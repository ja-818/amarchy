package io.github.ja818.amarchy

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ChimesTest {
    /** bin/amarchy's `CHIMES = (...)`: amarchy's built-in chimes. */
    private val amarchys: List<String> by lazy {
        val bin = File(System.getProperty("amarchy.bin") ?: "../../../bin/amarchy").readText()
        val line = Regex("""^CHIMES = \(([^)]*)\)""", RegexOption.MULTILINE).find(bin)?.groupValues?.get(1)
            ?: error("bin/amarchy has no CHIMES line")
        Regex("\"([a-z0-9_]+)\"").findAll(line).map { it.groupValues[1] }.toList()
    }

    @Test
    fun everyBuiltInChimeIsInTheApp() {
        assertTrue("bin/amarchy's CHIMES: $amarchys", amarchys.size >= 7)
        for (name in amarchys) {
            assertTrue("$name is in bin/amarchy's CHIMES, but the app has no sound for it (sounds/$name.wav or .oga?)", name in Chimes.all)
        }
        assertEquals(amarchys, Chimes.all)
    }

    @Test
    fun everyChimeHasItsRawResource() {
        val raw = Class.forName("io.github.ja818.amarchy.R\$raw")
        val built = File("build/generated").walkTopDown()
            .filter { it.isFile && it.parentFile?.name == "raw" && it.name.startsWith("chime_") }.toList()
        for (name in amarchys) {
            raw.getField(Chimes.resource(name))       // throws when it isn't there
            val file = built.find { it.nameWithoutExtension == "chime_$name" } ?: return fail("res/raw/chime_$name.wav or .ogg wasn't built")
            assertTrue("chime_$name is ${file.extension}: Android plays .wav or .ogg (kept uncompressed)", file.extension in setOf("wav", "ogg"))
            assertTrue("chime_$name is empty", file.length() > 1000)
        }
    }

    @Test
    fun aNotificationsSoundNamesItsChannel() {
        for (name in amarchys) {
            assertEquals(name, Chimes.of(name))
            assertEquals("chats.$name", Chimes.channel(Chimes.of(name), urgent = false))
            assertEquals("urgent.$name", Chimes.channel(Chimes.of(name), urgent = true))
            assertEquals("chime_$name", Chimes.resource(name))
            assertEquals("android.resource://io.github.ja818.amarchy/raw/chime_$name", Chimes.uri("io.github.ja818.amarchy", name))
        }
        assertEquals("Chats that need you (Kalimba)", Chimes.channelName("kalimba", urgent = false))
        assertEquals("Urgent (Herald)", Chimes.channelName("herald", urgent = true))
    }

    @Test
    fun whateverCaseItsWrittenIn() {
        assertEquals("herald", Chimes.of("Herald"))
        assertEquals("kalimba", Chimes.of(" KALIMBA "))
        assertEquals("chats.vibraphone", Chimes.channel(Chimes.of("VibraPhone"), urgent = false))
    }

    @Test
    fun unknownOrAbsentRingsTheDefault() {
        for (sound in listOf(null, "", "  ", "off", "mission", "my-own-sound", "kalimba.wav", "../kalimba", "chime_kalimba")) {
            assertNull(sound, Chimes.of(sound))
        }
        assertEquals(Notes.CHATS, Chimes.channel(Chimes.of("my-own-sound"), urgent = false))
        assertEquals(Notes.URGENT, Chimes.channel(null, urgent = true))
        assertEquals("chats", Chimes.channel(null, urgent = false))
    }

    @Test
    fun theServersNotificationNamesItsChime() {
        // As bin/amarchy sends it (push-vectors.json's first): "sound": "chime".
        val n = Notice.parse("""{"title": "Fix the login", "sound": "Herald"}""")!!
        assertEquals("herald", Chimes.of(n.sound))
        assertNull(Chimes.of(Notice.parse("""{"title": "T"}""")!!.sound))
    }
}
