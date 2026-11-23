package io.github.ja818.amarchy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnNodeTest {
    @Test
    fun withoutTheAarItIsAbsent() {
        assertFalse(OwnNode.available)
        assertNull(OwnNode.state())
        assertTrue(OwnNode.loginUrl().isFailure)
        assertTrue(OwnNode.start(java.io.File("build/tmp/node"), "x").isFailure)
        assertNull(OwnNode.proxy)
    }

    @Test
    fun itsProxy() {
        assertEquals(NodeProxy("127.0.0.1", 41641, "amarchy", "s3cret/+="), NodeProxy.parse("http://amarchy:s3cret%2F%2B%3D@127.0.0.1:41641"))
        for (bad in listOf(null, "", "http://127.0.0.1:1", "http://amarchy:x@10.0.0.1:80", "https://amarchy:x@127.0.0.1:80", "http://amarchy:@127.0.0.1:80", "http://amarchy:x@127.0.0.1")) {
            assertNull(bad, NodeProxy.parse(bad))
        }
    }

    @Test
    fun itsState() {
        val s = NodeState.parse(
            """{"state": "Running", "words": "On your tailnet", "login_url": "", "self": "amarchy-pixel.tail.ts.net",
               "peers": [{"name": "amarchy", "dns": "amarchy.tail.ts.net.", "online": true}, {"dns": "omarchy.tail.ts.net", "online": false}, {"name": "x"}]}""",
        )!!
        assertTrue(s.running)
        assertFalse(s.needsLogin)
        assertNull(s.loginUrl)
        assertEquals(listOf(NodePeer("amarchy", "amarchy.tail.ts.net", true), NodePeer("omarchy", "omarchy.tail.ts.net", false)), s.peers)
        val login = NodeState.parse("""{"state": "NeedsLogin", "words": "Sign in", "login_url": "https://login.tailscale.com/a/x"}""")!!
        assertTrue(login.needsLogin)
        assertEquals("https://login.tailscale.com/a/x", login.loginUrl)
        assertTrue(NodeState.parse("""{"state": "starting", "login_url": "https://login.tailscale.com/a/y"}""")!!.needsLogin)
        assertNull(NodeState.parse("nope"))
    }
}
