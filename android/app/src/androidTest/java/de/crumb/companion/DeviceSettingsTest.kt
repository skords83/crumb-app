package de.crumb.companion

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.net.ssl.HttpsURLConnection

@RunWith(AndroidJUnit4::class)
class DeviceSettingsTest {
    @get:Rule val compose = createEmptyComposeRule()
    @get:Rule val notifications = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    @Test fun persistentAlarmStatusAndThreeSystemCountdowns() = runBlocking<Unit> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repo = context.repository
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val previousTls = HttpsURLConnection.getDefaultSSLSocketFactory()
        val server = MockWebServer().apply { useHttps(serverTls.sslSocketFactory(), false) }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = when (request.path) {
                    "/api/auth/login" -> """{"token":"synthetic-settings-token"}"""
                    "/api/bake-sessions/companion/delivery" -> """{"delivery":"web"}"""
                    "/api/bake-sessions/companion" -> {
                        val sessions = (1..3).joinToString(",") { id ->
                            """{"id":$id,"version":0,"title":"Testbrot $id","steps":[{"id":"$id:0","globalIdx":0,"phase":"Teigruhe","instruction":"Falten","state":"active","due_at":"2026-09-23T12:10:00Z","critical":false,"action":"complete","alarm_key":"countdown-$id"}]}"""
                        }
                        """{"server_time":"2026-09-23T12:00:00Z","delivery":"android","sessions":[$sessions]}"""
                    }
                    else -> return MockResponse().setResponseCode(404)
                }
                return MockResponse().setHeader("Content-Type", "application/json").setBody(body)
            }
        }
        server.start()
        try {
            HttpsURLConnection.setDefaultSSLSocketFactory(clientTls.sslSocketFactory())
            AlarmScheduler(context).setCountdownsEnabled(true)
            repo.login(server.url("/api").toString(), "baker@example.invalid", "synthetic-password")
            val manager = context.getSystemService(NotificationManager::class.java)
            val deadline = android.os.SystemClock.elapsedRealtime() + 10_000
            while (manager.activeNotifications.count { it.tag?.startsWith("timer:") == true } != 3) {
                check(android.os.SystemClock.elapsedRealtime() < deadline) { "Missing countdown notifications" }
                Thread.sleep(100)
            }
            val timers = manager.activeNotifications.filter { it.tag?.startsWith("timer:") == true }
            assertTrue(timers.all { it.notification.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER) })
            assertTrue(timers.all { it.notification.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN) })
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val exact = AlarmScheduler(context).exact()
                val status = if (exact) "Genaue Backtimer: erlaubt" else "Genaue Backtimer: nicht erlaubt"
                val button = if (exact) "Backtimer-Einstellungen öffnen" else "Genaue Backtimer erlauben"
                compose.onNodeWithText(status).performScrollTo().assertIsDisplayed()
                compose.onNodeWithText("Einstellungen").performScrollTo().performClick()
                compose.onNodeWithText(button).performScrollTo().assertIsDisplayed()
                scenario.recreate()
                compose.onNodeWithText(status).performScrollTo().assertIsDisplayed()
                compose.onNodeWithText("Laufende Timer anzeigen").performScrollTo().assertIsDisplayed()
            }
        } finally {
            repo.logout()
            AlarmScheduler(context).clear()
            androidx.work.WorkManager.getInstance(context).cancelAllWork()
            HttpsURLConnection.setDefaultSSLSocketFactory(previousTls)
            server.shutdown()
        }
    }
}
