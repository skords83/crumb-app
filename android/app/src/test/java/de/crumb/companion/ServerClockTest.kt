package de.crumb.companion
import org.junit.Assert.*
import org.junit.Test
class ServerClockTest {
    @Test fun countdownUsesElapsedTimeIncludingSleep() {
        var elapsed = 100L
        val clock = ServerClock { elapsed }
        clock.sync(10_000)
        elapsed += 3_600_000
        assertEquals(3_610_000, clock.now())
        assertEquals(3_600_000, clock.age())
        clock.sync(20_000)
        assertEquals(20_000, clock.now())
    }
    @Test fun parallelDeadlinesAndOverdueRemainIndependent() {
        assertEquals("Noch 00:01:00", countdown(70_000, 10_000))
        assertEquals("00:00:10 überfällig", countdown(0, 10_000))
        assertEquals("Zeitpunkt offen", countdown(null, 10_000))
    }
}
