package com.readest.native_bridge

import android.content.Context
import android.util.Log
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener

class InstallReferrerHelper(private val context: Context) {
    fun getReferrer(callback: (String) -> Unit) {
        val client = InstallReferrerClient.newBuilder(context).build()
        client.startConnection(object : InstallReferrerStateListener {
            override fun onInstallReferrerSetupFinished(responseCode: Int) {
                val referrer = if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                    runCatching { client.installReferrer.installReferrer }.getOrElse { "" }
                } else {
                    ""
                }
                runCatching { client.endConnection() }
                callback(referrer)
            }
            override fun onInstallReferrerServiceDisconnected() {
                callback("")
            }
        })
    }
}
