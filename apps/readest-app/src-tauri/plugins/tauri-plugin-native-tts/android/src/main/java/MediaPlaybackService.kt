package com.readest.native_tts

import com.readest.native_tts.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.session.MediaButtonReceiver
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.tauri.plugin.JSObject
import java.io.File

class MediaPlaybackService : MediaBrowserServiceCompat() {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var carBridgeStore: CarBridgeStore
    private var foregroundStarted = false
    private var reportedPlaying = false
    private var reportedPositionMs = 0L
    private var reportedPlaybackSpeed = 1f
    private lateinit var nativePlayer: ExoPlayer
    private var nativePlayback = false
    private var nativeManifest: BridgePlaybackManifest? = null
    private var nativeQueue: List<NativeQueueEntry> = emptyList()

    private data class NativeQueueEntry(
        val sectionIndex: Int,
        val segmentIndex: Int,
        val durationMs: Long,
        val mediaId: String
    )

    companion object {
        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"
        private const val AUDIOBOOKS_ID = "audiobooks"
        const val ACTION_ACTIVATE = "com.readest.native_tts.action.ACTIVATE"
        const val ACTION_UPDATE_METADATA = "com.readest.native_tts.action.UPDATE_METADATA"
        const val ACTION_UPDATE_PLAYBACK_STATE = "com.readest.native_tts.action.UPDATE_PLAYBACK_STATE"

        var pluginEventTrigger: ((String, JSObject) -> Boolean)? = null

        var currentTitle: String = "Read Aloud"
        var currentArtist: String = "Reading your content"
        var currentArtwork: Bitmap? = null
        var currentDurationMs: Long = -1L

        fun updateLibrary(context: Context, books: List<BridgeBook>) {
            CarBridgeStore(context.applicationContext).saveBooks(books)
            instance?.notifyChildrenChanged(MEDIA_ROOT_ID)
            instance?.notifyChildrenChanged(AUDIOBOOKS_ID)
        }

        fun updateChapters(context: Context, bookId: String, chapters: List<BridgeChapter>) {
            CarBridgeStore(context.applicationContext).saveChapters(bookId, chapters)
            instance?.notifyChildrenChanged("book:$bookId")
        }

        fun notifyPlaybackManifestChanged(bookId: String) {
            instance?.notifyChildrenChanged("book:$bookId")
        }

        @Volatile var instance: MediaPlaybackService? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        carBridgeStore = CarBridgeStore(applicationContext)

        nativePlayer = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                true
            )
            addListener(NativePlayerListener())
        }

        mediaSession = MediaSessionCompat(baseContext, "ReadestMediaSession").apply {
            stateBuilder = PlaybackStateCompat.Builder().setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
                PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
            )
            setPlaybackState(
                stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, 0L, 0f).build()
            )
            setCallback(SessionCallback())
            setSessionToken(sessionToken)
            packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                setSessionActivity(PendingIntent.getActivity(this@MediaPlaybackService, 0, launchIntent, flags))
            }
            isActive = true
        }

    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlay() {
            if (nativePlayback && nativePlayer.mediaItemCount > 0) {
                nativePlayer.play()
                return
            }
            if (pluginEventTrigger?.invoke("media-session-play", JSObject()) == true) {
                publishTransientState(PlaybackStateCompat.STATE_CONNECTING)
                return
            }
            val request = carBridgeStore.loadLastPlayRequest()
            if (request != null) playNatively(request)
            else publishPlaybackError(getString(R.string.android_auto_nothing_to_resume))
        }

        override fun onPause() {
            if (nativePlayback) {
                nativePlayer.pause()
            } else if (pluginEventTrigger?.invoke("media-session-pause", JSObject()) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
            }
        }

        override fun onStop() {
            reportedPlaying = false
            if (nativePlayback) nativePlayer.stop()
            else pluginEventTrigger?.invoke("media-session-stop", JSObject())
            mediaSession?.setPlaybackState(
                stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, reportedPositionMs, 0f).build()
            )
            stopPlaybackForeground()
        }

        override fun onSkipToNext() {
            if (nativePlayback) seekToAdjacentChapter(1)
            else if (pluginEventTrigger?.invoke("media-session-next", JSObject()) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
            }
        }

        override fun onSkipToPrevious() {
            if (nativePlayback) seekToAdjacentChapter(-1)
            else if (pluginEventTrigger?.invoke("media-session-previous", JSObject()) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
            }
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            if (mediaId == null) return
            val request = if (mediaId.startsWith("chapter:")) {
                val value = mediaId.removePrefix("chapter:")
                val separator = value.lastIndexOf(':')
                if (separator <= 0) return
                val index = value.substring(separator + 1).toIntOrNull() ?: return
                BridgePlayRequest(value.substring(0, separator), index)
            } else {
                BridgePlayRequest(mediaId.removePrefix("book:"), null)
            }
            dispatchAudiobookPlay(request)
        }

        override fun onPlayFromSearch(query: String?, extras: Bundle?) {
            val book = CarBridgeCodec.findBook(carBridgeStore.loadBooks(), query.orEmpty()) ?: return
            dispatchAudiobookPlay(BridgePlayRequest(book.id, null))
        }

        override fun onSeekTo(pos: Long) {
            if (nativePlayback) {
                seekNativeChapterPosition(pos)
                return
            }
            reportedPositionMs = pos
            val data = JSObject()
            data.put("position", pos)
            if (pluginEventTrigger?.invoke("media-session-seek", data) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
                return
            }
            // Reflect the scrub immediately; the app confirms with the next
            // UPDATE_PLAYBACK_STATE once the real seek lands.
            val state = if (reportedPlaying) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED
            mediaSession?.setPlaybackState(stateBuilder.setState(state, pos, 1f).build())
        }
    }

    private fun dispatchAudiobookPlay(request: BridgePlayRequest) {
        carBridgeStore.savePendingPlayRequest(request)
        carBridgeStore.saveLastPlayRequest(request)
        val data = JSObject().apply {
            put("bookId", request.bookId)
            request.chapterIndex?.let { put("chapterIndex", it) }
        }
        val delivered = pluginEventTrigger?.invoke("audiobook-play", data) == true
        if (delivered) {
            carBridgeStore.takePendingPlayRequest()
            publishTransientState(PlaybackStateCompat.STATE_CONNECTING)
            return
        }
        playNatively(request)
    }

    private fun playNatively(request: BridgePlayRequest) {
        val manifest = carBridgeStore.loadPlaybackManifest(request.bookId)
        if (manifest == null || manifest.sections.isEmpty()) {
            publishPlaybackError(getString(R.string.android_auto_open_book_to_prepare))
            return
        }
        val playableSections = manifest.sections.filter { section ->
            section.segments.isNotEmpty() && section.segments.all { File(it.path).isFile }
        }
        if (playableSections.isEmpty()) {
            publishPlaybackError(getString(R.string.android_auto_audio_unavailable))
            return
        }

        val queueEntries = mutableListOf<NativeQueueEntry>()
        val mediaItems = mutableListOf<MediaItem>()
        for (section in playableSections) {
            section.segments.forEachIndexed { segmentIndex, segment ->
                val durationMs = (segment.clipEndMs - segment.clipBeginMs).coerceAtLeast(0L)
                val mediaId = "chapter:${manifest.bookId}:${section.sectionIndex}:$segmentIndex"
                val clipping = MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(segment.clipBeginMs)
                    .setEndPositionMs(segment.clipEndMs)
                    .build()
                mediaItems.add(
                    MediaItem.Builder()
                        .setMediaId(mediaId)
                        .setUri(Uri.fromFile(File(segment.path)))
                        .setClippingConfiguration(clipping)
                        .build()
                )
                queueEntries.add(
                    NativeQueueEntry(section.sectionIndex, segmentIndex, durationMs, mediaId)
                )
            }
        }

        val requestedSection = request.chapterIndex
            ?: manifest.currentSectionIndex
            ?: playableSections.first().sectionIndex
        val startIndex = queueEntries.indexOfFirst { it.sectionIndex == requestedSection }
            .takeIf { it >= 0 } ?: 0
        nativeManifest = manifest
        nativeQueue = queueEntries
        nativePlayback = true
        reportedPlaying = false
        reportedPositionMs = 0L
        updateNativeMetadata(queueEntries[startIndex].sectionIndex)
        publishTransientState(PlaybackStateCompat.STATE_CONNECTING)
        ensurePlaybackForeground()
        carBridgeStore.takePendingPlayRequest()
        carBridgeStore.saveLastPlayRequest(
            BridgePlayRequest(manifest.bookId, queueEntries[startIndex].sectionIndex)
        )
        nativePlayer.setMediaItems(mediaItems, startIndex, 0L)
        nativePlayer.prepare()
        nativePlayer.play()
    }

    private inner class NativePlayerListener : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!nativePlayback) return
            reportedPlaying = isPlaying
            reportedPositionMs = nativeChapterPositionMs()
            if (isPlaying) ensurePlaybackForeground()
            publishPlaybackState(updateNotification = true)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (!nativePlayback) return
            when (playbackState) {
                Player.STATE_BUFFERING -> publishTransientState(PlaybackStateCompat.STATE_BUFFERING)
                Player.STATE_READY -> {
                    reportedPlaying = nativePlayer.isPlaying
                    reportedPositionMs = nativeChapterPositionMs()
                    publishPlaybackState(updateNotification = true)
                }
                Player.STATE_ENDED -> {
                    reportedPlaying = false
                    reportedPositionMs = nativeChapterDurationMs()
                    mediaSession?.setPlaybackState(
                        stateBuilder.setState(
                            PlaybackStateCompat.STATE_STOPPED,
                            reportedPositionMs,
                            0f
                        ).build()
                    )
                    stopPlaybackForeground()
                }
                Player.STATE_IDLE -> Unit
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (!nativePlayback) return
            val entry = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return
            updateNativeMetadata(entry.sectionIndex)
            carBridgeStore.saveLastPlayRequest(
                BridgePlayRequest(nativeManifest?.bookId ?: return, entry.sectionIndex)
            )
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!nativePlayback) return
            publishPlaybackError(getString(R.string.android_auto_audio_unavailable))
        }
    }

    private fun nativeChapterPositionMs(): Long {
        val currentIndex = nativePlayer.currentMediaItemIndex
        val current = nativeQueue.getOrNull(currentIndex) ?: return 0L
        val before = nativeQueue.take(currentIndex)
            .filter { it.sectionIndex == current.sectionIndex }
            .sumOf { it.durationMs }
        return before + nativePlayer.currentPosition.coerceAtLeast(0L)
    }

    private fun nativeChapterDurationMs(): Long {
        val sectionIndex = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex)?.sectionIndex
            ?: return 0L
        return nativeManifest?.sections?.firstOrNull { it.sectionIndex == sectionIndex }?.durationMs
            ?: nativeQueue.filter { it.sectionIndex == sectionIndex }.sumOf { it.durationMs }
    }

    private fun seekNativeChapterPosition(positionMs: Long) {
        val current = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return
        var remaining = positionMs.coerceAtLeast(0L)
        for ((index, entry) in nativeQueue.withIndex()) {
            if (entry.sectionIndex != current.sectionIndex) continue
            if (remaining < entry.durationMs || entry.durationMs == 0L) {
                nativePlayer.seekTo(index, remaining.coerceAtMost(entry.durationMs))
                reportedPositionMs = positionMs
                publishPlaybackState()
                return
            }
            remaining -= entry.durationMs
        }
        val lastIndex = nativeQueue.indexOfLast { it.sectionIndex == current.sectionIndex }
        if (lastIndex >= 0) nativePlayer.seekTo(lastIndex, nativeQueue[lastIndex].durationMs)
    }

    private fun seekToAdjacentChapter(direction: Int) {
        val current = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return
        val sectionIndexes = nativeQueue.map { it.sectionIndex }.distinct()
        val currentChapter = sectionIndexes.indexOf(current.sectionIndex)
        val target = sectionIndexes.getOrNull(currentChapter + direction) ?: return
        val targetIndex = nativeQueue.indexOfFirst { it.sectionIndex == target }
        if (targetIndex >= 0) nativePlayer.seekTo(targetIndex, 0L)
    }

    private fun updateNativeMetadata(sectionIndex: Int) {
        val manifest = nativeManifest ?: return
        val section = manifest.sections.firstOrNull { it.sectionIndex == sectionIndex } ?: return
        currentTitle = manifest.title
        currentArtist = manifest.author
        currentDurationMs = section.durationMs
        currentArtwork = manifest.coverPath?.let { path ->
            BitmapFactory.decodeFile(path)
        }
        mediaSession?.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, "chapter:${manifest.bookId}:$sectionIndex")
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, section.label)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
                .build()
        )
    }

    private fun publishTransientState(state: Int) {
        reportedPlaying = false
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, reportedPositionMs, 0f).build()
        )
    }

    private fun publishPlaybackError(message: String) {
        reportedPlaying = false
        mediaSession?.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(stateBuilder.build().actions)
                .setState(PlaybackStateCompat.STATE_ERROR, reportedPositionMs, 0f)
                .setErrorMessage(PlaybackStateCompat.ERROR_CODE_APP_ERROR, message)
                .build()
        )
        if (foregroundStarted) showNotification(PlaybackStateCompat.STATE_PAUSED)
    }

    private fun ensurePlaybackForeground() {
        if (foregroundStarted) return
        foregroundStarted = true
        showNotification(
            if (reportedPlaying) PlaybackStateCompat.STATE_PLAYING
            else PlaybackStateCompat.STATE_PAUSED
        )
    }

    private fun stopPlaybackForeground() {
        if (foregroundStarted) {
            @Suppress("DEPRECATION")
            stopForeground(true)
            foregroundStarted = false
        }
    }

    private fun publishPlaybackState(updateNotification: Boolean = false) {
        val state = if (reportedPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            stateBuilder.setState(
                state,
                reportedPositionMs,
                if (reportedPlaying) reportedPlaybackSpeed else 0f
            ).build()
        )
        if (foregroundStarted && updateNotification) updateNotification(state)
    }

    private fun showNotification(playbackState: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Media Controls", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        startForeground(NOTIFICATION_ID, buildNotification(playbackState))
    }

    private fun updateNotification(playbackState: Int) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(playbackState))
    }

    private fun buildNotification(playbackState: Int): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID).apply {
            setContentTitle(currentTitle)
            setContentText(currentArtist)
            setLargeIcon(currentArtwork)
            setContentIntent(mediaSession!!.controller.sessionActivity)
            setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this@MediaPlaybackService, PlaybackStateCompat.ACTION_STOP))
            setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            setSmallIcon(R.drawable.ic_car_attribution)

            addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this@MediaPlaybackService,
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
            )
            if (playbackState == PlaybackStateCompat.STATE_PLAYING) {
                addAction(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(
                        this@MediaPlaybackService,
                        PlaybackStateCompat.ACTION_PAUSE
                    )
                )
            } else {
                addAction(
                    android.R.drawable.ic_media_play,
                    "Play",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(
                        this@MediaPlaybackService,
                        PlaybackStateCompat.ACTION_PLAY
                    )
                )
            }

            addAction(
                android.R.drawable.ic_media_next,
                "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this@MediaPlaybackService,
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                )
            )

            setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        }
        return builder.build()
    }

    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
        return BrowserRoot(MEDIA_ROOT_ID, null)
    }

    // Android Auto browse tree: root → Audiobooks → books → cached chapters.
    // The root has a browsable-only child because some car hosts drop playable
    // items at that level. Books remain directly playable even before their
    // chapter list has been cached.
    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        val items = mutableListOf<MediaBrowserCompat.MediaItem>()
        if (parentId == MEDIA_ROOT_ID) {
            val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                .setMediaId(AUDIOBOOKS_ID)
                .setTitle(getString(R.string.android_auto_audiobooks))
                .build()
            items.add(
                MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE)
            )
        } else if (parentId == AUDIOBOOKS_ID) {
            for (book in carBridgeStore.loadBooks()) {
                val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                    .setMediaId("book:" + book.id)
                    .setTitle(book.title)
                    .setSubtitle(book.author)
                    .build()
                val flags = MediaBrowserCompat.MediaItem.FLAG_PLAYABLE or
                    if (carBridgeStore.loadChapters(book.id).isNotEmpty()) {
                        MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
                    } else {
                        0
                    }
                items.add(
                    MediaBrowserCompat.MediaItem(
                        description,
                        flags
                    )
                )
            }
        } else if (parentId.startsWith("book:")) {
            val bookId = parentId.removePrefix("book:")
            for (chapter in carBridgeStore.loadChapters(bookId)) {
                val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                    .setMediaId("chapter:" + bookId + ":" + chapter.index)
                    .setTitle(chapter.label)
                    .build()
                items.add(
                    MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
                )
            }
        }
        result.sendResult(items)
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        MediaButtonReceiver.handleIntent(mediaSession, intent)

        if (intent?.action == ACTION_ACTIVATE) {
            ensurePlaybackForeground()
        } else if (intent?.action == ACTION_UPDATE_METADATA) {
            currentTitle = intent.getStringExtra("title") ?: currentTitle
            currentArtist = intent.getStringExtra("artist") ?: currentArtist
            val newArtwork = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra("artwork", Bitmap::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra("artwork")
            }
            currentArtwork = newArtwork
            currentDurationMs = -1L

            val metadataBuilder = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
            if (currentDurationMs > 0) {
                metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
            }
            
            mediaSession?.setMetadata(metadataBuilder.build())

            if (foregroundStarted) {
                updateNotification(
                    if (reportedPlaying) PlaybackStateCompat.STATE_PLAYING
                    else PlaybackStateCompat.STATE_PAUSED
                )
            }
        } else if (intent?.action == ACTION_UPDATE_PLAYBACK_STATE) {
            val isPlaying = intent.getBooleanExtra("playing", false)
            val position = intent.getLongExtra("position", 0L) // in milliseconds
            val duration = intent.getLongExtra("duration", 0L) // in milliseconds

            if (nativePlayback) {
                nativePlayer.stop()
                nativePlayback = false
                nativeManifest = null
                nativeQueue = emptyList()
            }
            reportedPlaying = isPlaying
            reportedPositionMs = position
            if (isPlaying) {
                ensurePlaybackForeground()
            }

            if (duration > 0 && duration != currentDurationMs) {
                currentDurationMs = duration
                val metadataBuilder = MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
                mediaSession?.setMetadata(metadataBuilder.build())
            }

            publishPlaybackState()
        }

        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        nativePlayer.release()
        stopPlaybackForeground()
        super.onDestroy()
        mediaSession?.release()
    }
}
