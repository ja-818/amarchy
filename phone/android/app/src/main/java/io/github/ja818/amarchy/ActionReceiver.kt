package io.github.ja818.amarchy

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.IOException
import kotlin.concurrent.thread

/**
 * A notification's button, pressed: its POST to the machine, from here
 * without opening the app (goAsync gives it the time). It worked: that
 * notification goes. It didn't: one says so, and opens the chat.
 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Notes.ACTION_ANSWER) return
        val server = intent.getStringExtra(Notes.EXTRA_SERVER)?.takeIf { Address.parse(it).getOrNull() == it } ?: return
        val path = intent.getStringExtra(Notes.EXTRA_PATH)?.takeIf { it.startsWith("/") && !it.startsWith("//") } ?: return
        val body = intent.getStringExtra(Notes.EXTRA_BODY) ?: "{}"
        val label = intent.getStringExtra(Notes.EXTRA_LABEL).orEmpty()
        val tag = intent.getStringExtra(Notes.EXTRA_TAG) ?: return
        val go = intent.getStringExtra(Notes.EXTRA_GO)
        val ask = intent.getStringExtra(Notes.EXTRA_ASK)
        val app = context.applicationContext
        val pending = goAsync()
        thread(name = "amarchy-answer") {
            try {
                val answer = Http.postToMachine(server, path, body, TIMEOUT_MS)
                if (answer.ok) {
                    Notes.cancel(app, tag)
                } else {
                    Log.w(TAG, "$label: ${Address.host(server)} answered ${answer.code}")
                    Notes.failed(app, tag, label, server, go, ask)
                }
            } catch (e: IOException) {
                Log.w(TAG, "$label: ${Address.host(server)} didn't answer", e)
                Notes.failed(app, tag, label, server, go, ask)
            } catch (e: RuntimeException) {
                Log.e(TAG, "$label: couldn't be sent", e)
                Notes.failed(app, tag, label, server, go, ask)
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        const val TAG = "amarchy"
        const val TIMEOUT_MS = 20_000
    }
}
