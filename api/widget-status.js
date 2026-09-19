'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { sessionRecipeColumns } = require('./bake-persistence');
const { checkSoftDone, buildUITimeline } = require('./bake-engine');

function selectNextStep(sessions, now = Date.now()) {
  const candidates = sessions.flatMap(session => (session.timeline || [])
    .filter(step => step.state === 'soft_done' || step.state === 'active' || step.state === 'ready')
    .map(step => ({ session, step })));
  // Expired timers need attention even if the engine has not yet marked them soft_done.
  const overdue = candidates.filter(({ step }) => step.state === 'soft_done' ||
    (step.state === 'active' && step.end && Date.parse(step.end) <= now));
  const pending = overdue.length ? overdue : candidates;
  pending.sort((a, b) => {
    const aTime = Date.parse(a.step.end || a.step.scheduled_start || '') || Infinity;
    const bTime = Date.parse(b.step.end || b.step.scheduled_start || '') || Infinity;
    return aTime - bTime;
  });
  const first = pending[0];
  if (!first) return null;
  const { session, step } = first;
  return {
    recipe: session.title,
    instruction: step.instruction,
    phase: step.phase,
    state: step.state,
    due_at: step.end || step.scheduled_start || null,
    remaining_seconds: step.remaining,
  };
}

function secureKeyMatches(provided, expected) {
  if (typeof provided !== 'string' || !expected || !provided || provided.length > 512) return false;
  const suppliedHash = crypto.createHash('sha256').update(provided).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(suppliedHash, expectedHash);
}

function createWidgetRouter(pool, config = process.env) {
  const router = express.Router();
  router.get('/status', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    const userId = Number(config.WIDGET_USER_ID);
    const key = config.WIDGET_API_KEY;
    if (!Number.isSafeInteger(userId) || userId <= 0 || !key || key.length < 32) {
      return res.status(503).json({ error: 'Widget nicht konfiguriert' });
    }
    if (!secureKeyMatches(req.get('X-Widget-Key'), key)) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    try {
      const result = await pool.query(
        `SELECT bs.*, ${sessionRecipeColumns} FROM bake_sessions bs
         WHERE bs.user_id = $1 AND bs.finished_at IS NULL ORDER BY bs.planned_at ASC`,
        [userId]
      );
      const sessions = result.rows.map(row => {
        const sections = row.dough_sections || [];
        const { states } = checkSoftDone(sections, row.step_states || {}, row.step_timestamps || {});
        return {
          title: row.title,
          timeline: buildUITimeline(sections, states, row.step_timestamps || {}, row.planned_at),
        };
      });
      return res.json({ active_count: sessions.length, next_step: selectNextStep(sessions) });
    } catch (error) {
      console.error('Widget-Status Fehler:', error.message);
      return res.status(500).json({ error: 'Status derzeit nicht verfügbar' });
    }
  });
  return router;
}

module.exports = { createWidgetRouter, selectNextStep, secureKeyMatches };
