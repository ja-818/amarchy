package io.github.ja818.amarchy

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** A notification's button: `body` (JSON) POSTed to `<server><path>`. */
internal data class NoticeAction(val label: String, val path: String, val body: String)

/**
 * A notification as the machine sends a phone app (phone/README.md,
 * "Notifications"): every field but the title may be missing, and what
 * isn't what it should be counts as missing.
 */
internal data class Notice(
    val title: String,
    val body: String = "",
    val tag: String? = null,
    val url: String? = null,
    val ask: String? = null,
    val waiting: Int? = null,
    val urgent: Boolean = false,
    val server: String? = null,
    val session: String? = null,
    val sound: String? = null,
    val actions: List<NoticeAction> = emptyList(),
) {
    companion object {
        const val MOST_ACTIONS = 3

        /** What's shown when there's nothing to decrypt with, or it doesn't decrypt. */
        val unread = Notice(title = "Amarchy", body = "Open it to see")

        fun parse(plain: ByteArray): Notice? = parse(plain.toString(Charsets.UTF_8))

        fun parse(text: String): Notice? {
            val o = jsonObject(text) ?: return null
            val title = o.string("title")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            // A button only means something with the machine it goes to.
            val server = o.string("server")?.let { s -> Address.parse(s).getOrNull()?.takeIf { s.startsWith("https://") } }
            return Notice(
                title = title,
                body = o.string("body").orEmpty(),
                tag = o.string("tag")?.takeIf { it.isNotBlank() && it.length <= 200 },
                url = o.string("url")?.takeIf { it.startsWith("/") && !it.startsWith("//") },
                ask = o.string("ask")?.takeIf { Routes.isKey(it) },
                waiting = o.int("waiting")?.takeIf { it >= 0 },
                urgent = o.bool("urgent") == true,
                server = server,
                session = o.string("session")?.takeIf { Routes.isKey(it) },
                sound = o.string("sound"),
                actions = if (server == null) emptyList() else actions(o),
            )
        }

        private fun actions(o: JsonObject): List<NoticeAction> =
            (o["actions"] as? JsonArray).orEmpty().mapNotNull(::action).take(MOST_ACTIONS)

        private fun action(element: JsonElement): NoticeAction? {
            val a = element as? JsonObject ?: return null
            val label = a.string("label")?.trim()?.takeIf { it.isNotEmpty() && it.length <= 60 } ?: return null
            val path = a.string("path")?.takeIf { it.startsWith("/") && !it.startsWith("//") && it.none(Char::isWhitespace) }
                ?: return null
            val body = when (val b = a["body"]) {
                null -> "{}"
                is JsonObject -> b.toString()
                else -> return null
            }
            return NoticeAction(label, path, body)
        }
    }
}
