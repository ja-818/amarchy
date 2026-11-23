package io.github.ja818.amarchy

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import androidx.core.util.AtomicFile
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The phone's push keys (a P-256 pair and the auth secret): made once, never
 * leaving the phone. They're kept in the app's own storage, wrapped by an
 * AES key in the Android Keystore, so the file alone opens nothing.
 */
internal object PushKeys {
    private const val TAG = "amarchy"
    private const val ALIAS = "amarchy.push.wrap"
    private const val FILE = "push.keys"
    private const val IV = 12

    /** The keys, or null when none were made yet (or they can't be opened any more). */
    @Synchronized
    fun load(context: Context): WebPush.Keys? {
        val file = File(context.filesDir, FILE)
        if (!file.isFile) return null
        return try {
            val sealed = AtomicFile(file).readFully()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrapKey() ?: return null, GCMParameterSpec(128, sealed, 0, IV))
            val o = jsonObject(String(cipher.doFinal(sealed, IV, sealed.size - IV), Charsets.UTF_8)) ?: return null
            WebPush.Keys(
                private = WebPush.privateKey(B64.decode(o.string("private") ?: return null)),
                public = B64.decode(o.string("public") ?: return null),
                auth = B64.decode(o.string("auth") ?: return null),
            )
        } catch (e: GeneralSecurityException) {
            Log.w(TAG, "the push keys can't be opened (the Keystore's key is gone?): new ones next time", e)
            null
        } catch (e: IOException) {
            Log.w(TAG, "the push keys file isn't readable: new ones next time", e)
            null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "the push keys file isn't readable: new ones next time", e)
            null
        }
    }

    /** The keys, and whether they were made just now (there were none, or they couldn't be opened). */
    @Synchronized
    fun loadOrMake(context: Context): Pair<WebPush.Keys, Boolean> {
        load(context)?.let { return it to false }
        val keys = WebPush.newKeys()
        val plain = buildJsonObject {
            put("private", B64.encode(keys.private.encoded))
            put("public", B64.encode(keys.public))
            put("auth", B64.encode(keys.auth))
        }.toString().toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, newWrapKey())
        val sealed = cipher.iv + cipher.doFinal(plain)
        check(cipher.iv.size == IV) { "the Keystore gave an IV of ${cipher.iv.size} bytes" }
        val file = AtomicFile(File(context.filesDir, FILE))
        val out = file.startWrite()
        try {
            out.write(sealed)
            file.finishWrite(out)
        } catch (e: IOException) {
            file.failWrite(out)
            throw e
        }
        return keys to true
    }

    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun wrapKey(): SecretKey? = store().getKey(ALIAS, null) as? SecretKey

    // New keys get a new wrapping key too: an old one may be what failed.
    private fun newWrapKey(): SecretKey {
        store().deleteEntry(ALIAS)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }
}
