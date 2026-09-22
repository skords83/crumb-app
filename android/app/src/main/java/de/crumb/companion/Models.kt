package de.crumb.companion

import org.json.JSONObject
import java.time.Instant

data class Step(val id: String, val index: Int, val phase: String, val instruction: String,
    val state: String, val start: Long?, val end: Long?, val due: Long?, val critical: Boolean,
    val action: String?, val alarmKey: String?) {
    val label: String get() = when (action) { "start_baking" -> "Ofen bereit · Backen starten"; "confirm_gate" -> "Phase starten"; else -> "Erledigt" }
}
data class Session(val id: Int, val version: Int, val title: String, val steps: List<Step>)
data class Snapshot(val serverTime: Long, val delivery: String, val sessions: List<Session>) {
    val tasks get() = sessions.flatMap { session -> session.steps.filter { it.action != null }.map { Task(session, it) } }
        .sortedWith(compareBy<Task> { it.step.due ?: Long.MAX_VALUE }.thenByDescending { it.step.critical }.thenBy { it.step.id })
}
data class Task(val session: Session, val step: Step)
fun JSONObject.optionalString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
fun JSONObject.time(key: String): Long? = optionalString(key)?.let { Instant.parse(it).toEpochMilli() }
fun parseSnapshot(raw: String): Snapshot {
    val root = JSONObject(raw)
    val sessions = root.getJSONArray("sessions")
    return Snapshot(root.time("server_time")!!, root.getString("delivery"), (0 until sessions.length()).map { i ->
        val session = sessions.getJSONObject(i)
        val steps = session.getJSONArray("steps")
        Session(session.getInt("id"), session.getInt("version"), session.getString("title"), (0 until steps.length()).map { j ->
            val step = steps.getJSONObject(j)
            Step(step.getString("id"), step.getInt("globalIdx"), step.getString("phase"), step.getString("instruction"),
                step.getString("state"), step.time("start") ?: step.time("scheduled_start"), step.time("end") ?: step.time("planned_end"),
                step.time("due_at"), step.getBoolean("critical"), step.optionalString("action"), step.optionalString("alarm_key"))
        })
    })
}
