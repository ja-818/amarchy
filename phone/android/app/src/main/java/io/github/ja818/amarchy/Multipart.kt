package io.github.ja818.amarchy

import java.io.InputStream
import java.io.OutputStream
import java.security.SecureRandom

/**
 * A multipart/form-data body (RFC 7578), as a browser's form sends it: what
 * the share sheet sends the machine (`text`, and one `images` file per
 * picture). Its length is known before it's written, so it streams.
 */
internal class Multipart(val boundary: String = newBoundary()) {
    private sealed interface Part {
        val head: ByteArray
        val size: Long
    }

    private class Field(override val head: ByteArray, val value: ByteArray) : Part {
        override val size get() = value.size.toLong()
    }

    private class File(override val head: ByteArray, override val size: Long, val open: () -> InputStream) : Part

    private val parts = mutableListOf<Part>()

    val contentType get() = "multipart/form-data; boundary=$boundary"

    fun field(name: String, value: String) = apply {
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"${safe(name)}\"\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n\r\n"
        parts += Field(head.toByteArray(), value.toByteArray())
    }

    fun file(name: String, filename: String, type: String, size: Long, open: () -> InputStream) = apply {
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"${safe(name)}\"; filename=\"${safe(filename)}\"\r\n" +
            "Content-Type: ${type.filter { it.isLetterOrDigit() || it in "/.+-" }}\r\n\r\n"
        parts += File(head.toByteArray(), size, open)
    }

    private val end get() = "--$boundary--\r\n".toByteArray()

    /** The body's bytes, all of them. */
    fun length(): Long = parts.sumOf { it.head.size + it.size + 2 } + end.size

    /** Writes the body; throws when a file isn't the size it was said to be. */
    fun writeTo(out: OutputStream) {
        for (p in parts) {
            out.write(p.head)
            when (p) {
                is Field -> out.write(p.value)
                is File -> {
                    val copied = p.open().use { it.copyTo(out) }
                    check(copied == p.size) { "a picture changed while it was being sent" }
                }
            }
            out.write(CRLF)
        }
        out.write(end)
    }

    companion object {
        private val CRLF = "\r\n".toByteArray()

        private fun newBoundary(): String {
            val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
            return "amarchy-" + bytes.joinToString("") { "%02x".format(it) }
        }

        // A name in quotes: nothing that would end them or the line.
        private fun safe(text: String) = text.filter { it.isLetterOrDigit() || it in "._- " }.ifEmpty { "file" }
    }
}
