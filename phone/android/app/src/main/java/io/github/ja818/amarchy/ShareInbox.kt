package io.github.ja818.amarchy

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * The share sheet's inbox: what's shared into the app (text, a link,
 * pictures) is copied here first, while the app may still read it, then
 * sent to the machine as the iPhone's Shortcut sends it. What the machine
 * can't take yet stays, and goes the next time the app reaches it.
 */
internal object ShareInbox {
    private const val TAG = "amarchy"
    const val MOST_PICTURES = 20
    private const val MOST_PICTURE_BYTES = 25_000_000L
    private const val MOST_TEXT = 100_000

    /** How sending what's kept went. */
    data class Sent(val sent: Int, val kept: Int, val refused: List<String>)

    private fun dir(context: Context) = File(context.filesDir, "inbox")

    /** Keeps what an ACTION_SEND / ACTION_SEND_MULTIPLE brought: whether there was anything. */
    fun keep(context: Context, intent: Intent): Boolean {
        val words = listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
        ).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        // A link's title comes as the subject and often in the text too.
        val text = words.filterNot { w -> words.any { it != w && w in it } }.joinToString("\n").take(MOST_TEXT)
        val streams = if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        } else {
            listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        }
        val item = File(dir(context), "${System.currentTimeMillis()}-${(1000..9999).random()}")
        item.mkdirs()
        val pictures = mutableListOf<Pair<String, String>>()
        var extra = ""
        for (uri in streams) {
            val type = runCatching { context.contentResolver.getType(uri) }.getOrNull() ?: intent.type.orEmpty()
            if (type.startsWith("image/") && pictures.size < MOST_PICTURES) {
                val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type) ?: "jpg"
                val file = File(item, "picture-${pictures.size + 1}.$ext")
                val copied = read(context, uri) { input -> file.outputStream().use { out -> copyAtMost(input, out, MOST_PICTURE_BYTES) } }
                if (copied != null && copied > 0) pictures += file.name to type else file.delete()
            } else if (type.startsWith("text/") && extra.length < MOST_TEXT) {
                read(context, uri) { input -> extra += "\n" + input.readBytes().toString(Charsets.UTF_8).take(MOST_TEXT) }
            }
        }
        val all = listOf(text, extra.trim()).filter { it.isNotEmpty() }.joinToString("\n")
        if (all.isEmpty() && pictures.isEmpty()) {
            item.deleteRecursively()
            return false
        }
        // share.json written last: an item without it was cut short, and isn't sent.
        val manifest = buildJsonObject {
            put("text", all)
            putJsonArray("pictures") { pictures.forEach { (file, type) -> addJsonObject { put("file", file); put("type", type) } } }
        }
        File(item, "share.json.tmp").writeText(manifest.toString())
        File(item, "share.json.tmp").renameTo(File(item, "share.json"))
        return true
    }

    fun waiting(context: Context): Boolean = items(context).isNotEmpty()

    // A shared file: null when it can't be read (gone, or not this app's to read).
    private fun <T> read(context: Context, uri: Uri, use: (InputStream) -> T): T? = try {
        context.contentResolver.openInputStream(uri)?.use(use)
    } catch (e: IOException) {
        Log.w(TAG, "a shared file couldn't be read: ${e.message}")
        null
    } catch (e: SecurityException) {
        Log.w(TAG, "a shared file this app may not read", e)
        null
    }

    private fun items(context: Context): List<File> {
        val now = System.currentTimeMillis()
        return dir(context).listFiles().orEmpty().sortedBy { it.name }.filter { f ->
            when {
                File(f, "share.json").isFile -> true
                now - f.lastModified() > 3_600_000 -> f.deleteRecursively().let { false }     // cut short, long ago
                else -> false
            }
        }
    }

    /** Sends what's kept to the machine at server (blocking: not on the main thread). */
    fun send(context: Context, server: String): Sent {
        val kept = Kept(context)
        var sent = 0
        var waiting = 0
        val refused = mutableListOf<String>()
        for (item in items(context)) {
            val manifest = jsonObject(runCatching { File(item, "share.json").readText() }.getOrNull())
            if (manifest == null) {
                item.deleteRecursively()
                continue
            }
            when (val outcome = sendOne(kept, server, item, manifest)) {
                null -> {
                    sent++
                    item.deleteRecursively()
                }
                is Said -> {
                    refused += outcome.message.orEmpty()
                    item.deleteRecursively()
                }
                else -> {
                    Log.w(TAG, "sharing waits: ${outcome.message}")
                    waiting++
                }
            }
        }
        return Sent(sent, waiting, refused)
    }

    /** Null: it went. Said: the machine won't take it (dropped). Anything else: try again later. */
    private fun sendOne(kept: Kept, server: String, item: File, manifest: JsonObject): Exception? {
        for (attempt in 0..1) {
            val url = try {
                shareUrl(kept, server, fresh = attempt > 0)
            } catch (e: IOException) {
                return e
            } catch (e: Said) {
                return IOException(e.message)
            }
            val body = Multipart()
            manifest.string("text")?.takeIf { it.isNotEmpty() }?.let { body.field("text", it) }
            (manifest["pictures"] as? JsonArray).orEmpty().forEach { p ->
                val o = p as? JsonObject ?: return@forEach
                val file = File(item, o.string("file") ?: return@forEach).takeIf { it.isFile } ?: return@forEach
                body.file("images", file.name, o.string("type") ?: "image/jpeg", file.length()) { file.inputStream() }
            }
            val answer = try {
                Http.request(url, "POST", mapOf("Content-Type" to body.contentType), Http.Body(body.length(), body::writeTo), 120_000)
            } catch (e: IOException) {
                return e
            }
            when {
                answer.ok -> return null
                answer.code == 403 && attempt == 0 -> continue      // its share key changed: ask for it again
                answer.code in 400..499 -> return Said(jsonObject(answer.body)?.string("error") ?: "it answered ${answer.code}")
                else -> return IOException("it answered ${answer.code}")
            }
        }
        return Said("it doesn't take this phone's share key")
    }

    /** The machine's share address (`GET /api/share/key` → `{"url"}`), kept. */
    private fun shareUrl(kept: Kept, server: String, fresh: Boolean): String {
        if (!fresh) kept.shareUrl(server)?.let { return it }
        val answer = Http.get("$server/api/share/key", 10_000)
        if (!answer.ok) throw Said(jsonObject(answer.body)?.string("error") ?: "it answered ${answer.code}")
        val url = jsonObject(answer.body)?.string("url")?.takeIf { it.startsWith("$server/api/share?") }
            ?: throw Said("its share address isn't one")
        kept.keepShareUrl(server, url)
        return url
    }

    private fun copyAtMost(input: InputStream, out: OutputStream, most: Long): Long {
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) return total
            total += n
            if (total > most) throw IOException("a picture over ${most / 1_000_000} MB")
            out.write(buf, 0, n)
        }
    }
}
