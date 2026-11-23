package io.github.ja818.amarchy

import java.io.File
import java.security.interfaces.ECPublicKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** phone/testdata/push-vectors.json: what the server encrypts, decrypted as the phone does. */
class WebPushTest {
    private val vectors: List<JsonObject> by lazy {
        val dir = System.getProperty("amarchy.testdata") ?: "../../testdata"
        val all = Json.parseToJsonElement(File(dir, "push-vectors.json").readText()) as JsonObject
        (all["vectors"] as JsonArray).map { it as JsonObject }
    }

    private fun keys(v: JsonObject) = WebPush.Keys(
        private = WebPush.privateKey(B64.decode(v.string("ua_private_pkcs8")!!)),
        public = B64.decode(v.string("ua_public")!!),
        auth = B64.decode(v.string("auth")!!),
    )

    @Test
    fun everyVectorDecryptsOrFailsAsItSays() {
        assertTrue("the vectors are there", vectors.size >= 5)
        for (v in vectors) {
            val name = v.string("name")
            val record = B64.decode(v.string("record")!!)
            when (val plain = v["plaintext"]) {
                is JsonNull -> try {
                    WebPush.decrypt(record, keys(v))
                    fail("$name: decrypted, and it mustn't")
                } catch (e: Exception) {
                    // as it should: tampered
                }
                is JsonPrimitive -> assertEquals(name, plain.content, WebPush.decrypt(record, keys(v)).toString(Charsets.UTF_8))
                else -> fail("$name: plaintext is neither a string nor null")
            }
        }
    }

    @Test
    fun theServersNotificationsParse() {
        for (v in vectors.filter { it.string("name")!!.startsWith("bin/amarchy") }) {
            val plain = v.string("plaintext") ?: continue
            val notice = Notice.parse(WebPush.decrypt(B64.decode(v.string("record")!!), keys(v)))
            assertNotNull(v.string("name"), notice)
            assertEquals(Notice.parse(plain), notice)
        }
    }

    @Test
    fun wrongKeysDontOpenIt() {
        val v = vectors.first { it["plaintext"] is JsonPrimitive }
        val other = WebPush.newKeys()
        try {
            WebPush.decrypt(B64.decode(v.string("record")!!), WebPush.Keys(other.private, B64.decode(v.string("ua_public")!!), B64.decode(v.string("auth")!!)))
            fail("decrypted with another phone's private key")
        } catch (e: Exception) {
            // as it should
        }
    }

    @Test
    fun cutRecordsFail() {
        val v = vectors.first { it["plaintext"] is JsonPrimitive }
        val record = B64.decode(v.string("record")!!)
        for (cut in listOf(0, 20, 86, 102, record.size - 1)) {
            try {
                WebPush.decrypt(record.copyOf(cut), keys(v))
                fail("a record cut at $cut decrypted")
            } catch (e: Exception) {
                // as it should
            }
        }
        val wrongId = record.copyOf().also { it[20] = 64 }
        try {
            WebPush.decrypt(wrongId, keys(v))
            fail("a key id of 64 bytes was taken")
        } catch (e: IllegalArgumentException) {
            // as it should
        }
    }

    @Test
    fun newKeysAreWebPushKeys() {
        val k = WebPush.newKeys()
        assertEquals(65, k.public.size)
        assertEquals(4.toByte(), k.public[0])
        assertEquals(16, k.auth.size)
        // What's kept (PKCS#8) reads back as the same key.
        val again = WebPush.privateKey(k.private.encoded)
        assertArrayEquals(k.private.encoded, again.encoded)
        val pair = java.security.KeyPairGenerator.getInstance("EC").apply { initialize(java.security.spec.ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        assertEquals(65, WebPush.raw(pair.public as ECPublicKey).size)
    }

    @Test
    fun base64urlWithAndWithoutPadding() {
        val bytes = byteArrayOf(-5, -1, 0, 62, 63)
        assertEquals("-_8APj8", B64.encode(bytes))
        assertArrayEquals(bytes, B64.decode("-_8APj8"))
        assertArrayEquals(bytes, B64.decode("-_8APj8="))
    }
}
