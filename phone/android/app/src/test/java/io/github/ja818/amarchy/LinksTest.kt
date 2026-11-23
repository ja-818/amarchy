package io.github.ja818.amarchy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinksTest {
    @Test
    fun typedAddresses() {
        for (typed in listOf("amarchy.tail1234.ts.net", " https://amarchy.tail1234.ts.net ", "https://Amarchy.Tail1234.ts.net/", "amarchy.tail1234.ts.net:443", "https://amarchy.tail1234.ts.net/#/s/x?y")) {
            assertEquals(typed, "https://amarchy.tail1234.ts.net", Address.parse(typed).getOrThrow())
        }
        assertEquals("https://m.tail.ts.net:8443", Address.parse("m.tail.ts.net:8443").getOrThrow())
    }

    @Test
    fun notAddresses() {
        assertEquals("Type your amarchy's address, like amarchy.your-tailnet.ts.net", Address.parse("  ").exceptionOrNull()!!.message)
        assertEquals(
            "Only https addresses: your amarchy is at https://<machine>.<tailnet>.ts.net",
            Address.parse("http://amarchy.tail.ts.net").exceptionOrNull()!!.message,
        )
        for (bad in listOf("ftp://x.ts.net", "amarchy tail", "https://", "https://user:pw@amarchy.tail.ts.net", "javascript:alert(1)")) {
            assertTrue(bad, Address.parse(bad).isFailure)
            assertTrue(bad, Address.parse(bad).exceptionOrNull() is Said)
        }
    }

    @Test
    fun origins() {
        assertEquals("https://amarchy.tail.ts.net", Address.origin("https://amarchy.tail.ts.net/?ask=x#/s/x"))
        assertEquals("https://appassets.androidplatform.net", Address.origin("https://appassets.androidplatform.net/shell/index.html"))
        assertEquals("http://127.0.0.1:7397", Address.origin("http://127.0.0.1:7397/"))
        assertNull(Address.origin("tel:123"))
        assertNull(Address.origin("about:blank"))
        assertNull(Address.origin(null))
        assertEquals("amarchy.tail.ts.net", Address.host("https://amarchy.tail.ts.net"))
    }

    @Test
    fun theTailnet() {
        for (yes in listOf("amarchy.tail1234.ts.net", "AMARCHY.TAIL1234.TS.NET.", "100.64.0.1", "100.127.255.255", "[fd7a:115c:a1e0::1]")) assertTrue(yes, Address.onTailnet(yes))
        for (no in listOf("ts.net.example.com", "example.com", "100.128.0.1", "100.63.0.1", "10.0.0.1", "fd7b::1", "127.0.0.1")) assertFalse(no, Address.onTailnet(no))
    }

    @Test
    fun openLinks() {
        assertEquals(Link.Open("https://amarchy.tail.ts.net"), Link.parse("amarchy://open?server=https%3A%2F%2Famarchy.tail.ts.net%2F"))
        assertEquals(Link.Open("https://amarchy.tail.ts.net"), Link.parse("amarchy://open?server=https://amarchy.tail.ts.net"))
        assertEquals(Link.Open("https://amarchy.tail.ts.net"), Link.parse("amarchy://open?from=settings&server=amarchy.tail.ts.net"))
        for (bad in listOf("amarchy://open", "amarchy://open?server=", "amarchy://open?server=http%3A%2F%2Fx.ts.net", "amarchy://open/x?server=https://a.ts.net")) {
            assertNull(bad, Link.parse(bad))
        }
    }

    @Test
    fun chatLinks() {
        assertEquals(Link.Chat("amarchy", "web-fix"), Link.parse("amarchy://chat/amarchy/web-fix"))
        assertEquals("a.b_c-1", (Link.parse("amarchy://chat/omarchy/a.b_c-1/") as Link.Chat).id)
        assertEquals("x", (Link.parse("amarchy://chat/omarchy/x?from=bar") as Link.Chat).id)
        for (bad in listOf(
            "amarchy://chat/omarchy", "amarchy://chat//x", "amarchy://other/a/b", "https://chat/a/b", "amarchy://chat/a/b/c",
            "amarchy://chat/a/%2e%2e", "amarchy://chat/a/b c", "amarchy://chat/a/'><script>", null, "",
        )) {
            assertNull(bad, Link.parse(bad))
        }
    }

    @Test
    fun chatRoutes() {
        val l = Link.parse("amarchy://chat/omarchy/dots") as Link.Chat
        assertEquals("/#/s/dots", l.route("omarchy"))
        assertEquals("/#/s/omarchy:dots", l.route("amarchy"))
        assertEquals("/#/s/dots", l.route(""))
    }

    @Test
    fun pages() {
        val s = "https://amarchy.tail.ts.net"
        assertEquals("$s/", Routes.page(s))
        assertEquals("$s/?ask=fix-login#/s/fix-login", Routes.page(s, "/#/s/fix-login", "fix-login"))
        assertEquals("$s/#/s/omarchy:dots", Routes.page(s, "/#/s/omarchy:dots", null))
        assertEquals("$s/#/s/x", Routes.page(s, "#/s/x", null))
        assertEquals("$s/?ask=x", Routes.page(s, "/", "x"))
        // Nothing but a route: never another place, never script.
        assertEquals("$s/", Routes.page(s, "https://evil.example/#/s/x\"><", "a b"))
        assertEquals("$s/", Routes.page(s, "/#/s/<script>", "<x>"))
    }

    @Test
    fun whereNavigationsGo() {
        val here = setOf("https://amarchy.tail.ts.net", "https://appassets.androidplatform.net")
        assertEquals(Nav.Here, WebLinks.decide("https://amarchy.tail.ts.net/#/s/x", here))
        assertEquals(Nav.Here, WebLinks.decide("https://appassets.androidplatform.net/shell/index.html", here))
        assertEquals(Nav.Browser("https://github.com/x"), WebLinks.decide("https://github.com/x", here))
        assertEquals(Nav.Browser("https://amarchy.tail.ts.net/"), WebLinks.decide("https://amarchy.tail.ts.net/", emptySet()))
        assertEquals(Nav.Browser("http://amarchy.tail.ts.net/"), WebLinks.decide("http://amarchy.tail.ts.net/", here))
        assertEquals(Nav.System("tel:+123", "tel"), WebLinks.decide("tel:+123", here))
        assertEquals(Nav.System("mailto:a@b.c", "mailto"), WebLinks.decide("mailto:a@b.c", here))
        assertEquals("intent", (WebLinks.decide("intent://x#Intent;scheme=zoom;end", here) as Nav.System).scheme)
        assertEquals("slack", (WebLinks.decide("slack://open", here) as Nav.System).scheme)
        assertEquals(Nav.Ours(Link.Chat("m", "x")), WebLinks.decide("amarchy://chat/m/x", here))
        for (no in listOf("javascript:alert(1)", "file:///sdcard/x", "content://x/y", "data:text/html,x", "blob:https://x/y", "about:blank", "amarchy://nope", "nothing")) {
            assertTrue(no, WebLinks.decide(no, here) is Nav.Refused)
        }
    }
}
