package com.readest.native_bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import androidx.activity.result.ActivityResult
import java.io.*
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg
class FireKindleArgs {
    lateinit var filePath: String
    lateinit var title: String
    lateinit var exportKey: String
    lateinit var fileSha256: String
}

internal class FireKindleExporter(private val activity: Activity) {
    private val preferences by lazy { activity.getSharedPreferences("bookarc-kindle-exports", 0) }
    private val busy = AtomicBoolean(false)
    private val worker = Executors.newSingleThreadExecutor()
    private val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    fun start(invoke: Invoke, pick: (Intent) -> Unit) {
        if (!busy.compareAndSet(false, true)) { invoke.reject("A Kindle export is already in progress."); return }
        try {
            validate(invoke.parseArgs(FireKindleArgs::class.java))
            val folder = preferences.getString("folder", null)?.let { Uri.parse(it) }
            if (folder != null && validFolder(folder) && activity.contentResolver.persistedUriPermissions.any {
                    it.uri == folder && it.isReadPermission && it.isWritePermission }) {
                save(invoke, folder)
            } else {
                preferences.edit().remove("folder").commit()
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(flags or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                    putExtra(DocumentsContract.EXTRA_INITIAL_URI,
                        Uri.parse("content://com.android.externalstorage.documents/document/primary:Books"))
                }
                pick(intent)
            }
        } catch (error: Exception) { fail(invoke, error) }
    }

    fun selected(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            busy.set(false)
            invoke.resolve(JSObject().putResult(true, "", false))
            return
        }
        try {
            require(validFolder(uri)) { "Choose the Books folder in internal storage, then try again." }
            activity.contentResolver.takePersistableUriPermission(uri, flags)
            check(preferences.edit().putString("folder", uri.toString()).commit()) { "Could not retain folder access." }
            save(invoke, uri)
        } catch (error: Exception) { fail(invoke, error) }
    }

    private fun validFolder(uri: Uri): Boolean = uri.authority == "com.android.externalstorage.documents" &&
        DocumentsContract.isTreeUri(uri) && DocumentsContract.getTreeDocumentId(uri) == "primary:Books"

    private fun validate(args: FireKindleArgs): File {
        require(Regex("^[a-f0-9]{64}-[a-zA-Z0-9.-]{1,80}$").matches(args.exportKey)) { "Invalid export identity." }
        require(Regex("^[a-f0-9]{64}$").matches(args.fileSha256)) { "Invalid file digest." }
        val source = File(args.filePath).canonicalFile
        // Only app-controlled files are accepted by this native command.
        val roots = listOfNotNull(activity.filesDir, activity.cacheDir, activity.getExternalFilesDir(null))
        require(roots.any { source.path.startsWith(it.canonicalPath + File.separator) }) { "Invalid Kindle source path." }
        require(source.isFile && source.length() in 78..(100L * 1024 * 1024) && source.extension == "mobi") { "Invalid Kindle copy." }
        return source
    }

    private fun save(invoke: Invoke, folder: Uri) {
        worker.execute {
            try {
                val args = invoke.parseArgs(FireKindleArgs::class.java)
                val source = validate(args)
                val resolver = activity.contentResolver
                val parent = DocumentsContract.buildDocumentUriUsingTree(folder, "primary:Books")
                val documents = object : KindleDocuments {
                    override fun read(id: String) = resolver.openInputStream(Uri.parse(id))
                    override fun create(name: String): String = DocumentsContract.createDocument(resolver, parent,
                        "application/octet-stream", name)?.toString() ?: throw IOException("Could not create a file in Books.")
                    override fun write(id: String): OutputStream {
                        val descriptor = resolver.openFileDescriptor(Uri.parse(id), "wt")
                            ?: throw IOException("Could not write to Books.")
                        return object : ParcelFileDescriptor.AutoCloseOutputStream(descriptor) {
                            override fun close() {
                                try { flush(); fd.sync() } finally { super.close() }
                            }
                        }
                    }
                    override fun rename(id: String, name: String): String = DocumentsContract.renameDocument(resolver, Uri.parse(id), name)?.toString()
                        ?: throw IOException("Could not finish saving to Books.")
                    override fun delete(id: String) { DocumentsContract.deleteDocument(resolver, Uri.parse(id)) }
                    override fun find(name: String): String? {
                        val children = DocumentsContract.buildChildDocumentsUriUsingTree(folder, "primary:Books")
                        resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
                            while (cursor.moveToNext()) {
                                if (cursor.getString(1) == name)
                                    return DocumentsContract.buildDocumentUriUsingTree(folder, cursor.getString(0)).toString()
                            }
                        }
                        return null
                    }
                }
                // A killed process may leave its unpublished temporary document.
                preferences.getString("pending", null)?.let { id ->
                    val uri = Uri.parse(id)
                    if (uri.authority == folder.authority && DocumentsContract.getDocumentId(uri).startsWith("primary:Books/BookArc-")) {
                        try { documents.delete(id) } catch (_: FileNotFoundException) {}
                    }
                    preferences.edit().remove("pending").commit()
                }
                val safeTitle = args.title.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(100).ifEmpty { "Book" }
                val name = "BookArc-$safeTitle-${args.exportKey.take(12)}-${args.exportKey.substring(65)}.mobi"
                val result = KindleExportFiles.save(source, documents,
                    preferences.getString(args.exportKey, null), name, args.fileSha256,
                    { id -> check(preferences.edit().putString("pending", id).commit()) { "Could not record the pending export." } },
                    { id -> check(preferences.edit().putString(args.exportKey, id).remove("pending").commit()) { "Could not record the saved export." } })
                activity.runOnUiThread {
                    var opened = false
                    try {
                        activity.packageManager.getLaunchIntentForPackage("com.amazon.kindle")?.let {
                            activity.startActivity(it); opened = true
                        }
                    } catch (_: Exception) { /* Saving and opening are separate results. */ }
                    busy.set(false)
                    invoke.resolve(JSObject().putResult(false, result, opened))
                }
            } catch (error: Exception) { fail(invoke, error) }
        }
    }

    private fun fail(invoke: Invoke, error: Exception) {
        if (error is SecurityException) preferences.edit().remove("folder").commit()
        busy.set(false)
        invoke.reject(if (error is SecurityException) "Books folder access has changed. Please try again and allow access." else error.message ?: "Could not save the Kindle copy.")
    }

    private fun JSObject.putResult(cancelled: Boolean, savedPath: String, kindleOpened: Boolean): JSObject {
        put("cancelled", cancelled); put("savedPath", savedPath); put("kindleOpened", kindleOpened)
        return this
    }
}
