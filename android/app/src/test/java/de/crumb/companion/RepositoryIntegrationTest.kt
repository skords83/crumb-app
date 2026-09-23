package de.crumb.companion

import android.app.AlarmManager
import android.content.Context
import androidx.work.Configuration
import androidx.work.WorkManager
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

// Real HTTPS requests against a loopback server. Production certificate checks remain unchanged.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class RepositoryIntegrationTest {
    private lateinit var context: Context
    private lateinit var server: MockWebServer
    private lateinit var api: CrumbApi
    private lateinit var credentials: MemoryCredentials
    private lateinit var repo: Repository
    private lateinit var base: String
    private class MemoryCredentials : CredentialStore {
        var value: Pair<String, String>? = null
        override fun read() = value
        override fun save(url: String, token: String) { value = url to token }
        var refresh: String? = null
        var expires: String? = null
        override fun refreshToken() = refresh
        override fun sessionExpiresAt() = expires
        override fun saveSession(url: String, token: String, refresh: String?, expires: String?) {
            save(url, token); this.refresh = refresh; this.expires = expires
        }
        override fun clear() { value = null; refresh = null; expires = null }
    }
    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("snapshot", Context.MODE_PRIVATE).edit().clear().commit()
        AlarmScheduler(context).clear()
        runCatching { WorkManager.getInstance(context) }.onFailure {
            WorkManager.initialize(context, Configuration.Builder().build())
        }
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server = MockWebServer().apply { useHttps(serverTls.sslSocketFactory(), false); start() }
        base = server.url("/api").toString()
        api = CrumbApi(clientTls.sslSocketFactory())
        credentials = MemoryCredentials()
        repo = Repository(context, api, credentials)
    }
    @After fun teardown() { server.shutdown() }
    private fun json(body: String, status: Int = 200) = MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)
    private fun snapshot(version: Int = 0, done: Boolean = false, delivery: String = "android") = """
        {"server_time":"2026-09-22T12:00:00Z","delivery":"$delivery","sessions":[
          {"id":7,"version":$version,"title":"Testbrot","steps":[
            {"id":"7:0","globalIdx":0,"phase":"Teig","instruction":"Falten","state":"${if (done) "done" else "active"}",
             "start":"2026-09-22T12:00:00Z","end":"2026-09-22T12:10:00Z","due_at":"2026-09-22T12:10:00Z",
             "critical":true,"action":${if (done) "null" else "\"complete\""},"alarm_key":${if (done) "null" else "\"test-alarm\""}}]}]}
    """.trimIndent()
    private suspend fun login() {
        server.enqueue(json("""{"token":"synthetic-test-token"}"""))
        server.enqueue(json(snapshot()))
        repo.login(base, "baker@example.invalid", "synthetic-password")
        assertTrue(repo.state.value.loggedIn)
        assertNotNull(repo.state.value.snapshot)
    }
    private fun alarmCount() = shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms.count { shadowOf(it.operation).savedIntent.action != TIMER_REFRESH_ACTION }
    private fun requests() = (0 until server.requestCount).map { server.takeRequest(1, TimeUnit.SECONDS)!! }

    @Test fun loginUsesHttpsAndSubsequentRequestsCarryOnlyBearerToken() = runBlocking {
        login()
        val requests = requests()
        assertEquals("/api/auth/login", requests[0].path)
        assertNull(requests[0].getHeader("Authorization"))
        assertEquals("synthetic-password", JSONObject(requests[0].body.readUtf8()).getString("password"))
        assertEquals("Bearer synthetic-test-token", requests[1].getHeader("Authorization"))
        assertEquals("", requests[1].body.readUtf8())
        assertFalse(repo.state.value.stale)
    }
    @Test fun successfulLoginStillSchedulesRecoveryWhenInitialSnapshotFails() = runBlocking {
        server.enqueue(json("""{"token":"synthetic-test-token"}"""))
        server.enqueue(json("{}", 503))
        repo.login(base, "baker@example.invalid", "synthetic-password")
        assertTrue(repo.state.value.loggedIn)
        assertTrue(repo.state.value.stale)
        assertNull(repo.state.value.snapshot)
        assertEquals(1, WorkManager.getInstance(context).getWorkInfosForUniqueWork("sync").get(5, TimeUnit.SECONDS).size)
    }
    @Test fun failedConfirmationDoesNotCompleteOrCancelReminder() = runBlocking {
        login()
        server.enqueue(json("{}", 503))
        assertFalse(repo.act(7, 0, "7:0", "complete"))
        assertEquals("active", repo.state.value.snapshot!!.sessions.single().steps.single().state)
        assertTrue(repo.state.value.message!!.startsWith("Nicht bestätigt"))
        assertNull(repo.state.value.pending)
        assertEquals(1, alarmCount())
        assertEquals(3, server.requestCount)
    }
    @Test fun acceptedConfirmationIsNotRearmedWhenFollowupReadFails() = runBlocking {
        login()
        server.enqueue(json("""{"version":1}"""))
        server.enqueue(json("{}", 503))
        assertTrue(repo.act(7, 0, "7:0", "complete"))
        assertTrue(repo.state.value.message!!.startsWith("Bestätigt;"))
        assertEquals(0, alarmCount())
        val restarted = Repository(context, api, credentials)
        AlarmScheduler(context).reconcile(restarted.state.value.snapshot!!, restarted.clock.now())
        assertEquals(0, alarmCount())
    }
    @Test fun conflictReloadsStateWithoutReplayingTheAction() = runBlocking {
        login()
        server.enqueue(json("{}", 409))
        server.enqueue(json(snapshot(1, done = true)))
        assertFalse(repo.act(7, 0, "7:0", "complete"))
        assertTrue(repo.state.value.snapshot!!.tasks.isEmpty())
        assertEquals(0, alarmCount())
        assertEquals(listOf("POST", "GET", "POST", "GET"), requests().map { it.method })
    }
    @Test fun expiredAuthenticationClearsCredentialsCacheAndAlarms() = runBlocking {
        login()
        server.enqueue(json("{}", 401))
        assertFalse(repo.refresh())
        assertFalse(repo.state.value.loggedIn)
        assertNull(repo.state.value.snapshot)
        assertNull(credentials.read())
        assertEquals(0, alarmCount())
        assertTrue(context.getSharedPreferences("snapshot", Context.MODE_PRIVATE).all.isEmpty())
    }
    @Test fun acceptedWebDeliverySurvivesReadFailureAndRestart() = runBlocking {
        login()
        server.enqueue(json("""{"delivery":"web"}"""))
        server.enqueue(json("{}", 503))
        repo.delivery("web")
        assertEquals("web", repo.state.value.snapshot!!.delivery)
        val restarted = Repository(context, api, credentials)
        assertEquals("web", restarted.state.value.snapshot!!.delivery)
        AlarmScheduler(context).reconcile(restarted.state.value.snapshot!!, restarted.clock.now())
        assertEquals(0, alarmCount())
    }
    @Test fun successfulRecoveryRemovesOldNetworkFailureMessage() = runBlocking {
        login()
        server.enqueue(json("{}", 503)); assertFalse(repo.refresh())
        assertNotNull(repo.state.value.message)
        server.enqueue(json(snapshot())); assertTrue(repo.refresh())
        assertNull(repo.state.value.message)
        assertFalse(repo.state.value.stale)
    }
    @Test fun oldLoginGenerationCannotSubmitAMutation() = runBlocking {
        login()
        server.enqueue(json(snapshot()))
        assertFalse(repo.act(7, 0, "7:0", "complete", "previous-login"))
        assertEquals(listOf("POST", "GET", "GET"), requests().map { it.method })
    }
    @Test fun concurrentTapsSubmitOnlyOneConfirmation() = runBlocking {
        login()
        server.enqueue(json("""{"version":1}"""))
        server.enqueue(json(snapshot(1, done = true)))
        server.enqueue(json(snapshot(1, done = true)))
        val first = async { repo.act(7, 0, "7:0", "complete") }
        val second = async { repo.act(7, 0, "7:0", "complete") }
        assertEquals(listOf(false, true), listOf(first.await(), second.await()).sorted())
        assertEquals(1, requests().count { it.path == "/api/bake-sessions/7/transition" })
    }
    @Test fun incorrectPasswordIsNotReportedAsAnExpiredSession() = runBlocking {
        server.enqueue(json("{}", 401))
        repo.login(base, "baker@example.invalid", "wrong-synthetic-password")
        assertFalse(repo.state.value.loggedIn)
        assertNull(credentials.read())
        assertEquals("Anmeldung fehlgeschlagen. E-Mail und Passwort prüfen.", repo.state.value.message)
    }
    @Test fun lostResponseAfterCommitNeverAdvancesTwice() = runBlocking {
        login()
        var committed = false
        var commits = 0
        val submittedVersions = mutableListOf<Int>()
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
                if (request.path == "/api/bake-sessions/7/transition") {
                    submittedVersions.add(JSONObject(request.body.readUtf8()).getInt("expectedVersion"))
                    if (committed) return json("{}", 409)
                    committed = true; commits++
                    return MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST)
                }
                return json(snapshot(1, done = true))
            }
        }
        assertFalse(repo.act(7, 0, "7:0", "complete"))
        assertTrue(repo.refresh())
        assertTrue(repo.state.value.snapshot!!.tasks.isEmpty())
        assertEquals(1, commits)
        assertTrue(submittedVersions.isNotEmpty())
        assertTrue(submittedVersions.all { it == 0 })
    }
    @Test fun expiredAccessTokenRenewsWithoutPasswordAndRetriesOriginalVersion() = runBlocking {
        login()
        credentials.refresh = "synthetic-refresh"
        server.enqueue(json("{}", 401))
        server.enqueue(json("""{"token":"renewed-access","sessionExpiresAt":"2026-10-22T12:00:00Z"}"""))
        server.enqueue(json("""{"version":1}"""))
        server.enqueue(json(snapshot(1, done = true)))
        assertTrue(repo.act(7, 0, "7:0", "complete"))
        val sent = requests()
        assertEquals("/api/auth/mobile/refresh", sent[3].path)
        assertNull(sent[3].getHeader("Authorization"))
        val body = JSONObject(sent[3].body.readUtf8())
        assertEquals("synthetic-refresh", body.getString("refreshToken"))
        assertFalse(body.has("password"))
        assertEquals("Bearer renewed-access", sent[4].getHeader("Authorization"))
        assertEquals(0, JSONObject(sent[4].body.readUtf8()).getInt("expectedVersion"))
        assertEquals("renewed-access", credentials.read()!!.second)
        assertEquals("synthetic-refresh", credentials.refreshToken())
    }
    @Test fun renewalNetworkFailureKeepsCredentialsAndLastPlanForRecovery() = runBlocking {
        login(); credentials.refresh = "synthetic-refresh"
        server.enqueue(json("{}", 401)); server.enqueue(json("{}", 503))
        assertFalse(repo.refresh())
        assertTrue(repo.state.value.loggedIn)
        assertNotNull(repo.state.value.snapshot)
        assertEquals("synthetic-refresh", credentials.refreshToken())
        assertTrue(repo.state.value.stale)
        assertEquals(4, server.requestCount)
    }
    @Test fun revokedRefreshSessionClearsLocalAlarmsAndNeverRetriesAction() = runBlocking {
        login(); credentials.refresh = "synthetic-refresh"
        server.enqueue(json("{}", 401)); server.enqueue(json("{}", 401))
        assertFalse(repo.act(7, 0, "7:0", "complete"))
        assertFalse(repo.state.value.loggedIn)
        assertNull(credentials.refreshToken())
        assertEquals(0, alarmCount())
        assertEquals(1, requests().count { it.path == "/api/bake-sessions/7/transition" })
    }
    @Test fun failedSessionRevocationKeepsAcceptedWebDeliveryAfterRestart() = runBlocking {
        login(); credentials.refresh = "synthetic-refresh"
        server.enqueue(json("""{"delivery":"web"}""")); server.enqueue(json("{}", 503))
        repo.logout()
        assertTrue(repo.state.value.loggedIn)
        assertEquals("web", repo.state.value.snapshot!!.delivery)
        assertEquals(0, alarmCount())
        assertEquals("web", Repository(context, api, credentials).state.value.snapshot!!.delivery)
        server.enqueue(json("""{"delivery":"web"}""")); server.enqueue(json("""{"ok":true}"""))
        repo.logout()
        assertFalse(repo.state.value.loggedIn)
        assertNull(credentials.refreshToken())
    }
    @Test fun redirectIsRejectedWithoutForwardingCredentials() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://example.invalid/stolen"))
        val error = runCatching { api.request(base, "/bake-sessions/companion", "synthetic-test-token") }.exceptionOrNull()
        assertTrue(error is ApiException && error.status == 302)
        assertEquals(1, server.requestCount)
    }
    @Test fun untrustedTlsCertificateIsRejected() {
        val error = runCatching { CrumbApi().request(base, "/bake-sessions/companion", "synthetic-test-token") }.exceptionOrNull()
        assertTrue(error is javax.net.ssl.SSLHandshakeException)
        assertEquals(0, server.requestCount)
    }
}
