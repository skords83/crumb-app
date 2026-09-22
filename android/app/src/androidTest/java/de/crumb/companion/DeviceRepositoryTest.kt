package de.crumb.companion

import android.app.AlarmManager
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceRepositoryTest {
    @Test fun realKeystoreHttpsAndOfflineConfirmation() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        SecureStore(context).clear()
        context.getSharedPreferences("snapshot", Context.MODE_PRIVATE).edit().clear().commit()
        AlarmScheduler(context).clear()
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val tlsServer = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val tlsClient = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server = MockWebServer()
        server.useHttps(tlsServer.sslSocketFactory(), false)
        server.start()
        try {
            val repo = Repository(context, CrumbApi(tlsClient.sslSocketFactory()))
            val snapshot = """{"server_time":"2026-09-22T12:00:00Z","delivery":"android","sessions":[{"id":7,"version":0,"title":"Testbrot","steps":[{"id":"7:0","globalIdx":0,"phase":"Teig","instruction":"Falten","state":"active","due_at":"2026-09-22T12:10:00Z","critical":false,"action":"complete","alarm_key":"device-test"}]}]}"""
            server.enqueue(MockResponse().setBody("""{"token":"synthetic-device-token"}"""))
            server.enqueue(MockResponse().setBody(snapshot))
            repo.login(server.url("/api").toString(), "baker@example.invalid", "synthetic-password")
            assertTrue(repo.state.value.loggedIn)
            assertEquals(1, repo.state.value.snapshot!!.sessions.size)
            assertNotNull(SecureStore(context).read())
            server.enqueue(MockResponse().setResponseCode(503))
            assertFalse(repo.act(7, 0, "7:0", "complete"))
            assertTrue(repo.state.value.message!!.startsWith("Nicht bestätigt"))
            assertEquals("active", repo.state.value.snapshot!!.tasks.single().step.state)
            server.enqueue(MockResponse().setBody("""{"version":1}"""))
            server.enqueue(MockResponse().setBody("""{"server_time":"2026-09-22T12:00:01Z","delivery":"android","sessions":[]}"""))
            assertTrue(repo.act(7, 0, "7:0", "complete"))
            assertTrue(repo.state.value.snapshot!!.sessions.isEmpty())
        } finally {
            server.shutdown()
            SecureStore(context).clear()
            AlarmScheduler(context).clear()
            context.getSharedPreferences("snapshot", Context.MODE_PRIVATE).edit().clear().commit()
            androidx.work.WorkManager.getInstance(context).cancelAllWork()
        }
    }
}
