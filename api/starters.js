// api/starters.js
// ============================================================
// STARTERS API — Sauerteig-Starter-Tracker
// ============================================================
const express = require('express');
const router = express.Router();

const { calculateHealth } = require('./starter-health');
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

module.exports = { router, setPool };
