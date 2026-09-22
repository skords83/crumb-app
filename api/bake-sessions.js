const { sessionRecipeColumns, saveTransition, startSession, finishSession } = require('./bake-persistence');
// api/bake-sessions.js
// ============================================================
// BAKE SESSIONS API — Routes für den State-Machine-Backplan
// ============================================================
const express = require('express');
const router = express.Router();

const {
  performTransition,
  checkSoftDone,
  calculateProjectedEnd,
  getPendingGates,
  buildUITimeline,
} = require('./bake-engine');
const { evaluateAndDispatch } = require('./notification-engine');
const { calculateHealth } = require('./starter-health');

// Pool wird vom Parent-Module injiziert
let pool;
function setPool(p) { pool = p; }

// ── POST /api/bake-sessions — Session starten ───────────────
router.post('/', async (req, res) => {
  const { recipe_id, planned_at, multiplier, starter_id } = req.body;
  if (!recipe_id || !planned_at || !Number.isFinite(new Date(planned_at).getTime()) || (multiplier !== undefined && (!Number.isFinite(Number(multiplier)) || Number(multiplier) <= 0 || Number(multiplier) > 99))) {
    return res.status(400).json({ error: 'recipe_id und planned_at erforderlich' });
  }

  try {
    const { recipe, session } = await startSession(pool, req.user.userId, req.body);
    const sections = recipe.dough_sections;
    const states = session.step_states;
    const timestamps = session.step_timestamps;
    const gates = getPendingGates(sections, states);
    const timeline = buildUITimeline(sections, states, timestamps, planned_at);

    const response = {
      session,
      timeline,
      gates,
      recipe: { id: recipe.id, title: recipe.title, image_url: recipe.image_url, dough_sections: sections },
    };

    if (starter_id) {
      try {
        const starterRes = await pool.query(
          `SELECT s.*, tp.* FROM starters s
           JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
           WHERE s.id = $1 AND s.user_id = $2 AND s.archived_at IS NULL`,
          [starter_id, req.user.userId]
        );
        if (starterRes.rows.length > 0) {
          const feedingsRes = await pool.query(
            `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
            [starter_id]
          );
          const { health, status } = calculateHealth(feedingsRes.rows, starterRes.rows[0]);
          if (health < 60) {
            response.starterWarning = {
              starterId: starter_id,
              message: `Dein Starter "${starterRes.rows[0].name}" ist aktuell "${status}". Eventuell vorher füttern.`,
            };
          }
        }
      } catch (err) {
        console.error('⚠️ Starter-Health-Check Fehler (nicht kritisch):', err.message);
      }
    }

    res.status(201).json(response);
  } catch (err) {
    console.error('❌ bake-session create Fehler:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Native projection; existing web response remains unchanged.
router.get('/companion', async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  try {
    const result = await pool.query(`SELECT bs.*, ${sessionRecipeColumns} FROM bake_sessions bs
      WHERE bs.user_id = $1 AND bs.finished_at IS NULL ORDER BY bs.planned_at ASC`, [req.user.userId]);
    const delivery = await pool.query('SELECT android_bake_delivery FROM users WHERE id = $1', [req.user.userId]);
    res.json({ server_time: new Date().toISOString(), delivery: delivery.rows[0]?.android_bake_delivery ? 'android' : 'web',
      sessions: result.rows.map(require('./android-companion').companionSession) });
  } catch (err) { res.status(500).json({ error: 'Backvorgänge konnten nicht geladen werden' }); }
});
router.put('/companion/delivery', async (req, res) => {
  if (!['web', 'android'].includes(req.body?.delivery)) return res.status(400).json({ error: 'Ungültige Zustellung' });
  try {
    await pool.query('UPDATE users SET android_bake_delivery = $1 WHERE id = $2', [req.body.delivery === 'android', req.user.userId]);
    res.json({ delivery: req.body.delivery });
  } catch { res.status(500).json({ error: 'Zustellung konnte nicht geändert werden' }); }
});

// ── GET /api/bake-sessions/active — Aktive Sessions ─────────
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bs.*, ${sessionRecipeColumns}
       FROM bake_sessions bs
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

      const effectiveStates = softDoneSteps.length > 0 ? updatedStates : states;
      const timeline = buildUITimeline(sections, effectiveStates, timestamps, row.planned_at);
      const gates = getPendingGates(sections, effectiveStates);
      const projectedEnd = calculateProjectedEnd(sections, effectiveStates, timestamps);

      return {
        id: row.id,
        version: row.version,
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/bake-sessions/:id/transition — State-Wechsel ──
router.post('/:id/transition', async (req, res) => {
  const { id } = req.params;
  const { stepIndex, action, phase, minutes, temperature, expectedVersion } = req.body;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'Aktuellen Backplan bitte neu laden' });
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || !['complete', 'start_baking', 'confirm_gate', 'extend_timer', 'log_temperature', 'undo'].includes(action)) {
    return res.status(400).json({ error: 'stepIndex und action erforderlich' });
  }

  try {
    const result = await pool.query(
      `SELECT bs.*, ${sessionRecipeColumns}
       FROM bake_sessions bs
       WHERE bs.id = $1 AND bs.user_id = $2 AND bs.finished_at IS NULL`,
      [id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    const session = result.rows[0];
    if (session.version !== expectedVersion) return res.status(409).json({ error: 'Backplan wurde zwischenzeitlich geändert. Bitte aktuellen Stand prüfen.' });
    const sections = session.dough_sections || [];
    const currentStates = session.step_states || {};
    const currentTimestamps = session.step_timestamps || {};

    // Erst soft_done Check
    const { states: preStates } = checkSoftDone(sections, currentStates, currentTimestamps);

    if (action === 'confirm_gate' && !getPendingGates(sections, preStates).some(g => g.phase === phase && g.firstStepIdx === stepIndex)) {
      return res.status(409).json({ error: 'Diese Phase kann noch nicht oder nicht mehr gestartet werden.' });
    }

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

    const saved = await saveTransition(pool, session, req.user.userId, {
      states, timestamps, projectedEnd,
      temperatureLog: action === 'log_temperature' && temperature !== undefined
        ? [{ step_idx: stepIndex, temp_c: parseFloat(temperature), recorded_at: Date.now() }] : [],
    });
    if (!saved.rowCount) return res.status(409).json({ error: 'Backplan wurde zwischenzeitlich geändert. Bitte aktuellen Stand prüfen.' });

    const timeline = buildUITimeline(sections, states, timestamps, session.planned_at);
    const gates = getPendingGates(sections, states);

    // Notifications direkt nach Transition auswerten und versenden.
    // Idempotent: doppelte Versendung wird über sent_notifications-Tabelle verhindert.
    // Der 60s-Sweep läuft parallel als Safety-Net.
    try {
      await evaluateAndDispatch(
        pool,
        {
          id: session.id,
          user_id: req.user.userId,
          title: session.title,
          step_states: states,
          step_timestamps: timestamps,
        },
        sections
      );
    } catch (e) {
      console.error('Notification-Dispatch nach Transition fehlgeschlagen:', e.message);
    }

    res.json({
      version: saved.rows[0].version,
      step_states: states,
      step_timestamps: timestamps,
      projected_end: projectedEnd.toISOString(),
      timeline,
      gates,
      sideEffects,
    });
  } catch (err) {
    console.error('❌ transition Fehler:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/bake-sessions/:id/finish — Backen abschließen ─
router.post('/:id/finish', async (req, res) => {
  const { notes, expectedVersion } = req.body;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'Aktuellen Backplan bitte neu laden' });
  try {
    await finishSession(pool, req.user.userId, req.params.id, expectedVersion, notes);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/bake-sessions/history — Abgeschlossene Sessions ─
router.get('/history', async (req, res) => {
  try {
    const { recipe_id } = req.query;
    let query = `
      SELECT bs.id, bs.recipe_id, bs.planned_at, bs.started_at, bs.finished_at,
             bs.multiplier, bs.notes, bs.temperature_log, bs.step_timestamps,
             ${sessionRecipeColumns}
      FROM bake_sessions bs
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = { router, setPool };