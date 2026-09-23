package de.crumb.companion

import android.app.AlarmManager
import android.content.Context
import android.view.View
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class TimerNotificationTest {
    private val now = 1_000_000L
    private fun task(start: Long? = now - 60_000, due: Long = now + 180_000) = Task(
        Session(7, 0, "Einfaches Weizenbrot", emptyList()),
        Step("7:0", 0, "Teigruhe", "Nach der Ruhezeit falten", "active", start, due, due, false, "complete", "timer-test"))
    @Test fun ringUsesServerIntervalAndDoesNotInventMissingDuration() {
        assertEquals(0.75f, timerRemainingFraction(task().step, now)!!, 0.0001f)
        assertEquals(0f, timerRemainingFraction(task().step, now + 180_000)!!, 0f)
        assertEquals(0f, timerRemainingFraction(task().step, now + 190_000)!!, 0f)
        assertNull(timerRemainingFraction(task(start = null).step, now))
        assertNull(timerRemainingFraction(task(start = now + 1000).step, now))
        assertNull(timerRemainingFraction(task(start = now, due = now).step, now))
    }
    @Test fun customViewsHaveLargeNativeCountdownWithMonotonicBaseAndAccessibleRecipe() {
        val context = RuntimeEnvironment.getApplication() as Context
        AlarmScheduler(context).channels()
        val notification = timerNotification(context, task(), now, elapsedNow = 2000L, wallNow = 5000L)
        for (remote in listOf(notification.contentView, notification.bigContentView)) {
            assertNotNull(remote)
            val view = remote.apply(context, FrameLayout(context))
            val clock = view.findViewById<Chronometer>(R.id.timer_clock)
            assertTrue(clock.isCountDown)
            assertEquals(182000L, clock.base)
            assertTrue(clock.textSize >= 22 * context.resources.displayMetrics.scaledDensity)
            assertEquals("Einfaches Weizenbrot", view.findViewById<TextView>(R.id.timer_title).text.toString())
            assertNotNull(view.findViewById<View>(R.id.timer_gauge))
        }
        val expanded = notification.bigContentView.apply(context, FrameLayout(context))
        assertTrue(expanded.findViewById<TextView>(R.id.timer_gauge_status).text.toString().contains("75 %"))
        assertEquals(180000L, notification.timeoutAfter)
        assertTrue(notification.actions.isNullOrEmpty())
    }
    @Test fun oneCosmeticAlarmIsSharedAndDoesNotWakeDeviceOrReplaceDueAlarms() {
        val context = RuntimeEnvironment.getApplication() as Context
        val scheduler = AlarmScheduler(context)
        scheduler.channels(); scheduler.clear(); scheduler.setCountdownsEnabled(true)
        val data = Snapshot(now, "android", (1..3).map { id ->
            Session(id, 0, "Test $id", listOf(task().step.copy(id = "$id:0", alarmKey = "timer-$id")))
        })
        scheduler.reconcile(data, now)
        val scheduled = shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms
        val cosmetics = scheduled.filter { shadowOf(it.operation).savedIntent.action == TIMER_REFRESH_ACTION }
        assertEquals(1, cosmetics.size)
        assertEquals(AlarmManager.ELAPSED_REALTIME, cosmetics.single().type)
        assertFalse(cosmetics.single().isAllowWhileIdle)
        assertEquals(4, scheduled.size)
        scheduler.clear()
        assertTrue(shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms.isEmpty())
    }
}
