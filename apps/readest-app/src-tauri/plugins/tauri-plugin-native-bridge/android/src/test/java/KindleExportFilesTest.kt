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
        var missingError: RuntimeException? = null
        val names = mutableMapOf<String, String>()
        override fun read(id: String): InputStream? {
            if (!files.containsKey(id)) missingError?.let { throw it }
            return files[id]?.inputStream()
        }
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

    @Test fun deletedTreeDocumentIsRecreatedWhenFireReportsAnInvalidDocument() {
        val documents = Documents()
        val first = save(documents)
        documents.files.remove(first)
        // FileSystemProvider.isChildDocument wraps a missing file in this exception.
        documents.missingError = IllegalArgumentException("Failed to determine if document is child of Books: java.io.FileNotFoundException")
        val replacement = save(documents, first)
        assertNotEquals(first, replacement)
        assertArrayEquals(bytes, documents.files[replacement])
        assertEquals(replacement, save(documents, replacement))
        assertEquals(2, documents.creates)
    }

    @Test fun revokedAccessIsNotTreatedAsADeletedFile() {
        val documents = Documents()
        documents.missingError = SecurityException("Books folder access revoked")
        assertThrows(SecurityException::class.java) { save(documents, "old-export") }
        assertEquals(0, documents.creates)
    }
}
