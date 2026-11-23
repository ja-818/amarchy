package io.github.ja818.amarchy

/**
 * amarchy's chimes on the phone: a notification's `sound` (the chime picked
 * in amarchy's Settings, or an assistant's own) rings that chime, as the
 * desktop app does. Android sets a notification's sound per channel, and a
 * channel's sound can't change once it's made: so each chime has channels of
 * its own (a chat's, an urgent one's), made the first time a notification
 * rings it. Anything else rings as the phone's default.
 */
internal object Chimes {
    /** The built-in chimes (bin/amarchy's CHIMES that have a file in sounds/), as the build brought them in. */
    val all: List<String> = BuildConfig.CHIMES.toList()

    /** The chime a notification's `sound` names, or null: none, or not one the app has. */
    fun of(sound: String?): String? = sound?.trim()?.lowercase()?.takeIf { it in all }

    /** The channel a notification goes to: the chime's own, else the default sound's. */
    fun channel(chime: String?, urgent: Boolean): String {
        val base = if (urgent) Notes.URGENT else Notes.CHATS
        return if (chime == null) base else "$base.$chime"
    }

    /** What Android's settings call a chime's channel: "Chats that need you (Kalimba)". */
    fun channelName(chime: String, urgent: Boolean): String =
        "${if (urgent) Notes.URGENT_NAME else Notes.CHATS_NAME} (${label(chime)})"

    fun label(chime: String): String = chime.replaceFirstChar { it.uppercase() }

    /** Its raw resource's name (the build's `res/raw/chime_<name>.wav|ogg`). */
    fun resource(chime: String): String = "chime_$chime"

    /** The sound a chime's channel rings. */
    fun uri(packageName: String, chime: String): String = "android.resource://$packageName/raw/${resource(chime)}"
}
