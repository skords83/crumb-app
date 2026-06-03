// api/notification-engine.js
// ============================================================
// NOTIFICATION ENGINE — Auswertung & Versand für Bake-Sessions
//
// Idempotente Auswertung aus dem aktuellen Session-State + DB-basierte
// Dedup. Wird sowohl vom 60s-Cron als auch direkt nach jeder
// State-Transition aufgerufen, damit User-getriggerte Übergänge
// keinen 60s-Lag haben.
//
// Transport-Wrapper trennt Eval-Logik vom Versand:
//   evaluateSession → dispatch → sendNotification → ntfy (+ später web-push)
// ============================================================

const axios = require('axios');
const { flattenSteps, getPendingGates, isWaitStep, isBakeStep } = require('./bake-engine');

// ── Konfiguration ────────────────────────────────────────────
const OVERDUE_THRESHOLD_MIN = 30; // Minuten nach Timer-Ende bis "überfällig"

// ── Helpers ──────────────────────────────────────────────────
function extractTemp(instruction) {
  if (!instruction) return null;
  const match = instruction.match(/(\d{2,3})\s*°\s*C?|(\d{2,3})\s*[Gg]rad/);
  return match ? (match[1] || match[2]) : null;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function normalizeKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

// ── evaluateSession ──────────────────────────────────────────
// Liefert ALLE aktuell fälligen Notification-Kandidaten für eine Session.
// Idempotent: Mehrfachaufrufe geben identische Listen zurück (bis sich
// der State ändert). Dedup geschieht in der DB.
//
// session: { id, user_id, title, step_states, step_timestamps }
// sections: dough_sections array
// → [{ notificationId, type, title, message, priority, tags }]
function evaluateSession(session, sections) {
  if (!sections || sections.length === 0) return [];

  const states = session.step_states || {};
  const timestamps = session.step_timestamps || {};
  const recipeTitle = session.title || 'Brot';
  const sessionId = session.id;
  const candidates = [];
  const now = Date.now();

  const steps = flattenSteps(sections);

  // 1) Gate ready — Phasen, deren Dependencies done sind, aber noch locked
  const gates = getPendingGates(sections, states);
  for (const gate of gates) {
    candidates.push({
      notificationId: `bs-${sessionId}-gate-${normalizeKey(gate.phase)}`,
      type: 'gate-ready',
      title: `🔓 ${truncate(gate.phase, 40)} kann starten`,
      message: `${recipeTitle} · ${gate.dependencies.join(' + ')} fertig`,
      priority: 4,
      tags: 'unlock',
    });
  }

  // 2) Soft-Done — Warten-Steps mit abgelaufenem Timer
  //    (Steps stehen bereits auf 'soft_done' nach checkSoftDone-Lauf)
  steps.forEach(step => {
    if (states[step.globalIdx] !== 'soft_done') return;
    if (!isWaitStep(step)) return;
    candidates.push({
      notificationId: `bs-${sessionId}-softdone-${step.globalIdx}`,
      type: 'softdone',
      title: `⏱ ${truncate(step.instruction, 50)}`,
      message: `${recipeTitle} · Geplante Zeit abgelaufen — prüfe und bestätige`,
      priority: 4,
      tags: 'hourglass_done',
    });
  });

  // 3) Preheat — Backen-Steps die ready stehen (User muss Ofen vorheizen)
  steps.forEach(step => {
    if (!isBakeStep(step)) return;
    if (states[step.globalIdx] !== 'ready') return;
    const temp = extractTemp(step.instruction);
    candidates.push({
      notificationId: `bs-${sessionId}-preheat-${step.globalIdx}`,
      type: 'preheat',
      title: temp ? `🔥 Ofen auf ${temp}°C vorheizen` : `🔥 Ofen vorheizen`,
      message: `${recipeTitle} · Backen steht an`,
      priority: 5,
      tags: 'fire',
    });
  });

  // 4) Overdue — soft_done Steps, die seit > OVERDUE_THRESHOLD_MIN hängen
  steps.forEach(step => {
    if (states[step.globalIdx] !== 'soft_done') return;
    const ts = timestamps[step.globalIdx];
    if (!ts || !ts.timer_end) return;
    const minutesOverdue = (now - ts.timer_end) / 60000;
    if (minutesOverdue < OVERDUE_THRESHOLD_MIN) return;
    candidates.push({
      notificationId: `bs-${sessionId}-overdue-${step.globalIdx}`,
      type: 'overdue',
      title: `⚠️ ${truncate(step.phase, 40)} überfällig`,
      message: `${recipeTitle} · ${truncate(step.instruction, 40)} — alles okay?`,
      priority: 4,
      tags: 'warning',
    });
  });

  return candidates;
}

// ── Transport: ntfy ──────────────────────────────────────────
async function sendNtfy(title, message, tags, priority) {
  if (!process.env.NTFY_URL) return;
  try {
    const topic = process.env.NTFY_TOPIC || 'crumb-backplan';
    const baseUrl = process.env.NTFY_URL.replace(/\/$/, '');
    const shortTitle = title.length > 60
      ? title.slice(0, 60).replace(/\s+\S*$/, '') + '…'
      : title;
    const payload = JSON.stringify({
      topic,
      title: shortTitle,
      message,
      tags: [tags || 'bread'],
      priority: priority || 4,
    });
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    await axios.post(baseUrl, payload, { headers });
    console.log(`🔔 ntfy: ${shortTitle}`);
  } catch (err) {
    console.error('❌ ntfy Fehler:', err.message);
  }
}

// ── sendNotification ─────────────────────────────────────────
// Transport-Wrapper. Heute: nur ntfy. Später kommt parallel
// Web-Push pro User dazu (basierend auf push_subscriptions).
async function sendNotification(pool, userId, candidate) {
  // Heute: globales ntfy-Topic (alle User)
  await sendNtfy(candidate.title, candidate.message, candidate.tags, candidate.priority);

  // Hier später ergänzen:
  // const subs = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  // for (const sub of subs.rows) { await sendWebPush(sub, candidate); }
}

// ── dispatch ─────────────────────────────────────────────────
// Versucht atomar einen Eintrag in sent_notifications zu setzen.
// Bei Konflikt (= schon gesendet) wird nichts versendet.
// → true wenn neu gesendet, false wenn schon mal gesendet.
async function dispatch(pool, userId, sessionId, candidate) {
  if (!pool || !candidate || !candidate.notificationId) return false;
  try {
    const result = await pool.query(
      `INSERT INTO sent_notifications (user_id, session_id, notification_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, notification_id) DO NOTHING
       RETURNING id`,
      [userId, sessionId, candidate.notificationId]
    );
    if (result.rowCount === 0) return false;

    await sendNotification(pool, userId, candidate);
    return true;
  } catch (err) {
    console.error('❌ dispatch Fehler:', err.message, candidate.notificationId);
    return false;
  }
}

// ── evaluateAndDispatch ──────────────────────────────────────
// Convenience: einmal auswerten und alle Kandidaten durch dispatch jagen.
// → Anzahl der tatsächlich neu gesendeten Notifications
async function evaluateAndDispatch(pool, session, sections) {
  const candidates = evaluateSession(session, sections);
  let sent = 0;
  for (const candidate of candidates) {
    const ok = await dispatch(pool, session.user_id, session.id, candidate);
    if (ok) sent++;
  }
  return sent;
}

// ── cleanupOldNotifications ──────────────────────────────────
// TTL-Cleanup: entfernt Einträge zu beendeten Sessions (>24h) und
// sehr alte Waisen (>7 Tage). Vom Cron oder beim Boot aufrufen.
async function cleanupOldNotifications(pool) {
  if (!pool) return;
  try {
    await pool.query(`
      DELETE FROM sent_notifications sn
      USING bake_sessions bs
      WHERE sn.session_id = bs.id
        AND bs.finished_at IS NOT NULL
        AND bs.finished_at < NOW() - INTERVAL '24 hours'
    `);
    await pool.query(`
      DELETE FROM sent_notifications
      WHERE sent_at < NOW() - INTERVAL '7 days'
    `);
  } catch (err) {
    console.error('❌ cleanupOldNotifications Fehler:', err.message);
  }
}

module.exports = {
  evaluateSession,
  dispatch,
  evaluateAndDispatch,
  sendNotification,
  cleanupOldNotifications,
  extractTemp,
};
