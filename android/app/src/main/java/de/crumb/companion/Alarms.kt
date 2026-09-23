package de.crumb.companion

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.*

internal fun confirmationIntent(context: Context, task: Task, generation: String): PendingIntent =
    PendingIntent.getBroadcast(context, 0, Intent(context, ActionReceiver::class.java)
        .setData(Uri.parse("crumb://action/" + Uri.encode("$generation:${task.step.alarmKey}:${task.session.version}")))
        .putExtra("generation", generation).putExtra("session", task.session.id).putExtra("version", task.session.version)
        .putExtra("step", task.step.id).putExtra("action", task.step.action).putExtra("key", task.step.alarmKey),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

class AlarmScheduler(private val context: Context) {
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notices = NotificationManagerCompat.from(context)
    private val prefs = context.getSharedPreferences("alarms", Context.MODE_PRIVATE)
    fun channels() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("timers", "Laufende Timer", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Stille Countdowns bis zum nächsten Arbeitsschritt"
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        manager.createNotificationChannel(NotificationChannel("steps", "Arbeitsschritte", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(NotificationChannel("critical", "Zeitkritisches Backen", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Backende und Wechsel im Ofen; Wiederholung nach frühestens 10 Minuten"
            enableVibration(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
    }
    fun allowed(): Boolean = notices.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    fun channelStatus(): List<Triple<String, String, Boolean>> {
        val manager = context.getSystemService(NotificationManager::class.java)
        return listOf("steps" to "Arbeitsschritte", "critical" to "Zeitkritisches Backen", "timers" to "Laufende Timer").map { (id, label) ->
            Triple(id, label, manager.getNotificationChannel(id)?.importance != NotificationManager.IMPORTANCE_NONE)
        }
    }
    fun countdownsEnabled(): Boolean = context.getSharedPreferences("display", Context.MODE_PRIVATE).getBoolean("countdowns", true)
    fun setCountdownsEnabled(enabled: Boolean) { context.getSharedPreferences("display", Context.MODE_PRIVATE).edit().putBoolean("countdowns", enabled).apply() }
    private fun cancelTimer(key: String) { notices.cancel("timer:$key", 0) }
    private fun showTimer(task: Task, now: Long) {
        val key = task.step.alarmKey ?: return
        val remaining = (task.step.due ?: return) - now
        if (!countdownsEnabled() || remaining <= 0) { cancelTimer(key); return }
        val notice = timerNotification(context, task, now)
        try { notices.notify("timer:$key", 0, notice) } catch (_: SecurityException) { }
    }
    private fun timerRefreshIntent(): PendingIntent = PendingIntent.getBroadcast(context, 0,
        Intent(context, AlarmReceiver::class.java).setAction(TIMER_REFRESH_ACTION), PendingIntent.FLAG_IMMUTABLE)
    private fun scheduleTimerRefresh(tasks: List<Task>, now: Long) {
        val nextDue = tasks.filter { task -> task.step.alarmKey?.let { prefs.getLong("fired:$it", 0) < Long.MAX_VALUE - 600_000 } == true }
            .mapNotNull { it.step.due }.filter { it > now }.minOrNull()
        if (!allowed() || !countdownsEnabled() || nextDue == null) alarms.cancel(timerRefreshIntent())
        else {
            // Cosmetic only: one inexact, non-wakeup tick shared by all timers. It may
            // be deferred in Doze. Actual due alarms use their independent schedule.
            alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + minOf(60_000, nextDue - now), timerRefreshIntent())
        }
    }
    fun refreshTimerDisplays() {
        val repo = context.repository
        val snapshot = repo.state.value.snapshot
        val tasks = if (snapshot?.delivery == "android") snapshot.tasks else emptyList()
        val now = repo.clock.now()
        if (allowed()) tasks.forEach { task ->
            val key = task.step.alarmKey ?: return@forEach
            if (prefs.getLong("fired:$key", 0) < Long.MAX_VALUE - 600_000) showTimer(task, now)
        }
        scheduleTimerRefresh(tasks, now)
    }
    fun exact(): Boolean = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
    private fun intent(key: String): PendingIntent = PendingIntent.getBroadcast(context, 0,
        Intent(context, AlarmReceiver::class.java).setData(Uri.parse("crumb://alarm/" + Uri.encode(key))).putExtra("key", key),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun reconcile(snapshot: Snapshot, now: Long) {
        val tasks = if (snapshot.delivery == "android") snapshot.tasks.filter { it.step.due != null } else emptyList()
        val keys = tasks.mapNotNull { it.step.alarmKey }.toSet()
        val old = prefs.getStringSet("keys", emptySet()).orEmpty().toSet()
        (old - keys).forEach { key -> alarms.cancel(intent(key)); notices.cancel(key, 0); cancelTimer(key); prefs.edit().remove("fired:$key").apply() }
        prefs.edit().putStringSet("keys", keys).commit()
        if (!allowed()) {
            // Permissions are not a state transition: retain delivery/acknowledgement tombstones.
            keys.forEach { key -> alarms.cancel(intent(key)); notices.cancel(key, 0); cancelTimer(key) }
            alarms.cancel(timerRefreshIntent())
            return
        }
        tasks.forEach { task ->
            val key = task.step.alarmKey ?: return@forEach
            val fired = prefs.getLong("fired:$key", 0)
            if (fired >= Long.MAX_VALUE - 600_000) { cancelTimer(key); return@forEach }
            showTimer(task, now)
            if (fired != 0L && !task.step.critical) {
                if (context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.tag == key }) show(task, stale = false, silent = true)
                return@forEach
            }
            val due = if (fired == 0L) task.step.due!! else maxOf(task.step.due!!, fired + 600_000)
            schedule(key, due - now, task.step.critical)
            // Keep the action's expectedVersion current after a successful sync.
            if (fired != 0L) show(task, stale = false, silent = true)
        }
        scheduleTimerRefresh(tasks, now)
    }
    private fun schedule(key: String, delay: Long, critical: Boolean) {
        val trigger = SystemClock.elapsedRealtime() + delay.coerceAtLeast(1000)
        try {
            if (critical && exact()) alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, intent(key))
            else alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, intent(key))
        } catch (_: SecurityException) { alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, intent(key)) }
    }
    fun fire(key: String) {
        val repo = context.repository
        val snapshot = repo.state.value.snapshot ?: return
        if (snapshot.delivery != "android" || !allowed()) return
        val task = snapshot.tasks.find { it.step.alarmKey == key } ?: return
        val now = repo.clock.now()
        if (task.step.due!! > now + 1000) { reconcile(snapshot, now); return }
        val last = prefs.getLong("fired:$key", 0)
        if (last != 0L && (!task.step.critical || now - last < 599_000)) return
        cancelTimer(key)
        show(task, repo.state.value.stale || repo.clock.age() > 120_000)
        prefs.edit().putLong("fired:$key", now).commit()
        if (task.step.critical) schedule(key, 600_000, true)
        WorkManager.getInstance(context).enqueueUniqueWork("alarm-sync", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<SyncWorker>().build())
    }
    private fun show(task: Task, stale: Boolean, silent: Boolean = false, failure: Boolean = false) {
        if (!allowed()) return
        val step = task.step
        val key = step.alarmKey ?: return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val action = confirmationIntent(context, task, context.repository.generation)
        val text = (if (failure) "Nicht bestätigt. Verbindung prüfen. " else if (stale) "Letzter bekannter Plan · " else "") + step.instruction
        val notification = NotificationCompat.Builder(context, if (step.critical) "critical" else "steps")
            .setSmallIcon(R.drawable.ic_crumb).setContentTitle("${task.session.title} · ${step.phase}")
            .setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(false).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(if (step.critical) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (step.critical) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(silent).addAction(0, step.label, action).build()
        try { notices.notify(key, 0, notification) } catch (_: SecurityException) { /* permission revoked */ }
    }
    fun transmitting(key: String) {
        if (!allowed()) return
        val notification = NotificationCompat.Builder(context, "steps").setSmallIcon(R.drawable.ic_crumb)
            .setContentTitle("Bestätigung wird übertragen …").setContentText("Crumb wartet auf die Antwort des Servers.")
            .setSilent(true).setOngoing(true).build()
        try { notices.notify(key, 0, notification) } catch (_: SecurityException) { }
    }
    fun failed(key: String) {
        context.repository.state.value.snapshot?.tasks?.find { it.step.alarmKey == key }?.let { show(it, true, failure = true) } ?: notices.cancel(key, 0)
    }
    fun acknowledge(step: Step) {
        step.alarmKey?.let { key ->
            alarms.cancel(intent(key)); notices.cancel(key, 0); cancelTimer(key)
            // Retain a tombstone until refreshed, so an old cache cannot rearm an accepted action.
            prefs.edit().putLong("fired:$key", Long.MAX_VALUE - 600_000).commit()
        }
    }
    fun clear() {
        prefs.getStringSet("keys", emptySet()).orEmpty().forEach { alarms.cancel(intent(it)); notices.cancel(it, 0); cancelTimer(it) }
        prefs.edit().clear().commit()
        alarms.cancel(timerRefreshIntent())
    }
}
internal const val TIMER_REFRESH_ACTION = "de.crumb.companion.REFRESH_TIMER_DISPLAY"
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val scheduler = AlarmScheduler(context)
        if (intent.action == TIMER_REFRESH_ACTION) scheduler.refreshTimerDisplays()
        else intent.getStringExtra("key")?.let { scheduler.fire(it) }
    }
}
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra("key") ?: return
        val request = OneTimeWorkRequestBuilder<ActionWorker>().setInputData(workDataOf(
            "generation" to intent.getStringExtra("generation"), "session" to intent.getIntExtra("session", -1), "version" to intent.getIntExtra("version", -1),
            "step" to intent.getStringExtra("step"), "action" to intent.getStringExtra("action"), "key" to key)).build()
        WorkManager.getInstance(context).enqueueUniqueWork("action:$key", ExistingWorkPolicy.KEEP, request)
    }
}
class ActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (inputData.getString("generation") != applicationContext.repository.generation) return Result.failure()
        val step = inputData.getString("step") ?: return Result.failure()
        val action = inputData.getString("action") ?: return Result.failure()
        inputData.getString("key")?.let { AlarmScheduler(applicationContext).transmitting(it) }
        val ok = applicationContext.repository.act(inputData.getInt("session", -1), inputData.getInt("version", -1), step, action, inputData.getString("generation").orEmpty())
        if (!ok) inputData.getString("key")?.let { AlarmScheduler(applicationContext).failed(it) }
        // No automatic retry: an old intention must never be replayed against a new timeline.
        return if (ok) Result.success() else Result.failure()
    }
}
class RestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)) return
        val repo = context.repository
        repo.state.value.snapshot?.let { AlarmScheduler(context).reconcile(it, repo.clock.now()) }
        if (repo.state.value.loggedIn) {
            scheduleSync(context)
            WorkManager.getInstance(context).enqueueUniqueWork("restore", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<SyncWorker>().build())
        }
    }
}
