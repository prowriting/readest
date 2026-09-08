package com.readest.native_tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CarBridgeCodecTest {
    @Test
    fun booksRoundTripWithoutLosingUserMetadata() {
        val books = listOf(
            BridgeBook("book:one", "A title | with separators", "Zoë\nAuthor", 123.5),
            BridgeBook("二", "第二本书", "", 0.0)
        )

        assertEquals(books, CarBridgeCodec.decodeBooks(CarBridgeCodec.encodeBooks(books)))
    }

    @Test
    fun chaptersRoundTripAndIgnoreMalformedRows() {
        val chapters = listOf(
            BridgeChapter(0, "Opening"),
            BridgeChapter(12, "A label | with separators")
        )
        val encoded = CarBridgeCodec.encodeChapters(chapters) + "\nnot-a-valid-row"

        assertEquals(chapters, CarBridgeCodec.decodeChapters(encoded))
    }

    @Test
    fun pendingPlayRequestRoundTripsWithAndWithoutChapter() {
        val chapter = BridgePlayRequest("book-id", 7)
        val wholeBook = BridgePlayRequest("book-id", null)

        assertEquals(chapter, CarBridgeCodec.decodePlayRequest(CarBridgeCodec.encodePlayRequest(chapter)))
        assertEquals(
            wholeBook,
            CarBridgeCodec.decodePlayRequest(CarBridgeCodec.encodePlayRequest(wholeBook))
        )
        assertNull(CarBridgeCodec.decodePlayRequest("invalid"))
    }

    @Test
    fun voiceSearchMatchesTitleOrAuthorAndFallsBackForEmptyQuery() {
        val books = listOf(
            BridgeBook("recent", "The Long Way Home", "Ada Writer", 10.0),
            BridgeBook("second", "Another Story", "Ben Reader", 20.0)
        )

        assertEquals("recent", CarBridgeCodec.findBook(books, "long way")?.id)
        assertEquals("second", CarBridgeCodec.findBook(books, "BEN")?.id)
        assertEquals("recent", CarBridgeCodec.findBook(books, "")?.id)
        assertNull(CarBridgeCodec.findBook(emptyList(), "anything"))
    }

    @Test
    fun nativePlaybackManifestRoundTripsAudioSegmentsAndCues() {
        val manifest = BridgePlaybackManifest(
            bookId = "book|one",
            title = "A title",
            author = "An author",
            currentSectionIndex = 7,
            sections = listOf(
                BridgePlaybackSection(
                    sectionIndex = 7,
                    label = "Chapter\nOne",
                    durationMs = 12_000L,
                    segments = listOf(
                        BridgePlaybackSegment(
                            path = "/data/audio one.mp3",
                            clipBeginMs = 1_250L,
                            clipEndMs = 5_500L,
                            cues = listOf(BridgePlaybackCue(500L, "text/c1.xhtml#p1"))
                        )
                    )
                )
            )
        )

        assertEquals(
            manifest,
            CarBridgeCodec.decodePlaybackManifest(CarBridgeCodec.encodePlaybackManifest(manifest))
        )
    }
}
