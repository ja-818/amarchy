package io.github.ja818.amarchy

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.security.GeneralSecurityException

/**
 * FCM's messages: a data message `{"p"}` from the relay, the notification
 * encrypted for this phone (RFC 8291). Decrypted and shown here; anything
 * that can't be read shows as "Amarchy" / "Open it to see", nothing else.
 */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val notice = message.data["p"]?.let(::read) ?: Notice.unread
        Notes.show(this, notice)
        notice.waiting?.let { Widget.waiting(this, it) }
    }

    private fun read(p: String): Notice? {
        return try {
            val keys = PushKeys.load(this) ?: return null
            Notice.parse(WebPush.decrypt(B64.decode(p), keys))
        } catch (e: GeneralSecurityException) {
            Log.w(TAG, "a notification that doesn't decrypt with this phone's keys", e)
            null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "a notification that isn't a record: ${e.message}")
            null
        } catch (e: RuntimeException) {
            // Whatever else went wrong, it still shows (as "Open it to see").
            Log.e(TAG, "a notification that couldn't be read", e)
            null
        }
    }

    @Suppress("OVERRIDE_DEPRECATION")      // FCM 26's token API is still its default (see Push.unsubscribe)
    override fun onNewToken(token: String) {
        // On FCM's own background thread: the relay and each machine are told now.
        Push.refresh(this, token)
    }

    private companion object {
        const val TAG = "amarchy"
    }
}
