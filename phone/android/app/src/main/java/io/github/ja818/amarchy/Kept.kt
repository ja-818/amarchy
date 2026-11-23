package io.github.ja818.amarchy

import android.content.Context
import androidx.core.content.edit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put

/** A phone subscribed on a machine: kept, so a new FCM token registers again and tells that machine. */
internal data class Subscription(val server: String, val key: String, val endpoint: String, val token: String)

/** What the shell keeps, in the app's own storage (never backed up: see data_extraction_rules). */
internal class Kept(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("amarchy", Context.MODE_PRIVATE)

    /** The machine's address, the last one that answered. */
    val server: String? get() = prefs.getString("server", null)

    /** Its name (for a chat's link) and what it calls itself. */
    val machine: String get() = prefs.getString("machine", null).orEmpty()
    val label: String get() = prefs.getString("label", null).orEmpty()

    fun keep(server: String, hello: Hello) = prefs.edit {
        putString("server", server)
        putString("machine", hello.name)
        putString("label", hello.label)
    }

    fun shareUrl(server: String): String? = prefs.getString("share:$server", null)

    fun keepShareUrl(server: String, url: String?) = prefs.edit {
        if (url == null) remove("share:$server") else putString("share:$server", url)
    }

    /** Asked for POST_NOTIFICATIONS once (Android 13+): a "no" since then is the system's. */
    var notificationsAsked: Boolean
        get() = prefs.getBoolean("notifications_asked", false)
        set(value) = prefs.edit { putBoolean("notifications_asked", value) }

    var subscriptions: List<Subscription>
        get() = jsonArray(prefs.getString("subscriptions", null)).mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            Subscription(
                server = o.string("server") ?: return@mapNotNull null,
                key = o.string("key") ?: return@mapNotNull null,
                endpoint = o.string("endpoint") ?: return@mapNotNull null,
                token = o.string("token").orEmpty(),
            )
        }
        set(value) = prefs.edit {
            putString(
                "subscriptions",
                buildJsonArray {
                    value.forEach { s ->
                        addJsonObject {
                            put("server", s.server)
                            put("key", s.key)
                            put("endpoint", s.endpoint)
                            put("token", s.token)
                        }
                    }
                }.toString(),
            )
        }

    /** What the widget shows: the page's last `status`, its count from the last notification since. */
    var board: Board
        get() = Board.parse(jsonObject(prefs.getString("board", null)))
        set(value) = prefs.edit { putString("board", value.toJson().toString()) }

    private fun jsonArray(text: String?): JsonArray =
        text?.let { runCatching { Json.parseToJsonElement(it) as? JsonArray }.getOrNull() } ?: JsonArray(emptyList())
}
