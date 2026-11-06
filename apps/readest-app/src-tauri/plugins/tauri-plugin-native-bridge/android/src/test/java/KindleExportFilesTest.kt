package com.readest.native_bridge

import java.io.*
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class KindleExportFilesTest {
    private val bytes = "personalized hybrid mobi".toByteArray()
    private val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private class Documents : KindleDocuments {
        val files = mutableMapOf<String, ByteArray>()
        var creates = 0
        var broken = false
        val names = mutableMapOf<String, String>()
        override fun read(id: String) = files[id]?.inputStream()
        override fun create(name: String): String = "document-${++creates}".also { files[it] = byteArrayOf() }
        override fun write(id: String): OutputStream = object : ByteArrayOutputStream() {
            override fun close() { files[id] = if (broken) byteArrayOf(1) else toByteArray() }
        }
        override fun rename(id: String, name: String) = id.also { names[name] = id }
        override fun find(name: String) = names[name]
        override fun delete(id: String) { files.remove(id) }
    }
    private fun save(documents: Documents, existing: String? = null): String {
        val source = File.createTempFile("kindle-test", ".mobi")
        return try {
            source.writeBytes(bytes)
            KindleExportFiles.save(source, documents, existing, "Book.mobi", digest, {}, {})
        } finally { source.delete() }
    }
    @Test fun intactExportIsReusedAndDeletedExportIsRecreated() {
        val documents = Documents()
        val first = save(documents)
        assertEquals(first, save(documents, first))
        assertEquals(1, documents.creates)
        documents.files.remove(first)
        assertNotEquals(first, save(documents, first))
        assertEquals(2, documents.creates)
    }
    @Test fun partialWritesAreDeletedAndCanBeRetried() {
        val documents = Documents()
        documents.broken = true
        assertThrows(IOException::class.java) { save(documents) }
        assertTrue(documents.files.isEmpty())
        documents.broken = false
        assertNotNull(save(documents))
    }
    @Test fun mismatchedExistingExportIsNotReusedOrDeleted() {
        val documents = Documents()
        documents.files["other"] = "other edition".toByteArray()
        assertNotEquals("other", save(documents, "other"))
        assertArrayEquals("other edition".toByteArray(), documents.files["other"])
    }
    @Test fun committedFileIsRecoveredIfTheProcessDiedBeforeRecordingItsUri() {
        val documents = Documents()
        val first = save(documents)
        assertEquals(first, save(documents))
        assertEquals(1, documents.creates)
    }
    @Test fun committedFileIsRecoveredEvenWhenTheOldRecordedExportWasRemoved() {
        val documents = Documents()
        val first = save(documents)
        assertEquals(first, save(documents, "removed-old-export"))
        assertEquals(1, documents.creates)
    }
}
