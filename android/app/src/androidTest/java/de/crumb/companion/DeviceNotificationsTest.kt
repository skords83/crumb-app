package de.crumb.companion

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection

@RunWith(AndroidJUnit4::class)
class DeviceNotificationsTest {
    @get:Rule val notificationsPermission = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    @Test fun threeNotificationsDirectActionFailureRetryAndStaleAction() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repo = context.repository
        val scheduler = AlarmScheduler(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val originalTls = HttpsURLConnection.getDefaultSSLSocketFactory()
        val attempts = AtomicInteger()
        val version = AtomicInteger()
        val server = MockWebServer()
        server.useHttps(serverTls.sslSocketFactory(), false)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
                return when (request.path) {
                    "/api/auth/login" -> json("""{"token":"synthetic-notification-token"}""")
                    "/api/bake-sessions/companion" -> {
                        val sessions = (1..3).joinToString(",") { id ->
                            val done = id == 1 && version.get() == 1
                            """{"id":$id,"version":${version.get()},"title":"Testbrot $id","steps":[{"id":"$id:0","globalIdx":0,"phase":"Backphase","instruction":"Aufgabe $id","state":"${if (done) "done" else "active"}","due_at":"2026-09-22T11:59:00Z","critical":${id == 2},"action":${if (done) "null" else "\"complete\""},"alarm_key":${if (done) "null" else "\"notice-$id\""}}]}"""
                        }
                        json("""{"server_time":"2026-09-22T12:00:00Z","delivery":"android","sessions":[$sessions]}""")
                    }
                    "/api/bake-sessions/1/transition" -> {
                        val expected = JSONObject(request.body.readUtf8()).getInt("expectedVersion")
                        if (attempts.incrementAndGet() == 1) MockResponse().setResponseCode(503)
                        else if (expected != 0 || !version.compareAndSet(0, 1)) MockResponse().setResponseCode(409)
                        else json("""{"version":1}""")
                    }
                    "/api/bake-sessions/companion/delivery" -> json("""{"delivery":"web"}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        try {
            // Test-process-only trust root; never changes the APK's production network configuration.
            HttpsURLConnection.setDefaultSSLSocketFactory(clientTls.sslSocketFactory())
            repo.login(server.url("/api").toString(), "baker@example.invalid", "synthetic-password")
            assertEquals(3, repo.state.value.snapshot!!.sessions.size)
            (1..3).forEach { scheduler.fire("notice-$it") }
            await { manager.activeNotifications.count { it.tag?.startsWith("notice-") == true } == 3 }
            val first = manager.activeNotifications.first { it.tag == "notice-1" }.notification.actions.single().actionIntent
            first.send()
            await { manager.activeNotifications.any { it.tag == "notice-1" && it.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("Nicht bestätigt") } }
            await { androidx.work.WorkManager.getInstance(context).getWorkInfosForUniqueWork("action:notice-1").get().all { it.state.isFinished } }
            assertEquals(0, version.get())
            assertEquals(3, manager.activeNotifications.count { it.tag?.startsWith("notice-") == true })
            manager.activeNotifications.first { it.tag == "notice-1" }.notification.actions.single().actionIntent.send()
            await { version.get() == 1 && repo.state.value.pending == null && manager.activeNotifications.none { it.tag == "notice-1" } }
            assertEquals(2, manager.activeNotifications.count { it.tag?.startsWith("notice-") == true })
            await { androidx.work.WorkManager.getInstance(context).getWorkInfosForUniqueWork("action:notice-1").get().all { it.state.isFinished } }
            val previousJobs = androidx.work.WorkManager.getInstance(context).getWorkInfosForUniqueWork("action:notice-1").get().map { it.id }.toSet()
            first.send()
            await { androidx.work.WorkManager.getInstance(context).getWorkInfosForUniqueWork("action:notice-1").get().let { jobs -> jobs.any { it.id !in previousJobs } && jobs.all { it.state.isFinished } } }
            assertEquals(2, attempts.get())
        } finally {
            repo.logout()
            scheduler.clear()
            androidx.work.WorkManager.getInstance(context).cancelAllWork()
            HttpsURLConnection.setDefaultSSLSocketFactory(originalTls)
            server.shutdown()
        }
    }
    private fun await(predicate: () -> Boolean) {
        val deadline = android.os.SystemClock.elapsedRealtime() + 60_000
        while (!predicate()) {
            if (android.os.SystemClock.elapsedRealtime() > deadline) fail("Android notification/action did not reach the expected state")
            Thread.sleep(200)
        }
    }
}
