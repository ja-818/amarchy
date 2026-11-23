package io.github.ja818.amarchy

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/** Something that went wrong, in the plain words the person reads. */
internal class Said(message: String) : Exception(message)

/** JSON text as an object, or null when it isn't one. */
internal fun jsonObject(text: String?): JsonObject? =
    text?.let { runCatching { Json.parseToJsonElement(it) as? JsonObject }.getOrNull() }

/** A field that's a string (not a number or a boolean written as one). */
internal fun JsonObject.string(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonObject.int(name: String): Int? =
    (this[name] as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull

internal fun JsonObject.bool(name: String): Boolean? =
    (this[name] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

/** Base64url without padding, as Web Push writes its keys and records. */
internal object B64 {
    fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** Throws IllegalArgumentException when it isn't base64url. */
    fun decode(text: String): ByteArray = Base64.getUrlDecoder().decode(text.trim().trimEnd('='))
}
