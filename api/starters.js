// api/starters.js
// ============================================================
// STARTERS API — Sauerteig-Starter-Tracker
// ============================================================
const express = require('express');
const router = express.Router();

const { calculateHealth, calculatePlanAdherence } = require('./starter-health');
const { predictNextPeak } = require('./starter-peak');
const { TARGET_PROFILES, TARGET_PROFILE_KEYS } = require('./starter-profiles');

let pool;
function setPool(p) { pool = p; }

const FLOUR_TYPES = ['weizen', 'roggen', 'dinkel', 'vollkorn'];

// ── GET /api/starters/profiles — Zielprofil-Metadaten (statisch) ──
// Muss VOR /:id registriert werden, sonst matcht Express "profiles" als :id.
router.get('/profiles', (req, res) => {
  res.json(TARGET_PROFILES);
});

// ── GET /api/starters — Liste (ohne archivierte), Health inline ───
router.get('/', async (req, res) => {
  try {
    const startersRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max, tp.label_de AS target_profile_label
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.user_id = $1 AND s.archived_at IS NULL
       ORDER BY s.created_at DESC`,
      [req.user.userId]
    );
    const starters = startersRes.rows;
    if (starters.length === 0) return res.json([]);

    const ids = starters.map(s => s.id);
    const feedingsRes = await pool.query(
      `SELECT * FROM (
         SELECT sf.*, ROW_NUMBER() OVER (PARTITION BY sf.starter_id ORDER BY sf.fed_at DESC) AS rn
         FROM starter_feedings sf
         WHERE sf.starter_id = ANY($1::int[])
       ) ranked WHERE rn <= 20`,
      [ids]
    );
    const feedingsByStarterId = new Map();
    for (const f of feedingsRes.rows) {
      if (!feedingsByStarterId.has(f.starter_id)) feedingsByStarterId.set(f.starter_id, []);
      feedingsByStarterId.get(f.starter_id).push(f);
    }

    const result = starters.map(s => {
      const feedings = feedingsByStarterId.get(s.id) || [];
      const { health, status } = calculateHealth(feedings, s);
      return {
        id: s.id,
        name: s.name,
        flour_type: s.flour_type,
        hydration_percent: s.hydration_percent,
        target_profile: s.target_profile,
        target_profile_label: s.target_profile_label,
        created_at: s.created_at,
        last_fed_at: feedings[0]?.fed_at || null,
        health,
        status,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('❌ starters list Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/starters — Neuen Starter anlegen ─────────────────────
router.post('/', async (req, res) => {
  const { name, flour_type, hydration_percent, target_profile } = req.body;
  if (!name || !flour_type) {
    return res.status(400).json({ error: 'name und flour_type erforderlich' });
  }
  if (!FLOUR_TYPES.includes(flour_type)) {
    return res.status(400).json({ error: `flour_type muss einer von ${FLOUR_TYPES.join(', ')} sein` });
  }
  const profile = target_profile || 'ausgeglichen';
  if (!TARGET_PROFILE_KEYS.includes(profile)) {
    return res.status(400).json({ error: `target_profile muss einer von ${TARGET_PROFILE_KEYS.join(', ')} sein` });
  }
  const hydration = Number.isFinite(parseInt(hydration_percent, 10)) ? parseInt(hydration_percent, 10) : 100;

  try {
    const result = await pool.query(
      `INSERT INTO starters (user_id, name, flour_type, hydration_percent, target_profile)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.userId, name, flour_type, hydration, profile]
    );
    res.status(201).json({ ...result.rows[0], health: 0, status: 'Unbekannt' });
  } catch (err) {
    console.error('❌ starter create Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/starters/:id — Einzelner Starter inkl. letzter Fütterungen ──
router.get('/:id', async (req, res) => {
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.*
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2 AND s.archived_at IS NULL`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const starter = starterRes.rows[0];
    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [starter.id]
    );
    const { health, status } = calculateHealth(feedingsRes.rows, starter);
    const plan_adherence = calculatePlanAdherence(feedingsRes.rows, starter);
    const nextPeakPrediction = predictNextPeak(feedingsRes.rows, starter.target_profile);
    const next_peak_prediction = nextPeakPrediction ? {
      source: nextPeakPrediction.source,
      window_start: nextPeakPrediction.windowStart,
      window_end: nextPeakPrediction.windowEnd,
      median: nextPeakPrediction.median,
    } : null;
    res.json({ ...starter, health, status, plan_adherence, next_peak_prediction, feedings: feedingsRes.rows });
  } catch (err) {
    console.error('❌ starter detail Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/starters/:id — Bearbeiten ─────────────────────────
router.patch('/:id', async (req, res) => {
  const { name, flour_type, hydration_percent, target_profile } = req.body;
  if (flour_type !== undefined && !FLOUR_TYPES.includes(flour_type)) {
    return res.status(400).json({ error: `flour_type muss einer von ${FLOUR_TYPES.join(', ')} sein` });
  }
  if (target_profile !== undefined && !TARGET_PROFILE_KEYS.includes(target_profile)) {
    return res.status(400).json({ error: `target_profile muss einer von ${TARGET_PROFILE_KEYS.join(', ')} sein` });
  }
  try {
    const result = await pool.query(
      `UPDATE starters SET
         name = COALESCE($1, name),
         flour_type = COALESCE($2, flour_type),
         hydration_percent = COALESCE($3, hydration_percent),
         target_profile = COALESCE($4, target_profile)
       WHERE id = $5 AND user_id = $6 AND archived_at IS NULL RETURNING *`,
      [name ?? null, flour_type ?? null, hydration_percent ?? null, target_profile ?? null, req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ starter update Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/starters/:id — Soft-Delete ────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE starters SET archived_at = NOW() WHERE id = $1 AND user_id = $2 AND archived_at IS NULL RETURNING id`,
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ starter delete Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/starters/:id/health — Health separat ─────────────────
router.get('/:id/health', async (req, res) => {
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2 AND s.archived_at IS NULL`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(calculateHealth(feedingsRes.rows, starterRes.rows[0]));
  } catch (err) {
    console.error('❌ starter health Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/starters/:id/feedings — Fütterung protokollieren ───
router.post('/:id/feedings', async (req, res) => {
  const { flour_grams, water_grams, discard_grams, temperature_celsius, activity_rating, notes, fed_at, flour_type } = req.body;
  if (!Number.isFinite(Number(flour_grams)) || !Number.isFinite(Number(water_grams))) {
    return res.status(400).json({ error: 'flour_grams und water_grams erforderlich' });
  }
  if (flour_type !== undefined && !FLOUR_TYPES.includes(flour_type)) {
    return res.status(400).json({ error: `flour_type muss einer von ${FLOUR_TYPES.join(', ')} sein` });
  }
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2 AND s.archived_at IS NULL`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const starter = starterRes.rows[0];

    const insertRes = await pool.query(
      `INSERT INTO starter_feedings
         (starter_id, flour_grams, water_grams, discard_grams, temperature_celsius, activity_rating, notes, fed_at, flour_type, target_profile_at_feeding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10)
       RETURNING *`,
      [
        starter.id,
        Number(flour_grams),
        Number(water_grams),
        discard_grams != null ? Number(discard_grams) : null,
        temperature_celsius != null ? Number(temperature_celsius) : null,
        activity_rating != null ? Number(activity_rating) : null,
        notes || null,
        fed_at || null,
        flour_type ?? null,
        starter.target_profile,
      ]
    );

    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [starter.id]
    );
    const { health, status } = calculateHealth(feedingsRes.rows, starter);
    res.status(201).json({ feeding: insertRes.rows[0], health, status });
  } catch (err) {
    console.error('❌ feeding create Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/starters/:id/feedings — Historie (neueste zuerst) ───
router.get('/:id/feedings', async (req, res) => {
  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM starters WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
      [req.params.id, req.user.userId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const result = await pool.query(
      `SELECT sf.* FROM starter_feedings sf
       JOIN starters s ON s.id = sf.starter_id
       WHERE sf.starter_id = $1 AND s.user_id = $2
       ORDER BY sf.fed_at DESC LIMIT 100`,
      [req.params.id, req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ feedings history Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
