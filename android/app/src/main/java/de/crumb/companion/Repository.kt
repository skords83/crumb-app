package de.crumb.companion

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class AppState(val loggedIn: Boolean = false, val snapshot: Snapshot? = null,
    val loading: Boolean = false, val pending: String? = null, val message: String? = null,
    val stale: Boolean = true, val sessionExpiresAt: String? = null)
class CrumbApp : Application() {
    val repository by lazy { Repository(this) }
    override fun onCreate() { super.onCreate(); AlarmScheduler(this).channels() }
}
val Context.repository: Repository get() = (applicationContext as CrumbApp).repository

class Repository(private val context: Context,
    private val api: CompanionApi = CrumbApi(),
    private val credentials: CredentialStore = SecureStore(context)) {
    private val cache = context.getSharedPreferences("snapshot", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    val clock = ServerClock(SystemClock::elapsedRealtime)
    private val mutable = MutableStateFlow(AppState(loggedIn = credentials.read() != null, sessionExpiresAt = credentials.sessionExpiresAt()))
    val state = mutable.asStateFlow()
    init {
        runCatching {
            val raw = cache.getString("json", null) ?: return@runCatching
            if (credentials.read() == null) return@runCatching
            val data = parseSnapshot(raw)
            val sameBoot = cache.getInt("boot", -1) == bootCount()
            val age = if (sameBoot) SystemClock.elapsedRealtime() - cache.getLong("elapsed", SystemClock.elapsedRealtime())
                else System.currentTimeMillis() - cache.getLong("wall", System.currentTimeMillis())
            clock.sync(data.serverTime + age.coerceAtLeast(0))
            mutable.value = mutable.value.copy(snapshot = data)
        }
    }
    private fun bootCount() = android.provider.Settings.Global.getInt(context.contentResolver, android.provider.Settings.Global.BOOT_COUNT, -2)
    val generation: String get() = cache.getString("generation", "").orEmpty()
    private fun auth(): Pair<String, String> = credentials.read() ?: throw ApiException(401, "Bitte anmelden.")
    // Called only while holding the repository mutex. A 401 from auth middleware means
    // the rejected action was not executed; network errors and conflicts are never replayed.
    private fun request(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): String {
        val (url, token) = auth()
        try { return api.request(url, path, token, body, method) }
        catch (e: ApiException) {
            if (e.status != 401) throw e
            val refresh = credentials.refreshToken() ?: throw e
            val renewed = JSONObject(api.request(url, "/auth/mobile/refresh", body = JSONObject().put("refreshToken", refresh)))
            val next = renewed.getString("token")
            credentials.saveSession(url, next, refresh, renewed.optionalString("sessionExpiresAt"))
            mutable.value = mutable.value.copy(sessionExpiresAt = renewed.optionalString("sessionExpiresAt"))
            return api.request(url, path, next, body, method)
        }
    }
    suspend fun login(url: String, email: String, password: String) = withContext(Dispatchers.IO) { mutex.withLock {
        mutable.value = mutable.value.copy(loading = true, message = null)
        var authenticated = false
        try {
            val base = api.validateUrl(url)
            val response = JSONObject(api.request(base, "/auth/login", body = JSONObject().put("email", email).put("password", password).put("client", "android")))
            AlarmScheduler(context).clear()
            cache.edit().clear().commit()
            credentials.saveSession(base, response.getString("token"), response.optionalString("refreshToken"), response.optionalString("sessionExpiresAt"))
            cache.edit().putString("generation", java.util.UUID.randomUUID().toString()).commit()
            mutable.value = AppState(loggedIn = true, loading = true, sessionExpiresAt = response.optionalString("sessionExpiresAt"))
            authenticated = true
            scheduleSync(context)
            refreshLocked()
        } catch (e: Exception) {
            if (!authenticated && e is ApiException && e.status == 401) mutable.value = mutable.value.copy(message = "Anmeldung fehlgeschlagen. E-Mail und Passwort prüfen.")
            else fail(e)
        }
        finally { mutable.value = mutable.value.copy(loading = false) }
    } }
    private fun refreshLocked() {
        val raw = request("/bake-sessions/companion")
        val data = parseSnapshot(raw)
        clock.sync(data.serverTime)
        check(cache.edit().putString("json", raw).putLong("wall", System.currentTimeMillis()).putLong("elapsed", SystemClock.elapsedRealtime()).putInt("boot", bootCount()).commit())
        mutable.value = mutable.value.copy(snapshot = data, stale = false, loggedIn = true)
        AlarmScheduler(context).reconcile(data, clock.now())
    }
    suspend fun restoreCachedAlarms() = withContext(Dispatchers.IO) { mutex.withLock {
        // Force-stop removes OS alarms; reopening offline must still restore the last known plan.
        mutable.value.snapshot?.let { AlarmScheduler(context).reconcile(it, clock.now()) }
    } }
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) { mutex.withLock {
        if (!mutable.value.loggedIn) return@withLock false
        mutable.value = mutable.value.copy(loading = true)
        try { refreshLocked(); mutable.value = mutable.value.copy(message = null); true } catch (e: Exception) { fail(e); false }
        finally { mutable.value = mutable.value.copy(loading = false) }
    } }
    suspend fun act(sessionId: Int, version: Int, stepId: String, action: String, expectedGeneration: String = generation): Boolean = withContext(Dispatchers.IO) { mutex.withLock {
        mutable.value = mutable.value.copy(pending = stepId, message = "Bestätigung wird übertragen …")
        try {
            if (expectedGeneration != generation) throw ApiException(409, "Anmeldung geändert. Alte Aktion verworfen.")
            val task = mutable.value.snapshot?.tasks?.find { it.session.id == sessionId && it.step.id == stepId }
                ?: throw ApiException(409, "Diese Aufgabe ist nicht mehr aktuell. Bitte aktualisieren.")
            if (task.session.version != version || task.step.action != action) throw ApiException(409, "Backplan geändert. Bitte erneut prüfen.")
            request("/bake-sessions/$sessionId/transition", JSONObject()
                .put("expectedVersion", version).put("stepIndex", task.step.index).put("action", action).put("phase", task.step.phase))
            // Only a successful server response permits removing the completed reminder.
            AlarmScheduler(context).acknowledge(task.step)
            mutable.value = mutable.value.copy(message = "Bestätigung vom Server angenommen.", stale = true)
            try { refreshLocked() } catch (e: Exception) { fail(e, "Bestätigt; aktueller Backplan noch nicht geladen. ") }
            true
        } catch (e: Exception) {
            fail(e, "Nicht bestätigt. ")
            // Read-only reconciliation; never replay with a newer version.
            if (e is ApiException && e.status == 409) runCatching { refreshLocked() }
            false
        } finally { mutable.value = mutable.value.copy(pending = null) }
    } }
    private fun persistDelivery(mode: String) {
        // A confirmed delivery switch must survive a failed follow-up GET and process death.
        cache.getString("json", null)?.let { raw ->
            check(cache.edit().putString("json", JSONObject(raw).put("delivery", mode).toString()).commit())
        }
        mutable.value.snapshot?.let { previous ->
            val changed = previous.copy(delivery = mode)
            mutable.value = mutable.value.copy(snapshot = changed)
            AlarmScheduler(context).reconcile(changed, clock.now())
        }
        if (mode == "web") AlarmScheduler(context).clear()
    }
    suspend fun delivery(mode: String) = withContext(Dispatchers.IO) { mutex.withLock {
        mutable.value = mutable.value.copy(loading = true)
        try {
            request("/bake-sessions/companion/delivery", JSONObject().put("delivery", mode), "PUT")
            persistDelivery(mode)
            refreshLocked()
            mutable.value = mutable.value.copy(message = if (mode == "android") "Backmeldungen für dieses Konto auf Android umgestellt." else "Backmeldungen wieder über Web-Push.")
        } catch (e: Exception) { fail(e) }
        finally { mutable.value = mutable.value.copy(loading = false) }
    } }
    suspend fun logout() = withContext(Dispatchers.IO) { mutex.withLock {
        // Restore web delivery before removing credentials. If offline, retain login so user can retry.
        try {
            request("/bake-sessions/companion/delivery", JSONObject().put("delivery", "web"), "PUT")
            persistDelivery("web")
            if (credentials.refreshToken() != null) request("/auth/mobile/logout", JSONObject())
            clearLocal()
        } catch (e: Exception) { fail(e, "Abmeldung nicht abgeschlossen. ") }
    } }
    private fun clearLocal() {
        AlarmScheduler(context).clear(); credentials.clear(); cache.edit().clear().commit()
        WorkManager.getInstance(context).cancelUniqueWork("sync")
        mutable.value = AppState()
    }
    private fun fail(e: Exception, prefix: String = "") {
        if (e is kotlinx.coroutines.CancellationException) throw e
        if (e is ApiException && e.status == 401) {
            clearLocal()
            mutable.value = mutable.value.copy(message = "Anmeldung abgelaufen. Erneut anmelden; die serverseitige Zustellwahl bleibt bestehen.")
        } else mutable.value = mutable.value.copy(stale = true, message = prefix + (if (e is ApiException || e is IllegalArgumentException) e.message else "Server nicht erreichbar. Letzter Stand bleibt sichtbar."))
    }
}
fun scheduleSync(context: Context) {
    WorkManager.getInstance(context).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
}
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (applicationContext.repository.refresh()) Result.success() else Result.retry()
}
