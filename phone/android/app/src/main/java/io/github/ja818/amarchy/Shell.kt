package io.github.ja818.amarchy

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** A machine of yours the own node found on the tailnet, answering as amarchy. */
internal data class Candidate(val name: String, val label: String, val url: String)

/**
 * What the own page shows (its `status`, polled every half second):
 * looking for your amarchy, which one, or why not, with what to do.
 */
internal data class ShellStatus(
    val kind: Kind,
    val label: String? = null,
    val why: String? = null,
    val machines: List<Candidate> = emptyList(),
    val waiting: Boolean = false,
) {
    enum class Kind(val word: String) { Opening("opening"), Choose("choose"), Nothing("nothing"), Failed("failed"), SignIn("signin") }

    fun toJson(): JsonObject = buildJsonObject {
        put("kind", kind.word)
        label?.let { put("label", it) }
        why?.let { put("why", it) }
        putJsonArray("machines") {
            machines.forEach { m ->
                addJsonObject {
                    put("name", m.name)
                    put("label", m.label)
                    put("url", m.url)
                }
            }
        }
        put("waiting", waiting)
    }

    companion object {
        val opening = ShellStatus(Kind.Opening)
    }
}

/** What a machine says it is (`GET /api/peer/hello`). */
internal data class Hello(val name: String, val label: String) {
    companion object {
        /** Its answer, or why it isn't amarchy's (in words, for the own page). */
        fun parse(status: Int, body: String): Result<Hello> {
            val o = jsonObject(body)
            if (status == 403) return Result.failure(Said(Words.NOT_YOURS))
            if (status != 200) return Result.failure(Said("It answered $status, not as amarchy: is that your amarchy's address?"))
            val name = o?.string("name")?.takeIf { it.isNotBlank() }
                ?: return Result.failure(Said("That address answers, but not as amarchy: is it your amarchy's?"))
            return Result.success(Hello(name, o.string("label")?.takeIf { it.isNotBlank() } ?: name))
        }
    }
}

/** The own page's words: why it can't open your amarchy, and what to do. */
internal object Words {
    const val NOT_YOURS = "It says this phone isn't yours: sign in to the Tailscale app with the account your amarchy is on."
    private const val VPN = "Turn on the Tailscale app's VPN: this phone reaches your amarchy through it."
    private const val LINK = "Settings → Phone app, in amarchy on your computer, has the address and a link that opens it here."

    /** Nothing to open yet: no address kept, none typed. */
    fun noAddress(vpnOn: Boolean): ShellStatus =
        ShellStatus(ShellStatus.Kind.Nothing, why = if (vpnOn) "Type your amarchy's address. $LINK" else "$VPN Then type its address. $LINK")

    /** The own node is on the tailnet, and none of the machines there answers as amarchy. */
    fun noneFound(): ShellStatus =
        ShellStatus(ShellStatus.Kind.Nothing, why = "None of the machines on your tailnet answers as amarchy. Type its address. $LINK")

    /** The address didn't answer: with the VPN off that's why; else what went wrong. */
    fun unreached(origin: String, error: Throwable, vpnOn: Boolean, ownNode: Boolean): ShellStatus {
        val host = Address.host(origin)
        if (!vpnOn && !ownNode && error !is Said) {
            return ShellStatus(ShellStatus.Kind.Nothing, label = host, why = "$VPN Then Try again.")
        }
        return ShellStatus(ShellStatus.Kind.Failed, label = host, why = why(host, error))
    }

    /** Its page stopped loading (the web view's own error). */
    fun dropped(origin: String, description: String?): ShellStatus =
        ShellStatus(
            ShellStatus.Kind.Failed,
            label = Address.host(origin),
            why = "It stopped answering" + (description?.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()) +
                ". Is it on, and is the Tailscale app's VPN on?",
        )

    /** Its certificate isn't good for its name. */
    fun badCertificate(origin: String): ShellStatus =
        ShellStatus(ShellStatus.Kind.Failed, label = Address.host(origin), why = "Its certificate isn't valid for ${Address.host(origin)}, so this phone won't open it.")

    fun why(host: String, error: Throwable): String = when (error) {
        is Said -> error.message.orEmpty()
        is SocketTimeoutException -> "It didn't answer in 5 seconds. Is it on, and on the same Tailscale account as this phone?"
        is UnknownHostException -> "This phone can't find $host: check the address, and that the Tailscale app is signed in to your tailnet."
        is SSLException -> "Its certificate isn't valid for $host, so this phone won't open it."
        is ConnectException, is NoRouteToHostException -> "Nothing answers at $host: is amarchy running on it?"
        else -> "It didn't answer: ${error.message ?: error.javaClass.simpleName}."
    }
}

/** What the widget says: how many need you. */
internal fun needsYou(needs: Int): String = when {
    needs <= 0 -> "Nothing needs you"
    needs == 1 -> "1 needs you"
    else -> "$needs need you"
}

/** The page's `status` for the widget: `{"needs", "chats": [{"key", "name", "why"}]}`. */
internal data class Board(val needs: Int, val chats: List<BoardChat>) {
    fun toJson(): JsonObject = buildJsonObject {
        put("needs", needs)
        putJsonArray("chats") {
            chats.forEach { c ->
                addJsonObject {
                    put("key", c.key)
                    put("name", c.name)
                    c.why?.let { put("why", it) }
                }
            }
        }
    }

    companion object {
        const val MOST_CHATS = 3
        val empty = Board(0, emptyList())

        fun parse(o: JsonObject?): Board {
            if (o == null) return empty
            val chats = (o["chats"] as? JsonArray).orEmpty().mapNotNull { e ->
                val c = e as? JsonObject ?: return@mapNotNull null
                val key = c.string("key")?.takeIf { Routes.isKey(it) } ?: return@mapNotNull null
                val name = c.string("name")?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                BoardChat(key, name.take(80), c.string("why")?.trim()?.take(120))
            }.take(MOST_CHATS)
            return Board((o.int("needs") ?: chats.size).coerceAtLeast(0), chats)
        }
    }
}

internal data class BoardChat(val key: String, val name: String, val why: String?)
