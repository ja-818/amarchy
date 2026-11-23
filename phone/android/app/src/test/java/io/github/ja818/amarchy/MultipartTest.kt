package io.github.ja818.amarchy

import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MultipartTest {
    private val png = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3)
    private val jpeg = ByteArray(70_000) { (it % 251).toByte() }

    private fun build() = Multipart("b0undary")
        .field("text", "Look at this\nhttps://example.com/ — ünïcode")
        .file("images", "picture-1.png", "image/png", png.size.toLong()) { png.inputStream() }
        .file("images", "picture-2.jpg", "image/jpeg", jpeg.size.toLong()) { jpeg.inputStream() }

    @Test
    fun itsLengthIsWhatItWrites() {
        val body = build()
        val out = ByteArrayOutputStream()
        body.writeTo(out)
        assertEquals(body.length(), out.size().toLong())
        assertEquals("multipart/form-data; boundary=b0undary", body.contentType)
    }

    @Test
    fun aFormAsABrowserSendsIt() {
        val out = ByteArrayOutputStream().also { build().writeTo(it) }.toByteArray()
        val text = String(out, Charsets.ISO_8859_1)
        assertTrue(text.startsWith("--b0undary\r\nContent-Disposition: form-data; name=\"text\"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"))
        assertTrue(text.endsWith("\r\n--b0undary--\r\n"))
        // Split on the boundary: the field, then each picture, byte for byte.
        val parts = text.removeSuffix("--b0undary--\r\n").split("--b0undary\r\n").drop(1)
        assertEquals(3, parts.size)
        val (head0, value0) = parts[0].split("\r\n\r\n", limit = 2)
        assertTrue(head0.contains("name=\"text\""))
        assertEquals("Look at this\nhttps://example.com/ — ünïcode", value0.removeSuffix("\r\n").toByteArray(Charsets.ISO_8859_1).toString(Charsets.UTF_8))
        val (head1, value1) = parts[1].split("\r\n\r\n", limit = 2)
        assertTrue(head1.contains("name=\"images\"; filename=\"picture-1.png\""))
        assertTrue(head1.contains("Content-Type: image/png"))
        assertArrayEquals(png, value1.removeSuffix("\r\n").toByteArray(Charsets.ISO_8859_1))
        val (head2, value2) = parts[2].split("\r\n\r\n", limit = 2)
        assertTrue(head2.contains("filename=\"picture-2.jpg\""))
        assertArrayEquals(jpeg, value2.removeSuffix("\r\n").toByteArray(Charsets.ISO_8859_1))
    }

    @Test
    fun namesCantBreakTheirQuotes() {
        val out = ByteArrayOutputStream().also {
            Multipart("b").file("images", "a\"\r\nX-Evil: 1.png", "image/png\r\nX: y", 1) { byteArrayOf(1).inputStream() }.writeTo(it)
        }.toString("ISO-8859-1")
        assertTrue(out, out.contains("filename=\"aX-Evil 1.png\""))
        assertTrue(out, out.contains("Content-Type: image/pngXy\r\n"))
        assertEquals(1, out.split("\r\n").count { it.startsWith("Content-Type") })
    }

    @Test
    fun aPictureThatChangedFails() {
        val body = Multipart("b").file("images", "p.png", "image/png", 10) { byteArrayOf(1, 2).inputStream() }
        try {
            body.writeTo(ByteArrayOutputStream())
            fail("a short picture went as if whole")
        } catch (e: IllegalStateException) {
            // as it should
        }
    }

    @Test
    fun boundariesAreFresh() {
        val a = Multipart().boundary
        val b = Multipart().boundary
        assertTrue(a.startsWith("amarchy-") && a.length == "amarchy-".length + 32)
        assertTrue(a != b)
    }
}
