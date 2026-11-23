package io.github.ja818.amarchy

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Web Push's message encryption as the phone reads it (RFC 8291, its
 * aes128gcm record of RFC 8188): the machine encrypts each notification for
 * this phone's key, so the relay and Google's push carry what they can't read.
 */
internal object WebPush {
    /** The phone's keys: its P-256 private key, the public key's 65 bytes, the 16-byte auth secret. */
    class Keys(val private: PrivateKey, val public: ByteArray, val auth: ByteArray)

    private const val HEADER = 21           // salt 16, record size 4, key id length 1
    private const val KEY = 65              // an uncompressed P-256 point
    private const val TAG = 16

    /** A new key pair and auth secret, made on the phone. */
    fun newKeys(): Keys {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val auth = ByteArray(16).also { SecureRandom().nextBytes(it) }
        return Keys(pair.private, raw(pair.public as ECPublicKey), auth)
    }

    /** The plaintext of a record encrypted for keys; throws when it isn't one, or isn't for them. */
    fun decrypt(record: ByteArray, keys: Keys): ByteArray {
        require(record.size >= HEADER + KEY + TAG + 1) { "too short for a record" }
        val salt = record.copyOfRange(0, 16)
        val size = ByteBuffer.wrap(record, 16, 4).int.toLong() and 0xffffffffL
        val idLength = record[20].toInt() and 0xff
        require(idLength == KEY) { "the key id isn't the server's key" }
        val serverKey = record.copyOfRange(HEADER, HEADER + KEY)
        val sealed = record.copyOfRange(HEADER + KEY, record.size)
        require(size >= 18 && sealed.size <= size) { "more than one record" }

        val secret = ecdh(keys.private, serverKey)
        val ikm = hkdf(keys.auth, secret, "WebPush: info\u0000".toByteArray() + keys.public + serverKey, 32)
        val cek = hkdf(salt, ikm, "Content-Encoding: aes128gcm\u0000".toByteArray(), 16)
        val nonce = hkdf(salt, ikm, "Content-Encoding: nonce\u0000".toByteArray(), 12)
        val padded = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(TAG * 8, nonce))
            doFinal(sealed)
        }
        // The last record: its padding (zeros) ends at the 0x02 delimiter.
        var end = padded.size
        while (end > 0 && padded[end - 1] == 0.toByte()) end--
        require(end > 0 && padded[end - 1] == 2.toByte()) { "not the last record" }
        return padded.copyOf(end - 1)
    }

    fun privateKey(pkcs8: ByteArray): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(pkcs8))

    /** A public key's 65 uncompressed bytes: 0x04, x, y. */
    fun raw(key: ECPublicKey): ByteArray = byteArrayOf(4) + fixed(key.w.affineX) + fixed(key.w.affineY)

    private fun fixed(n: BigInteger): ByteArray {
        val b = n.toByteArray()
        return when {
            b.size == 32 -> b
            b.size > 32 -> b.copyOfRange(b.size - 32, b.size)     // its sign byte
            else -> ByteArray(32 - b.size) + b
        }
    }

    private fun ecdh(private: PrivateKey, raw: ByteArray): ByteArray {
        val params: ECParameterSpec = (private as ECPrivateKey).params
        require(raw.size == KEY && raw[0] == 4.toByte()) { "not an uncompressed P-256 key" }
        val x = BigInteger(1, raw.copyOfRange(1, 33))
        val y = BigInteger(1, raw.copyOfRange(33, 65))
        val public = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), params))
        return KeyAgreement.getInstance("ECDH").run {
            init(private)
            doPhase(public, true)
            generateSecret()
        }
    }

    /** HKDF-SHA256 (RFC 5869) for at most 32 bytes: one block of its expand. */
    private fun hkdf(salt: ByteArray, ikm: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmac(salt, ikm)
        return hmac(prk, info + byteArrayOf(1)).copyOf(length)
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }
}
