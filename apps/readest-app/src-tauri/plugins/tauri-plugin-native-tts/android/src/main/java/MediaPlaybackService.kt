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
import android.util.Log
import android.view.KeyEvent
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.AudioManager.OnAudioFocusChangeListener
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.session.MediaButtonReceiver
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.tauri.plugin.JSObject

class MediaPlaybackService : MediaBrowserServiceCompat() {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var player: ExoPlayer
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var audioManager: AudioManager

    private val afChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        Log.i("MediaPlaybackService", "Audio focus changed: $focusChange, $player.isPlaying")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                player.volume = 1.0f
                if (!player.isPlaying) player.play()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                player.volume = 0.3f
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (player.isPlaying) player.pause()
            }
        }
    }

    companion object {
        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"

        var pluginEventTrigger: ((String, JSObject) -> Unit)? = null

        var currentTitle: String = "Read Aloud"
        var currentArtist: String = "Reading your content"
        var currentArtwork: Bitmap? = null
        var currentDurationMs: Long = -1L

        // Audiobook browse cache pushed from the webview (car bridge).
        data class BridgeBook(val id: String, val title: String, val author: String, val durationSec: Double)
        data class BridgeChapter(val index: Int, val label: String)
        var bridgeBooks: List<BridgeBook> = emptyList()
        var bridgeChaptersBookId: String? = null
        var bridgeChapters: List<BridgeChapter> = emptyList()

        fun notifyBridgeChanged() {
            instance?.notifyChildrenChanged(MEDIA_ROOT_ID)
            bridgeChaptersBookId?.let { instance?.notifyChildrenChanged("book:" + it) }
        }
        @Volatile var instance: MediaPlaybackService? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val result = audioManager.requestAudioFocus(
            afChangeListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN
        )
        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.d("MediaPlaybackService", "Audio focus granted")
        } else {
            Log.w("MediaPlaybackService", "Failed to gain audio focus")
        }

        player = ExoPlayer.Builder(this).build()

        mediaSession = MediaSessionCompat(baseContext, "ReadestMediaSession").apply {
            stateBuilder = PlaybackStateCompat.Builder().setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
            )
            setPlaybackState(stateBuilder.build())
            setCallback(SessionCallback())
            setSessionToken(sessionToken)
            isActive = true
        }

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updatePlaybackState()
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                updatePlaybackState()
            }
        })

        val mediaItem = MediaItem.fromUri("asset:///silence.mp3")
        player.setMediaItem(mediaItem)
        player.repeatMode = Player.REPEAT_MODE_ONE
        player.prepare()
        player.playWhenReady = true

        showNotification(PlaybackStateCompat.STATE_PLAYING)
    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlay() {
            player.play()
            pluginEventTrigger?.invoke("media-session-play", JSObject())
            updatePlaybackState()
        }

        override fun onPause() {
            player.pause()
            pluginEventTrigger?.invoke("media-session-pause", JSObject())
            updatePlaybackState()
        }

        override fun onSkipToNext() {
            player.seekTo(0)
            pluginEventTrigger?.invoke("media-session-next", JSObject())
        }

        override fun onSkipToPrevious() {
            player.seekTo(0)
            pluginEventTrigger?.invoke("media-session-previous", JSObject())
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            if (mediaId == null) return
            val data = JSObject()
            if (mediaId.startsWith("chapter:")) {
                val parts = mediaId.removePrefix("chapter:").split(":")
                if (parts.size >= 2) {
                    data.put("bookId", parts[0])
                    data.put("chapterIndex", parts[1].toIntOrNull() ?: 0)
                }
            } else if (mediaId.startsWith("book:")) {
                data.put("bookId", mediaId.removePrefix("book:"))
            } else {
                data.put("bookId", mediaId)
            }
            pluginEventTrigger?.invoke("audiobook-play", data)
        }

        override fun onSeekTo(pos: Long) {
            val data = JSObject()
            data.put("position", pos)
            pluginEventTrigger?.invoke("media-session-seek", data)
            // Reflect the scrub immediately; the app confirms with the next
            // UPDATE_PLAYBACK_STATE once the real seek lands.
            val state = if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED
            mediaSession?.setPlaybackState(stateBuilder.setState(state, pos, 1f).build())
        }
    }
    
    private fun updatePlaybackState() {
        val state = if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, player.currentPosition, 1f).build()
        )
        showNotification(state)
    }

    private fun showNotification(playbackState: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Media Controls", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        startForeground(NOTIFICATION_ID, buildNotification(playbackState))
    }

    private fun buildNotification(playbackState: Int): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID).apply {
            setContentTitle(currentTitle)
            setContentText(currentArtist)
            setLargeIcon(currentArtwork)
            setContentIntent(mediaSession!!.controller.sessionActivity)
            setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this@MediaPlaybackService, PlaybackStateCompat.ACTION_STOP))
            setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            setSmallIcon(R.drawable.notification_icon)

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

    // Android Auto browse tree: root → audiobooks (playable, browsable into
    // chapters) → chapters (playable). Served from the cache the webview
    // pushes, so browsing works instantly and offline.
    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        val items = mutableListOf<MediaBrowserCompat.MediaItem>()
        if (parentId == MEDIA_ROOT_ID) {
            for (book in bridgeBooks) {
                val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                    .setMediaId("book:" + book.id)
                    .setTitle(book.title)
                    .setSubtitle(book.author)
                    .build()
                items.add(
                    MediaBrowserCompat.MediaItem(
                        description,
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE or MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
                    )
                )
            }
        } else if (parentId.startsWith("book:")) {
            val bookId = parentId.removePrefix("book:")
            if (bookId == bridgeChaptersBookId) {
                for (chapter in bridgeChapters) {
                    val description = android.support.v4.media.MediaDescriptionCompat.Builder()
                        .setMediaId("chapter:" + bookId + ":" + chapter.index)
                        .setTitle(chapter.label)
                        .build()
                    items.add(
                        MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
                    )
                }
            }
        }
        result.sendResult(items)
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        MediaButtonReceiver.handleIntent(mediaSession, intent)

        if (intent?.action == "UPDATE_METADATA") {
            currentTitle = intent.getStringExtra("title") ?: currentTitle
            currentArtist = intent.getStringExtra("artist") ?: currentArtist
            val newArtwork = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra("artwork", Bitmap::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra("artwork")
            }
            if (newArtwork != null) {
                currentArtwork = newArtwork
            }

            val metadataBuilder = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
            if (currentDurationMs > 0) {
                metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
            }
            
            mediaSession?.setMetadata(metadataBuilder.build())

            showNotification(if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
        } else if (intent?.action == "UPDATE_PLAYBACK_STATE") {
            val isPlaying = intent.getBooleanExtra("playing", false)
            val position = intent.getLongExtra("position", 0L) // in milliseconds
            val duration = intent.getLongExtra("duration", 0L) // in milliseconds

            if (isPlaying && !player.isPlaying) {
                player.play()
            } else if (!isPlaying && player.isPlaying) {
                player.pause()
            }
            player.seekTo(position)

            if (duration > 0 && duration != currentDurationMs) {
                currentDurationMs = duration
                val metadataBuilder = MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
                mediaSession?.setMetadata(metadataBuilder.build())
            }

            val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
            mediaSession?.setPlaybackState(
                stateBuilder.setState(state, position, 1f).build()
            )
            showNotification(state)
        }

        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
        player.release()
        mediaSession?.release()
    }
}