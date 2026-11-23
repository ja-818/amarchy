package io.github.ja818.amarchy

import java.io.File
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.net.URI
import java.net.URLDecoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** The own node's local proxy: `http://amarchy:<secret>@127.0.0.1:<port>`. */
internal data class NodeProxy(val host: String, val port: Int, val user: String, val password: String) {
    companion object {
        fun parse(url: String?): NodeProxy? {
            val u = url?.let { runCatching { URI(it) }.getOrNull() } ?: return null
            if (u.scheme != "http" || u.host != "127.0.0.1" || u.port !in 1..65535) return null
            val info = u.rawUserInfo ?: return null
            val user = URLDecoder.decode(info.substringBefore(':'), "UTF-8")
            val password = URLDecoder.decode(info.substringAfter(':', ""), "UTF-8")
            if (user.isEmpty() || password.isEmpty()) return null
            return NodeProxy(u.host, u.port, user, password)
        }
    }
}

/** A peer on the tailnet, as the own node sees it. */
internal data class NodePeer(val name: String, val dns: String, val online: Boolean)

/** What the own node says it's doing (`State()`). */
internal data class NodeState(val state: String, val words: String, val loginUrl: String?, val self: String?, val peers: List<NodePeer>) {
    /** On the tailnet: its proxy reaches it. */
    val running get() = state.equals("running", ignoreCase = true)

    /** Waiting for you to sign in to Tailscale. */
    val needsLogin get() = !running && (loginUrl != null || state.contains("login", ignoreCase = true))

    companion object {
        fun parse(text: String?): NodeState? {
            val o = jsonObject(text) ?: return null
            val peers = (o["peers"] as? JsonArray).orEmpty().mapNotNull { e ->
                val p = e as? JsonObject ?: return@mapNotNull null
                val dns = p.string("dns")?.trimEnd('.')?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                NodePeer(p.string("name") ?: dns.substringBefore('.'), dns, p.bool("online") == true)
            }
            return NodeState(
                state = o.string("state").orEmpty(),
                words = o.string("words").orEmpty(),
                loginUrl = o.string("login_url")?.takeIf { it.startsWith("https://") },
                self = o.string("self"),
                peers = peers,
            )
        }
    }
}

/**
 * amarchy's own Tailscale node in the app (tailnet/mobile, a gomobile AAR
 * whose Go package `mobile` becomes the Java class `mobile.Mobile`), for a
 * phone without the Tailscale app's VPN. Builds without the AAR have no such
 * class: then [available] is false and the app reaches the tailnet through
 * the Tailscale app only.
 */
internal object OwnNode {
    private class Api(val start: Method, val state: Method, val loginUrl: Method, val proxyUrl: Method)

    private val api: Api? = runCatching {
        val c = Class.forName("mobile.Mobile")
        Api(
            start = c.getMethod("start", String::class.java, String::class.java),
            state = c.getMethod("state"),
            loginUrl = c.getMethod("loginURL"),
            proxyUrl = c.getMethod("proxyURL"),
        )
    }.getOrNull()

    @Volatile private var started = false

    @Volatile var proxy: NodeProxy? = null
        private set

    val available get() = api != null

    /** Starts it (once), its state kept in dir; why not, in words. */
    @Synchronized
    fun start(dir: File, hostname: String): Result<Unit> {
        val a = api ?: return Result.failure(Said("This build has no Tailscale node of its own"))
        if (started) return Result.success(Unit)
        dir.mkdirs()
        return call { a.start.invoke(null, dir.absolutePath, hostname) }.map {
            started = true
            proxy = NodeProxy.parse(call { a.proxyUrl.invoke(null) as? String }.getOrNull())
        }
    }

    fun state(): NodeState? = api?.takeIf { started }?.let { a -> NodeState.parse(call { a.state.invoke(null) as? String }.getOrNull()) }

    /** Tailscale's sign-in page for it. */
    fun loginUrl(): Result<String> {
        val a = api ?: return Result.failure(Said("This build has no Tailscale node of its own"))
        return call { a.loginUrl.invoke(null) as? String }.mapCatching {
            it?.takeIf { u -> u.startsWith("https://") } ?: throw Said("Tailscale gave no sign-in page: try again in a moment")
        }
    }

    // A Go error comes back as the Java method's exception.
    private fun <T> call(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: InvocationTargetException) {
        Result.failure(Said("amarchy's own Tailscale node: " + (e.targetException?.message ?: "it failed")))
    } catch (e: ReflectiveOperationException) {
        Result.failure(Said("amarchy's own Tailscale node isn't the one this app knows: ${e.message}"))
    }
}
