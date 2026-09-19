const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { migrateBakeReliability, startSession, saveTransition, finishSession, sessionRecipeColumns } = require('./bake-persistence');
const { router, setPool } = require('./bake-sessions');

const sections = [{ name: 'Hauptteig', ingredients: [{ name: 'Mehl', amount: 500, unit: 'g' }], steps: [{ type: 'Warten', duration: 10, instruction: 'Ruhen lassen' }] }];
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE recipes (id SERIAL PRIMARY KEY, user_id INTEGER, title TEXT, image_url TEXT, category TEXT, dough_sections JSONB, planned_at TIMESTAMP, planned_timeline JSONB);
    CREATE TABLE bake_sessions (id SERIAL PRIMARY KEY, recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE, user_id INTEGER, planned_at TIMESTAMP, started_at TIMESTAMP, finished_at TIMESTAMP, multiplier NUMERIC, step_states JSONB, step_timestamps JSONB, projected_end TIMESTAMP, starter_id INTEGER, temperature_log JSONB DEFAULT '[]', notes TEXT);
    CREATE TABLE starters (id INTEGER, user_id INTEGER, archived_at TIMESTAMP);`);
  const pool = { query: async (sql, args) => {
    const result = await db.query(sql, args);
    return { ...result, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows };
  } };
  pool.connect = async () => ({ query: pool.query, release() {} });
  await pool.query('INSERT INTO recipes (user_id,title,dough_sections) VALUES (1,$1,$2)', ['Original', JSON.stringify(sections)]);
  return { db, pool };
}
const input = { recipe_id: 1, planned_at: '2026-10-01T12:00:00', multiplier: 1 };
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function handler(path, method = 'get') { return router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle; }

test('migration backfills old bakes exactly once and preserves snapshots after recipe edits', async t => {
  const { pool } = await fixture(t);
  await pool.query('INSERT INTO bake_sessions (recipe_id,user_id) VALUES (1,1)');
  await migrateBakeReliability(pool);
  await pool.query("UPDATE recipes SET title = 'Changed', dough_sections = '[]'");
  await migrateBakeReliability(pool);
  const { rows } = await pool.query(`SELECT ${sessionRecipeColumns} FROM bake_sessions bs`);
  assert.equal(rows[0].title, 'Original');
  assert.deepEqual(rows[0].dough_sections, sections);
});

test('two concurrent changes cannot overwrite each other; finished bakes reject writes', async t => {
  const { pool } = await fixture(t);
  await migrateBakeReliability(pool);
  const { session } = await startSession(pool, 1, input);
  const changes = [1, 2].map(n => ({ states: { 0: 'active' }, timestamps: { 0: { marker: n } }, projectedEnd: new Date(), temperatureLog: [{ temp_c: n }] }));
  const results = await Promise.all(changes.map(change => saveTransition(pool, session, 1, change)));
  assert.deepEqual(results.map(r => r.rowCount).sort(), [0, 1]);
  const stored = (await pool.query('SELECT * FROM bake_sessions WHERE id = $1', [session.id])).rows[0];
  assert.equal(stored.version, 1);
  assert.equal(stored.temperature_log.length, 1);
  assert.equal(stored.temperature_log[0].temp_c, stored.step_timestamps[0].marker);
  await assert.rejects(finishSession(pool, 1, session.id, 0, ''), { status: 409 });
  await finishSession(pool, 1, session.id, 1, 'Fertig');
  assert.equal((await saveTransition(pool, { ...session, version: 2 }, 1, changes[0])).rowCount, 0);
});

test('archiving a recipe preserves active bakes, history and original ingredients', async t => {
  const { pool } = await fixture(t);
  await migrateBakeReliability(pool);
  const { session } = await startSession(pool, 1, input);
  await pool.query("UPDATE recipes SET title = 'Changed', dough_sections = '[]', archived_at = NOW() WHERE id = 1");
  await assert.rejects(startSession(pool, 1, input), { status: 404 });
  await pool.query('UPDATE bake_sessions SET step_timestamps = $1 WHERE id = $2', [JSON.stringify({ 0: { started_at: Date.now() - 2000, timer_end: Date.now() - 1000 } }), session.id]);
  setPool(pool);
  let res = response();
  await handler('/active')({ user: { userId: 1 } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body[0].title, 'Original');
  assert.equal(res.body[0].step_states[0], 'soft_done');
  assert.equal((await pool.query('SELECT step_states FROM bake_sessions')).rows[0].step_states[0], 'active');
  assert.deepEqual(res.body[0].dough_sections, sections);
  const previousVersion = res.body[0].version;
  await handler('/active')({ user: { userId: 1 } }, response());
  assert.equal((await pool.query('SELECT version FROM bake_sessions')).rows[0].version, previousVersion);
  await finishSession(pool, 1, session.id, session.version, 'Gut geworden');
  res = response();
  await handler('/history')({ user: { userId: 1 }, query: {} }, res);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].title, 'Original');
  assert.deepEqual(res.body[0].dough_sections, sections);
  const other = response();
  await handler('/history')({ user: { userId: 2 }, query: {} }, other);
  assert.deepEqual(other.body, []);
});

test('finishing one of multiple bakes retains the remaining recipe plan', async t => {
  const { pool } = await fixture(t);
  await migrateBakeReliability(pool);
  const first = await startSession(pool, 1, input);
  const second = await startSession(pool, 1, { ...input, planned_at: '2026-10-02T12:00:00' });
  await finishSession(pool, 1, first.session.id, 0, '');
  assert.ok((await pool.query('SELECT planned_at FROM recipes')).rows[0].planned_at);
  await finishSession(pool, 1, second.session.id, 0, '');
  assert.equal((await pool.query('SELECT planned_at FROM recipes')).rows[0].planned_at, null);
});

test('failed creation rolls back and rejects a starter owned by someone else', async t => {
  const { pool } = await fixture(t);
  await migrateBakeReliability(pool);
  await pool.query('INSERT INTO starters VALUES (7,2,NULL)');
  await assert.rejects(startSession(pool, 1, { ...input, starter_id: 7 }), { status: 400 });
  await assert.rejects(startSession(pool, 1, { ...input, planned_at: 'invalid timestamp' }));
  assert.equal((await pool.query('SELECT * FROM bake_sessions')).rows.length, 0);
  assert.equal((await pool.query('SELECT planned_at FROM recipes')).rows[0].planned_at, null);
});
