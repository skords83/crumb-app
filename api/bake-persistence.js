// Snapshot data is immutable once a bake starts. Existing sessions inherit the
// current recipe on migration; older recipe versions cannot be reconstructed.
async function migrateBakeReliability(db) {
  await db.query('ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP');
  await db.query('ALTER TABLE bake_sessions ADD COLUMN IF NOT EXISTS recipe_snapshot JSONB');
  await db.query('ALTER TABLE bake_sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0');
  await db.query(`UPDATE bake_sessions bs SET recipe_snapshot = to_jsonb(r)
    FROM recipes r WHERE r.id = bs.recipe_id AND bs.recipe_snapshot IS NULL`);
}

const sessionRecipeColumns = `bs.recipe_snapshot->>'title' AS title,
  bs.recipe_snapshot->>'image_url' AS image_url,
  bs.recipe_snapshot->>'category' AS category,
  bs.recipe_snapshot->'dough_sections' AS dough_sections`;

async function saveTransition(db, session, userId, change) {
  return db.query(`UPDATE bake_sessions SET step_states = $1, step_timestamps = $2,
    projected_end = $3, temperature_log = COALESCE(temperature_log, '[]'::jsonb) || $4::jsonb,
    version = version + 1
    WHERE id = $5 AND user_id = $6 AND version = $7 AND finished_at IS NULL RETURNING version`,
  [JSON.stringify(change.states), JSON.stringify(change.timestamps), change.projectedEnd,
    JSON.stringify(change.temperatureLog || []), session.id, userId, session.version]);
}

module.exports = { migrateBakeReliability, sessionRecipeColumns, saveTransition };

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

async function startSession(pool, userId, input) {
  const { computeInitialStates, calculateProjectedEnd } = require('./bake-engine');
  return inTransaction(pool, async client => {
    const recipes = await client.query('SELECT * FROM recipes WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE', [input.recipe_id, userId]);
    const recipe = recipes.rows[0];
    if (!recipe) throw httpError(404, 'Rezept nicht gefunden');
    if (!Array.isArray(recipe.dough_sections) || !recipe.dough_sections.length) throw httpError(400, 'Rezept hat keine Phasen');
    if (input.starter_id) {
      const starter = await client.query('SELECT id FROM starters WHERE id = $1 AND user_id = $2 AND archived_at IS NULL', [input.starter_id, userId]);
      if (!starter.rowCount) throw httpError(400, 'Starter nicht gefunden');
    }
    const { states, timestamps } = computeInitialStates(recipe.dough_sections);
    const projectedEnd = calculateProjectedEnd(recipe.dough_sections, states, timestamps);
    const result = await client.query(`INSERT INTO bake_sessions
      (recipe_id, user_id, planned_at, started_at, multiplier, step_states, step_timestamps, projected_end, starter_id, recipe_snapshot)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9) RETURNING *`,
    [recipe.id, userId, input.planned_at, input.multiplier ?? 1, JSON.stringify(states), JSON.stringify(timestamps), projectedEnd, input.starter_id || null, JSON.stringify(recipe)]);
    await client.query('UPDATE recipes SET planned_at = $1 WHERE id = $2', [input.planned_at, recipe.id]);
    return { recipe, session: result.rows[0] };
  });
}

async function finishSession(pool, userId, id, version, notes) {
  return inTransaction(pool, async client => {
    const found = await client.query('SELECT recipe_id FROM bake_sessions WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!found.rowCount) throw httpError(404, 'Backvorgang nicht gefunden');
    const recipeId = found.rows[0].recipe_id;
    // Same lock order as startSession: recipe first, then bake session.
    await client.query('SELECT id FROM recipes WHERE id = $1 FOR UPDATE', [recipeId]);
    const finished = await client.query(`UPDATE bake_sessions SET finished_at = NOW(), notes = $1, version = version + 1
      WHERE id = $2 AND user_id = $3 AND version = $4 AND finished_at IS NULL RETURNING id`, [notes || null, id, userId, version]);
    if (!finished.rowCount) throw httpError(409, 'Backplan wurde zwischenzeitlich geändert. Bitte aktuellen Stand prüfen.');
    await client.query(`UPDATE recipes SET planned_at = (SELECT MIN(planned_at) FROM bake_sessions WHERE recipe_id = $1 AND finished_at IS NULL), planned_timeline = NULL
      WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [recipeId, userId]);
  });
}

module.exports.startSession = startSession;
module.exports.finishSession = finishSession;
