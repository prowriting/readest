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
    val path: String,
    val clipBeginMs: Long,
    val clipEndMs: Long,
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
    val currentSectionIndex: Int?,
    val sections: List<BridgePlaybackSection>,
    val coverPath: String? = null
)

internal object CarBridgeCodec {
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
                manifest.currentSectionIndex?.toString().orEmpty(),
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
                        encodeText(segment.path),
                        segment.clipBeginMs.toString(),
                        segment.clipEndMs.toString()
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
        val header = rows.firstOrNull()?.takeIf { it.size == 6 && it[0] == "H" } ?: return null
        val bookId = decodeText(header[1]) ?: return null
        val title = decodeText(header[2]) ?: return null
        val author = decodeText(header[3]) ?: return null
        val currentSectionIndex = header[4].takeIf(String::isNotEmpty)?.toIntOrNull()
        if (header[4].isNotEmpty() && currentSectionIndex == null) return null
        val coverPath = decodeText(header[5])?.takeIf(String::isNotEmpty)

        val sectionRows = rows.filter { it.size == 4 && it[0] == "S" }
        val sections = sectionRows.mapNotNull section@{ sectionRow ->
            val sectionIndex = sectionRow[1].toIntOrNull() ?: return@section null
            val label = decodeText(sectionRow[2]) ?: return@section null
            val durationMs = sectionRow[3].toLongOrNull() ?: return@section null
            val segmentRows = rows.filter {
                it.size == 6 && it[0] == "G" && it[1].toIntOrNull() == sectionIndex
            }.sortedBy { it[2].toIntOrNull() ?: Int.MAX_VALUE }
            val segments = segmentRows.mapNotNull segment@{ segmentRow ->
                val segmentIndex = segmentRow[2].toIntOrNull() ?: return@segment null
                val path = decodeText(segmentRow[3]) ?: return@segment null
                val clipBeginMs = segmentRow[4].toLongOrNull() ?: return@segment null
                val clipEndMs = segmentRow[5].toLongOrNull() ?: return@segment null
                val cues = rows.filter {
                    it.size == 5 && it[0] == "C" &&
                        it[1].toIntOrNull() == sectionIndex && it[2].toIntOrNull() == segmentIndex
                }.mapNotNull cue@{ cueRow ->
                    val offsetMs = cueRow[3].toLongOrNull() ?: return@cue null
                    val text = decodeText(cueRow[4]) ?: return@cue null
                    BridgePlaybackCue(offsetMs, text)
                }
                BridgePlaybackSegment(path, clipBeginMs, clipEndMs, cues)
            }
            BridgePlaybackSection(sectionIndex, label, durationMs, segments)
        }
        return BridgePlaybackManifest(bookId, title, author, currentSectionIndex, sections, coverPath)
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

    private companion object {
        const val PREFERENCES_NAME = "bookarc_android_auto"
        const val BOOKS_KEY = "audiobooks"
        const val CHAPTERS_KEY_PREFIX = "chapters_"
        const val PENDING_PLAY_KEY = "pending_play"
        const val LAST_PLAY_KEY = "last_play"
        const val PLAYBACK_MANIFEST_KEY_PREFIX = "playback_manifest_"
    }
}
