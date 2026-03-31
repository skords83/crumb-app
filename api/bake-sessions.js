// api/bake-sessions.js
// ============================================================
// BAKE SESSIONS API — Routes für den State-Machine-Backplan
// ============================================================
const express = require('express');
const router = express.Router();

const {
  flattenSteps,
  buildDependencyGraph,
  computeInitialStates,
  performTransition,
  checkSoftDone,
  calculateProjectedEnd,
  getPendingGates,
  buildUITimeline,
} = require('./bake-engine');

// Pool wird vom Parent-Module injiziert
let pool;
function setPool(p) { pool = p; }

// ── POST /api/bake-sessions — Session starten ───────────────
router.post('/', async (req, res) => {
  const { recipe_id, planned_at, multiplier } = req.body;
  if (!recipe_id || !planned_at) {
    return res.status(400).json({ error: 'recipe_id und planned_at erforderlich' });
  }

  try {
    // Rezept laden
    const recipeRes = await pool.query(
      'SELECT * FROM recipes WHERE id = $1 AND user_id = $2',
      [recipe_id, req.user.userId]
    );
    if (recipeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rezept nicht gefunden' });
    }
    const recipe = recipeRes.rows[0];
    const sections = recipe.dough_sections || [];

    if (sections.length === 0) {
      return res.status(400).json({ error: 'Rezept hat keine Phasen' });
    }

    // Initialen State berechnen
    const { states, timestamps } = computeInitialStates(sections);
    const projectedEnd = calculateProjectedEnd(sections, states, timestamps);

    // Session erstellen
    const result = await pool.query(
      `INSERT INTO bake_sessions 
       (recipe_id, user_id, planned_at, started_at, multiplier, step_states, step_timestamps, projected_end)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7) RETURNING *`,
      [
        recipe_id,
        req.user.userId,
        planned_at,
        multiplier || 1,
        JSON.stringify(states),
        JSON.stringify(timestamps),
        projectedEnd,
      ]
    );

    // planned_at auf Rezept setzen (für Nav-Badge etc.)
    await pool.query(
      'UPDATE recipes SET planned_at = $1 WHERE id = $2 AND user_id = $3',
      [planned_at, recipe_id, req.user.userId]
    );

    const session = result.rows[0];
    const gates = getPendingGates(sections, states);
    const timeline = buildUITimeline(sections, states, timestamps, planned_at);

    res.status(201).json({
      session,
      timeline,
      gates,
      recipe: { id: recipe.id, title: recipe.title, image_url: recipe.image_url, dough_sections: sections },
    });
  } catch (err) {
    console.error('❌ bake-session create Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bake-sessions/active — Aktive Sessions ─────────
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bs.*, r.title, r.image_url, r.dough_sections, r.category
       FROM bake_sessions bs
       JOIN recipes r ON r.id = bs.recipe_id
       WHERE bs.user_id = $1 AND bs.finished_at IS NULL
       ORDER BY bs.planned_at ASC`,
      [req.user.userId]
    );

    const sessions = result.rows.map(row => {
      const sections = row.dough_sections || [];
      const states = row.step_states || {};
      const timestamps = row.step_timestamps || {};

      // Soft-Done Check (Timer abgelaufen?)
      const { states: updatedStates, softDoneSteps } = checkSoftDone(sections, states, timestamps);

      // Wenn sich States geändert haben, DB updaten (fire-and-forget)
      if (softDoneSteps.length > 0) {
        pool.query(
          'UPDATE bake_sessions SET step_states = $1 WHERE id = $2',
          [JSON.stringify(updatedStates), row.id]
        ).catch(e => console.error('soft_done update Fehler:', e.message));
      }

      const effectiveStates = softDoneSteps.length > 0 ? updatedStates : states;
      const timeline = buildUITimeline(sections, effectiveStates, timestamps, row.planned_at);
      const gates = getPendingGates(sections, effectiveStates);
      const projectedEnd = calculateProjectedEnd(sections, effectiveStates, timestamps);

      return {
        id: row.id,
        recipe_id: row.recipe_id,
        title: row.title,
        image_url: row.image_url,
        category: row.category,
        planned_at: row.planned_at,
        started_at: row.started_at,
        multiplier: row.multiplier,
        projected_end: projectedEnd.toISOString(),
        step_states: effectiveStates,
        step_timestamps: timestamps,
        timeline,
        gates,
        dough_sections: sections,
        temperature_log: row.temperature_log || [],
      };
    });

    res.json(sessions);
  } catch (err) {
    console.error('❌ active sessions Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bake-sessions/:id/transition — State-Wechsel ──
router.post('/:id/transition', async (req, res) => {
  const { id } = req.params;
  const { stepIndex, action, phase, minutes, temperature } = req.body;

  if (stepIndex === undefined || !action) {
    return res.status(400).json({ error: 'stepIndex und action erforderlich' });
  }

  try {
    const result = await pool.query(
      `SELECT bs.*, r.dough_sections, r.title
       FROM bake_sessions bs JOIN recipes r ON r.id = bs.recipe_id
       WHERE bs.id = $1 AND bs.user_id = $2 AND bs.finished_at IS NULL`,
      [id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    const session = result.rows[0];
    const sections = session.dough_sections || [];
    const currentStates = session.step_states || {};
    const currentTimestamps = session.step_timestamps || {};

    // Erst soft_done Check
    const { states: preStates } = checkSoftDone(sections, currentStates, currentTimestamps);

    // Transition durchführen
    const { states, timestamps, sideEffects, error } = performTransition(
      sections, preStates, currentTimestamps, stepIndex, action,
      { phase, minutes, temperature }
    );

    if (error) {
      return res.status(400).json({ error });
    }

    // Projected End neu berechnen
    const projectedEnd = calculateProjectedEnd(sections, states, timestamps);

    // DB updaten
    await pool.query(
      `UPDATE bake_sessions SET step_states = $1, step_timestamps = $2, projected_end = $3 WHERE id = $4`,
      [JSON.stringify(states), JSON.stringify(timestamps), projectedEnd, id]
    );

    // Temperatur loggen wenn vorhanden
    if (action === 'log_temperature' && temperature !== undefined) {
      await pool.query(
        `UPDATE bake_sessions SET temperature_log = COALESCE(temperature_log, '[]'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify([{ step_idx: stepIndex, temp_c: parseFloat(temperature), recorded_at: Date.now() }]), id]
      );
    }

    const timeline = buildUITimeline(sections, states, timestamps, session.planned_at);
    const gates = getPendingGates(sections, states);

    // Notification Side-Effects verarbeiten
    for (const effect of sideEffects) {
      if (effect.type === 'gate_ready') {
        // Könnte hier ntfy auslösen — wird im checkAndNotify abgehandelt
      }
    }

    res.json({
      step_states: states,
      step_timestamps: timestamps,
      projected_end: projectedEnd.toISOString(),
      timeline,
      gates,
      sideEffects,
    });
  } catch (err) {
    console.error('❌ transition Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bake-sessions/:id/finish — Backen abschließen ─
router.post('/:id/finish', async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const result = await pool.query(
      `SELECT bs.*, r.dough_sections FROM bake_sessions bs JOIN recipes r ON r.id = bs.recipe_id
       WHERE bs.id = $1 AND bs.user_id = $2 AND bs.finished_at IS NULL`,
      [id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    const session = result.rows[0];

    // Session abschließen
    await pool.query(
      `UPDATE bake_sessions SET finished_at = NOW(), notes = $1 WHERE id = $2`,
      [notes || null, id]
    );

    // planned_at vom Rezept entfernen
    await pool.query(
      'UPDATE recipes SET planned_at = NULL WHERE id = $1 AND user_id = $2',
      [session.recipe_id, req.user.userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ finish Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bake-sessions/history — Abgeschlossene Sessions ─
router.get('/history', async (req, res) => {
  try {
    const { recipe_id } = req.query;
    let query = `
      SELECT bs.id, bs.recipe_id, bs.planned_at, bs.started_at, bs.finished_at,
             bs.multiplier, bs.notes, bs.temperature_log, bs.step_timestamps,
             r.title, r.image_url
      FROM bake_sessions bs
      JOIN recipes r ON r.id = bs.recipe_id
      WHERE bs.user_id = $1 AND bs.finished_at IS NOT NULL`;
    const params = [req.user.userId];

    if (recipe_id) {
      query += ' AND bs.recipe_id = $2';
      params.push(recipe_id);
    }

    query += ' ORDER BY bs.finished_at DESC LIMIT 50';

    const result = await pool.query(query, params);

    // Berechne Statistiken pro Session
    const sessions = result.rows.map(row => {
      const timestamps = row.step_timestamps || {};
      const durations = Object.values(timestamps)
        .filter(t => t.actual_duration)
        .map(t => t.actual_duration);
      const totalActualSeconds = durations.reduce((sum, d) => sum + d, 0);

      return {
        ...row,
        total_actual_duration: totalActualSeconds,
        step_count: Object.keys(timestamps).length,
      };
    });

    res.json(sessions);
  } catch (err) {
    console.error('❌ history Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bake-sessions/recipe-stats/:recipeId ───────────
// Aggregierte Statistiken für ein bestimmtes Rezept
router.get('/recipe-stats/:recipeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as bake_count,
              MAX(finished_at) as last_baked,
              AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) as avg_duration_seconds
       FROM bake_sessions
       WHERE recipe_id = $1 AND user_id = $2 AND finished_at IS NOT NULL`,
      [req.params.recipeId, req.user.userId]
    );

    const stats = result.rows[0];
    res.json({
      bake_count: parseInt(stats.bake_count) || 0,
      last_baked: stats.last_baked,
      avg_duration_minutes: stats.avg_duration_seconds ? Math.round(stats.avg_duration_seconds / 60) : null,
    });
  } catch (err) {
    console.error('❌ recipe-stats Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/bake-sessions/:id — Session löschen ─────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM bake_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ delete session Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };