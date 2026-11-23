package io.github.ja818.amarchy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayTest {
    @Test
    fun registerAsks() {
        val body = jsonObject(Relay.registerBody("fcm-token:abc", "io.github.ja818.amarchy", "BKey"))!!
        assertEquals(setOf("platform", "token", "app", "server_key"), body.keys)
        assertEquals("fcm", body.string("platform"))
        assertEquals("fcm-token:abc", body.string("token"))
        assertEquals("io.github.ja818.amarchy", body.string("app"))
        assertEquals("BKey", body.string("server_key"))
    }

    @Test
    fun anEndpoint() {
        assertEquals(
            "https://relay.example/v1/push/h4ndle",
            Relay.endpoint(200, """{"endpoint": "https://relay.example/v1/push/h4ndle"}""").getOrThrow(),
        )
        assertEquals("https://r.example/v1/push/x", Relay.endpoint(201, """{"endpoint":"https://r.example/v1/push/x"}""").getOrThrow())
    }

    @Test
    fun noEndpoint() {
        for (body in listOf("", "{}", """{"endpoint": "http://relay.example/v1/push/x"}""", """{"endpoint": 3}""", "<html>")) {
            val r = Relay.endpoint(200, body)
            assertTrue(body, r.isFailure)
            assertTrue(r.exceptionOrNull() is Said)
        }
    }

    @Test
    fun whyNotInWords() {
        assertEquals("The push relay is busy: try again in a minute", Relay.endpoint(429, "").exceptionOrNull()!!.message)
        assertEquals("The push relay said no (400: not a token)", Relay.endpoint(400, """{"error": "not a token"}""").exceptionOrNull()!!.message)
        assertEquals("The push relay said no (403)", Relay.endpoint(403, "forbidden").exceptionOrNull()!!.message)
        assertEquals("The push relay isn't working right now (502): try again later", Relay.endpoint(502, "").exceptionOrNull()!!.message)
    }
}
