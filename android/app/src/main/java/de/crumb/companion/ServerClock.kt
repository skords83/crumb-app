package de.crumb.companion

// elapsedRealtime includes deep sleep and is unaffected by manual wall-clock changes.
class ServerClock(private val elapsed: () -> Long) {
    private var server = 0L
    private var anchor = 0L
    var synchronized = false
        private set
    fun sync(serverMillis: Long, receivedAt: Long = elapsed()) { server = serverMillis; anchor = receivedAt; synchronized = true }
    fun now(): Long = server + elapsed() - anchor
    fun age(): Long = if (synchronized) (elapsed() - anchor).coerceAtLeast(0) else Long.MAX_VALUE
}
fun countdown(due: Long?, now: Long): String {
    if (due == null) return "Zeitpunkt offen"
    val delta = due - now
    val seconds = kotlin.math.abs(delta / 1000)
    val value = "%02d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
    return if (delta < 0) "$value überfällig" else "Noch $value"
}
