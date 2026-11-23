package io.github.ja818.amarchy

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * A machine's address is its origin, `https://<machine>.<tailnet>.ts.net`
 * (a port only when it isn't 443): what the app's pages come from, and the
 * only origin the bridge answers.
 */
internal object Address {
    /** What was typed or linked (`amarchy.tail1234.ts.net`, with or without https://): its origin. */
    fun parse(raw: String): Result<String> {
        val text = raw.trim()
        if (text.isEmpty()) return Result.failure(Said("Type your amarchy's address, like amarchy.your-tailnet.ts.net"))
        val uri = runCatching { URI(if ("://" in text) text else "https://$text") }.getOrNull()
        if (uri == null || uri.host.isNullOrEmpty() || uri.scheme == null) {
            return Result.failure(Said("$text isn't an address: type it like amarchy.your-tailnet.ts.net"))
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) {
            return Result.failure(Said("Only https addresses: your amarchy is at https://<machine>.<tailnet>.ts.net"))
        }
        if (uri.rawUserInfo != null) return Result.failure(Said("$text isn't an address: type it like amarchy.your-tailnet.ts.net"))
        return Result.success(originOf(uri)!!)
    }

    /** Where a page's address comes from (scheme://host[:port]), or null for anything but http(s). */
    fun origin(url: String?): String? = url?.let { runCatching { originOf(URI(it)) }.getOrNull() }

    private fun originOf(uri: URI): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase()?.trimEnd('.')?.takeIf { it.isNotEmpty() } ?: return null
        val port = when (uri.port) {
            -1, if (scheme == "https") 443 else 80 -> ""
            else -> ":${uri.port}"
        }
        return "$scheme://$host$port"
    }

    /** The host of an origin, what the own page calls it. */
    fun host(origin: String): String = runCatching { URI(origin).host }.getOrNull() ?: origin

    /** Whether a host is the tailnet's: a name under .ts.net, or one of its addresses. */
    fun onTailnet(host: String): Boolean {
        val h = host.trim('[', ']').trimEnd('.').lowercase()
        val v4 = h.split('.').takeIf { it.size == 4 }?.map { it.toIntOrNull() ?: -1 }
        if (v4 != null && v4.all { it in 0..255 }) return v4[0] == 100 && v4[1] in 64..127
        if (':' in h) return h.startsWith("fd7a:115c:a1e0:")
        return h.endsWith(".ts.net")
    }
}

/** A link that opens the app: `amarchy://open?server=<https url>`, `amarchy://chat/<machine>/<id>`. */
internal sealed interface Link {
    data class Open(val server: String) : Link

    data class Chat(val machine: String, val id: String) : Link {
        /** The app's route to it from the machine called `here`: its own chat by id, another's by <machine>:<id>. */
        fun route(here: String): String = if (machine == here || here.isEmpty()) "/#/s/$id" else "/#/s/$machine:$id"
    }

    companion object {
        private val part = Regex("[A-Za-z0-9._-]+")

        fun parse(raw: String?): Link? {
            val text = raw?.trim() ?: return null
            if (!text.startsWith("amarchy://", ignoreCase = true)) return null
            val rest = text.substring("amarchy://".length)
            val (where, query) = rest.substringBefore('#').let { it.substringBefore('?') to it.substringAfter('?', "") }
            val parts = where.trimEnd('/').split('/')
            return when (parts.firstOrNull()?.lowercase()) {
                "open" -> {
                    if (parts.size != 1) return null
                    val server = query.split('&').firstNotNullOfOrNull { kv ->
                        kv.substringBefore('=').takeIf { it == "server" }?.let { kv.substringAfter('=', "") }
                    } ?: return null
                    val decoded = runCatching { URLDecoder.decode(server, "UTF-8") }.getOrNull() ?: return null
                    Address.parse(decoded).getOrNull()?.let { Open(it) }
                }
                "chat" -> {
                    if (parts.size != 3) return null
                    val (machine, id) = parts[1] to parts[2]
                    if (machine.length > 63 || id.length > 120 || !part.matches(machine) || !part.matches(id)) return null
                    Chat(machine, id)
                }
                else -> null
            }
        }
    }
}

/** The pages the shell opens on a machine. */
internal object Routes {
    private val key = Regex("[A-Za-z0-9._:-]{1,200}")
    private val fragment = Regex("[A-Za-z0-9._:/~%-]*")

    /** Whether it's a chat's key, as the board and the notifications name them. */
    fun isKey(text: String?): Boolean = text != null && key.matches(text)

    /** The route in a `go` (`/#/s/<key>`, as a notification's url or a chat's link has it), or null. */
    fun hash(go: String?): String? {
        val at = go?.indexOf('#') ?: return null
        if (at < 0) return null
        return go.substring(at + 1).takeIf { it.isNotEmpty() && fragment.matches(it) }
    }

    /** The app at `server`, on `go`, with the card of `ask` shown: `<server>/?ask=<ask>#/s/<key>`. */
    fun page(server: String, go: String? = null, ask: String? = null): String {
        val query = ask?.takeIf { isKey(it) }?.let { "?ask=" + URLEncoder.encode(it, "UTF-8") }.orEmpty()
        val hash = hash(go)?.let { "#$it" }.orEmpty()
        return "$server/$query$hash"
    }
}
