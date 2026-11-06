package com.readest.native_bridge

import android.app.Activity
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.mockito.Mockito.*

class FireKindleExporterTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun start(path: String): Pair<Boolean, List<String>> {
        val activity = mock(Activity::class.java)
        val preferences = mock(SharedPreferences::class.java)
        val editor = mock(SharedPreferences.Editor::class.java)
        val data = temporary.root
        `when`(activity.filesDir).thenReturn(File(data, "files"))
        `when`(activity.cacheDir).thenReturn(File(data, "cache"))
        `when`(activity.applicationInfo).thenReturn(ApplicationInfo().apply { dataDir = data.path })
        `when`(activity.getSharedPreferences("bookarc-kindle-exports", 0)).thenReturn(preferences)
        `when`(preferences.edit()).thenReturn(editor)
        `when`(editor.remove("folder")).thenReturn(editor)
        `when`(editor.commit()).thenReturn(true)
        val mapper = ObjectMapper()
        val args = mapOf("filePath" to path, "title" to "Personalized book",
            "exportKey" to "${"a".repeat(64)}-calibre-9.8.0-hybrid-v1", "fileSha256" to "b".repeat(64))
        val replies = mutableListOf<String>()
        val invoke = Invoke(1, "send_to_kindle_app", 1, 2, { _, result -> replies.add(result) },
            mapper.writeValueAsString(args), mapper)
        var picked = false
        FireKindleExporter(activity).start(invoke) { picked = true }
        return Pair(picked, replies)
    }

    private fun mobi(path: String): File = File(temporary.root, path).apply {
        parentFile!!.mkdirs()
        writeBytes(ByteArray(80))
    }

    @Test fun acceptsTheTauriDataDirectoryCacheBeforeOpeningTheFolderPicker() {
        // Tauri's Android AppData is applicationInfo.dataDir, not Activity.filesDir.
        val source = mobi("Bookarc/kindle-conversions/personalized.mobi")
        val (picked, replies) = start(source.path)
        assertTrue("Expected the Books picker, received $replies", picked)
        assertTrue(replies.isEmpty())
    }

    @Test fun rejectsSiblingDirectoriesAndCanonicalPathsEscapingTheCache() {
        val outside = mobi("Bookarc/kindle-conversions-other/personalized.mobi")
        val link = File(temporary.root, "Bookarc/kindle-conversions/linked.mobi")
        link.parentFile!!.mkdirs()
        Files.createSymbolicLink(link.toPath(), outside.toPath())
        for (source in listOf(outside, link)) {
            val (picked, replies) = start(source.path)
            assertFalse(picked)
            assertTrue(replies.single().contains("Invalid Kindle source path."))
        }
    }
}
