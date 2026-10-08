package com.readest.native_bridge

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.module.SimpleModule
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.mockito.Mockito.*

class NativeFileIntentTest {
    private val activity = mock(Activity::class.java)
    private val resolver = mock(ContentResolver::class.java)
    private val plugin = NativeBridgePlugin(activity)
    private val received = mutableListOf<String>()

    init { `when`(activity.contentResolver).thenReturn(resolver) }

    private fun view(url: String): Intent {
        val uri = mock(Uri::class.java)
        `when`(uri.scheme).thenReturn(url.substringBefore(':'))
        `when`(uri.toString()).thenReturn(url)
        return mock(Intent::class.java).also {
            `when`(it.action).thenReturn(Intent.ACTION_VIEW)
            `when`(it.data).thenReturn(uri)
        }
    }

    private fun listen() {
        val mapper = ObjectMapper()
        val channel = Channel(1, { received.add(it) }, mapper)
        mapper.registerModule(SimpleModule().addDeserializer(Channel::class.java,
            object : JsonDeserializer<Channel>() {
                override fun deserialize(p: JsonParser, ctxt: DeserializationContext) = channel
            }))
        plugin.registerListener(Invoke(1, "registerListener", 1, 2, { _, _ -> },
            """{"event":"shared-intent","handler":"__CHANNEL__:1"}""", mapper))
    }

    @Test fun chromeDownloadIsDeliveredToTheRunningReaderEvenWithoutPersistablePermission() {
        val intent = view("content://com.android.providers.downloads.documents/document/7")
        val uri = intent.data!!
        doThrow(SecurityException("Temporary grant only")).`when`(resolver)
            .takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        listen()
        plugin.onNewIntent(intent)
        assertEquals(listOf(intent.data.toString()), received.map {
            JSONObject(it).getJSONArray("urls").getString(0)
        })
    }

    @Test fun coldStartWaitsForReaderListenerAndDoesNotReplayOnRemount() {
        val intent = view("content://com.android.chrome.FileProvider/downloads/gift.epub")
        `when`(activity.intent).thenReturn(intent)
        plugin.load(mock(WebView::class.java))
        assertTrue(received.isEmpty())
        listen()
        assertEquals(1, received.size)
        assertEquals(intent.data.toString(), JSONObject(received.single()).getJSONArray("urls").getString(0))
        listen()
        assertEquals(1, received.size)
    }

    @Test fun webAndAuthenticationUrlsAreNotImportedAsBooks() {
        listen()
        plugin.onNewIntent(view("https://web.bookarc.app/claim"))
        plugin.onNewIntent(view("bookarc://auth-callback"))
        assertTrue(received.isEmpty())
    }
}
