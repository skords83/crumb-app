// api/notification-settings.js
// ============================================================
// NOTIFICATION SETTINGS — User-Präferenzen für Push-Trigger
//
// Tabelle: user_notification_settings (1 Zeile pro User).
// Wird von notification-engine.js gelesen, vom Settings-UI im
// Frontend gepflegt.
// ============================================================
const express = require('express');
const router = express.Router();

let pool;
function setPool(p) { pool = p; }

// ── Default-Settings ─────────────────────────────────────────
// Wird verwendet, wenn ein User noch keinen DB-Eintrag hat
// (z.B. Bestandskunden vor diesem Release).
const DEFAULT_SETTINGS = Object.freeze({
  master_enabled: true,
  step_ready_enabled: true,
  step_ready_vorlauf_min: 5,
  preheat_enabled: true,
  preheat_vorlauf_min: 45,
  bake_done_enabled: true,
  plan_done_enabled: true,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
});

// ── normalizeTime ────────────────────────────────────────────
// pg liefert TIME als "HH:MM:SS" → schneidet auf "HH:MM".
function normalizeTime(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') return v.slice(0, 5);
  // pg-types kann TIME ggf. als Objekt liefern — defensiv casten
  try {
    const s = String(v);
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  } catch (_) {}
  return fallback;
}

// ── validateTime ─────────────────────────────────────────────
// Akzeptiert "H:MM" oder "HH:MM", lehnt alles andere ab.
function validateTime(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ── getSettings ──────────────────────────────────────────────
// Liest Settings für einen User. Gibt Default-Settings zurück
// wenn kein Eintrag existiert (kein Fehlerfall).
async function getSettings(poolRef, userId) {
  const p = poolRef || pool;
  if (!p || !userId) return { ...DEFAULT_SETTINGS };
  try {
    const result = await p.query(
      `SELECT master_enabled, step_ready_enabled, step_ready_vorlauf_min,
              preheat_enabled, preheat_vorlauf_min,
              bake_done_enabled, plan_done_enabled,
              quiet_enabled, quiet_start, quiet_end
       FROM user_notification_settings WHERE user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return { ...DEFAULT_SETTINGS };
    const row = result.rows[0];
    return {
      master_enabled: !!row.master_enabled,
      step_ready_enabled: !!row.step_ready_enabled,
      step_ready_vorlauf_min: Number(row.step_ready_vorlauf_min) || 0,
      preheat_enabled: !!row.preheat_enabled,
      preheat_vorlauf_min: Number(row.preheat_vorlauf_min) || 0,
      bake_done_enabled: !!row.bake_done_enabled,
      plan_done_enabled: !!row.plan_done_enabled,
      quiet_enabled: !!row.quiet_enabled,
      quiet_start: normalizeTime(row.quiet_start, DEFAULT_SETTINGS.quiet_start),
      quiet_end: normalizeTime(row.quiet_end, DEFAULT_SETTINGS.quiet_end),
    };
  } catch (err) {
    console.error('❌ getSettings Fehler:', err.message);
    return { ...DEFAULT_SETTINGS };
  }
}

// ── isInQuietHours ───────────────────────────────────────────
// Prüft ob jetzt Stille-Zeit ist. Funktioniert auch über Mitternacht
// (z.B. 22:00 → 07:00).
function isInQuietHours(settings, date = new Date()) {
  if (!settings || !settings.quiet_enabled) return false;
  const start = validateTime(settings.quiet_start, '22:00');
  const end = validateTime(settings.quiet_end, '07:00');
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  const nowMin = date.getHours() * 60 + date.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Über Mitternacht: aktiv wenn now >= start ODER now < end
  return nowMin >= startMin || nowMin < endMin;
}

// ── GET /api/notification-settings ──────────────────────────
router.get('/', async (req, res) => {
  const settings = await getSettings(pool, req.user.userId);
  res.json(settings);
});

// ── PUT /api/notification-settings ──────────────────────────
// Upsert (PRIMARY KEY user_id). Validiert Werte vor dem Schreiben.
router.put('/', async (req, res) => {
  const userId = req.user.userId;
  const b = req.body || {};

  // Validierung: Vorlauf-Werte clampen
  const stepReadyVorlauf = Math.max(0, Math.min(60,
    Number.isFinite(parseInt(b.step_ready_vorlauf_min, 10))
      ? parseInt(b.step_ready_vorlauf_min, 10)
      : DEFAULT_SETTINGS.step_ready_vorlauf_min
  ));
  const preheatVorlauf = Math.max(5, Math.min(120,
    Number.isFinite(parseInt(b.preheat_vorlauf_min, 10))
      ? parseInt(b.preheat_vorlauf_min, 10)
      : DEFAULT_SETTINGS.preheat_vorlauf_min
  ));

  const quietStart = validateTime(b.quiet_start, DEFAULT_SETTINGS.quiet_start);
  const quietEnd = validateTime(b.quiet_end, DEFAULT_SETTINGS.quiet_end);

  try {
    await pool.query(
      `INSERT INTO user_notification_settings
        (user_id, master_enabled, step_ready_enabled, step_ready_vorlauf_min,
         preheat_enabled, preheat_vorlauf_min, bake_done_enabled, plan_done_enabled,
         quiet_enabled, quiet_start, quiet_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         master_enabled = EXCLUDED.master_enabled,
         step_ready_enabled = EXCLUDED.step_ready_enabled,
         step_ready_vorlauf_min = EXCLUDED.step_ready_vorlauf_min,
         preheat_enabled = EXCLUDED.preheat_enabled,
         preheat_vorlauf_min = EXCLUDED.preheat_vorlauf_min,
         bake_done_enabled = EXCLUDED.bake_done_enabled,
         plan_done_enabled = EXCLUDED.plan_done_enabled,
         quiet_enabled = EXCLUDED.quiet_enabled,
         quiet_start = EXCLUDED.quiet_start,
         quiet_end = EXCLUDED.quiet_end,
         updated_at = NOW()`,
      [
        userId,
        !!b.master_enabled,
        !!b.step_ready_enabled,
        stepReadyVorlauf,
        !!b.preheat_enabled,
        preheatVorlauf,
        !!b.bake_done_enabled,
        !!b.plan_done_enabled,
        !!b.quiet_enabled,
        quietStart,
        quietEnd,
      ]
    );
    const settings = await getSettings(pool, userId);
    res.json(settings);
  } catch (err) {
    console.error('❌ PUT notification-settings Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  setPool,
  getSettings,
  isInQuietHours,
  DEFAULT_SETTINGS,
};
