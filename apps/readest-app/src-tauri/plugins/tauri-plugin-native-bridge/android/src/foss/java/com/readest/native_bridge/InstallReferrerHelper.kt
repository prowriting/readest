package com.readest.native_bridge

import android.content.Context

class InstallReferrerHelper(private val context: Context) {
    fun getReferrer(callback: (String) -> Unit) {
        callback("")
    }
}
