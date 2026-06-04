// api/notification-engine.js
// ============================================================
// NOTIFICATION ENGINE — Auswertung & Versand für Bake-Sessions
//
// State-driven Trigger mit User-Settings und adaptiver Vorlauf-Logik.
// Idempotente Auswertung aus dem aktuellen Session-State + DB-basierte
// Dedup. Wird sowohl vom 60s-Cron als auch direkt nach jeder
// State-Transition aufgerufen, damit User-getriggerte Übergänge
// keinen 60s-Lag haben.
//
// Transport-Wrapper trennt Eval-Logik vom Versand:
//   evaluateSession → dispatch → sendNotification → web-push
//
// Trigger-Typen:
//   - 'gate-ready'  Phase-Gate bereit (Toggle: step_ready_enabled)
//   - 'step-ready'  Wait-Step Heads-Up mit adaptivem Vorlauf
//                   (Toggle: step_ready_enabled, Slider: step_ready_vorlauf_min)
//   - 'preheat'     Ofen vorheizen mit adaptivem Vorlauf
//                   (Toggle: preheat_enabled, Slider: preheat_vorlauf_min)
//   - 'bake-done'   Backtimer abgelaufen (Toggle: bake_done_enabled)
//   - 'plan-done'   Alle Steps done (Toggle: plan_done_enabled)
//   - 'overdue'     Safety-Net, immer aktiv (>30 Min soft_done)
// ============================================================

const webpush = require('web-push');
const { flattenSteps, getPendingGates, isWaitStep, isBakeStep } = require('./bake-engine');
const { getSettings, isInQuietHours, DEFAULT_SETTINGS } = require('./notification-settings');

// ── Konfiguration ────────────────────────────────────────────
const OVERDUE_THRESHOLD_MIN = 30; // Minuten nach Timer-Ende bis "überfällig"

// ── VAPID-Setup für Web Push ─────────────────────────────────
// Wird einmalig beim Boot aus index.js aufgerufen.
let webPushEnabled = false;
function initWebPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY fehlen — Web Push deaktiviert');
    webPushEnabled = false;
    return false;
  }
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@crumb.local',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    webPushEnabled = true;
    console.log('✅ Web Push konfiguriert');
    return true;
  } catch (err) {
    console.error('❌ Web Push Init Fehler:', err.message);
    webPushEnabled = false;
    return false;
  }
}

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

// ── previousStepInPhase ─────────────────────────────────────
// Findet den unmittelbar vorherigen Step in derselben Phase.
// null wenn step der erste seiner Phase ist.
function previousStepInPhase(allSteps, step) {
  const phaseSteps = allSteps.filter(s => s.phase === step.phase);
  const idx = phaseSteps.findIndex(s => s.globalIdx === step.globalIdx);
  return idx > 0 ? phaseSteps[idx - 1] : null;
}

// ── evaluateSession ──────────────────────────────────────────
// Liefert ALLE aktuell fälligen Notification-Kandidaten für eine Session
// basierend auf State + User-Settings. Idempotent: Mehrfachaufrufe geben
// identische Listen zurück (bis sich State oder Settings ändern).
// Dedup geschieht in der DB.
//
// session:  { id, user_id, title, step_states, step_timestamps }
// sections: dough_sections array
// settings: Objekt aus notification-settings.getSettings()
// → [{ notificationId, type, title, message, priority, tags }]
function evaluateSession(session, sections, settings = DEFAULT_SETTINGS) {
  if (!sections || sections.length === 0) return [];
  if (!settings || !settings.master_enabled) return [];

  const states = session.step_states || {};
  const timestamps = session.step_timestamps || {};
  const recipeTitle = session.title || 'Brot';
  const sessionId = session.id;
  const candidates = [];
  const now = Date.now();

  const steps = flattenSteps(sections);

  // ────────────────────────────────────────────────────────────
  // 1) Gate-Ready + Step-Ready (Toggle: step_ready_enabled)
  // ────────────────────────────────────────────────────────────
  if (settings.step_ready_enabled) {
    // 1a) Gate-Ready — Phasen, deren Dependencies done sind, noch locked
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

    // 1b) Step-Ready — Wait-Steps mit adaptivem Heads-Up
    //
    // Adaptive Vorlauf-Logik:
    //   - timer_end = Zeitpunkt an dem die Wartephase planmäßig endet
    //   - started_at = Beginn der Wartephase
    //   - vorlauf = User-Setting in Minuten
    //
    //   fireAt = max(started_at, timer_end - vorlauf*60s)
    //
    //   → Bei langen Wartephasen feuert die Notification "vorlauf" Min vor Ende
    //   → Bei kurzen Wartephasen (< vorlauf) feuert sie am Anfang der Wartephase
    //     (nicht in einer vorherigen aktiven Phase)
    //   → Bei vorlauf=0 entspricht es exakt timer_end (= alter softdone-Trigger)
    const vorlaufMs = Math.max(0, Number(settings.step_ready_vorlauf_min) || 0) * 60000;

    steps.forEach(step => {
      const state = states[step.globalIdx];
      if (state !== 'active' && state !== 'soft_done') return;
      if (!isWaitStep(step)) return;

      const ts = timestamps[step.globalIdx];
      if (!ts || !ts.timer_end) return;

      const startedAt = ts.started_at || ts.timer_end;
      const fireAt = Math.max(startedAt, ts.timer_end - vorlaufMs);
      if (now < fireAt) return;

      candidates.push({
        notificationId: `bs-${sessionId}-stepready-${step.globalIdx}`,
        type: 'step-ready',
        title: `⏱ Nächster Schritt: ${truncate(step.phase, 30)}`,
        message: `${recipeTitle} · ${truncate(step.instruction, 45)}`,
        priority: 4,
        tags: 'bell',
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // 2) Preheat (Toggle: preheat_enabled, Slider: preheat_vorlauf_min)
  // ────────────────────────────────────────────────────────────
  // Feuert bevor ein Bake-Step beginnt:
  //   - Wenn Bake-Step bereits 'ready' ist → sofort (User soll JETZT vorheizen)
  //   - Wenn Bake-Step noch 'locked' und der unmittelbar vorherige Step ist
  //     ein laufender Warte-Step mit timer_end → fire bei max(start, timer_end - vorlauf)
  // Vorgehen identisch zur Step-Ready-Adaption, nur basierend auf dem
  // VORHERIGEN Wait-Step relativ zum Bake-Step.
  if (settings.preheat_enabled) {
    const preVorlaufMs = Math.max(0, Number(settings.preheat_vorlauf_min) || 0) * 60000;

    steps.forEach(step => {
      if (!isBakeStep(step)) return;
      const state = states[step.globalIdx];

      let shouldFire = false;

      if (state === 'ready') {
        shouldFire = true;
      } else if (state === 'locked') {
        const prev = previousStepInPhase(steps, step);
        if (prev && (states[prev.globalIdx] === 'active' || states[prev.globalIdx] === 'soft_done')) {
          const prevTs = timestamps[prev.globalIdx];
          if (prevTs && prevTs.timer_end) {
            const prevStart = prevTs.started_at || prevTs.timer_end;
            const fireAt = Math.max(prevStart, prevTs.timer_end - preVorlaufMs);
            if (now >= fireAt) shouldFire = true;
          }
        }
      }

      if (!shouldFire) return;

      const temp = extractTemp(step.instruction);
      candidates.push({
        notificationId: `bs-${sessionId}-preheat-${step.globalIdx}`,
        type: 'preheat',
        title: temp ? `🔥 Ofen auf ${temp}°C vorheizen` : `🔥 Ofen vorheizen`,
        message: `${recipeTitle} · Backen steht bald an`,
        priority: 5,
        tags: 'fire',
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // 3) Bake-Done (Toggle: bake_done_enabled)
  // ────────────────────────────────────────────────────────────
  // Backstep hat eigenen Timer (timer_end gesetzt beim start_baking).
  // bake-engine flippt Backstep NICHT auto auf soft_done — wir prüfen
  // also direkt now >= timer_end bei state 'active'.
  if (settings.bake_done_enabled) {
    steps.forEach(step => {
      if (!isBakeStep(step)) return;
      const state = states[step.globalIdx];
      if (state !== 'active' && state !== 'soft_done') return;

      const ts = timestamps[step.globalIdx];
      if (!ts || !ts.timer_end) return;
      if (now < ts.timer_end) return;

      candidates.push({
        notificationId: `bs-${sessionId}-bakedone-${step.globalIdx}`,
        type: 'bake-done',
        title: `✅ Backen fertig`,
        message: `${recipeTitle} · ${truncate(step.instruction, 50)}`,
        priority: 5,
        tags: 'bread',
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // 4) Plan-Done (Toggle: plan_done_enabled)
  // ────────────────────────────────────────────────────────────
  if (settings.plan_done_enabled && steps.length > 0) {
    const allDone = steps.every(s => states[s.globalIdx] === 'done');
    if (allDone) {
      candidates.push({
        notificationId: `bs-${sessionId}-plandone`,
        type: 'plan-done',
        title: `🎉 Backplan abgeschlossen`,
        message: `${recipeTitle} · Alle Schritte erledigt`,
        priority: 4,
        tags: 'tada',
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  // 5) Overdue (Safety-Net, immer aktiv)
  // ────────────────────────────────────────────────────────────
  // Greift wenn Step-Ready bspw. durch Quiet-Hours unterdrückt wurde
  // und der Step jetzt > 30 Min in soft_done hängt.
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

// ── Transport: Web Push (per User) ───────────────────────────
// Iteriert über alle Subscriptions des Users und sendet die Notification.
// Bei expired Subscriptions (404/410): automatisches Cleanup in der DB.
async function sendWebPushToUser(poolRef, userId, candidate) {
  if (!webPushEnabled || !poolRef || !userId) return;
  try {
    const subs = await poolRef.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    if (subs.rows.length === 0) return;

    const payload = JSON.stringify({
      title: candidate.title,
      body: candidate.message,
      tag: candidate.notificationId,
      url: '/backplan',
      type: candidate.type,
    });

    for (const sub of subs.rows) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 3600 });
        poolRef.query(
          'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1',
          [sub.id]
        ).catch(() => {});
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await poolRef.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
          console.log(`🗑  Push-Sub abgelaufen (${err.statusCode}), gelöscht: id=${sub.id}`);
        } else {
          console.error(`❌ Web-Push Fehler (${err.statusCode || 'no-status'}):`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ sendWebPushToUser Fehler:', err.message);
  }
}

// ── sendNotification ─────────────────────────────────────────
// Transport-Wrapper. Sendet via Web Push (per User).
// Bypasst Settings/Quiet-Hours — wird vom Test-Endpoint und
// von dispatch() (nach erfolgreichem Insert in sent_notifications) aufgerufen.
async function sendNotification(poolRef, userId, candidate) {
  await sendWebPushToUser(poolRef, userId, candidate);
}

// ── dispatch ─────────────────────────────────────────────────
// Versucht atomar einen Eintrag in sent_notifications zu setzen.
// Bei Konflikt (= schon gesendet) wird nichts versendet.
// → true wenn neu gesendet, false wenn schon mal gesendet.
async function dispatch(poolRef, userId, sessionId, candidate) {
  if (!poolRef || !candidate || !candidate.notificationId) return false;
  try {
    const result = await poolRef.query(
      `INSERT INTO sent_notifications (user_id, session_id, notification_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, notification_id) DO NOTHING
       RETURNING id`,
      [userId, sessionId, candidate.notificationId]
    );
    if (result.rowCount === 0) return false;

    await sendNotification(poolRef, userId, candidate);
    return true;
  } catch (err) {
    console.error('❌ dispatch Fehler:', err.message, candidate.notificationId);
    return false;
  }
}

// ── evaluateAndDispatch ──────────────────────────────────────
// Liest Settings → wertet Session aus → versendet via Dispatch.
// Quiet-Hours: kein Insert in sent_notifications, sodass nach Ende
// der Ruhezeit die noch fälligen Kandidaten erneut evaluiert und
// versendet werden.
// → Anzahl der tatsächlich neu gesendeten Notifications
async function evaluateAndDispatch(pool, session, sections) {
  const settings = await getSettings(pool, session.user_id);
  if (!settings.master_enabled) return 0;
  if (isInQuietHours(settings)) return 0;

  const candidates = evaluateSession(session, sections, settings);
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
  initWebPush,
};