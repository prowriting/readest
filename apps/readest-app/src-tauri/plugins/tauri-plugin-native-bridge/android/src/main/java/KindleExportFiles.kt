package com.readest.native_bridge

import java.io.*
import java.security.MessageDigest
import java.util.UUID

internal interface KindleDocuments {
    fun read(id: String): InputStream?
    fun create(name: String): String
    fun write(id: String): OutputStream
    fun rename(id: String, name: String): String
    fun delete(id: String)
    fun find(name: String): String? = null
}

internal object KindleExportFiles {
    fun digest(input: InputStream): String = input.use {
        val hash = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            hash.update(buffer, 0, count)
        }
        hash.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    fun save(source: File, documents: KindleDocuments, existing: String?, name: String,
             expectedSha: String, pending: (String?) -> Unit, complete: (String) -> Unit): String {
        require(Regex("^[a-f0-9]{64}$").matches(expectedSha)) { "Invalid Kindle file digest." }
        require(digest(source.inputStream()) == expectedSha) { "The Kindle copy is incomplete. Please try again." }
        for (candidate in listOfNotNull(existing, documents.find(name)).distinct()) {
            val intact = try { documents.read(candidate)?.let { digest(it) == expectedSha } == true }
                catch (_: FileNotFoundException) { false }
            if (intact) { complete(candidate); return candidate }
        }
        var created: String? = null
        try {
            created = documents.create("BookArc-${UUID.randomUUID()}.partial")
            pending(created)
            documents.write(created).use { output -> source.inputStream().use { it.copyTo(output) } }
            if (documents.read(created)?.let { digest(it) } != expectedSha)
                throw IOException("The Books folder copy is incomplete. Please try again.")
            created = documents.rename(created, name)
            pending(created)
            complete(created)
            return created
        } catch (error: Exception) {
            created?.let { try { documents.delete(it) } catch (_: Exception) {} }
            pending(null)
            throw error
        }
    }
}
