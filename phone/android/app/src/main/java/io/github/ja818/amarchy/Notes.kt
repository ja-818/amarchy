package io.github.ja818.amarchy

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

/**
 * The notifications on the phone: one per chat (its `tag`, a newer one
 * replacing it), the count waiting on it, its buttons, and what tapping
 * it opens.
 */
internal object Notes {
    const val CHATS = "chats"
    const val URGENT = "urgent"
    const val CHATS_NAME = "Chats that need you"
    const val URGENT_NAME = "Urgent"
    private const val CHATS_WHY = "A chat asks you something, or is done"
    private const val URGENT_WHY = "What can't wait: it stays on the screen until you look"
    private const val ID = 1
    private const val UNREAD_TAG = "amarchy"

    const val ACTION_OPEN = "io.github.ja818.amarchy.OPEN"
    const val ACTION_ANSWER = "io.github.ja818.amarchy.ANSWER"
    const val EXTRA_SERVER = "server"
    const val EXTRA_GO = "go"
    const val EXTRA_ASK = "ask"
    const val EXTRA_TAG = "tag"
    const val EXTRA_LABEL = "label"
    const val EXTRA_PATH = "path"
    const val EXTRA_BODY = "body"

    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(CHATS, CHATS_NAME, NotificationManager.IMPORTANCE_HIGH).apply { description = CHATS_WHY },
                NotificationChannel(URGENT, URGENT_NAME, NotificationManager.IMPORTANCE_HIGH).apply { description = URGENT_WHY },
            ),
        )
    }

    /** A notification from a machine (or the unread one, when it couldn't be read). */
    fun show(context: Context, n: Notice) {
        val tag = n.tag ?: UNREAD_TAG
        val builder = NotificationCompat.Builder(context, channel(context, Chimes.of(n.sound), n.urgent))
            .setSmallIcon(R.drawable.ic_note)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle(n.title)
            .setContentText(n.body.lineSequence().firstOrNull().orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setAutoCancel(true)
            .setContentIntent(opening(context, tag, n.server, n.url, n.ask))
            .setCategory(if (n.urgent) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(if (n.urgent) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, CHATS)
                    .setSmallIcon(R.drawable.ic_note)
                    .setColor(ContextCompat.getColor(context, R.color.accent))
                    .setContentTitle(Notice.unread.title)
                    .setContentText(Notice.unread.body)
                    .build(),
            )
        n.waiting?.let { builder.setNumber(it) }
        if (n.server != null) {
            n.actions.forEachIndexed { i, a ->
                val answer = Intent(context, ActionReceiver::class.java)
                    .setAction(ACTION_ANSWER)
                    .setData(Uri.fromParts("amarchy-note", "$tag/$i", null))
                    .putExtra(EXTRA_SERVER, n.server)
                    .putExtra(EXTRA_PATH, a.path)
                    .putExtra(EXTRA_BODY, a.body)
                    .putExtra(EXTRA_LABEL, a.label)
                    .putExtra(EXTRA_TAG, tag)
                    .putExtra(EXTRA_GO, n.url)
                    .putExtra(EXTRA_ASK, n.ask)
                val pending = PendingIntent.getBroadcast(context, 0, answer, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                builder.addAction(
                    NotificationCompat.Action.Builder(0, a.label, pending)
                        .setAuthenticationRequired(true)       // a locked phone asks who you are first
                        .build(),
                )
            }
        }
        post(context, tag, builder)
    }

    /** A button's POST didn't get through: say so, and tapped it opens the chat. */
    fun failed(context: Context, tag: String, label: String, server: String, go: String?, ask: String?) {
        val builder = NotificationCompat.Builder(context, CHATS)
            .setSmallIcon(R.drawable.ic_note)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle("Couldn't send $label")
            .setContentText("Open the chat to answer")
            .setAutoCancel(true)
            .setContentIntent(opening(context, tag, server, go, ask))
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
        post(context, tag, builder)
    }

    /**
     * The channel that rings the chime (made the first time it's needed: only
     * chimes actually rung get one in Android's settings), else the default's.
     */
    private fun channel(context: Context, chime: String?, urgent: Boolean): String {
        val id = Chimes.channel(chime, urgent)
        if (chime == null) return id
        val manager = context.getSystemService(NotificationManager::class.java) ?: return id
        if (manager.getNotificationChannel(id) != null) return id
        // Turned off in Android's settings: a new chime doesn't turn it back on.
        val off = manager.getNotificationChannel(if (urgent) URGENT else CHATS)?.importance == NotificationManager.IMPORTANCE_NONE
        val ring = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        manager.createNotificationChannel(
            NotificationChannel(id, Chimes.channelName(chime, urgent), if (off) NotificationManager.IMPORTANCE_NONE else NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "${if (urgent) URGENT_WHY else CHATS_WHY}, with amarchy's ${Chimes.label(chime)} chime"
                    setSound(Chimes.uri(context.packageName, chime).toUri(), ring)
                },
        )
        return id
    }

    fun cancel(context: Context, tag: String) = NotificationManagerCompat.from(context).cancel(tag, ID)

    /** `notes.clear {tags}`: the page opened those chats. */
    fun clear(context: Context, tags: List<String>) = tags.forEach { cancel(context, it) }

    private fun post(context: Context, tag: String, builder: NotificationCompat.Builder) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return      // turned off in Android's settings since: nothing can show
        }
        NotificationManagerCompat.from(context).notify(tag, ID, builder.build())
    }

    /** The app, opened on the chat: `<server>/?ask=<ask>#/s/<key>` (or the page told, when it's up). */
    fun opening(context: Context, tag: String, server: String?, go: String?, ask: String?): PendingIntent {
        val open = Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN)
            .setData(Uri.fromParts("amarchy-note", tag, null))
            .putExtra(EXTRA_SERVER, server)
            .putExtra(EXTRA_GO, go)
            .putExtra(EXTRA_ASK, ask)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
