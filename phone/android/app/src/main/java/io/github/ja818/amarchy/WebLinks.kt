package io.github.ja818.amarchy

/** Where a navigation in the web view goes. */
internal sealed interface Nav {
    /** One of the shell's own origins: it loads here. */
    data object Here : Nav

    /** A web page elsewhere: a Custom Tab (the system's browser). */
    data class Browser(val url: String) : Nav

    /** Another scheme (tel:, mailto:, intent:, an app's own): the system opens it. */
    data class System(val url: String, val scheme: String) : Nav

    /** amarchy:// in a page: the shell itself opens it. */
    data class Ours(val link: Link) : Nav

    /** What no page may make the phone open (files, the app's own content, script). */
    data class Refused(val scheme: String) : Nav
}

internal object WebLinks {
    private val refused = setOf("file", "content", "javascript", "data", "blob", "about", "chrome", "android-app")

    /** Where `url` goes when the page navigates to it, with `origins` the ones that stay in the web view. */
    fun decide(url: String, origins: Set<String>): Nav {
        val scheme = url.substringBefore(':', "").lowercase()
        return when {
            scheme == "http" || scheme == "https" ->
                if (Address.origin(url)?.let { it in origins } == true) Nav.Here else Nav.Browser(url)
            scheme == "amarchy" -> Link.parse(url)?.let { Nav.Ours(it) } ?: Nav.Refused(scheme)
            scheme.isEmpty() || scheme in refused || !scheme.all { it.isLetterOrDigit() || it in "+.-" } -> Nav.Refused(scheme)
            else -> Nav.System(url, scheme)
        }
    }
}
