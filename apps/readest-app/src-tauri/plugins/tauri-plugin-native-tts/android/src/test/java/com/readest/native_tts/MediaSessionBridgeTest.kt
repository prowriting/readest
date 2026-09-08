package com.readest.native_tts

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaSessionBridgeTest {
    @Test
    fun playbackStateKeepsMillisecondValuesAsLongs() {
        val beyondIntRange = Int.MAX_VALUE.toLong() + 1L
        val args = UpdateMediaSessionStateArgs().apply {
            position = beyondIntRange
            duration = beyondIntRange + 1L
        }

        assertEquals(beyondIntRange, args.position)
        assertEquals(beyondIntRange + 1L, args.duration)
    }
}
