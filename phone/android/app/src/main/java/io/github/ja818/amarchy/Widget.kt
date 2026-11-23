package io.github.ja818.amarchy

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/** The home screen's widget: "2 need you" and the first chats' names, each opening its chat. */
class NeedsWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Widget.draw(context, manager, ids)
    }
}

internal object Widget {
    private val lines = intArrayOf(R.id.chat1, R.id.chat2, R.id.chat3)

    /** The page's `status`: the count and the names. */
    fun status(context: Context, board: Board) {
        Kept(context).board = board
        refresh(context)
    }

    /** A notification's `waiting`: the count, newer than the names. */
    fun waiting(context: Context, waiting: Int) {
        val kept = Kept(context)
        val board = kept.board
        kept.board = board.copy(needs = waiting, chats = if (waiting == 0) emptyList() else board.chats)
        refresh(context)
    }

    private fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context) ?: return
        val ids = manager.getAppWidgetIds(ComponentName(context, NeedsWidget::class.java))
        if (ids.isNotEmpty()) draw(context, manager, ids)
    }

    fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val board = Kept(context).board
        val views = RemoteViews(context.packageName, R.layout.widget_needs)
        views.setTextViewText(R.id.needs, needsYou(board.needs))
        views.setOnClickPendingIntent(R.id.widget, open(context, "widget", null))
        lines.forEachIndexed { i, id ->
            val chat = board.chats.getOrNull(i)
            if (chat == null) {
                views.setViewVisibility(id, View.GONE)
            } else {
                views.setViewVisibility(id, View.VISIBLE)
                views.setTextViewText(id, chat.why?.let { "${chat.name} · $it" } ?: chat.name)
                views.setOnClickPendingIntent(id, open(context, "widget/${chat.key}", "/#/s/${chat.key}"))
            }
        }
        manager.updateAppWidget(ids, views)
    }

    private fun open(context: Context, which: String, go: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Notes.ACTION_OPEN)
            .setData(Uri.fromParts("amarchy-widget", which, null))
            .putExtra(Notes.EXTRA_GO, go)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
