package io.github.ja818.amarchy

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The own page's status and words (desktop/dist/shell.js renders them). */
class ShellTest {
    private val origin = "https://amarchy.tail1234.ts.net"

    @Test
    fun statusAsTheOwnPageReadsIt() {
        val s = ShellStatus(
            ShellStatus.Kind.Choose,
            machines = listOf(Candidate("amarchy", "Amarchy", "https://amarchy.tail.ts.net"), Candidate("omarchy", "Laptop", "https://omarchy.tail.ts.net")),
        ).toJson()
        assertEquals("choose", s.string("kind"))
        val machines = s["machines"] as JsonArray
        assertEquals(2, machines.size)
        assertEquals(setOf("name", "label", "url"), (machines[1] as JsonObject).keys)
        assertEquals("Laptop", (machines[1] as JsonObject).string("label"))
        assertEquals(false, s.bool("waiting"))
        assertNull(s["why"])
        assertEquals("opening", ShellStatus.opening.toJson().string("kind"))
        assertEquals(true, ShellStatus(ShellStatus.Kind.SignIn, waiting = true).toJson().bool("waiting"))
        assertEquals(listOf("opening", "choose", "nothing", "failed", "signin"), ShellStatus.Kind.entries.map { it.word })
    }

    @Test
    fun noAddressYet() {
        val on = Words.noAddress(vpnOn = true)
        assertEquals(ShellStatus.Kind.Nothing, on.kind)
        val why = on.why!!
        assertTrue(why.startsWith("Type your amarchy's address."))
        assertTrue(why.contains("Settings → Phone app"))
        val off = Words.noAddress(vpnOn = false)
        assertTrue(off.why!!.startsWith("Turn on the Tailscale app's VPN"))
    }

    @Test
    fun theVpnOffIsWhyItDidntAnswer() {
        val s = Words.unreached(origin, SocketTimeoutException(), vpnOn = false, ownNode = false)
        assertEquals(ShellStatus.Kind.Nothing, s.kind)
        assertEquals("amarchy.tail1234.ts.net", s.label)
        assertEquals("Turn on the Tailscale app's VPN: this phone reaches your amarchy through it. Then Try again.", s.why)
    }

    @Test
    fun itDidntAnswer() {
        fun why(e: Throwable) = Words.unreached(origin, e, vpnOn = true, ownNode = false).also { assertEquals(ShellStatus.Kind.Failed, it.kind) }.why
        assertEquals("It didn't answer in 5 seconds. Is it on, and on the same Tailscale account as this phone?", why(SocketTimeoutException()))
        assertEquals(
            "This phone can't find amarchy.tail1234.ts.net: check the address, and that the Tailscale app is signed in to your tailnet.",
            why(UnknownHostException("amarchy.tail1234.ts.net")),
        )
        assertEquals("Its certificate isn't valid for amarchy.tail1234.ts.net, so this phone won't open it.", why(SSLHandshakeException("x")))
        assertEquals("Nothing answers at amarchy.tail1234.ts.net: is amarchy running on it?", why(ConnectException()))
        assertEquals("It didn't answer: reset.", why(IOException("reset")))
        // The own node in use: its words, not the VPN's.
        assertEquals(ShellStatus.Kind.Failed, Words.unreached(origin, SocketTimeoutException(), vpnOn = false, ownNode = true).kind)
    }

    @Test
    fun itAnsweredButNotAsAmarchy() {
        assertEquals(Hello("amarchy", "Amarchy"), Hello.parse(200, """{"name": "amarchy", "label": "Amarchy", "protocol": 3}""").getOrThrow())
        assertEquals(Hello("omarchy", "omarchy"), Hello.parse(200, """{"name": "omarchy"}""").getOrThrow())
        val notYours = Hello.parse(403, """{"error": "not yours"}""").exceptionOrNull()!!
        assertEquals(Words.NOT_YOURS, notYours.message)
        // A machine's own answer is its why, VPN or not: it was reached.
        assertEquals(ShellStatus.Kind.Failed, Words.unreached(origin, notYours, vpnOn = false, ownNode = false).kind)
        assertEquals("It answered 404, not as amarchy: is that your amarchy's address?", Hello.parse(404, "").exceptionOrNull()!!.message)
        assertEquals("That address answers, but not as amarchy: is it your amarchy's?", Hello.parse(200, "<html>").exceptionOrNull()!!.message)
        assertTrue(Hello.parse(200, """{"name": ""}""").isFailure)
    }

    @Test
    fun itsPageStopped() {
        val s = Words.dropped(origin, "net::ERR_CONNECTION_RESET")
        assertEquals(ShellStatus.Kind.Failed, s.kind)
        assertEquals("It stopped answering (net::ERR_CONNECTION_RESET). Is it on, and is the Tailscale app's VPN on?", s.why)
        assertEquals("It stopped answering. Is it on, and is the Tailscale app's VPN on?", Words.dropped(origin, null).why)
        assertEquals(ShellStatus.Kind.Failed, Words.badCertificate(origin).kind)
    }

    @Test
    fun theWidgetsWords() {
        assertEquals("Nothing needs you", needsYou(0))
        assertEquals("Nothing needs you", needsYou(-2))
        assertEquals("1 needs you", needsYou(1))
        assertEquals("2 need you", needsYou(2))
    }

    @Test
    fun thePagesStatusForTheWidget() {
        val b = Board.parse(
            jsonObject(
                """{"needs": 4, "chats": [{"key": "fix-login", "name": "Fix the login", "why": "Asks: Allow Bash"},
                   {"key": "omarchy:dots", "name": "Dots"}, {"key": "bad key", "name": "x"}, {"key": "k", "name": " "},
                   {"key": "c", "name": "C"}, {"key": "d", "name": "D"}]}""",
            ),
        )
        assertEquals(4, b.needs)
        assertEquals(listOf("fix-login", "omarchy:dots", "c"), b.chats.map { it.key })
        assertEquals("Asks: Allow Bash", b.chats[0].why)
        assertNull(b.chats[1].why)
        assertEquals(b, Board.parse(b.toJson()))
        assertEquals(Board.empty, Board.parse(null))
        assertEquals(1, Board.parse(jsonObject("""{"chats": [{"key": "a", "name": "A"}]}""")).needs)
    }
}
