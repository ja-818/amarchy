package io.github.ja818.amarchy

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The push relay (relay/): a Web Push service in front of FCM that keeps
 * nothing. This phone registers its FCM token there for a machine's key and
 * gets the endpoint the machine pushes to.
 */
internal object Relay {
    /** `POST <relay>/v1/register`'s body. */
    fun registerBody(token: String, app: String, serverKey: String): String = buildJsonObject {
        put("platform", "fcm")
        put("token", token)
        put("app", app)
        put("server_key", serverKey)
    }.toString()

    /** What the relay answered: the endpoint, or why not. */
    fun endpoint(status: Int, body: String): Result<String> {
        val answer = jsonObject(body)
        if (status in 200..299) {
            val endpoint = answer?.string("endpoint")?.takeIf { it.startsWith("https://") }
            return endpoint?.let { Result.success(it) } ?: Result.failure(Said("The push relay answered, but with no endpoint"))
        }
        val said = answer?.string("error")?.takeIf { it.isNotBlank() }
        return Result.failure(
            Said(
                when (status) {
                    429 -> "The push relay is busy: try again in a minute"
                    in 500..599 -> "The push relay isn't working right now ($status): try again later"
                    else -> "The push relay said no ($status${said?.let { ": $it" }.orEmpty()})"
                },
            ),
        )
    }
}
