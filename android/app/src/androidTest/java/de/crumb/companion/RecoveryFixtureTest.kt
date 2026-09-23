package de.crumb.companion

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

/** Opt-in fixture for the external process-death/reboot/Doze harness. Not a device test result itself. */
@RunWith(AndroidJUnit4::class)
class RecoveryFixtureTest {
    @Test fun seedPersistedAlarm() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("recoveryFixture") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val delay = arguments.getString("delayMillis")?.toLong() ?: 90_000L
        require(delay in 15_000L..300_000L)
        val now = System.currentTimeMillis()
        val raw = """{"server_time":"${Instant.ofEpochMilli(now)}","delivery":"android","sessions":[{"id":9001,"version":0,"title":"Recovery-Testbrot","steps":[{"id":"9001:0","globalIdx":0,"phase":"Backen","instruction":"Testalarm prüfen","state":"active","start":"${Instant.ofEpochMilli(now - delay)}","due_at":"${Instant.ofEpochMilli(now + delay)}","critical":true,"action":"complete","alarm_key":"recovery-fixture"}]}]}"""
        AlarmScheduler(context).clear()
        SecureStore(context).save("https://example.invalid/api", "synthetic-recovery-token")
        context.getSharedPreferences("snapshot", Context.MODE_PRIVATE).edit().clear()
            .putString("json", raw).putString("generation", "recovery-fixture")
            .putLong("wall", now).putLong("elapsed", SystemClock.elapsedRealtime())
            .putInt("boot", Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)).commit()
        val repo = context.repository
        assertNotNull(repo.state.value.snapshot)
        val scheduler = AlarmScheduler(context)
        assertTrue("Grant notification permission in the emulator harness", scheduler.allowed())
        assertTrue("Grant exact-alarm access in the emulator harness", scheduler.exact())
        scheduler.reconcile(repo.state.value.snapshot!!, repo.clock.now())
    }
}
