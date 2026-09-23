package de.crumb.companion

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.util.TypedValue
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

// A ring represents remaining time in a known, already started interval, never
// a fabricated duration from "when the app first saw the task".
internal fun timerRemainingFraction(step: Step, now: Long): Float? {
    val start = step.start ?: return null
    val due = step.due ?: return null
    if (due <= start || now < start) return null
    return ((due - now).toDouble() / (due - start).toDouble()).coerceIn(0.0, 1.0).toFloat()
}
internal fun timerGauge(fraction: Float?, critical: Boolean): Bitmap {
    val bitmap = Bitmap.createBitmap(288, 288, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 16f; strokeCap = Paint.Cap.ROUND
        color = Color.argb(90, 128, 128, 128)
    }
    val bounds = RectF(16f, 16f, 272f, 272f)
    canvas.drawOval(bounds, paint)
    if (fraction != null && fraction > 0f) {
        paint.color = if (critical) Color.rgb(219, 139, 63) else Color.rgb(168, 124, 79)
        canvas.drawArc(bounds, -90f, 360f * fraction, false, paint)
    }
    return bitmap
}
internal fun timerNotification(context: Context, task: Task, now: Long,
    elapsedNow: Long = SystemClock.elapsedRealtime(), wallNow: Long = System.currentTimeMillis()): Notification {
    val remaining = (task.step.due!! - now).coerceAtLeast(0)
    val fraction = timerRemainingFraction(task.step, now)
    val gauge = timerGauge(fraction, task.step.critical)
    val updated = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(wallNow))
    val status = if (fraction == null) context.getString(R.string.timer_gauge_unknown, updated)
        else context.getString(R.string.timer_gauge_status, (fraction * 100).roundToInt(), updated)
    fun layout(id: Int, expanded: Boolean): RemoteViews = RemoteViews(context.packageName, id).apply {
        setTextViewText(R.id.timer_title, task.session.title)
        setTextViewText(R.id.timer_phase, task.step.phase + if (task.step.critical) " · Zeitkritisch" else "")
        setImageViewBitmap(R.id.timer_gauge, gauge)
        setChronometer(R.id.timer_clock, elapsedNow + remaining, null, true)
        setChronometerCountDown(R.id.timer_clock, true)
        // Reserve at least HH:MM:SS even when the current value is shorter. Never
        // autosize a ticking Chronometer: OEM layouts may resize it on every tick.
        val interval = maxOf(remaining, task.step.start?.let { task.step.due!! - it } ?: 0L)
        val hoursDigits = maxOf(2, (interval / 3_600_000).toString().length)
        val sample = "8".repeat(hoursDigits) + ":88:88"
        val metrics = context.resources.displayMetrics
        val preferredPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, if (expanded) 32f else 28f, metrics)
        val paint = Paint().apply { typeface = Typeface.MONOSPACE; textSize = preferredPx }
        val availablePx = (if (expanded) 116f else 92f) * metrics.density
        val fixedPx = preferredPx * minOf(1f, availablePx / paint.measureText(sample))
        setTextViewTextSize(R.id.timer_clock, TypedValue.COMPLEX_UNIT_PX, fixedPx)
        if (expanded) {
            setTextViewText(R.id.timer_instruction, context.getString(R.string.timer_plan, task.step.instruction))
            setTextViewText(R.id.timer_gauge_status, status)
        }
    }
    val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, "timers")
        .setSmallIcon(R.drawable.ic_crumb).setContentTitle("${task.session.title} · ${task.step.phase}")
        .setContentText(context.getString(R.string.timer_plan, task.step.instruction))
        .setContentIntent(open).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
        // Keep standard fields for accessibility and OEM fallback; hide the duplicate small header clock.
        .setWhen(wallNow + remaining).setShowWhen(false)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(layout(R.layout.notification_timer_compact, false))
        .setCustomBigContentView(layout(R.layout.notification_timer_expanded, true))
        .setTimeoutAfter(remaining).build()
}
