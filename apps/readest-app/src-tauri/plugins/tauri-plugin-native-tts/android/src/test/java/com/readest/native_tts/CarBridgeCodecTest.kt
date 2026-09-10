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
            sections = listOf(
                BridgePlaybackSection(
                    sectionIndex = 7,
                    label = "Chapter\nOne",
                    durationMs = 12_000L,
                    segments = listOf(
                        BridgePlaybackSegment(
                            href = "OEBPS/audio/audio one.mp3",
                            type = "audio/mpeg",
                            path = "/data/audio one.mp3",
                            clipBeginMs = 1_250L,
                            clipEndMs = 5_500L,
                            sourceDurationMs = 10_000L,
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

    @Test
    fun readiumPlaybackLocationRoundTripsAndLegacyProgressIsRejected() {
        val location = BridgePlaybackLocation(
            schemaVersion = 2,
            editionId = "book|one",
            locator = BridgeLocator(
                href = "OEBPS/audio/audio one.mp3",
                type = "audio/mpeg",
                title = "Chapter One",
                fragments = listOf("t=3.25"),
                progression = 0.325,
                totalProgression = 0.2
            ),
            textLocator = BridgeLocator(
                href = "OEBPS/text/c1.xhtml",
                type = "application/xhtml+xml",
                title = "Chapter One",
                fragments = listOf("p1"),
                progression = null,
                totalProgression = null
            ),
            updatedAt = 1234L
        )
        assertEquals(
            location,
            CarBridgeCodec.decodePlaybackLocation(CarBridgeCodec.encodePlaybackLocation(location))
        )
        assertNull(CarBridgeCodec.decodePlaybackLocation("{\"sectionIndex\":1,\"positionMs\":3}"))
    }

    @Test
    fun pendingBookmarkLocationsRoundTripAsAnOrderedList() {
        val first = BridgePlaybackLocation(
            2,
            "edition",
            BridgeLocator("audio/one.mp3", "audio/mpeg", null, listOf("t=12"), null, null),
            BridgeLocator("text/one.xhtml", "application/xhtml+xml", null, listOf("p1"), null, null),
            1L
        )
        val second = first.copy(
            locator = first.locator.copy(fragments = listOf("t=42")),
            textLocator = first.textLocator?.copy(fragments = listOf("p2")),
            updatedAt = 2L
        )

        assertEquals(
            listOf(first, second),
            CarBridgeCodec.decodePlaybackLocations(
                CarBridgeCodec.encodePlaybackLocations(listOf(first, second))
            )
        )
    }

    @Test
    fun staleWebLocationCannotOverwriteNewerCarPlayback() {
        val base = BridgePlaybackLocation(
            schemaVersion = 2,
            editionId = "book-one",
            locator = BridgeLocator(
                "audio/one.mp3", "audio/mpeg", null, listOf("t=12"), null, null
            ),
            textLocator = null,
            updatedAt = 2_000L
        )
        val stale = base.copy(
            locator = base.locator.copy(fragments = listOf("t=3")),
            updatedAt = 1_000L
        )

        assertEquals(base, CarBridgeCodec.newestPlaybackLocation(base, stale))
        assertEquals(base, CarBridgeCodec.newestPlaybackLocation(stale, base))
    }

    @Test
    fun repeatedReconnectUpdatesNeverMovePlaybackBackward() {
        fun at(seconds: Int, updatedAt: Long) = BridgePlaybackLocation(
            2,
            "book-one",
            BridgeLocator(
                "audio/one.mp3",
                "audio/mpeg",
                null,
                listOf("t=$seconds"),
                null,
                null
            ),
            null,
            updatedAt
        )

        val latest = listOf(at(3, 3_000), at(8, 8_000), at(5, 5_000), at(12, 12_000))
            .fold<BridgePlaybackLocation, BridgePlaybackLocation?>(null) { current, incoming ->
                CarBridgeCodec.newestPlaybackLocation(current, incoming)
            }

        assertEquals(12_000L, latest?.updatedAt)
        assertEquals(listOf("t=12"), latest?.locator?.fragments)
    }

    @Test
    fun equalTimestampCannotReplaceTheAlreadyAcceptedLocator() {
        val current = BridgePlaybackLocation(
            2,
            "book-one",
            BridgeLocator("audio/one.mp3", "audio/mpeg", null, listOf("t=12"), null, null),
            null,
            2_000L
        )
        val sameTimestampButBehind = current.copy(
            locator = current.locator.copy(fragments = listOf("t=3"))
        )

        assertEquals(current, CarBridgeCodec.newestPlaybackLocation(current, sameTimestampButBehind))
    }

    @Test
    fun locatorResolutionUsesResourceTimeTextCueAndExactEdition() {
        val shared = BridgePlaybackSegment(
            href = "audio/shared.mp3",
            type = "audio/mpeg",
            path = "/tmp/shared.mp3",
            clipBeginMs = 1_000L,
            clipEndMs = 5_000L,
            sourceDurationMs = 8_000L,
            cues = listOf(BridgePlaybackCue(0L, "text/one.xhtml#p1"))
        )
        val manifest = BridgePlaybackManifest(
            bookId = "edition-1",
            title = "Book",
            author = "Author",
            sections = listOf(
                BridgePlaybackSection(3, "One", 4_000L, listOf(shared)),
                BridgePlaybackSection(
                    7,
                    "Two",
                    4_000L,
                    listOf(shared.copy(cues = listOf(BridgePlaybackCue(0L, "text/two.xhtml#p1"))))
                )
            )
        )
        val location = BridgePlaybackLocation(
            schemaVersion = 2,
            editionId = "edition-1",
            locator = BridgeLocator(
                "audio/shared.mp3", "audio/mpeg", "Two", listOf("t=2.5"), null, null
            ),
            textLocator = BridgeLocator(
                "text/two.xhtml", "application/xhtml+xml", "Two", listOf("p1"), null, null
            ),
            updatedAt = 1L
        )

        assertEquals(
            BridgePlaybackTarget(sectionIndex = 7, segmentIndex = 0, positionMs = 1_500L),
            CarBridgeCodec.resolvePlaybackLocation(manifest, location)
        )
        assertNull(
            CarBridgeCodec.resolvePlaybackLocation(
                manifest,
                location.copy(editionId = "different-edition")
            )
        )
    }

    @Test
    fun locatorAtSharedClipBoundaryChoosesTheStartingSegment() {
        val first = BridgePlaybackSegment(
            "audio/shared.mp3", "audio/mpeg", "/tmp/shared.mp3",
            0L, 10_000L, 20_000L, emptyList()
        )
        val second = first.copy(clipBeginMs = 10_000L, clipEndMs = 20_000L)
        val manifest = BridgePlaybackManifest(
            "edition-1", "Book", "Author",
            listOf(BridgePlaybackSection(0, "One", 20_000L, listOf(first, second)))
        )
        val location = BridgePlaybackLocation(
            2,
            "edition-1",
            BridgeLocator("audio/shared.mp3", "audio/mpeg", null, listOf("t=10"), null, null),
            null,
            1L
        )

        assertEquals(
            BridgePlaybackTarget(0, 1, 0L),
            CarBridgeCodec.resolvePlaybackLocation(manifest, location)
        )
    }
}
