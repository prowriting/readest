package com.readest.native_tts

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.SystemClock
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Collections

class NativeTtsTestActivity : Activity()

@RunWith(AndroidJUnit4::class)
class MediaPlaybackAudioFocusTest {
    private lateinit var context: Context
    private lateinit var audioManager: AudioManager
    private val focusChanges = Collections.synchronizedList(mutableListOf<Int>())
    private val focusListener = AudioManager.OnAudioFocusChangeListener(focusChanges::add)
    private var focusRequest: AudioFocusRequest? = null

    @Test
    fun sharedAudiobookPlaybackContract() {
        val contract = loadPlaybackContract()
        val scenarios = contract.getJSONArray("scenarios")
        for (index in 0 until scenarios.length()) {
            resetPlaybackContractState()
            runPlaybackContractScenario(scenarios.getJSONObject(index).getString("id"))
        }
    }

    @Before
    fun setUp() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        context = instrumentation.targetContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            instrumentation.uiAutomation.executeShellCommand(
                "pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}"
            ).close()
        }
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        focusChanges.clear()
    }

    @After
    fun tearDown() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let(audioManager::abandonAudioFocusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
        context.stopService(Intent(context, MediaPlaybackService::class.java))
        for (attempt in 0 until 100) {
            if (MediaPlaybackService.instance == null) break
            SystemClock.sleep(20)
        }
        MediaPlaybackService.pluginEventTrigger = null
    }

    @Test
    fun webBackedSessionDoesNotStealAudioFocusFromItsRealPlayer() {
        // Stand in for the WebView, which already owns and manages Android
        // audio focus for its HTMLMediaElement.
        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, requestCompetingMediaFocus())
        focusChanges.clear()

        val intent = Intent(context, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_UPDATE_PLAYBACK_STATE
            putExtra("playing", true)
            putExtra("position", 12_000L)
            putExtra("duration", 60_000L)
        }
        ContextCompat.startForegroundService(context, intent)

        val session = waitForMediaSession()
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        SystemClock.sleep(300)
        assertTrue("media-session mirror stole audio focus", focusChanges.isEmpty())
        assertEquals(PlaybackStateCompat.STATE_PLAYING, session.controller.playbackState?.state)
    }

    @Test
    fun startingTtsPausesButDoesNotDiscardTheNativeAudiobookQueue() {
        val bookId = "handoff-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-handoff-$bookId.wav", 3_000)
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId = bookId,
                title = "Handoff test",
                author = "BookArc",
                sections = listOf(
                    BridgePlaybackSection(
                        sectionIndex = 0,
                        label = "Chapter 1",
                        durationMs = 3_000L,
                        segments = listOf(
                            BridgePlaybackSegment(
                                href = "audio/chapter.wav",
                                type = "audio/wav",
                                path = audio.absolutePath,
                                clipBeginMs = 0L,
                                clipEndMs = 3_000L,
                                sourceDurationMs = 3_000L,
                                cues = listOf(BridgePlaybackCue(0L, "text/chapter.xhtml#p1"))
                            )
                        )
                    )
                )
            )
        )
        MediaPlaybackService.pluginEventTrigger = null
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val session = waitForMediaSession()
        session.controller.transportControls.playFromMediaId("book:$bookId", null)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        context.startService(
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_UPDATE_PLAYBACK_STATE
                putExtra("playing", true)
                putExtra("position", 2_000L)
                putExtra("duration", 3_000L)
            }
        )
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        val service = MediaPlaybackService.instance
            ?: throw AssertionError("MediaPlaybackService disappeared during handoff")
        waitForPrivateBoolean(service, "audiobookOwnsMediaSession", false)
        assertTrue(privateBoolean(service, "nativePlayback"))
        assertTrue(!privateBoolean(service, "audiobookOwnsMediaSession"))
        assertTrue(!nativePlayerIsPlaying(service))
    }

    @Test
    fun stoppingImmediatelyAfterNativePlaybackPersistsAResumeLocator() {
        val bookId = "disconnect-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-handoff-$bookId.wav", 3_000)
        val store = CarBridgeStore(context)
        store.savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Disconnect test",
                "BookArc",
                listOf(
                    BridgePlaybackSection(
                        0,
                        "Chapter 1",
                        3_000L,
                        listOf(
                            BridgePlaybackSegment(
                                "audio/chapter.wav",
                                "audio/wav",
                                audio.absolutePath,
                                0L,
                                3_000L,
                                3_000L,
                                listOf(BridgePlaybackCue(0L, "text/chapter.xhtml#p1"))
                            )
                        )
                    )
                )
            )
        )
        MediaPlaybackService.pluginEventTrigger = null
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val session = waitForMediaSession()
        session.controller.transportControls.playFromMediaId("book:$bookId", null)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        SystemClock.sleep(150)

        context.stopService(Intent(context, MediaPlaybackService::class.java))
        for (attempt in 0 until 100) {
            if (MediaPlaybackService.instance == null) break
            SystemClock.sleep(20)
        }

        val saved = store.loadPlaybackLocation(bookId)
            ?: throw AssertionError("No locator was saved when native playback stopped")
        assertEquals(bookId, saved.editionId)
        assertEquals("audio/chapter.wav", saved.locator.href)
        assertTrue(saved.locator.fragments.first().startsWith("t="))
        assertTrue(saved.updatedAt > 0)
    }

    @Test
    fun androidAutoSessionAdvertisesAudiobookTransportAndCustomControls() {
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )

        val state = waitForMediaSession().controller.playbackState
            ?: throw AssertionError("Media session did not publish playback state")
        assertTrue(state.actions and PlaybackStateCompat.ACTION_PLAY_PAUSE != 0L)
        assertTrue(state.actions and PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS != 0L)
        assertTrue(state.actions and PlaybackStateCompat.ACTION_SKIP_TO_NEXT != 0L)
        assertTrue(state.actions and PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM != 0L)
        assertEquals(
            listOf(
                "com.readest.native_tts.action.SEEK_BACK_30",
                "com.readest.native_tts.action.SEEK_FORWARD_30",
                "com.readest.native_tts.action.PLAYBACK_SPEED",
                "com.readest.native_tts.action.ADD_BOOKMARK"
            ),
            state.customActions.map { it.action }
        )
        assertEquals(R.drawable.ic_replay_30, state.customActions[0].icon)
        assertEquals(R.drawable.ic_forward_30, state.customActions[1].icon)
        assertEquals(R.drawable.ic_speed_100, state.customActions[2].icon)
        assertEquals(R.drawable.ic_bookmark_add, state.customActions[3].icon)
    }

    @Test
    fun androidAutoControlsReachWebBackedAudiobookPlayback() {
        val events = Collections.synchronizedList(mutableListOf<String>())
        MediaPlaybackService.pluginEventTrigger = { name, _ ->
            events.add(name)
            true
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val controls = waitForMediaSession().controller.transportControls

        controls.sendCustomAction("com.readest.native_tts.action.SEEK_FORWARD_30", null)
        controls.sendCustomAction("com.readest.native_tts.action.PLAYBACK_SPEED", null)
        controls.sendCustomAction("com.readest.native_tts.action.ADD_BOOKMARK", null)

        repeat(100) {
            if (
                events.contains("media-session-seek-relative") &&
                events.contains("media-session-set-rate") &&
                events.contains("media-session-bookmark")
            ) return
            SystemClock.sleep(20)
        }
        assertTrue(events.contains("media-session-seek-relative"))
        assertTrue(events.contains("media-session-set-rate"))
        assertTrue(events.contains("media-session-bookmark"))

        val customActions = waitForMediaSession().controller.playbackState?.customActions
            ?: throw AssertionError("Media session did not publish custom controls")
        assertEquals(R.drawable.ic_speed_125, customActions[2].icon)
        assertEquals(R.drawable.ic_bookmark_added, customActions[3].icon)
    }

    @Test
    fun androidAutoAlwaysControlsTheNativeAudiobookPlayerEvenWhenWebListenersExist() {
        val bookId = "single-owner-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-native-owner-$bookId.wav", 70_000)
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Single owner",
                "BookArc",
                listOf(
                    BridgePlaybackSection(
                        0,
                        "Chapter 1",
                        70_000L,
                        listOf(
                            BridgePlaybackSegment(
                                "audio/chapter.wav",
                                "audio/wav",
                                audio.absolutePath,
                                0L,
                                70_000L,
                                70_000L,
                                listOf(BridgePlaybackCue(0L, "text/chapter.xhtml#p1"))
                            )
                        )
                    )
                )
            )
        )
        val webEvents = Collections.synchronizedList(mutableListOf<String>())
        MediaPlaybackService.pluginEventTrigger = { event, _ ->
            webEvents.add(event)
            true
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val session = waitForMediaSession()
        session.controller.transportControls.playFromMediaId("book:$bookId", null)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")

        assertTrue(privateBoolean(service, "nativePlayback"))
        assertTrue(webEvents.none { it == "audiobook-play" })
        session.controller.transportControls.sendCustomAction(
            "com.readest.native_tts.action.SEEK_FORWARD_30",
            null
        )
        repeat(100) {
            if (nativePlayerPosition(service) >= 29_000L) return@repeat
            SystemClock.sleep(20)
        }
        assertTrue(nativePlayerPosition(service) >= 29_000L)
        assertTrue(webEvents.none { it == "media-session-seek-relative" })
    }

    @Test
    fun bookmarkStateAppliesOnlyToTheExactSmilCue() {
        val bookId = "bookmark-cue-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-bookmark-$bookId.wav", 20_000)
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Bookmark cue",
                "BookArc",
                listOf(
                    BridgePlaybackSection(
                        0,
                        "Chapter 1",
                        20_000L,
                        listOf(
                            BridgePlaybackSegment(
                                "audio/chapter.wav",
                                "audio/wav",
                                audio.absolutePath,
                                0L,
                                20_000L,
                                20_000L,
                                listOf(
                                    BridgePlaybackCue(0L, "text/chapter.xhtml#p1"),
                                    BridgePlaybackCue(10_000L, "text/chapter.xhtml#p2")
                                )
                            )
                        )
                    )
                )
            )
        )
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        session.controller.transportControls.sendCustomAction(
            "com.readest.native_tts.action.ADD_BOOKMARK",
            null
        )
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        var before: JSONObject? = null
        var after: JSONObject? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            before = service.playbackSnapshot()
            privateNativePlayer(service).seekTo(11_000L)
            after = service.playbackSnapshot()
        }

        assertEquals(true, before?.getBoolean("isBookmarked"))
        assertEquals("p2", after?.getJSONObject("location")
            ?.getJSONObject("textLocator")
            ?.getJSONObject("locations")
            ?.getJSONArray("fragments")
            ?.getString(0))
        assertEquals(false, after?.getBoolean("isBookmarked"))
    }

    @Test
    fun anotherMediaOwnerPausesExoPlayerAndPublishesThePlayButtonState() {
        val bookId = "focus-loss-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-focus-$bookId.wav", 70_000)
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Focus test",
                "BookArc",
                listOf(
                    BridgePlaybackSection(
                        0,
                        "Chapter 1",
                        70_000L,
                        listOf(
                            BridgePlaybackSegment(
                                "audio/chapter.wav",
                                "audio/wav",
                                audio.absolutePath,
                                0L,
                                70_000L,
                                70_000L,
                                listOf(BridgePlaybackCue(0L, "text/chapter.xhtml#p1"))
                            )
                        )
                    )
                )
            )
        )
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val session = waitForMediaSession()
        session.controller.transportControls.playFromMediaId("book:$bookId", null)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, requestCompetingMediaFocus())
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PAUSED)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        assertTrue(!nativePlayerIsPlaying(service))
    }

    @Test
    fun pausingWhileBufferingPublishesANewerPausedSnapshot() {
        val bookId = "buffering-pause-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-buffering-$bookId.wav", 10_000)
        saveSingleSegmentManifest(bookId, audio, 10_000L)
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        val events = mutableListOf<JSONObject>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            MediaPlaybackService.pluginEventTrigger = { event, data ->
                if (event == "audiobook-playback-state") events.add(JSONObject(data.toString()))
                true
            }
            val field = MediaPlaybackService::class.java.getDeclaredField("nativePlayer")
            field.isAccessible = true
            val player = field.get(service) as androidx.media3.exoplayer.ExoPlayer
            // Pause before decoding can make re-prepared audio audible.
            // isPlaying stays false: only playWhenReady changes.
            player.stop()
            player.prepare()
            val loading = service.playbackSnapshot()
            assertEquals("loading", loading.getString("state"))
            events.clear()
            val paused = service.handleAudiobookCommand(
                "pause", null, null, null, null, null, null, null, null
            )
            assertEquals("paused", paused.getString("state"))
            assertTrue("pause reply must supersede loading", paused.getLong("sequence") > loading.getLong("sequence"))
            assertTrue("phone must receive a paused event even if isPlaying did not change", events.any { it.getString("state") == "paused" })
            val event = events.last()
            assertEquals(bookId, event.getString("bookId"))
            assertTrue("plugin events carry snapshots directly", !event.has("payload"))
        }
    }

    @Test
    fun readingAPausedSnapshotDoesNotMakeItsLocatorNewer() {
        val bookId = "read-only-location-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-read-only-$bookId.wav", 10_000)
        saveSingleSegmentManifest(bookId, audio, 10_000L)
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        session.controller.transportControls.pause()
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PAUSED)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")

        val firstUpdatedAt = snapshotLocationUpdatedAt(service)
        SystemClock.sleep(40)
        val secondUpdatedAt = snapshotLocationUpdatedAt(service)

        assertEquals(
            "A read-only snapshot must not turn stale native progress into the newest marker",
            firstUpdatedAt,
            secondUpdatedAt
        )
    }

    @Test
    fun readingPlaybackLocationThroughTheBridgeDoesNotMakeItNewer() {
        val bookId = "bridge-read-only-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-bridge-read-only-$bookId.wav", 10_000)
        saveSingleSegmentManifest(bookId, audio, 10_000L)
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        session.controller.transportControls.pause()
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PAUSED)
        val store = CarBridgeStore(context)
        val firstUpdatedAt = store.loadPlaybackLocation(bookId)?.updatedAt
            ?: throw AssertionError("saved locator missing")

        SystemClock.sleep(40)
        var returnedLocation: BridgePlaybackLocation? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            returnedLocation = MediaPlaybackService.currentPlaybackLocation(bookId)
        }
        val secondUpdatedAt = store.loadPlaybackLocation(bookId)?.updatedAt
            ?: throw AssertionError("saved locator missing after bridge read")

        assertEquals(firstUpdatedAt, returnedLocation?.updatedAt)
        assertEquals(
            "Reading progress through the bridge must be side-effect free",
            firstUpdatedAt,
            secondUpdatedAt
        )
    }

    @Test
    fun pressingPlayAfterTheBookEndsRestartsFromTheBeginning() {
        val bookId = "ended-replay-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-ended-$bookId.wav", 500)
        saveSingleSegmentManifest(bookId, audio, 500L)
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_STOPPED)

        session.controller.transportControls.play()

        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        assertTrue(nativePlayerPosition(service) < 400L)
    }

    @Test
    fun failedBookReplacementDoesNotLeaveThePreviousBookAudiblyPlaying() {
        val firstBookId = "replacement-a-${System.nanoTime()}"
        val firstAudio = writeSilentWav("bookarc-replacement-$firstBookId.wav", 10_000)
        saveSingleSegmentManifest(firstBookId, firstAudio, 10_000L)
        val session = startNativeBook(firstBookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        val missingBookId = "replacement-b-${System.nanoTime()}"
        saveSingleSegmentManifest(
            missingBookId,
            File(context.cacheDir, "missing-$missingBookId.wav"),
            10_000L
        )
        session.controller.transportControls.playFromMediaId("book:$missingBookId", null)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_ERROR)

        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        assertTrue(
            "The old ExoPlayer continued after replacement failed",
            !nativePlayerIsPlaying(service)
        )
    }

    @Test
    fun failedPhoneCommandReplacementDoesNotLeaveThePreviousBookPlaying() {
        val firstBookId = "phone-replacement-a-${System.nanoTime()}"
        val firstAudio = writeSilentWav("bookarc-phone-replacement-$firstBookId.wav", 10_000)
        saveSingleSegmentManifest(firstBookId, firstAudio, 10_000L)
        val session = startNativeBook(firstBookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        val missingBookId = "phone-replacement-missing-${System.nanoTime()}"

        var result: JSONObject? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            result = service.handleAudiobookCommand(
                "play",
                missingBookId,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            )
        }

        assertEquals("error", result?.getString("state"))
        assertEquals("manifest_unavailable", result?.getString("error"))
        assertEquals(missingBookId, result?.getString("bookId"))
        assertTrue(
            "The Tauri command path left the previous ExoPlayer playing",
            !nativePlayerIsPlaying(service)
        )
    }

    @Test
    fun partiallyDownloadedManifestIsRejectedInsteadOfDroppingChapters() {
        val bookId = "partial-manifest-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-partial-$bookId.wav", 10_000)
        val missing = File(context.cacheDir, "missing-partial-$bookId.wav")
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Partial download",
                "BookArc",
                listOf(
                    playbackSection(0, audio, 10_000L),
                    playbackSection(1, missing, 10_000L)
                )
            )
        )

        val session = startNativeBook(bookId)

        waitForPlaybackState(session, PlaybackStateCompat.STATE_ERROR)
    }

    @Test
    fun nativeSavesAdvancePastAnExistingFutureTimestamp() {
        val bookId = "monotonic-location-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-monotonic-$bookId.wav", 60_000)
        saveSingleSegmentManifest(bookId, audio, 60_000L)
        val store = CarBridgeStore(context)
        val futureTimestamp = System.currentTimeMillis() + 60_000L
        store.savePlaybackLocation(playbackLocation(bookId, 0.0, futureTimestamp))
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        session.controller.transportControls.seekTo(30_000L)
        session.controller.transportControls.pause()
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PAUSED)

        val saved = store.loadPlaybackLocation(bookId)
            ?: throw AssertionError("saved locator missing")
        assertEquals(listOf("t=30.0"), saved.locator.fragments)
        assertTrue(saved.updatedAt > futureTimestamp)
    }

    @Test
    fun ttsIdleShutdownDoesNotStopAnActiveNativeAudiobook() {
        val bookId = "tts-idle-${System.nanoTime()}"
        val audio = writeSilentWav("bookarc-tts-idle-$bookId.wav", 10_000)
        saveSingleSegmentManifest(bookId, audio, 10_000L)
        val session = startNativeBook(bookId)
        waitForPlaybackState(session, PlaybackStateCompat.STATE_PLAYING)

        val activity = InstrumentationRegistry.getInstrumentation().startActivitySync(
            Intent(context, NativeTtsTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        try {
            val plugin = NativeTTSPlugin(activity)
            val shutdown = NativeTTSPlugin::class.java.getDeclaredMethod("shutdownTTSEngine")
            shutdown.isAccessible = true
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                shutdown.invoke(plugin)
            }

            SystemClock.sleep(100)
            val service = MediaPlaybackService.instance
                ?: throw AssertionError("TTS idle cleanup destroyed the audiobook service")
            assertTrue(nativePlayerIsPlaying(service))
        } finally {
            activity.finish()
        }
    }

    private fun saveSingleSegmentManifest(bookId: String, audio: File, durationMs: Long) {
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                bookId,
                "Regression test",
                "BookArc",
                listOf(
                    BridgePlaybackSection(
                        0,
                        "Chapter 1",
                        durationMs,
                        listOf(
                            BridgePlaybackSegment(
                                "audio/chapter.wav",
                                "audio/wav",
                                audio.absolutePath,
                                0L,
                                durationMs,
                                durationMs,
                                listOf(BridgePlaybackCue(0L, "text/chapter.xhtml#p1"))
                            )
                        )
                    )
                )
            )
        )
    }

    private fun runPlaybackContractScenario(scenarioId: String) {
        val contract = loadPlaybackContract()
        val availableBookId = contract.getString("availableBookId")
        val durationMs = contract.getLong("durationMs")
        val scenario = contract.getJSONArray("scenarios")
            .let { scenarios ->
                (0 until scenarios.length())
                    .map(scenarios::getJSONObject)
                    .first { it.getString("id") == scenarioId }
            }
        val audio = writeSilentWav("bookarc-contract-$scenarioId.wav", durationMs.toInt())
        CarBridgeStore(context).savePlaybackManifest(
            BridgePlaybackManifest(
                availableBookId,
                "Contract book",
                "BookArc",
                listOf(
                    contractSection(0, "audio/chapter.mp3", "text/chapter.xhtml#p1", audio, durationMs),
                    contractSection(
                        1,
                        "audio/chapter-2.mp3",
                        "text/chapter-2.xhtml#p1",
                        audio,
                        durationMs
                    )
                )
            )
        )
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        waitForMediaSession()
        val service = MediaPlaybackService.instance ?: throw AssertionError("service missing")
        var result: JSONObject? = null

        val commands = scenario.getJSONArray("commands")
        for (index in 0 until commands.length()) {
            val command = commands.getJSONObject(index)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                result = service.handleAudiobookCommand(
                    command.getString("action"),
                    command.optString("bookId").takeIf(String::isNotBlank),
                    command.optInt("chapterIndex").takeIf { command.has("chapterIndex") },
                    command.optLong("offsetMs").takeIf { command.has("offsetMs") },
                    command.optDouble("rate").toFloat().takeIf { command.has("rate") },
                    command.optDouble("volume").toFloat().takeIf { command.has("volume") },
                    command.optJSONObject("location")?.let(::decodeContractLocation),
                    command.optString("mode").takeIf(String::isNotBlank),
                    command.optLong("endsAt").takeIf { command.has("endsAt") }
                )
            }
        }

        val expected = scenario.getJSONObject("expected")
        assertEquals(scenarioId, expected.getString("bookId"), result?.getString("bookId"))
        assertEquals(scenarioId, expected.getString("state"), result?.getString("state"))
        if (expected.has("error")) {
            assertEquals(scenarioId, expected.getString("error"), result?.getString("error"))
        }
        if (expected.has("playbackRate")) {
            assertEquals(
                scenarioId,
                expected.getDouble("playbackRate"),
                result?.getDouble("playbackRate") ?: Double.NaN,
                0.001
            )
        }
        if (expected.has("chapterIndex")) {
            assertEquals(
                scenarioId,
                expected.getInt("chapterIndex"),
                result?.getInt("chapterIndex")
            )
        }
        if (expected.has("isBookmarked")) {
            assertEquals(
                scenarioId,
                expected.getBoolean("isBookmarked"),
                result?.getBoolean("isBookmarked")
            )
        }
        if (expected.has("sleepTimerEndsAt")) {
            assertEquals(
                scenarioId,
                expected.getLong("sleepTimerEndsAt"),
                result?.getLong("sleepTimerEndsAt")
            )
        }
        if (expected.optBoolean("sleepTimerAbsent")) {
            assertEquals(scenarioId, false, result?.has("sleepTimerEndsAt"))
        }
        if (expected.optBoolean("locationAbsent")) {
            assertEquals(scenarioId, false, result?.has("location"))
        }
        if (expected.has("timeSeconds")) {
            val fragment = result?.getJSONObject("location")
                ?.getJSONObject("locator")
                ?.getJSONObject("locations")
                ?.getJSONArray("fragments")
                ?.getString(0)
            assertEquals(
                scenarioId,
                expected.getDouble("timeSeconds"),
                fragment?.removePrefix("t=")?.toDouble() ?: Double.NaN,
                0.001
            )
        }
        if (expected.has("volume")) {
            var volume = 0f
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                volume = privateNativePlayer(service).volume
            }
            assertEquals(
                scenarioId,
                expected.getDouble("volume"),
                volume.toDouble(),
                0.001
            )
        }
    }

    private fun resetPlaybackContractState() {
        context.stopService(Intent(context, MediaPlaybackService::class.java))
        repeat(100) {
            if (MediaPlaybackService.instance == null) return@repeat
            SystemClock.sleep(20)
        }
        context.getSharedPreferences("bookarc_android_auto", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    private fun contractSection(
        index: Int,
        href: String,
        text: String,
        audio: File,
        durationMs: Long
    ) = BridgePlaybackSection(
        index,
        "Chapter ${index + 1}",
        durationMs,
        listOf(
            BridgePlaybackSegment(
                href,
                "audio/wav",
                audio.absolutePath,
                0L,
                durationMs,
                durationMs,
                listOf(BridgePlaybackCue(0L, text))
            )
        )
    )

    private fun decodeContractLocation(value: JSONObject): BridgePlaybackLocation {
        fun decodeLocator(locator: JSONObject): BridgeLocator {
            val locations = locator.getJSONObject("locations")
            val fragments = locations.getJSONArray("fragments")
            return BridgeLocator(
                locator.getString("href"),
                locator.getString("type"),
                locator.optString("title").takeIf(String::isNotBlank),
                (0 until fragments.length()).map(fragments::getString),
                locations.optDouble("progression").takeIf {
                    locations.has("progression") && it.isFinite()
                },
                locations.optDouble("totalProgression").takeIf {
                    locations.has("totalProgression") && it.isFinite()
                }
            )
        }
        return BridgePlaybackLocation(
            value.getInt("schemaVersion"),
            value.getString("editionId"),
            decodeLocator(value.getJSONObject("locator")),
            value.optJSONObject("textLocator")?.let(::decodeLocator),
            value.getLong("updatedAt")
        )
    }

    private fun loadPlaybackContract() = JSONObject(
            context.assets.open("audiobook-playback-contract.json")
                .bufferedReader()
                .use { it.readText() }
        )

    private fun playbackSection(
        sectionIndex: Int,
        audio: File,
        durationMs: Long
    ) = BridgePlaybackSection(
        sectionIndex,
        "Chapter ${sectionIndex + 1}",
        durationMs,
        listOf(
            BridgePlaybackSegment(
                "audio/chapter-$sectionIndex.wav",
                "audio/wav",
                audio.absolutePath,
                0L,
                durationMs,
                durationMs,
                listOf(BridgePlaybackCue(0L, "text/chapter-$sectionIndex.xhtml#p1"))
            )
        )
    )

    private fun playbackLocation(
        bookId: String,
        seconds: Double,
        updatedAt: Long
    ) = BridgePlaybackLocation(
        2,
        bookId,
        BridgeLocator(
            "audio/chapter.wav",
            "audio/wav",
            "Chapter 1",
            listOf("t=$seconds"),
            null,
            null
        ),
        BridgeLocator(
            "text/chapter.xhtml",
            "application/xhtml+xml",
            "Chapter 1",
            listOf("p1"),
            null,
            null
        ),
        updatedAt
    )

    private fun startNativeBook(bookId: String): MediaSessionCompat {
        ContextCompat.startForegroundService(
            context,
            Intent(context, MediaPlaybackService::class.java).apply {
                action = MediaPlaybackService.ACTION_ACTIVATE
            }
        )
        val session = waitForMediaSession()
        session.controller.transportControls.playFromMediaId("book:$bookId", null)
        return session
    }

    private fun snapshotLocationUpdatedAt(service: MediaPlaybackService): Long {
        var snapshot: JSONObject? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            snapshot = service.playbackSnapshot()
        }
        return snapshot?.getJSONObject("location")?.getLong("updatedAt")
            ?: throw AssertionError("snapshot has no locator")
    }

    private fun waitForMediaSession(): MediaSessionCompat {
        repeat(250) {
            MediaPlaybackService.instance?.let { service ->
                mediaSession(service)?.let { return it }
            }
            SystemClock.sleep(20)
        }
        throw AssertionError("MediaPlaybackService media session did not start")
    }

    private fun mediaSession(service: MediaPlaybackService): MediaSessionCompat? {
        val field = MediaPlaybackService::class.java.getDeclaredField("mediaSession")
        field.isAccessible = true
        return field.get(service) as? MediaSessionCompat
    }

    private fun waitForPlaybackState(session: MediaSessionCompat, expectedState: Int) {
        repeat(100) {
            if (session.controller.playbackState?.state == expectedState) return
            SystemClock.sleep(20)
        }
        assertEquals(expectedState, session.controller.playbackState?.state)
    }

    private fun requestCompetingMediaFocus(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = request
            audioManager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun releaseCompetingMediaFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let(audioManager::abandonAudioFocusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
        focusRequest = null
    }

    private fun privateBoolean(service: MediaPlaybackService, name: String): Boolean {
        val field = MediaPlaybackService::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.getBoolean(service)
    }

    private fun waitForNativePlayback(service: MediaPlaybackService, expected: Boolean) {
        repeat(100) {
            if (privateBoolean(service, "nativePlayback") == expected) return
            SystemClock.sleep(20)
        }
        assertEquals(expected, privateBoolean(service, "nativePlayback"))
    }

    private fun waitForPrivateBoolean(
        service: MediaPlaybackService,
        name: String,
        expected: Boolean
    ) {
        repeat(100) {
            if (privateBoolean(service, name) == expected) return
            SystemClock.sleep(20)
        }
        assertEquals(expected, privateBoolean(service, name))
    }

    private fun privateNativePlayer(service: MediaPlaybackService): androidx.media3.exoplayer.ExoPlayer {
        val field = MediaPlaybackService::class.java.getDeclaredField("nativePlayer")
        field.isAccessible = true
        return field.get(service) as androidx.media3.exoplayer.ExoPlayer
    }

    private fun nativePlayerIsPlaying(service: MediaPlaybackService): Boolean {
        var isPlaying = false
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            isPlaying = privateNativePlayer(service).isPlaying
        }
        return isPlaying
    }

    private fun nativePlayerPosition(service: MediaPlaybackService): Long {
        var position = 0L
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            position = privateNativePlayer(service).currentPosition
        }
        return position
    }

    private fun writeSilentWav(name: String, durationMs: Int): File {
        val sampleRate = 8_000
        val sampleCount = sampleRate * durationMs / 1_000
        val dataSize = sampleCount * 2
        val bytes = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + dataSize)
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1.toShort())
            putShort(1.toShort())
            putInt(sampleRate)
            putInt(sampleRate * 2)
            putShort(2.toShort())
            putShort(16.toShort())
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize)
            repeat(sampleCount) { putShort(0.toShort()) }
        }.array()
        return File(context.cacheDir, name).apply { writeBytes(bytes) }
    }
}
