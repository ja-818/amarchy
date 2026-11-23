package io.github.ja818.amarchy

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeTest {
    @Test
    fun calls() {
        val c = BridgeCall.parse("""{"id": 7, "command": "push.subscribe", "args": {"key": "BKey"}}""")!!
        assertEquals(7L, c.id)
        assertEquals("push.subscribe", c.command)
        assertEquals("BKey", c.args.string("key"))
        assertTrue(BridgeCall.parse("""{"id": 1, "command": "push.state"}""")!!.args.isEmpty())
        assertTrue(BridgeCall.parse("""{"id": 1, "command": "status", "args": [1, 2]}""")!!.args.isEmpty())
        assertEquals(0L, BridgeCall.parse("""{"id": 0, "command": "shell.bars", "args": {"color": "#000"}}""")!!.id)
    }

    @Test
    fun notCalls() {
        for (bad in listOf(null, "", "{", "[]", """{"command": "status"}""", """{"id": "1", "command": "status"}""", """{"id": -1, "command": "x"}""", """{"id": 1}""", """{"id": 1, "command": ""}""")) {
            assertNull(bad, BridgeCall.parse(bad))
        }
    }

    @Test
    fun answers() {
        val c = BridgeCall(3, "push.state", buildJsonObject { })
        assertEquals("""{"id":3,"result":"on"}""", c.result(JsonPrimitive("on")))
        assertEquals("""{"id":3,"result":null}""", c.result(null))
        assertEquals("""{"id":3,"result":null}""", c.result(JsonNull))
        assertEquals("""{"id":3,"error":"Notifications are off \"here\""}""", c.error("Notifications are off \"here\""))
        val sub = c.result(buildJsonObject { put("endpoint", "https://r/v1/push/x") })
        assertEquals("https://r/v1/push/x", (jsonObject(sub)!!["result"] as kotlinx.serialization.json.JsonObject).string("endpoint"))
    }

    @Test
    fun theScripts() {
        val phone = BridgeScripts.phone("1.0 (1)", "https://relay.example")
        assertTrue(phone.contains("window.amarchyPhonePort"))
        assertTrue(phone.contains("""version: "1.0 (1)", platform: "android", relay: "https://relay.example""""))
        assertTrue(phone.contains("""Object.defineProperty(window, "amarchyPhone""""))
        assertTrue(phone.contains("shell.bars"))
        // A version or relay can't end its string.
        assertTrue(BridgeScripts.phone("1\"; alert(1); \"", "").contains("""version: "1\"; alert(1); \"""""))
        val shell = BridgeScripts.shell()
        assertTrue(shell.contains("window.amarchyShellPort"))
        assertTrue(shell.contains("invoke: call"))
        assertFalse(shell.contains("amarchyPhone"))
        val open = BridgeScripts.open("https://m.tail.ts.net", buildJsonObject { put("go", "/#/s/x"); put("share", true) })
        assertTrue(open.contains("""location.origin !== "https://m.tail.ts.net""""))
        assertTrue(open.contains("""new CustomEvent("amarchy-open", { detail: {"go":"/#/s/x","share":true} })"""))
        assertTrue(open.contains("return false"))
    }
}
