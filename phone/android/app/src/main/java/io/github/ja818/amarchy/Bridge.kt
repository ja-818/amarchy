package io.github.ja818.amarchy

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * The page and the shell talk in JSON messages (phone/README.md, "The
 * bridge"): `{id, command, args}` from the page, `{id, result}` or
 * `{id, error}` back. Id 0 asks for no answer (the shell's own messages).
 */
internal data class BridgeCall(val id: Long, val command: String, val args: JsonObject) {
    companion object {
        fun parse(text: String?): BridgeCall? {
            val o = jsonObject(text) ?: return null
            val id = (o["id"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull?.takeIf { it >= 0 } ?: return null
            val command = o.string("command")?.takeIf { it.isNotEmpty() } ?: return null
            return BridgeCall(id, command, o["args"] as? JsonObject ?: JsonObject(emptyMap()))
        }
    }

    fun result(value: JsonElement?): String = buildJsonObject {
        put("id", id)
        put("result", value ?: JsonNull)
    }.toString()

    fun error(message: String): String = buildJsonObject {
        put("id", id)
        put("error", message)
    }.toString()
}

/** The scripts set before a page's own (androidx.webkit's document-start scripts). */
internal object BridgeScripts {
    const val PHONE_PORT = "amarchyPhonePort"
    const val SHELL_PORT = "amarchyShellPort"

    // One promise per call; the port is the web message listener's object.
    private fun caller(port: String) = """
        const port = window.$port;
        let next = 0;
        const waiting = new Map();
        port.addEventListener("message", (e) => {
          let m;
          try { m = JSON.parse(e.data); } catch (_) { return; }
          const w = waiting.get(m.id);
          if (!w) return;
          waiting.delete(m.id);
          if ("error" in m) w.reject(new Error(String(m.error)));
          else w.resolve(m.result === undefined ? null : m.result);
        });
        const call = (command, args) => new Promise((resolve, reject) => {
          const id = ++next;
          waiting.set(id, { resolve, reject });
          port.postMessage(JSON.stringify({ id, command: String(command), args: args === undefined ? {} : args }));
        });
    """.trimIndent()

    /** `window.amarchyPhone` on the machine's origin; it also tells the shell the bars' color (the theme's). */
    fun phone(version: String, relay: String): String = """
        (() => {
          if (!window.$PHONE_PORT || window.amarchyPhone) return;
        ${caller(PHONE_PORT).prependIndent("  ")}
          Object.defineProperty(window, "amarchyPhone", {
            value: Object.freeze({ version: ${quote(version)}, platform: "android", relay: ${quote(relay)}, call }),
            enumerable: true,
          });
          const bars = () => {
            const m = document.querySelector('meta[name="theme-color"]');
            if (m && m.content) port.postMessage(JSON.stringify({ id: 0, command: "shell.bars", args: { color: m.content } }));
          };
          document.addEventListener("DOMContentLoaded", () => {
            bars();
            new MutationObserver(bars).observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ["content"] });
          });
        })();
    """.trimIndent()

    /** `window.amarchyShell` on the own page (desktop/dist), as the desktop app's. */
    fun shell(): String = """
        (() => {
          if (!window.$SHELL_PORT || window.amarchyShell) return;
        ${caller(SHELL_PORT).prependIndent("  ")}
          Object.defineProperty(window, "amarchyShell", { value: Object.freeze({ invoke: call }), enumerable: true });
        })();
    """.trimIndent()

    /**
     * Tells a loaded page to open something (`amarchy-open`); its value is
     * false when the page isn't up yet (still loading, or elsewhere), and the
     * shell loads the address instead.
     */
    fun open(origin: String, detail: JsonObject): String = """
        (() => {
          if (location.origin !== ${quote(origin)} || document.readyState !== "complete" || !window.amarchyPhone) return false;
          window.dispatchEvent(new CustomEvent("amarchy-open", { detail: $detail }));
          return true;
        })();
    """.trimIndent()

    private fun quote(s: String) = Json.encodeToString(JsonElement.serializer(), JsonPrimitive(s))
}
