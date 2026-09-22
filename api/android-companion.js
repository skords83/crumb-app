'use strict';
const { buildUITimeline, checkSoftDone, getPendingGates } = require('./bake-engine');

function companionSession(row) {
  const sections = row.dough_sections || [];
  const { states } = checkSoftDone(sections, row.step_states || {}, row.step_timestamps || {});
  const gates = getPendingGates(sections, states);
  const timeline = buildUITimeline(sections, states, row.step_timestamps || {}, row.planned_at);
  const steps = timeline.map(step => {
    const gate = gates.find(g => g.firstStepIdx === step.globalIdx);
    const actionable = ['active', 'soft_done', 'ready'].includes(step.state);
    const action = gate ? 'confirm_gate' : !actionable ? null : step.type === 'Backen' && step.state === 'ready' ? 'start_baking' : 'complete';
    const ts = row.step_timestamps?.[step.globalIdx] || {};
    const prerequisiteEnds = timeline.filter(previous => gate
      ? gate.dependencies.includes(previous.phase)
      : previous.phase === step.phase && previous.globalIdx < step.globalIdx)
      .map(previous => row.step_timestamps?.[previous.globalIdx]?.completed_at).filter(Number.isFinite);
    const readyAt = prerequisiteEnds.length ? new Date(Math.max(...prerequisiteEnds)).toISOString() : null;
    const due = action ? step.end || step.start || readyAt || step.scheduled_start : null;
    return { ...step, id: `${row.id}:${step.globalIdx}`, action,
      due_at: due, critical: step.type === 'Backen' && step.state === 'active',
      planned_end: step.scheduled_start ? new Date(Date.parse(step.scheduled_start) + step.duration * 60000).toISOString() : null,
      // Stable across unrelated version changes; timer extension/undo changes the key.
      alarm_key: action ? `${row.id}:${step.globalIdx}:${action}:${ts.started_at || ''}:${due || ''}` : null };
  });
  return { id: row.id, version: row.version, title: row.title, steps };
}
module.exports = { companionSession };
