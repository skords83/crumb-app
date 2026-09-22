package de.crumb.companion

import android.app.AlarmManager
import android.content.Context
import org.robolectric.RuntimeEnvironment
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class AlarmSchedulerTest {
    private lateinit var context: Context
    private lateinit var scheduler: AlarmScheduler
    private val now = 1_000_000L
    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        scheduler = AlarmScheduler(context)
        scheduler.clear()
        scheduler.channels()
    }
    private fun snapshot(delivery: String = "android", version: Int = 0, due: Long = now + 60_000): Snapshot = Snapshot(now, delivery, (1..3).map { id ->
        Session(id, version, "Testbrot $id", listOf(Step("$id:0", 0, "Backen", "Aus dem Ofen nehmen", "active", now, due, due, id == 1, "complete", "$id:0:$due")))
    })
    private fun scheduled() = shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms
    @Test fun threeParallelBakesRemainScheduledAndRepeatedSyncDoesNotDuplicate() {
        scheduler.reconcile(snapshot(), now)
        assertEquals(3, scheduled().size)
        scheduler.reconcile(snapshot(version = 1), now + 5000)
        assertEquals(3, scheduled().size)
        assertEquals(3, scheduled().map { it.operation }.toSet().size)
    }
    @Test fun timelineExtensionReplacesOldAlarmsAndWebModeCancelsAll() {
        scheduler.reconcile(snapshot(), now)
        val old = scheduled().map { it.operation }.toSet()
        scheduler.reconcile(snapshot(due = now + 120_000), now)
        assertEquals(3, scheduled().size)
        assertTrue(scheduled().none { it.operation in old })
        scheduler.reconcile(snapshot(delivery = "web"), now)
        assertTrue(scheduled().isEmpty())
    }
    @Test fun acceptedActionCannotRearmFromOldCacheEvenAfterSchedulerRecreation() {
        val data = snapshot()
        scheduler.reconcile(data, now)
        scheduler.acknowledge(data.sessions.first().steps.first())
        AlarmScheduler(context).reconcile(data, now)
        assertEquals(2, scheduled().size)
    }
    @Test fun emptyServerSnapshotRemovesEveryAlarm() {
        scheduler.reconcile(snapshot(), now)
        scheduler.reconcile(Snapshot(now, "android", emptyList()), now)
        assertTrue(scheduled().isEmpty())
    }
    @Test @Config(sdk = [31]) fun deniedExactAlarmPermissionFallsBackWithoutDroppingTasks() {
        org.robolectric.shadows.ShadowAlarmManager.setCanScheduleExactAlarms(false)
        assertFalse(scheduler.exact())
        scheduler.reconcile(snapshot(), now)
        assertEquals(3, scheduled().size)
        assertTrue(scheduled().all { it.isAllowWhileIdle && it.windowLengthMs != 0L })
        org.robolectric.shadows.ShadowAlarmManager.setCanScheduleExactAlarms(true)
        scheduler.reconcile(snapshot(), now)
        assertEquals(1, scheduled().count { it.windowLengthMs == 0L })
    }
    @Test fun disabledNotificationsDoNotScheduleInvisibleAlarms() {
        shadowOf(context.getSystemService(android.app.NotificationManager::class.java)).setNotificationsEnabled(false)
        scheduler.reconcile(snapshot(), now)
        assertTrue(scheduled().isEmpty())
    }
    @Test fun oldLoginActionCannotBeUpdatedIntoAnActionForAnotherAccount() {
        val task = snapshot().tasks.first()
        val oldAction = confirmationIntent(context, task, "old-login")
        val newAction = confirmationIntent(context, task, "new-login")
        assertNotEquals(oldAction, newAction)
        assertEquals("old-login", shadowOf(oldAction).savedIntent.getStringExtra("generation"))
        assertEquals("new-login", shadowOf(newAction).savedIntent.getStringExtra("generation"))
    }
    @Test fun permissionToggleDoesNotForgetAcceptedActionsInCachedTimeline() {
        val data = snapshot()
        scheduler.reconcile(data, now)
        scheduler.acknowledge(data.sessions.first().steps.first())
        val manager = shadowOf(context.getSystemService(android.app.NotificationManager::class.java))
        manager.setNotificationsEnabled(false)
        scheduler.reconcile(data, now)
        assertTrue(scheduled().isEmpty())
        manager.setNotificationsEnabled(true)
        scheduler.reconcile(data, now)
        assertEquals(2, scheduled().size)
    }
    @Test fun parserPreservesActionsAndAbsoluteTimes() {
        val data = parseSnapshot("""{"server_time":"2026-09-22T12:00:00.000Z","delivery":"android","sessions":[{"id":7,"version":3,"title":"Testbrot","steps":[{"id":"7:0","globalIdx":0,"phase":"Teig","instruction":"Kneten","state":"active","start":null,"scheduled_start":"2026-09-22T12:00:00.000Z","end":null,"planned_end":"2026-09-22T12:05:00.000Z","due_at":"2026-09-22T12:00:00.000Z","critical":false,"action":"complete","alarm_key":"test"}]}]}""")
        assertEquals(3, data.tasks.single().session.version)
        assertEquals(data.serverTime, data.tasks.single().step.due)
        assertEquals(data.serverTime + 300_000, data.tasks.single().step.end)
    }
}
