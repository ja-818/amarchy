package io.github.ja818.amarchy

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** The shell's own requests, against a server on this machine. */
class HttpTest {
    private lateinit var server: HttpServer
    private lateinit var base: String
    private val seen = ConcurrentHashMap<String, String>()
    private val release = CountDownLatch(1)

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/session/x/answer") { ex ->
            seen["origin"] = ex.requestHeaders.getFirst("Origin").orEmpty()
            seen["type"] = ex.requestHeaders.getFirst("Content-Type").orEmpty()
            seen["body"] = ex.requestBody.readBytes().toString(Charsets.UTF_8)
            val answer = """{"ok": true}""".toByteArray()
            ex.sendResponseHeaders(200, answer.size.toLong())
            ex.responseBody.use { it.write(answer) }
        }
        server.createContext("/api/peer/hello") { ex ->
            val answer = """{"error": "not yours"}""".toByteArray()
            ex.sendResponseHeaders(403, answer.size.toLong())
            ex.responseBody.use { it.write(answer) }
        }
        server.createContext("/slow") { ex ->
            release.await(10, TimeUnit.SECONDS)
            ex.sendResponseHeaders(204, -1)
            ex.close()
        }
        server.executor = java.util.concurrent.Executors.newCachedThreadPool()
        server.start()
        base = "http://127.0.0.1:${server.address.port}"
    }

    @After
    fun stop() {
        release.countDown()
        server.stop(0)
    }

    @Test
    fun aButtonPostsAsTheAppsPage() {
        val r = Http.postToMachine(base, "/api/session/x/answer", """{"request_id":"r1","choice":"allow"}""", 20_000)
        assertTrue(r.ok)
        assertEquals("""{"ok": true}""", r.body)
        assertEquals(base, seen["origin"])
        assertEquals("application/json", seen["type"])
        assertEquals("""{"request_id":"r1","choice":"allow"}""", seen["body"])
    }

    @Test
    fun anErrorsWordsComeBack() {
        val r = Http.get("$base/api/peer/hello", 5_000)
        assertEquals(403, r.code)
        assertEquals(Words.NOT_YOURS, Hello.parse(r.code, r.body).exceptionOrNull()!!.message)
    }

    @Test
    fun allOfItWithinItsTime() {
        val started = System.nanoTime()
        try {
            Http.get("$base/slow", 700)
            fail("a server that never answers answered")
        } catch (e: SocketTimeoutException) {
            val took = (System.nanoTime() - started) / 1_000_000
            assertTrue("took $took ms", took in 600..3_000)
        }
    }
}
