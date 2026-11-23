package io.github.ja818.amarchy

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.io.IOException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Notifications (phone/README.md, "Notifications"): the phone's push token
 * (FCM), its keys, registered with the relay for a machine's key; the
 * endpoint that gives is the subscription the page hands the machine.
 */
internal object Push {
    private const val TAG = "amarchy"
    const val UNSUPPORTED = "Notifications aren't in this build of the app"

    /** Where the relay is (built in): empty, and notifications are "unsupported". */
    val relay: String = BuildConfig.AMARCHY_RELAY.trim().trimEnd('/')

    // Firebase by hand, from the build's values: no google-services.json.
    private val options: FirebaseOptions? = listOf(
        BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_APP_ID, BuildConfig.FIREBASE_PROJECT_ID, BuildConfig.FIREBASE_SENDER_ID,
    ).takeIf { values -> values.all { it.isNotBlank() } }?.let {
        FirebaseOptions.Builder()
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()
    }

    /** Whether this build has notifications at all: a relay and a Firebase project. */
    val built get() = relay.startsWith("https://") && options != null

    fun init(context: Context) {
        val o = options ?: return
        if (FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context, o)
    }

    /** Built with them, on a phone with Google Play services (FCM comes through them). */
    fun usable(context: Context): Boolean =
        built && FirebaseApp.getApps(context).isNotEmpty() &&
            GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    enum class Permission { Allowed, Ask, Blocked }

    /** `push.state` for the machine at server. */
    fun state(context: Context, server: String?, permission: Permission): String = when {
        !usable(context) -> "unsupported"
        permission == Permission.Blocked -> "denied"
        permission == Permission.Ask -> "off"
        server != null && Kept(context).subscriptions.any { it.server == server } -> "on"
        else -> "off"
    }

    /** `push.subscribe {key}`, once the system said yes: the subscription, as a browser's. */
    suspend fun subscribe(context: Context, server: String, key: String): JsonObject = withContext(Dispatchers.IO) {
        if (!usable(context)) throw Said(if (built) "This phone has no Google Play services, which Android's notifications come through" else UNSUPPORTED)
        runCatching { B64.decode(key) }.getOrNull()?.takeIf { it.size == 65 && it[0] == 4.toByte() }
            ?: throw Said("That isn't a machine's push key")
        val token = token(enable = true)
        val (keys, fresh) = PushKeys.loadOrMake(context)
        val kept = Kept(context)
        // New keys: every other machine's subscription has to be sent again (catchUp).
        if (fresh) kept.subscriptions = kept.subscriptions.map { it.copy(token = "") }
        val endpoint = register(context, token, key)
        kept.subscriptions = kept.subscriptions.filter { it.server != server } + Subscription(server, key, endpoint, token)
        subscription(endpoint, keys)
    }

    // FCM 26 marks the token API deprecated for an opt-in register()/onRegistered
    // (firebase_messaging_installation_id_enabled); the token API is still its
    // default, and the token it gives is what the relay sends to.
    /** `push.unsubscribe`: the endpoint dropped, or null. The last one gone, the token goes too. */
    @Suppress("DEPRECATION")
    suspend fun unsubscribe(context: Context, server: String): String? = withContext(Dispatchers.IO) {
        val kept = Kept(context)
        val mine = kept.subscriptions.find { it.server == server }
        val rest = kept.subscriptions.filter { it.server != server }
        kept.subscriptions = rest
        if (rest.isEmpty() && usable(context)) {
            try {
                val messaging = FirebaseMessaging.getInstance()
                messaging.isAutoInitEnabled = false
                Tasks.await(messaging.deleteToken(), 20, TimeUnit.SECONDS)
            } catch (e: ExecutionException) {
                Log.w(TAG, "couldn't delete the push token (its endpoint stops working anyway once the machine drops it)", e)
            } catch (e: TimeoutException) {
                Log.w(TAG, "couldn't delete the push token in time", e)
            }
        }
        mine?.endpoint
    }

    /**
     * A new FCM token (onNewToken), or the app opening with subscriptions
     * that aren't on the current one: each registers again and tells its
     * machine itself, the new subscription then the old one's removal.
     * What doesn't get through is tried again the next time the app opens.
     */
    fun refresh(context: Context, token: String) {
        if (!built) return
        val keys = PushKeys.load(context) ?: return
        val kept = Kept(context)
        for (sub in kept.subscriptions.filter { it.token != token }) {
            try {
                val endpoint = register(context, token, sub.key)
                val added = Http.postToMachine(sub.server, "/api/push", subscription(endpoint, keys).toString(), 20_000)
                if (!added.ok) throw Said("${sub.server} answered ${added.code}")
                if (endpoint != sub.endpoint) {
                    val old = buildJsonObject { put("endpoint", sub.endpoint) }.toString()
                    // Not fatal: the old one stops working, and the machine drops it then.
                    runCatching { Http.postToMachine(sub.server, "/api/push/remove", old, 20_000) }
                }
                kept.subscriptions = kept.subscriptions.map { if (it.server == sub.server) Subscription(sub.server, sub.key, endpoint, token) else it }
            } catch (e: IOException) {
                Log.w(TAG, "couldn't move ${sub.server}'s notifications to the new token: next time", e)
            } catch (e: Said) {
                Log.w(TAG, "couldn't move ${sub.server}'s notifications to the new token: ${e.message}")
            }
        }
    }

    /** At the app's start: subscriptions on an older token (or older keys) move to the current one. */
    suspend fun catchUp(context: Context) = withContext(Dispatchers.IO) {
        val subs = Kept(context).subscriptions
        if (subs.isEmpty() || !usable(context)) return@withContext
        val token = try {
            token(enable = false)
        } catch (e: Said) {
            Log.w(TAG, e.message.orEmpty())
            return@withContext
        }
        if (subs.any { it.token != token }) refresh(context, token)
    }

    @Suppress("DEPRECATION")      // (see unsubscribe)
    private fun token(enable: Boolean): String {
        val messaging = FirebaseMessaging.getInstance()
        if (enable) messaging.isAutoInitEnabled = true
        return try {
            Tasks.await(messaging.token, 30, TimeUnit.SECONDS)
        } catch (e: ExecutionException) {
            throw Said("Couldn't get this phone's push token from Google: ${e.cause?.message ?: "it said no"}")
        } catch (e: TimeoutException) {
            throw Said("Couldn't get this phone's push token from Google in 30 seconds: is it online?")
        }
    }

    private fun register(context: Context, token: String, key: String): String {
        val answer = try {
            Http.postJson("$relay/v1/register", Relay.registerBody(token, context.packageName, key), 20_000)
        } catch (e: IOException) {
            throw Said("Couldn't reach the push relay: ${e.message ?: "no answer"}")
        }
        return Relay.endpoint(answer.code, answer.body).getOrThrow()
    }

    fun subscription(endpoint: String, keys: WebPush.Keys): JsonObject = buildJsonObject {
        put("endpoint", endpoint)
        putJsonObject("keys") {
            put("p256dh", B64.encode(keys.public))
            put("auth", B64.encode(keys.auth))
        }
        putJsonObject("app") {
            put("platform", "android")
            put("version", AppInfo.version)
            put("device", AppInfo.device)
        }
    }
}
