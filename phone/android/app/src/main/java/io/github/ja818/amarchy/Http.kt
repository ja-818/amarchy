package io.github.ja818.amarchy

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Authenticator
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.PasswordAuthentication
import java.net.Proxy
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The shell's own requests (never on the main thread): the machine's hello,
 * a notification's button, the share sheet, the relay. To the tailnet they
 * go through the own node's proxy when it's on; else straight (the Tailscale
 * app's VPN carries them).
 */
internal object Http {
    class Response(val code: Int, val body: String) {
        val ok get() = code in 200..299
    }

    private const val MOST_BODY = 1_000_000
    private val watchdog = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "amarchy-http-watchdog").apply { isDaemon = true } }

    init {
        // The own node's proxy asks for its credentials (407): only it gets them.
        Authenticator.setDefault(object : Authenticator() {
            override fun getPasswordAuthentication(): PasswordAuthentication? {
                val p = OwnNode.proxy ?: return null
                return if (requestorType == RequestorType.PROXY && requestingHost == p.host && requestingPort == p.port) {
                    PasswordAuthentication(p.user, p.password.toCharArray())
                } else {
                    null
                }
            }
        })
    }

    fun get(url: String, timeoutMs: Int, headers: Map<String, String> = emptyMap()): Response =
        request(url, "GET", headers, null, timeoutMs)

    /** A JSON POST to a machine as its own page makes it: `Origin: <server>`, `Content-Type: application/json`. */
    fun postToMachine(server: String, path: String, json: String, timeoutMs: Int): Response {
        val bytes = json.toByteArray()
        return request(
            server + path, "POST",
            mapOf("Origin" to server, "Content-Type" to "application/json"),
            Body(bytes.size.toLong()) { it.write(bytes) }, timeoutMs,
        )
    }

    fun postJson(url: String, json: String, timeoutMs: Int): Response {
        val bytes = json.toByteArray()
        return request(url, "POST", mapOf("Content-Type" to "application/json"), Body(bytes.size.toLong()) { it.write(bytes) }, timeoutMs)
    }

    class Body(val length: Long, val write: (OutputStream) -> Unit)

    /** One request, all of it (connecting, sending, the answer) within timeoutMs. */
    fun request(url: String, method: String, headers: Map<String, String>, body: Body?, timeoutMs: Int): Response {
        val target = URL(url)
        val node = OwnNode.proxy?.takeIf { Address.onTailnet(target.host) }
        val c = (if (node != null) target.openConnection(Proxy(Proxy.Type.HTTP, InetSocketAddress(node.host, node.port))) else target.openConnection())
            as HttpURLConnection
        val late = AtomicBoolean(false)
        val stop = watchdog.schedule({ late.set(true); c.disconnect() }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.requestMethod = method
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) {
                c.doOutput = true
                c.setFixedLengthStreamingMode(body.length)
                c.outputStream.use { body.write(it) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.use { s -> String(s.readNBytesCompat(MOST_BODY), Charsets.UTF_8) }.orEmpty()
            return Response(code, text)
        } catch (e: IOException) {
            throw if (late.get()) SocketTimeoutException("no answer in ${timeoutMs / 1000} seconds") else e
        } finally {
            stop.cancel(false)
            c.disconnect()
        }
    }

    // InputStream.readNBytes is Java 11 (Android 13): at most n bytes, the same.
    private fun InputStream.readNBytesCompat(n: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < n) {
            val r = read(buf, 0, minOf(buf.size, n - out.size()))
            if (r < 0) break
            out.write(buf, 0, r)
        }
        return out.toByteArray()
    }
}
