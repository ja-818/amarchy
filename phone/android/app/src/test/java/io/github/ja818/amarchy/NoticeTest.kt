package io.github.ja818.amarchy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticeTest {
    private val full = """
        {"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\nHouston Os",
         "tag": "houston-os-fix-login", "url": "/#/s/houston-os-fix-login",
         "ask": "houston-os-fix-login", "waiting": 2, "urgent": true,
         "server": "https://amarchy.example.ts.net", "session": "houston-os-fix-login", "sound": "chime",
         "actions": [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer",
                      "body": {"request_id": "r1", "choice": "allow"}}]}
    """.trimIndent()

    @Test
    fun everythingTheMachineSends() {
        val n = Notice.parse(full)!!
        assertEquals("Fix the login", n.title)
        assertEquals("Asks: Allow Bash: npm test?\nHouston Os", n.body)
        assertEquals("houston-os-fix-login", n.tag)
        assertEquals("/#/s/houston-os-fix-login", n.url)
        assertEquals("houston-os-fix-login", n.ask)
        assertEquals(2, n.waiting)
        assertTrue(n.urgent)
        assertEquals("https://amarchy.example.ts.net", n.server)
        assertEquals("chime", n.sound)
        assertEquals(1, n.actions.size)
        val a = n.actions.single()
        assertEquals("Allow", a.label)
        assertEquals("/api/session/houston-os-fix-login/answer", a.path)
        assertEquals("allow", jsonObject(a.body)!!.string("choice"))
        assertEquals("r1", jsonObject(a.body)!!.string("request_id"))
    }

    @Test
    fun onlyTheTitleIsNeeded() {
        val n = Notice.parse("""{"title": "Amarchy"}""")!!
        assertEquals(Notice(title = "Amarchy"), n)
        assertEquals("", n.body)
        assertNull(n.tag)
        assertNull(n.waiting)
        assertFalse(n.urgent)
        assertTrue(n.actions.isEmpty())
    }

    @Test
    fun noTitleOrNoJsonIsNoNotice() {
        for (bad in listOf("", "null", "[]", "\"Amarchy\"", "{", """{"body": "x"}""", """{"title": ""}""", """{"title": 3}""", "not json at all")) {
            assertNull(bad, Notice.parse(bad))
        }
        assertNull(Notice.parse(byteArrayOf(-1, -2, 0, 1)))
    }

    @Test
    fun fieldsOfTheWrongKindAreMissing() {
        val n = Notice.parse(
            """{"title": "T", "body": 5, "tag": "", "url": "https://evil.example/", "ask": "a b", "waiting": -1,
               "urgent": "yes", "server": "http://amarchy.example.ts.net", "session": ["x"]}""",
        )!!
        assertEquals("", n.body)
        assertNull(n.tag)
        assertNull(n.url)
        assertNull(n.ask)
        assertNull(n.waiting)
        assertFalse(n.urgent)
        assertNull(n.server)
        assertNull(n.session)
        assertNull(Notice.parse("""{"title": "T", "url": "//evil.example/x"}""")!!.url)
        assertEquals("""waiting as "2" isn't a number""", null, Notice.parse("""{"title": "T", "waiting": "2"}""")!!.waiting)
    }

    @Test
    fun atMostThreeButtons() {
        val actions = (1..5).joinToString(",") { """{"label": "Option $it", "path": "/api/session/x/send", "body": {"text": "$it"}}""" }
        val n = Notice.parse("""{"title": "T", "server": "https://m.tail.ts.net", "actions": [$actions]}""")!!
        assertEquals(listOf("Option 1", "Option 2", "Option 3"), n.actions.map { it.label })
        assertEquals(Notice.MOST_ACTIONS, n.actions.size)
    }

    @Test
    fun buttonsThatArentOneAreLeftOut() {
        val n = Notice.parse(
            """{"title": "T", "server": "https://m.tail.ts.net", "actions": [
                 {"path": "/api/a"},
                 {"label": "Far", "path": "//evil.example/api"},
                 {"label": "Spaced", "path": "/api/a b"},
                 {"label": "List", "path": "/api/a", "body": [1]},
                 "Allow",
                 {"label": "  No body  ", "path": "/api/session/x/answer"},
                 {"label": "Ok", "path": "/api/session/x/answer", "body": {"choice": "allow"}}
               ]}""",
        )!!
        assertEquals(listOf("No body", "Ok"), n.actions.map { it.label })
        assertEquals("{}", n.actions[0].body)
    }

    @Test
    fun noMachineNoButtons() {
        val n = Notice.parse("""{"title": "T", "actions": [{"label": "Allow", "path": "/api/a", "body": {}}]}""")!!
        assertTrue(n.actions.isEmpty())
    }

    @Test
    fun theUnreadOne() {
        assertEquals("Amarchy", Notice.unread.title)
        assertEquals("Open it to see", Notice.unread.body)
        assertTrue(Notice.unread.actions.isEmpty())
    }
}
