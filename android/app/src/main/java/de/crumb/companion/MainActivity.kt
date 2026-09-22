package de.crumb.companion

import android.Manifest
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class CompanionViewModel(application: Application) : AndroidViewModel(application) {
    val repo = application.repository
    fun login(url: String, email: String, password: String) { viewModelScope.launch { repo.login(url, email, password) } }
    fun refresh() { viewModelScope.launch { repo.refresh() } }
    fun act(task: Task) { viewModelScope.launch { repo.act(task.session.id, task.session.version, task.step.id, task.step.action!!) } }
    fun delivery(mode: String) { viewModelScope.launch { repo.delivery(mode) } }
    fun logout() { viewModelScope.launch { repo.logout() } }
}
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) {
            repository.restoreCachedAlarms()
            while (true) { repository.refresh(); delay(30_000) }
        } }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFC4A484), onPrimary = Color(0xFF2C1A0E),
                background = Color(0xFF0D1117), surface = Color(0xFF161B22), onSurface = Color(0xFFF5F0E8))) {
                Surface(Modifier.fillMaxSize()) { CompanionScreen(this) }
            }
        }
    }
}
@Composable
private fun CompanionScreen(activity: MainActivity, vm: CompanionViewModel = viewModel()) {
    val state by vm.repo.state.collectAsStateWithLifecycle()
    var now by remember { mutableLongStateOf(vm.repo.clock.now()) }
    var selected by rememberSaveable { mutableStateOf<Int?>(null) }
    var deliveryDialog by remember { mutableStateOf(false) }
    val scheduler = remember { AlarmScheduler(activity) }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) deliveryDialog = true }
    LaunchedEffect(Unit) { while (true) { now = vm.repo.clock.now(); delay(1000) } }
    val snapshot = state.snapshot
    val stale = state.stale || vm.repo.clock.age() > 120_000
    val detail = snapshot?.sessions?.find { it.id == selected }
    BackHandler(enabled = detail != null) { selected = null }
    if (deliveryDialog) AlertDialog(onDismissRequest = { deliveryDialog = false },
        title = { Text("Backmeldungen auf Android") },
        text = { Text("Backmeldungen werden für dein gesamtes Konto im Web ausgeschaltet. Dieses Smartphone übernimmt die Alarme. Serveränderungen können im Hintergrund verzögert eintreffen. Nutze V1 nur auf einem Android-Gerät. Sauerteig-Erinnerungen bleiben im Web aktiv.") },
        confirmButton = { TextButton(onClick = { deliveryDialog = false; vm.delivery("android") }) { Text("Auf Android umstellen") } },
        dismissButton = { TextButton(onClick = { deliveryDialog = false }) { Text("Abbrechen") } })
    LazyColumn(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 20.dp)) {
        item { Text("crumb", style = MaterialTheme.typography.headlineLarge, fontFamily = FontFamily.Serif) }
        item { Text("Dein Backbegleiter", style = MaterialTheme.typography.titleLarge) }
        if (!state.loggedIn) {
            item { Login(state.loading, vm::login) }
            state.message?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        } else {
            if (state.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            state.message?.let { item { Text(it, style = MaterialTheme.typography.bodyLarge) } }
            if (stale && snapshot != null) item { Text("Daten möglicherweise veraltet. Countdowns und Alarme basieren auf dem letzten bekannten Plan.", color = Color(0xFFFFCC80)) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = vm::refresh, enabled = !state.loading && state.pending == null) { Text("Aktualisieren") }
                    TextButton(onClick = vm::logout, enabled = !state.loading && state.pending == null) { Text("Abmelden") }
                }
            }
            if (snapshot != null) {
                item { Text(if (snapshot.sessions.size == 1) "1 aktiver Backvorgang" else "${snapshot.sessions.size} aktive Backvorgänge", style = MaterialTheme.typography.titleMedium) }
                if (snapshot.delivery == "web") item {
                    Text("Backmeldungen: Web-Push")
                    Button(onClick = {
                        if (Build.VERSION.SDK_INT >= 33 && !scheduler.allowed()) permissions.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else deliveryDialog = true
                    }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Android-Benachrichtigungen einrichten") }
                } else item {
                    Text("Backmeldungen: Android")
                    if (!scheduler.allowed()) {
                        Text("Benachrichtigungen blockiert: Android kann keine Backmeldungen anzeigen.", color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)) }) { Text("Benachrichtigungen erlauben") }
                    }
                    if (!scheduler.exact()) {
                        Text("Zeitkritische Alarme können verspätet eintreffen. Für genaue Backtimer Alarmzugriff erlauben.", color = Color(0xFFFFCC80))
                        TextButton(onClick = { activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}"))) }) { Text("Genaue Backtimer erlauben") }
                    }
                    TextButton(onClick = { vm.delivery("web") }, enabled = !state.loading) { Text("Zurück zu Web-Push") }
                }
                if (snapshot.sessions.isEmpty()) item { Text("Noch kein Backvorgang aktiv. Starte deinen nächsten Backplan wie gewohnt in Crumb.") }
                if (detail == null) {
                    val tasks = snapshot.tasks
                    if (tasks.isNotEmpty()) {
                        item { Text("Nächster Arbeitsschritt", style = MaterialTheme.typography.titleLarge) }
                        item { TaskCard(tasks.first(), now, state.pending, vm::act) { selected = tasks.first().session.id } }
                        if (tasks.size > 1) item { Text("Weitere Aufgaben", style = MaterialTheme.typography.titleMedium) }
                        items(tasks.drop(1), key = { it.step.id }) { task -> TaskCard(task, now, state.pending, vm::act) { selected = task.session.id } }
                    }
                    item { Text("Alle Backvorgänge", style = MaterialTheme.typography.titleLarge) }
                    items(snapshot.sessions, key = { "session:${it.id}" }) { session ->
                        OutlinedCard(Modifier.fillMaxWidth().clickable { selected = session.id }) {
                            Column(Modifier.padding(16.dp)) {
                                Text(session.title, style = MaterialTheme.typography.titleLarge, fontFamily = FontFamily.Serif)
                                Text("${session.steps.count { it.state == "done" }} / ${session.steps.size} Schritte erledigt · Timeline öffnen")
                                if (session.steps.all { it.state == "done" }) Text("Alle Schritte fertig. Backvorgang im Web abschließen.")
                            }
                        }
                    }
                } else {
                    item { TextButton(onClick = { selected = null }) { Text("← Alle Backvorgänge") } }
                    item { Text(detail.title, style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Serif) }
                    items(detail.steps, key = { it.id }) { step ->
                        if (step.action != null) TaskCard(Task(detail, step), now, state.pending, vm::act) {}
                        else OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
                            Text(step.phase, color = MaterialTheme.colorScheme.primary)
                            Text(step.instruction)
                            Text(if (step.state == "done") "Erledigt" else "Noch gesperrt")
                            Text("${timeLabel(step.start)} – ${timeLabel(step.end)}", style = MaterialTheme.typography.bodySmall)
                        } }
                    }
                }
            }
        }
    }
}
@Composable
private fun Login(busy: Boolean, submit: (String, String, String) -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    // Password deliberately not saved across activity recreation.
    var password by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(url, { url = it }, label = { Text("HTTPS-API-Adresse inklusive /api") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("E-Mail") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Passwort") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { submit(url, email, password); password = "" }, enabled = !busy && password.isNotEmpty(), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(if (busy) "Anmelden …" else "Anmelden") }
    }
}
@Composable
private fun TaskCard(task: Task, now: Long, pending: String?, act: (Task) -> Unit, open: () -> Unit) {
    val step = task.step
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = if (step.critical) Color(0xFF392A21) else Color(0xFF161B22))) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(task.session.title, modifier = Modifier.clickable(onClick = open), style = MaterialTheme.typography.titleLarge, fontFamily = FontFamily.Serif)
            Text(step.phase + if (step.critical) " · Zeitkritisch" else "", color = MaterialTheme.colorScheme.primary)
            Text(step.instruction, style = MaterialTheme.typography.bodyLarge)
            Text(countdown(step.due, now), style = MaterialTheme.typography.titleLarge, fontFamily = FontFamily.Monospace)
            Text("${timeLabel(step.start)} – ${timeLabel(step.end)}", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { act(task) }, enabled = pending == null, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text(if (pending == step.id) "Wird übertragen …" else step.label)
            }
        }
    }
}
private fun timeLabel(value: Long?): String = value?.let { DateTimeFormatter.ofPattern("dd.MM. HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(it)) } ?: "offen"
