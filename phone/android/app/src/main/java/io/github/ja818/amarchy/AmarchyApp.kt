package io.github.ja818.amarchy

import android.app.Application
import android.os.Build

class AmarchyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Before anything is shown or received: the channels, and Firebase
        // (by hand: its provider is taken out of the manifest).
        Notes.channels(this)
        Push.init(this)
    }
}

/** What this build is, for the page (`amarchyPhone.version`) and the machine (a subscription's `app`). */
internal object AppInfo {
    val version = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    /** Added to the web view's user agent: the machine can tell the app's page from a browser's. */
    val userAgent = " AmarchyApp/${BuildConfig.VERSION_NAME} (Android)"

    val device: String
        get() {
            val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
            val model = Build.MODEL.orEmpty()
            return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
        }
}
