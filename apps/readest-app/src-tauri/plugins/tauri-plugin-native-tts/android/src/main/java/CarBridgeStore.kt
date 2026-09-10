package com.readest.native_tts

import android.content.Context
import java.net.URLDecoder
import java.net.URLEncoder

data class BridgeBook(
    val id: String,
    val title: String,
    val author: String,
    val durationSec: Double
)

data class BridgeChapter(val index: Int, val label: String)

data class BridgePlayRequest(val bookId: String, val chapterIndex: Int?)

data class BridgePlaybackCue(val offsetMs: Long, val text: String)

data class BridgePlaybackSegment(
    val href: String,
    val type: String,
    val path: String,
    val clipBeginMs: Long,
    val clipEndMs: Long,
    val sourceDurationMs: Long,
    val cues: List<BridgePlaybackCue>
)

data class BridgePlaybackSection(
    val sectionIndex: Int,
    val label: String,
    val durationMs: Long,
    val segments: List<BridgePlaybackSegment>
)

data class BridgePlaybackManifest(
    val bookId: String,
    val title: String,
    val author: String,
    val sections: List<BridgePlaybackSection>,
    val coverPath: String? = null
)

data class BridgeLocator(
    val href: String,
    val type: String,
    val title: String?,
    val fragments: List<String>,
    val progression: Double?,
    val totalProgression: Double?
)

data class BridgePlaybackLocation(
    val schemaVersion: Int,
    val editionId: String,
    val locator: BridgeLocator,
    val textLocator: BridgeLocator?,
    val updatedAt: Long
)

data class BridgePlaybackTarget(
    val sectionIndex: Int,
    val segmentIndex: Int,
    val positionMs: Long
)

internal object CarBridgeCodec {
    private val timeFragment = Regex("^t=(?:npt:)?\\d+(?:\\.\\d+)?$")

    private fun encodeText(value: String): String =
        URLEncoder.encode(value, "UTF-8")

    private fun decodeText(value: String): String? = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (_: IllegalArgumentException) {
        null
    }

    fun encodeBooks(books: List<BridgeBook>): String = books.joinToString("\n") { book ->
        listOf(
            encodeText(book.id),
            encodeText(book.title),
            encodeText(book.author),
            book.durationSec.toString()
        ).joinToString("|")
    }

    fun decodeBooks(encoded: String): List<BridgeBook> = encoded.lineSequence().mapNotNull { row ->
        val fields = row.split('|')
        if (fields.size != 4) return@mapNotNull null
        val id = decodeText(fields[0]) ?: return@mapNotNull null
        val title = decodeText(fields[1]) ?: return@mapNotNull null
        val author = decodeText(fields[2]) ?: return@mapNotNull null
        val duration = fields[3].toDoubleOrNull() ?: return@mapNotNull null
        BridgeBook(id, title, author, duration)
    }.toList()

    fun encodeChapters(chapters: List<BridgeChapter>): String = chapters.joinToString("\n") { chapter ->
        "${chapter.index}|${encodeText(chapter.label)}"
    }

    fun decodeChapters(encoded: String): List<BridgeChapter> = encoded.lineSequence().mapNotNull { row ->
        val fields = row.split('|')
        if (fields.size != 2) return@mapNotNull null
        val index = fields[0].toIntOrNull() ?: return@mapNotNull null
        val label = decodeText(fields[1]) ?: return@mapNotNull null
        BridgeChapter(index, label)
    }.toList()

    fun encodePlayRequest(request: BridgePlayRequest): String =
        "${encodeText(request.bookId)}|${request.chapterIndex ?: ""}"

    fun decodePlayRequest(encoded: String): BridgePlayRequest? {
        val fields = encoded.split('|')
        if (fields.size != 2) return null
        val bookId = decodeText(fields[0]) ?: return null
        val chapterIndex = fields[1].takeIf(String::isNotEmpty)?.toIntOrNull()
        if (fields[1].isNotEmpty() && chapterIndex == null) return null
        return BridgePlayRequest(bookId, chapterIndex)
    }

    fun findBook(books: List<BridgeBook>, query: String): BridgeBook? {
        val normalized = query.trim()
        if (normalized.isEmpty()) return books.firstOrNull()
        return books.firstOrNull { book ->
            book.title.contains(normalized, ignoreCase = true) ||
                book.author.contains(normalized, ignoreCase = true)
        }
    }

    fun encodePlaybackManifest(manifest: BridgePlaybackManifest): String = buildList {
        add(
            listOf(
                "H",
                encodeText(manifest.bookId),
                encodeText(manifest.title),
                encodeText(manifest.author),
                encodeText(manifest.coverPath.orEmpty())
            ).joinToString("|")
        )
        manifest.sections.forEach { section ->
            add(
                listOf(
                    "S",
                    section.sectionIndex.toString(),
                    encodeText(section.label),
                    section.durationMs.toString()
                ).joinToString("|")
            )
            section.segments.forEachIndexed { segmentIndex, segment ->
                add(
                    listOf(
                        "G",
                        section.sectionIndex.toString(),
                        segmentIndex.toString(),
                        encodeText(segment.href),
                        encodeText(segment.type),
                        encodeText(segment.path),
                        segment.clipBeginMs.toString(),
                        segment.clipEndMs.toString(),
                        segment.sourceDurationMs.toString()
                    ).joinToString("|")
                )
                segment.cues.forEach { cue ->
                    add(
                        listOf(
                            "C",
                            section.sectionIndex.toString(),
                            segmentIndex.toString(),
                            cue.offsetMs.toString(),
                            encodeText(cue.text)
                        ).joinToString("|")
                    )
                }
            }
        }
    }.joinToString("\n")

    fun decodePlaybackManifest(encoded: String): BridgePlaybackManifest? {
        val rows = encoded.lineSequence().filter(String::isNotBlank).map { it.split('|') }.toList()
        val header = rows.firstOrNull()?.takeIf { it.size == 5 && it[0] == "H" } ?: return null
        val bookId = decodeText(header[1]) ?: return null
        val title = decodeText(header[2]) ?: return null
        val author = decodeText(header[3]) ?: return null
        val coverPath = decodeText(header[4])?.takeIf(String::isNotEmpty)

        val sectionRows = rows.filter { it.size == 4 && it[0] == "S" }
        val sections = sectionRows.mapNotNull section@{ sectionRow ->
            val sectionIndex = sectionRow[1].toIntOrNull() ?: return@section null
            val label = decodeText(sectionRow[2]) ?: return@section null
            val durationMs = sectionRow[3].toLongOrNull() ?: return@section null
            val segmentRows = rows.filter {
                it.size == 9 && it[0] == "G" && it[1].toIntOrNull() == sectionIndex
            }.sortedBy { it[2].toIntOrNull() ?: Int.MAX_VALUE }
            val segments = segmentRows.mapNotNull segment@{ segmentRow ->
                val segmentIndex = segmentRow[2].toIntOrNull() ?: return@segment null
                val href = decodeText(segmentRow[3]) ?: return@segment null
                val type = decodeText(segmentRow[4]) ?: return@segment null
                val path = decodeText(segmentRow[5]) ?: return@segment null
                val clipBeginMs = segmentRow[6].toLongOrNull() ?: return@segment null
                val clipEndMs = segmentRow[7].toLongOrNull() ?: return@segment null
                val sourceDurationMs = segmentRow[8].toLongOrNull() ?: return@segment null
                val cues = rows.filter {
                    it.size == 5 && it[0] == "C" &&
                        it[1].toIntOrNull() == sectionIndex && it[2].toIntOrNull() == segmentIndex
                }.mapNotNull cue@{ cueRow ->
                    val offsetMs = cueRow[3].toLongOrNull() ?: return@cue null
                    val text = decodeText(cueRow[4]) ?: return@cue null
                    BridgePlaybackCue(offsetMs, text)
                }
                BridgePlaybackSegment(
                    href, type, path, clipBeginMs, clipEndMs, sourceDurationMs, cues
                )
            }
            BridgePlaybackSection(sectionIndex, label, durationMs, segments)
        }
        return BridgePlaybackManifest(bookId, title, author, sections, coverPath)
    }

    private fun encodeFragments(fragments: List<String>): String =
        fragments.joinToString(",", transform = ::encodeText)

    private fun decodeFragments(value: String): List<String>? {
        if (value.isBlank()) return null
        return value.split(',').map { decodeText(it) ?: return null }.filter(String::isNotBlank)
            .takeIf(List<String>::isNotEmpty)
    }

    fun encodePlaybackLocation(location: BridgePlaybackLocation): String {
        val text = location.textLocator
        return listOf(
            "L",
            location.schemaVersion.toString(),
            encodeText(location.editionId),
            encodeText(location.locator.href),
            encodeText(location.locator.type),
            encodeText(location.locator.title.orEmpty()),
            encodeFragments(location.locator.fragments),
            location.locator.progression?.toString().orEmpty(),
            location.locator.totalProgression?.toString().orEmpty(),
            encodeText(text?.href.orEmpty()),
            encodeText(text?.type.orEmpty()),
            encodeText(text?.title.orEmpty()),
            text?.fragments?.let(::encodeFragments).orEmpty(),
            text?.progression?.toString().orEmpty(),
            text?.totalProgression?.toString().orEmpty(),
            location.updatedAt.toString()
        ).joinToString("|")
    }

    fun newestPlaybackLocation(
        existing: BridgePlaybackLocation?,
        incoming: BridgePlaybackLocation
    ): BridgePlaybackLocation =
        if (existing?.editionId == incoming.editionId && existing.updatedAt >= incoming.updatedAt) {
            existing
        } else {
            incoming
        }

    fun decodePlaybackLocation(encoded: String): BridgePlaybackLocation? {
        val fields = encoded.split('|')
        if (fields.size != 16 || fields[0] != "L" || fields[1].toIntOrNull() != 2) return null
        val editionId = decodeText(fields[2]).orEmpty().takeIf(String::isNotBlank) ?: return null
        fun progression(index: Int): Double? {
            if (fields[index].isEmpty()) return null
            return fields[index].toDoubleOrNull()?.takeIf { it.isFinite() && it in 0.0..1.0 }
        }
        val locator = BridgeLocator(
            decodeText(fields[3]).orEmpty().takeIf(String::isNotBlank) ?: return null,
            decodeText(fields[4]).orEmpty().takeIf(String::isNotBlank) ?: return null,
            decodeText(fields[5]).orEmpty().takeIf(String::isNotBlank),
            decodeFragments(fields[6]) ?: return null,
            progression(7),
            progression(8)
        )
        if (locator.fragments.none(timeFragment::matches)) {
            return null
        }
        val textHref = decodeText(fields[9]).orEmpty()
        val textLocator = if (textHref.isNotBlank()) BridgeLocator(
            textHref,
            decodeText(fields[10]).orEmpty().takeIf(String::isNotBlank) ?: return null,
            decodeText(fields[11]).orEmpty().takeIf(String::isNotBlank),
            decodeFragments(fields[12]) ?: return null,
            progression(13),
            progression(14)
        ) else null
        return BridgePlaybackLocation(
            2,
            editionId,
            locator,
            textLocator,
            fields[15].toLongOrNull()?.takeIf { it > 0 } ?: return null
        )
    }

    fun encodePlaybackLocations(locations: List<BridgePlaybackLocation>): String =
        locations.joinToString("\n", transform = ::encodePlaybackLocation)

    fun decodePlaybackLocations(encoded: String): List<BridgePlaybackLocation> =
        encoded.lineSequence().mapNotNull(::decodePlaybackLocation).toList()

    fun resolvePlaybackLocation(
        manifest: BridgePlaybackManifest,
        location: BridgePlaybackLocation?
    ): BridgePlaybackTarget? {
        if (location?.schemaVersion != 2 || location.editionId != manifest.bookId) return null
        val fragment = location.locator.fragments.firstOrNull(timeFragment::matches) ?: return null
        val sourceTimeMs = ((fragment.substringAfter('=').removePrefix("npt:").toDoubleOrNull()
            ?: return null) * 1_000).toLong()
        val textTarget = location.textLocator?.let {
            "${it.href}#${it.fragments.firstOrNull().orEmpty()}"
        }
        val matches = manifest.sections.flatMap { section ->
            section.segments.mapIndexedNotNull { segmentIndex, segment ->
                if (segment.href != location.locator.href ||
                    sourceTimeMs < segment.clipBeginMs || sourceTimeMs > segment.clipEndMs
                ) return@mapIndexedNotNull null
                Triple(
                    BridgePlaybackTarget(
                        section.sectionIndex,
                        segmentIndex,
                        (sourceTimeMs - segment.clipBeginMs)
                            .coerceIn(0L, segment.clipEndMs - segment.clipBeginMs)
                    ),
                    textTarget != null && segment.cues.any { it.text == textTarget },
                    sourceTimeMs == segment.clipBeginMs
                )
            }
        }
        return (matches.firstOrNull { it.second }
            ?: matches.firstOrNull { it.third }
            ?: matches.firstOrNull())?.first
    }
}

class CarBridgeStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun saveBooks(books: List<BridgeBook>) {
        preferences.edit().putString(BOOKS_KEY, CarBridgeCodec.encodeBooks(books)).apply()
    }

    fun loadBooks(): List<BridgeBook> =
        CarBridgeCodec.decodeBooks(preferences.getString(BOOKS_KEY, "").orEmpty())

    fun saveChapters(bookId: String, chapters: List<BridgeChapter>) {
        preferences.edit()
            .putString(chaptersKey(bookId), CarBridgeCodec.encodeChapters(chapters))
            .apply()
    }

    fun loadChapters(bookId: String): List<BridgeChapter> = CarBridgeCodec.decodeChapters(
        preferences.getString(chaptersKey(bookId), "").orEmpty()
    )

    fun savePendingPlayRequest(request: BridgePlayRequest) {
        preferences.edit()
            .putString(PENDING_PLAY_KEY, CarBridgeCodec.encodePlayRequest(request))
            .apply()
    }

    fun takePendingPlayRequest(): BridgePlayRequest? {
        val request = preferences.getString(PENDING_PLAY_KEY, null)
            ?.let(CarBridgeCodec::decodePlayRequest)
        if (request != null) preferences.edit().remove(PENDING_PLAY_KEY).apply()
        return request
    }

    fun savePlaybackManifest(manifest: BridgePlaybackManifest) {
        preferences.edit()
            .putString(playbackManifestKey(manifest.bookId), CarBridgeCodec.encodePlaybackManifest(manifest))
            .apply()
    }

    fun loadPlaybackManifest(bookId: String): BridgePlaybackManifest? =
        preferences.getString(playbackManifestKey(bookId), null)
            ?.let(CarBridgeCodec::decodePlaybackManifest)

    fun savePlaybackLocation(location: BridgePlaybackLocation) {
        val newest = CarBridgeCodec.newestPlaybackLocation(
            loadPlaybackLocation(location.editionId),
            location
        )
        preferences.edit()
            .putString(
                playbackLocationKey(location.editionId),
                CarBridgeCodec.encodePlaybackLocation(newest)
            )
            .apply()
    }

    fun loadPlaybackLocation(bookId: String): BridgePlaybackLocation? =
        preferences.getString(playbackLocationKey(bookId), null)
            ?.let(CarBridgeCodec::decodePlaybackLocation)

    fun savePendingBookmark(location: BridgePlaybackLocation) {
        val current = loadPendingBookmarks(location.editionId)
        val audioKey = location.locator.href to location.locator.fragments.firstOrNull()
        val textKey = location.textLocator?.let { it.href to it.fragments.firstOrNull() }
        val duplicate = current.any { existing ->
            val existingAudio = existing.locator.href to existing.locator.fragments.firstOrNull()
            val existingText = existing.textLocator?.let { it.href to it.fragments.firstOrNull() }
            (textKey != null && existingText == textKey) || existingAudio == audioKey
        }
        if (duplicate) return
        preferences.edit()
            .putString(
                pendingBookmarksKey(location.editionId),
                CarBridgeCodec.encodePlaybackLocations(current + location)
            )
            .apply()
    }

    fun takePendingBookmarks(bookId: String): List<BridgePlaybackLocation> {
        val key = pendingBookmarksKey(bookId)
        val bookmarks = loadPendingBookmarks(bookId)
        if (bookmarks.isNotEmpty()) preferences.edit().remove(key).apply()
        return bookmarks
    }

    private fun loadPendingBookmarks(bookId: String): List<BridgePlaybackLocation> =
        preferences.getString(pendingBookmarksKey(bookId), null)
            ?.let(CarBridgeCodec::decodePlaybackLocations)
            .orEmpty()

    fun saveLastPlayRequest(request: BridgePlayRequest) {
        preferences.edit()
            .putString(LAST_PLAY_KEY, CarBridgeCodec.encodePlayRequest(request))
            .apply()
    }

    fun loadLastPlayRequest(): BridgePlayRequest? = preferences.getString(LAST_PLAY_KEY, null)
        ?.let(CarBridgeCodec::decodePlayRequest)

    private fun chaptersKey(bookId: String): String =
        "$CHAPTERS_KEY_PREFIX${URLEncoder.encode(bookId, "UTF-8")}"

    private fun playbackManifestKey(bookId: String): String =
        "$PLAYBACK_MANIFEST_KEY_PREFIX${URLEncoder.encode(bookId, "UTF-8")}"

    private fun playbackLocationKey(bookId: String): String =
        "$PLAYBACK_LOCATION_KEY_PREFIX${URLEncoder.encode(bookId, "UTF-8")}"

    private fun pendingBookmarksKey(bookId: String): String =
        "$PENDING_BOOKMARKS_KEY_PREFIX${URLEncoder.encode(bookId, "UTF-8")}"

    private companion object {
        const val PREFERENCES_NAME = "bookarc_android_auto"
        const val BOOKS_KEY = "audiobooks"
        const val CHAPTERS_KEY_PREFIX = "chapters_"
        const val PENDING_PLAY_KEY = "pending_play"
        const val LAST_PLAY_KEY = "last_play"
        const val PLAYBACK_MANIFEST_KEY_PREFIX = "playback_manifest_"
        const val PLAYBACK_LOCATION_KEY_PREFIX = "playback_location_"
        const val PENDING_BOOKMARKS_KEY_PREFIX = "pending_bookmarks_v2_"
    }
}
