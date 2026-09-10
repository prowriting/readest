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
import android.os.Handler
import android.os.Looper
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
import java.util.UUID

internal fun nativePlaybackSnapshotState(
    isPlaying: Boolean,
    playWhenReady: Boolean,
    playbackEnded: Boolean,
    hasMedia: Boolean
): String = when {
    playbackEnded -> "ended"
    isPlaying -> "playing"
    playWhenReady && hasMedia -> "loading"
    hasMedia -> "paused"
    else -> "stopped"
}

class MediaPlaybackService : MediaBrowserServiceCompat() {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var carBridgeStore: CarBridgeStore
    private var foregroundStarted = false
    private var reportedPlaying = false
    private var reportedPositionMs = 0L
    private var reportedPlaybackSpeed = 1f
    private var reportedSectionIndex = -1
    private var bookmarkedTextTarget: String? = null
    private var publishedBookmarkState = false
    private lateinit var nativePlayer: ExoPlayer
    private var nativePlayback = false
    private var audiobookOwnsMediaSession = false
    private var ttsOwnsMediaSession = false
    private var nativeManifest: BridgePlaybackManifest? = null
    private var nativeQueue: List<NativeQueueEntry> = emptyList()
    private var playbackSessionId = UUID.randomUUID().toString()
    private var playbackSequence = 0L
    private var sleepTimerMode: String? = null
    private var sleepTimerEndsAt: Long? = null
    private var lastNativeSaveAt = 0L
    private var nativeLocationUpdatedAt = 0L
    private val progressHandler = Handler(Looper.getMainLooper())
    private val progressSaver = object : Runnable {
        override fun run() {
            if (nativePlayback) {
                val now = System.currentTimeMillis()
                val timerEnd = sleepTimerEndsAt
                if (sleepTimerMode == "duration" && timerEnd != null) {
                    val remaining = timerEnd - now
                    when {
                        remaining <= 0L -> {
                            saveNativeLocation()
                            nativePlayer.pause()
                            nativePlayer.volume = 1f
                            sleepTimerMode = null
                            sleepTimerEndsAt = null
                        }
                        remaining <= 10_000L -> nativePlayer.volume =
                            (remaining.toFloat() / 10_000f).coerceIn(0f, 1f)
                        else -> nativePlayer.volume = 1f
                    }
                }
                if (nativePlayer.isPlaying) {
                    reportedPositionMs = nativeChapterPositionMs()
                    if (now - lastNativeSaveAt >= 5_000L) {
                        saveNativeLocation()
                        lastNativeSaveAt = now
                    }
                    emitPlaybackSnapshot()
                }
            }
            progressHandler.postDelayed(this, 1_000L)
        }
    }

    private data class NativeQueueEntry(
        val sectionIndex: Int,
        val segmentIndex: Int,
        val durationMs: Long,
        val mediaId: String,
        val segment: BridgePlaybackSegment
    )

    companion object {
        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"
        private const val AUDIOBOOKS_ID = "audiobooks"
        const val ACTION_ACTIVATE = "com.readest.native_tts.action.ACTIVATE"
        const val ACTION_UPDATE_METADATA = "com.readest.native_tts.action.UPDATE_METADATA"
        const val ACTION_UPDATE_PLAYBACK_STATE = "com.readest.native_tts.action.UPDATE_PLAYBACK_STATE"
        private const val ACTION_SEEK_BACK_30 = "com.readest.native_tts.action.SEEK_BACK_30"
        private const val ACTION_SEEK_FORWARD_30 = "com.readest.native_tts.action.SEEK_FORWARD_30"
        private const val ACTION_PLAYBACK_SPEED = "com.readest.native_tts.action.PLAYBACK_SPEED"
        private const val ACTION_ADD_BOOKMARK = "com.readest.native_tts.action.ADD_BOOKMARK"
        private const val SEEK_INTERVAL_MS = 30_000L
        private const val WEB_BOOKMARK_TARGET = "__web__"
        private val PLAYBACK_RATES = floatArrayOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)

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

        fun currentPlaybackLocation(bookId: String): BridgePlaybackLocation? =
            instance?.currentPlaybackLocationFor(bookId)

        fun releaseTtsOwnership() {
            instance?.releaseTtsOwnershipAndStopIfIdle()
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
        progressHandler.postDelayed(progressSaver, 1_000L)

        mediaSession = MediaSessionCompat(baseContext, "ReadestMediaSession").apply {
            stateBuilder = createStateBuilder()
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

    private fun createStateBuilder(): PlaybackStateCompat.Builder {
        val isBookmarked = isCurrentPositionBookmarked()
        publishedBookmarkState = isBookmarked
        return PlaybackStateCompat.Builder().setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
                PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
            )
                // Android Auto exposes only a small number of primary slots.
                // Put audiobook seek actions first so they flank Play/Pause;
                // less frequent actions remain available in overflow.
                .addCustomAction(
                    PlaybackStateCompat.CustomAction.Builder(
                        ACTION_SEEK_BACK_30,
                        getString(R.string.android_auto_seek_back_30),
                        R.drawable.ic_replay_30
                    ).build()
                )
                .addCustomAction(
                    PlaybackStateCompat.CustomAction.Builder(
                        ACTION_SEEK_FORWARD_30,
                        getString(R.string.android_auto_seek_forward_30),
                        R.drawable.ic_forward_30
                    ).build()
                )
                .addCustomAction(
                    PlaybackStateCompat.CustomAction.Builder(
                        ACTION_PLAYBACK_SPEED,
                        getString(
                            R.string.android_auto_playback_speed,
                            reportedPlaybackSpeed.toString().removeSuffix(".0")
                        ),
                        playbackSpeedIcon()
                    ).build()
                )
                .addCustomAction(
                    PlaybackStateCompat.CustomAction.Builder(
                        ACTION_ADD_BOOKMARK,
                        getString(
                            if (isBookmarked) R.string.android_auto_bookmark_added
                            else R.string.android_auto_add_bookmark
                        ),
                        if (isBookmarked) R.drawable.ic_bookmark_added
                        else R.drawable.ic_bookmark_add
                    ).build()
                )
                .setActiveQueueItemId(
                    if (reportedSectionIndex >= 0) reportedSectionIndex.toLong()
                    else MediaSessionCompat.QueueItem.UNKNOWN_ID.toLong()
                )
    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlay() {
            if (nativePlayback && audiobookOwnsMediaSession && nativePlayer.mediaItemCount > 0) {
                if (nativePlayer.playbackState == Player.STATE_ENDED) {
                    nativePlayer.seekTo(0, 0L)
                    saveNativeLocation()
                }
                nativePlayer.play()
                return
            }
            ensurePlaybackForeground()
            if (ttsOwnsMediaSession && pluginEventTrigger?.invoke("media-session-play", JSObject()) == true) {
                publishTransientState(PlaybackStateCompat.STATE_CONNECTING)
                return
            }
            val request = carBridgeStore.loadLastPlayRequest()
            if (request != null) playNatively(request)
            else publishPlaybackError(getString(R.string.android_auto_nothing_to_resume))
        }

        override fun onPause() {
            if (nativePlayback && audiobookOwnsMediaSession) {
                saveNativeLocation()
                nativePlayer.pause()
            } else if (pluginEventTrigger?.invoke("media-session-pause", JSObject()) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
            }
        }

        override fun onStop() {
            reportedPlaying = false
            if (nativePlayback && audiobookOwnsMediaSession) {
                saveNativeLocation()
                nativePlayer.stop()
                nativePlayback = false
                audiobookOwnsMediaSession = false
            }
            else pluginEventTrigger?.invoke("media-session-stop", JSObject())
            mediaSession?.setPlaybackState(
                stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, reportedPositionMs, 0f).build()
            )
            stopPlaybackForeground()
        }

        override fun onSkipToNext() {
            bookmarkedTextTarget = null
            stateBuilder = createStateBuilder()
            if (nativePlayback && audiobookOwnsMediaSession) seekToAdjacentChapter(1)
            else if (pluginEventTrigger?.invoke("media-session-next", JSObject()) != true) {
                publishPlaybackError(getString(R.string.android_auto_player_unavailable))
            }
        }

        override fun onSkipToPrevious() {
            bookmarkedTextTarget = null
            stateBuilder = createStateBuilder()
            if (nativePlayback && audiobookOwnsMediaSession) seekToAdjacentChapter(-1)
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
            bookmarkedTextTarget = null
            stateBuilder = createStateBuilder()
            if (nativePlayback && audiobookOwnsMediaSession) {
                seekNativeChapterPosition(pos)
                saveNativeLocation()
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
            mediaSession?.setPlaybackState(
                stateBuilder.setState(state, pos, reportedPlaybackSpeed).build()
            )
        }

        override fun onRewind() = seekRelative(-SEEK_INTERVAL_MS)

        override fun onFastForward() = seekRelative(SEEK_INTERVAL_MS)

        override fun onSkipToQueueItem(id: Long) {
            val sectionIndex = id.toInt()
            bookmarkedTextTarget = null
            stateBuilder = createStateBuilder()
            if (nativePlayback && audiobookOwnsMediaSession) {
                val targetIndex = nativeQueue.indexOfFirst { it.sectionIndex == sectionIndex }
                if (targetIndex >= 0) {
                    nativePlayer.seekTo(targetIndex, 0L)
                    updateNativeMetadata(sectionIndex)
                    saveNativeLocation()
                    publishPlaybackState()
                }
                return
            }
            val bookId = carBridgeStore.loadLastPlayRequest()?.bookId ?: return
            dispatchAudiobookPlay(BridgePlayRequest(bookId, sectionIndex))
        }

        override fun onCustomAction(action: String?, extras: Bundle?) {
            when (action) {
                ACTION_SEEK_BACK_30 -> seekRelative(-SEEK_INTERVAL_MS)
                ACTION_SEEK_FORWARD_30 -> seekRelative(SEEK_INTERVAL_MS)
                ACTION_PLAYBACK_SPEED -> cyclePlaybackRate()
                ACTION_ADD_BOOKMARK -> addBookmark()
            }
        }
    }

    private fun playbackSpeedIcon(): Int = when {
        reportedPlaybackSpeed < 0.875f -> R.drawable.ic_speed_075
        reportedPlaybackSpeed < 1.125f -> R.drawable.ic_speed_100
        reportedPlaybackSpeed < 1.375f -> R.drawable.ic_speed_125
        reportedPlaybackSpeed < 1.625f -> R.drawable.ic_speed_150
        reportedPlaybackSpeed < 1.875f -> R.drawable.ic_speed_175
        else -> R.drawable.ic_speed_200
    }

    private fun seekRelative(offsetMs: Long) {
        bookmarkedTextTarget = null
        stateBuilder = createStateBuilder()
        if (nativePlayback && audiobookOwnsMediaSession) {
            seekNativeRelative(offsetMs)
            saveNativeLocation()
            return
        }
        val data = JSObject().apply { put("seconds", offsetMs.toDouble() / 1_000) }
        if (pluginEventTrigger?.invoke("media-session-seek-relative", data) != true) {
            publishPlaybackError(getString(R.string.android_auto_player_unavailable))
        }
    }

    private fun cyclePlaybackRate() {
        val next = PLAYBACK_RATES.firstOrNull { it > reportedPlaybackSpeed + 0.01f }
            ?: PLAYBACK_RATES.first()
        reportedPlaybackSpeed = next
        stateBuilder = createStateBuilder()
        if (nativePlayback && audiobookOwnsMediaSession) {
            nativePlayer.setPlaybackSpeed(next)
        } else {
            pluginEventTrigger?.invoke(
                "media-session-set-rate",
                JSObject().apply { put("rate", next.toDouble()) }
            )
        }
        publishPlaybackState(updateNotification = true)
    }

    private fun addBookmark() {
        if (isCurrentPositionBookmarked()) return
        var added = false
        if (nativePlayback && audiobookOwnsMediaSession) {
            currentNativeLocation()?.let {
                carBridgeStore.savePendingBookmark(it)
                bookmarkedTextTarget = textTarget(it)
                added = true
            }
        } else if (pluginEventTrigger?.invoke("media-session-bookmark", JSObject()) == true) {
            bookmarkedTextTarget = WEB_BOOKMARK_TARGET
            added = true
        } else {
            publishPlaybackError(getString(R.string.android_auto_player_unavailable))
        }
        if (added) {
            stateBuilder = createStateBuilder()
            publishPlaybackState(updateNotification = true)
        }
    }

    private fun dispatchAudiobookPlay(request: BridgePlayRequest) {
        carBridgeStore.savePendingPlayRequest(request)
        carBridgeStore.saveLastPlayRequest(request)
        carBridgeStore.loadPlaybackManifest(request.bookId)?.let(::publishChapterQueue)
        playNatively(request)
    }

    private fun playNatively(request: BridgePlayRequest): JSObject? {
        val previousBookId = nativeManifest?.bookId
        val manifest = carBridgeStore.loadPlaybackManifest(request.bookId)
        if (manifest == null || manifest.sections.isEmpty()) {
            return failNativePlaybackReplacement(
                request.bookId,
                "manifest_unavailable",
                getString(R.string.android_auto_open_book_to_prepare)
            )
        }
        val audioIsAvailable = manifest.sections.all { section ->
            section.segments.isNotEmpty() && section.segments.all { File(it.path).isFile }
        }
        if (!audioIsAvailable) {
            return failNativePlaybackReplacement(
                request.bookId,
                "audio_unavailable",
                getString(R.string.android_auto_audio_unavailable)
            )
        }

        val queueEntries = mutableListOf<NativeQueueEntry>()
        val mediaItems = mutableListOf<MediaItem>()
        for (section in manifest.sections) {
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
                        .setMimeType(segment.type)
                        .setClippingConfiguration(clipping)
                        .build()
                )
                queueEntries.add(
                    NativeQueueEntry(section.sectionIndex, segmentIndex, durationMs, mediaId, segment)
                )
            }
        }

        val savedTarget = if (request.chapterIndex == null) CarBridgeCodec.resolvePlaybackLocation(
            manifest,
            carBridgeStore.loadPlaybackLocation(manifest.bookId)
        ) else null
        val resolvedSavedStart = savedTarget?.let { target ->
            queueEntries.indexOfFirst {
                it.sectionIndex == target.sectionIndex && it.segmentIndex == target.segmentIndex
            }.takeIf { it >= 0 }?.let { it to target.positionMs }
        }
        val startIndex = request.chapterIndex?.let { requestedSection ->
            queueEntries.indexOfFirst { it.sectionIndex == requestedSection }.takeIf { it >= 0 }
        } ?: resolvedSavedStart?.first ?: 0
        val startPositionMs = if (request.chapterIndex == null) resolvedSavedStart?.second ?: 0L else 0L
        if (nativePlayback && previousBookId != null && previousBookId != request.bookId) {
            saveNativeLocation()
        }
        nativeManifest = manifest
        if (previousBookId != manifest.bookId) playbackSessionId = UUID.randomUUID().toString()
        nativeQueue = queueEntries
        nativePlayback = true
        audiobookOwnsMediaSession = true
        ttsOwnsMediaSession = false
        reportedPlaying = false
        reportedPositionMs = 0L
        bookmarkedTextTarget = null
        publishChapterQueue(manifest)
        updateNativeMetadata(queueEntries[startIndex].sectionIndex)
        publishTransientState(PlaybackStateCompat.STATE_CONNECTING)
        ensurePlaybackForeground()
        carBridgeStore.takePendingPlayRequest()
        carBridgeStore.saveLastPlayRequest(
            BridgePlayRequest(manifest.bookId, null)
        )
        nativePlayer.setMediaItems(mediaItems, startIndex, startPositionMs)
        saveNativeLocation()
        nativePlayer.setPlaybackSpeed(reportedPlaybackSpeed)
        nativePlayer.prepare()
        nativePlayer.play()
        emitPlaybackSnapshot("loading")
        return null
    }

    private fun failNativePlaybackReplacement(
        bookId: String,
        error: String,
        message: String
    ): JSObject {
        clearNativePlaybackAfterFailedReplacement()
        publishPlaybackError(message)
        playbackSequence += 1
        return playbackSnapshot("error", error, bookId).also { snapshot ->
            pluginEventTrigger?.invoke("audiobook-playback-state", snapshot)
        }
    }

    private inner class NativePlayerListener : Player.Listener {
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!nativePlayback) return
            // Pausing during buffering changes playWhenReady without changing
            // isPlaying. Publish it so both command replies and car events
            // supersede the loading snapshot on the phone.
            if (!playWhenReady) saveNativeLocation()
            publishNativePlayerState()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!nativePlayback) return
            if (!isPlaying) saveNativeLocation()
            if (!isPlaying && nativePlayer.playbackState == Player.STATE_ENDED) return
            publishNativePlayerState()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (!nativePlayback) return
            when (playbackState) {
                Player.STATE_BUFFERING -> publishTransientState(PlaybackStateCompat.STATE_BUFFERING)
                Player.STATE_READY -> publishNativePlayerState()
                Player.STATE_ENDED -> {
                    saveNativeLocation()
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
                    emitPlaybackSnapshot("ended")
                }
                Player.STATE_IDLE -> Unit
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (!nativePlayback) return
            val entry = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return
            val previousSectionIndex = reportedSectionIndex
            updateNativeMetadata(entry.sectionIndex)
            carBridgeStore.saveLastPlayRequest(
                BridgePlayRequest(nativeManifest?.bookId ?: return, null)
            )
            saveNativeLocation()
            if (sleepTimerMode == "endOfChapter" &&
                reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
                previousSectionIndex >= 0 && previousSectionIndex != entry.sectionIndex) {
                nativePlayer.pause()
                sleepTimerMode = null
                sleepTimerEndsAt = null
            }
            publishNativePlayerState()
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!nativePlayback) return
            publishPlaybackError(getString(R.string.android_auto_audio_unavailable))
            emitPlaybackSnapshot("error", error.message)
        }
    }

    private fun publishNativePlayerState() {
        reportedPlaying = nativePlayer.isPlaying
        reportedPositionMs = nativeChapterPositionMs()
        val state = nativePlaybackSnapshotState(
            isPlaying = nativePlayer.isPlaying,
            playWhenReady = nativePlayer.playWhenReady,
            playbackEnded = nativePlayer.playbackState == Player.STATE_ENDED,
            hasMedia = nativePlayback && nativePlayer.mediaItemCount > 0
        )
        if (state == "loading") {
            publishTransientState(PlaybackStateCompat.STATE_BUFFERING)
        } else {
            if (reportedPlaying) ensurePlaybackForeground()
            publishPlaybackState(updateNotification = true)
        }
        emitPlaybackSnapshot(state)
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

    private fun seekNativeRelative(offsetMs: Long) {
        val itemIndex = nativePlayer.currentMediaItemIndex
        if (!nativeQueue.indices.contains(itemIndex)) return
        val total = nativeQueue.sumOf { it.durationMs }
        val current = nativeQueue.take(itemIndex).sumOf { it.durationMs } +
            nativePlayer.currentPosition.coerceAtLeast(0L)
        var remaining = (current + offsetMs).coerceIn(0L, total)
        for ((index, entry) in nativeQueue.withIndex()) {
            if (remaining < entry.durationMs || index == nativeQueue.lastIndex) {
                nativePlayer.seekTo(index, remaining.coerceIn(0L, entry.durationMs))
                updateNativeMetadata(entry.sectionIndex)
                reportedPositionMs = nativeChapterPositionMs()
                publishPlaybackState()
                return
            }
            remaining -= entry.durationMs
        }
    }

    private fun currentNativeLocation(updatedAt: Long = nativeLocationUpdatedAt): BridgePlaybackLocation? {
        val manifest = nativeManifest ?: return null
        val entry = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return null
        val segmentPositionMs = nativePlayer.currentPosition.coerceIn(0L, entry.durationMs)
        val sourceTimeMs = entry.segment.clipBeginMs + segmentPositionMs
        val sourceDurationMs = entry.segment.sourceDurationMs.coerceAtLeast(entry.segment.clipEndMs)
        val totalDurationMs = manifest.sections.sumOf { it.durationMs }
        val beforeSectionMs = manifest.sections.takeWhile { it.sectionIndex != entry.sectionIndex }
            .sumOf { it.durationMs }
        val totalElapsedMs = beforeSectionMs + nativeChapterPositionMs()
        val section = manifest.sections.firstOrNull { it.sectionIndex == entry.sectionIndex }
        val cue = entry.segment.cues.lastOrNull { it.offsetMs <= segmentPositionMs }
        val textLocator = cue?.text?.lastIndexOf('#')?.takeIf { it > 0 }?.let { separator ->
            BridgeLocator(
                cue.text.substring(0, separator),
                "application/xhtml+xml",
                section?.label,
                listOf(cue.text.substring(separator + 1)),
                null,
                null
            )
        }
        return BridgePlaybackLocation(
                2,
                manifest.bookId,
                BridgeLocator(
                    entry.segment.href,
                    entry.segment.type,
                    section?.label,
                    listOf("t=${sourceTimeMs.toDouble() / 1_000}"),
                    if (sourceDurationMs > 0) {
                        (sourceTimeMs.toDouble() / sourceDurationMs).coerceIn(0.0, 1.0)
                    } else null,
                    if (totalDurationMs > 0) {
                        (totalElapsedMs.toDouble() / totalDurationMs).coerceIn(0.0, 1.0)
                    } else null
                ),
                textLocator,
                updatedAt
        )
    }

    private fun textTarget(location: BridgePlaybackLocation): String? {
        val locator = location.textLocator ?: return null
        val fragment = locator.fragments.firstOrNull() ?: return null
        return "${locator.href}#$fragment"
    }

    private fun isCurrentPositionBookmarked(): Boolean {
        val bookmarked = bookmarkedTextTarget ?: return false
        if (bookmarked == WEB_BOOKMARK_TARGET) return !nativePlayback
        return currentNativeLocation()?.let(::textTarget) == bookmarked
    }

    private fun saveNativeLocation() {
        val persistedUpdatedAt = nativeManifest?.bookId
            ?.let(carBridgeStore::loadPlaybackLocation)
            ?.updatedAt
            ?: 0L
        val previousUpdatedAt = maxOf(nativeLocationUpdatedAt, persistedUpdatedAt)
        val updatedAt = maxOf(
            System.currentTimeMillis(),
            if (previousUpdatedAt == Long.MAX_VALUE) previousUpdatedAt else previousUpdatedAt + 1L
        )
        currentNativeLocation(updatedAt)?.let { location ->
            nativeLocationUpdatedAt = updatedAt
            carBridgeStore.savePlaybackLocation(location)
        }
    }

    private fun clearNativePlaybackAfterFailedReplacement() {
        if (nativePlayback) saveNativeLocation()
        nativePlayer.pause()
        nativePlayer.clearMediaItems()
        nativePlayback = false
        audiobookOwnsMediaSession = false
        nativeManifest = null
        nativeQueue = emptyList()
        bookmarkedTextTarget = null
        reportedPlaying = false
        reportedPositionMs = 0L
        nativeLocationUpdatedAt = 0L
    }

    private fun releaseTtsOwnershipAndStopIfIdle() {
        ttsOwnsMediaSession = false
        if (!nativePlayback && !audiobookOwnsMediaSession) stopSelf()
    }

    internal fun playbackSnapshot(
        stateOverride: String? = null,
        error: String? = null,
        bookIdOverride: String? = null
    ): JSObject {
        val entry = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex)
        val location = currentNativeLocation()
        return JSObject().apply {
            put("sessionId", playbackSessionId)
            put("sequence", playbackSequence)
            put(
                "bookId",
                bookIdOverride
                    ?: nativeManifest?.bookId
                    ?: carBridgeStore.loadLastPlayRequest()?.bookId.orEmpty()
            )
            put(
                "state",
                stateOverride ?: if (error != null) "error" else nativePlaybackSnapshotState(
                    isPlaying = nativePlayer.isPlaying,
                    playWhenReady = nativePlayer.playWhenReady,
                    playbackEnded = nativePlayer.playbackState == Player.STATE_ENDED,
                    hasMedia = nativePlayback && nativePlayer.mediaItemCount > 0
                )
            )
            location?.let { put("location", playbackLocationToJs(it)) }
            put("chapterIndex", entry?.sectionIndex ?: -1)
            put("chapterPositionMs", nativeChapterPositionMs())
            put("chapterDurationMs", nativeChapterDurationMs())
            put("playbackRate", reportedPlaybackSpeed.toDouble())
            put("isBookmarked", isCurrentPositionBookmarked())
            sleepTimerEndsAt?.let { put("sleepTimerEndsAt", it) }
            error?.let { put("error", it) }
        }
    }

    private fun playbackLocationToJs(location: BridgePlaybackLocation): JSObject {
        fun locatorToJs(locator: BridgeLocator): JSObject = JSObject().apply {
            put("href", locator.href)
            put("type", locator.type)
            locator.title?.let { put("title", it) }
            put("locations", JSObject().apply {
                put("fragments", org.json.JSONArray(locator.fragments))
                locator.progression?.let { put("progression", it) }
                locator.totalProgression?.let { put("totalProgression", it) }
            })
        }
        return JSObject().apply {
            put("schemaVersion", location.schemaVersion)
            put("editionId", location.editionId)
            put("locator", locatorToJs(location.locator))
            location.textLocator?.let { put("textLocator", locatorToJs(it)) }
            put("updatedAt", location.updatedAt)
        }
    }

    private fun emitPlaybackSnapshot(state: String? = null, error: String? = null) {
        val bookmarkState = isCurrentPositionBookmarked()
        if (bookmarkState != publishedBookmarkState) {
            publishedBookmarkState = bookmarkState
            stateBuilder = createStateBuilder()
            publishPlaybackState(updateNotification = true)
        }
        playbackSequence += 1
        pluginEventTrigger?.invoke("audiobook-playback-state", playbackSnapshot(state, error))
    }

    private fun seekNativeToLocation(location: BridgePlaybackLocation) {
        val manifest = nativeManifest ?: return
        val target = CarBridgeCodec.resolvePlaybackLocation(manifest, location) ?: return
        val queueIndex = nativeQueue.indexOfFirst {
            it.sectionIndex == target.sectionIndex && it.segmentIndex == target.segmentIndex
        }
        if (queueIndex < 0) return
        nativePlayer.seekTo(queueIndex, target.positionMs)
        updateNativeMetadata(target.sectionIndex)
        saveNativeLocation()
        publishPlaybackState()
        emitPlaybackSnapshot()
    }

    internal fun handleAudiobookCommand(
        action: String,
        bookId: String?,
        chapterIndex: Int?,
        offsetMs: Long?,
        rate: Float?,
        volume: Float?,
        location: BridgePlaybackLocation?,
        timerMode: String?,
        timerEndsAt: Long?
    ): JSObject {
        when (action) {
            "play" -> {
                audiobookOwnsMediaSession = true
                ttsOwnsMediaSession = false
                rate?.coerceIn(0.5f, 3f)?.let {
                    reportedPlaybackSpeed = it
                    nativePlayer.setPlaybackSpeed(it)
                    stateBuilder = createStateBuilder()
                }
                if (location != null) carBridgeStore.savePlaybackLocation(location)
                if (nativePlayback && nativePlayer.mediaItemCount > 0 &&
                    (bookId == null || nativeManifest?.bookId == bookId)) {
                    location?.let(::seekNativeToLocation)
                    if (nativePlayer.playbackState == Player.STATE_ENDED) {
                        nativePlayer.seekTo(0, 0L)
                        saveNativeLocation()
                    }
                    nativePlayer.play()
                } else if (!bookId.isNullOrBlank()) {
                    playNatively(BridgePlayRequest(bookId, null))?.let { return it }
                }
            }
            "startChapter" -> if (!bookId.isNullOrBlank() && chapterIndex != null) {
                audiobookOwnsMediaSession = true
                ttsOwnsMediaSession = false
                playNatively(BridgePlayRequest(bookId, chapterIndex))?.let { return it }
            }
            "pause" -> if (nativePlayback) {
                saveNativeLocation()
                nativePlayer.pause()
            }
            "stop" -> if (nativePlayback) {
                saveNativeLocation()
                nativePlayer.stop()
                nativePlayback = false
                audiobookOwnsMediaSession = false
                reportedPlaying = false
                publishPlaybackState(updateNotification = true)
                emitPlaybackSnapshot("stopped")
            }
            "nextChapter" -> seekToAdjacentChapter(1)
            "previousChapter" -> seekToAdjacentChapter(-1)
            "seekRelative" -> offsetMs?.let {
                bookmarkedTextTarget = null
                stateBuilder = createStateBuilder()
                seekNativeRelative(it)
                saveNativeLocation()
                emitPlaybackSnapshot()
            }
            "seekToLocator" -> location?.let {
                bookmarkedTextTarget = null
                stateBuilder = createStateBuilder()
                seekNativeToLocation(it)
            }
            "setRate" -> rate?.coerceIn(0.5f, 3f)?.let {
                reportedPlaybackSpeed = it
                nativePlayer.setPlaybackSpeed(it)
                stateBuilder = createStateBuilder()
                publishPlaybackState(updateNotification = true)
                emitPlaybackSnapshot()
            }
            "setVolume" -> volume?.let { nativePlayer.volume = it.coerceIn(0f, 1f) }
            "addBookmark" -> addBookmark()
            "setSleepTimer" -> {
                sleepTimerMode = timerMode?.takeIf { it == "duration" || it == "endOfChapter" }
                sleepTimerEndsAt = if (sleepTimerMode == "duration") timerEndsAt else null
                emitPlaybackSnapshot()
            }
            "cancelSleepTimer" -> {
                sleepTimerMode = null
                sleepTimerEndsAt = null
                nativePlayer.volume = 1f
                emitPlaybackSnapshot()
            }
        }
        return playbackSnapshot()
    }

    private fun currentPlaybackLocationFor(bookId: String): BridgePlaybackLocation? =
        if (nativePlayback && nativeManifest?.bookId == bookId) currentNativeLocation() else null

    private fun seekToAdjacentChapter(direction: Int) {
        val current = nativeQueue.getOrNull(nativePlayer.currentMediaItemIndex) ?: return
        val sectionIndexes = nativeQueue.map { it.sectionIndex }.distinct()
        val currentChapter = sectionIndexes.indexOf(current.sectionIndex)
        val target = sectionIndexes.getOrNull(currentChapter + direction) ?: return
        val targetIndex = nativeQueue.indexOfFirst { it.sectionIndex == target }
        if (targetIndex >= 0) {
            nativePlayer.seekTo(targetIndex, 0L)
            updateNativeMetadata(target)
            saveNativeLocation()
            publishPlaybackState()
            emitPlaybackSnapshot()
        }
    }

    private fun updateNativeMetadata(sectionIndex: Int) {
        val manifest = nativeManifest ?: return
        val section = manifest.sections.firstOrNull { it.sectionIndex == sectionIndex } ?: return
        reportedSectionIndex = sectionIndex
        stateBuilder = createStateBuilder()
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

    private fun publishChapterQueue(manifest: BridgePlaybackManifest) {
        val queue = manifest.sections
            .filter { it.segments.isNotEmpty() }
            .map { section ->
                val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                    .setMediaId("chapter:${manifest.bookId}:${section.sectionIndex}")
                    .setTitle(section.label)
                    .setSubtitle(manifest.title)
                    .build()
                MediaSessionCompat.QueueItem(description, section.sectionIndex.toLong())
            }
        mediaSession?.setQueue(queue)
        mediaSession?.setQueueTitle(getString(R.string.android_auto_chapters))
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
            ttsOwnsMediaSession = true
            audiobookOwnsMediaSession = false
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
            carBridgeStore.loadLastPlayRequest()?.bookId
                ?.let(carBridgeStore::loadPlaybackManifest)
                ?.let(::publishChapterQueue)

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
            val playbackRate = intent.getFloatExtra("playbackRate", 1f)

            if (nativePlayback) {
                saveNativeLocation()
                audiobookOwnsMediaSession = false
                ttsOwnsMediaSession = true
                nativePlayer.pause()
            }
            if (isPlaying) ensurePlaybackForeground()
            // The WebView's HTMLMediaElement owns Android audio focus for
            // in-app playback. This service mirrors its state for Auto and
            // notifications, but must not request a second focus lease: doing
            // so immediately pauses BookArc's own WebView audio.
            reportedPlaying = isPlaying
            reportedPositionMs = position
            reportedPlaybackSpeed = playbackRate.coerceIn(0.5f, 3f)
            stateBuilder = createStateBuilder()
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
        if (nativePlayback) saveNativeLocation()
        progressHandler.removeCallbacks(progressSaver)
        nativePlayer.release()
        stopPlaybackForeground()
        super.onDestroy()
        mediaSession?.release()
    }
}
