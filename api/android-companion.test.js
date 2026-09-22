const { test } = require('node:test');
const assert = require('node:assert/strict');
const { companionSession } = require('./android-companion');
const engine = require('./bake-engine');
const { router, setPool } = require('./bake-sessions');
const { evaluateAndDispatch } = require('./notification-engine');
const sections = [{ name: 'Teig', ingredients: [], steps: [
  { type: 'Aktion', instruction: 'Kneten', duration: 5 },
  { type: 'Warten', instruction: 'Ruhen', duration: 10 },
  { type: 'Backen', instruction: 'Backen', duration: 20 },
  { type: 'Backen', instruction: 'Temperatur senken', duration: 10 },
] }];
function row(id = 7) { return { id, version: 0, title: 'Testbrot', planned_at: new Date().toISOString(), dough_sections: sections,
  step_states: { 0: 'done', 1: 'active', 2: 'locked', 3: 'locked' },
  step_timestamps: { 0: { completed_at: 1000 }, 1: { started_at: Date.now() - 700000, timer_end: Date.now() - 100000 } } }; }
function handler(path, method) { return router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack[0].handle; }
function response() { return { code: 200, headers: {}, set(k,v) { this.headers[k]=v; return this; }, status(n) { this.code=n; return this; }, json(body) { this.body=body; return this; } }; }
test('native projection retains parallel sessions, UTC deadlines, soft_done and stable IDs', () => {
  const rows = [row(7), row(8), row(9)];
  const projections = rows.map(companionSession);
  assert.equal(new Set(projections.flatMap(s => s.steps.map(t => t.id))).size, 12);
  const wait = projections[0].steps[1];
  assert.equal(wait.state, 'soft_done');
  assert.equal(wait.action, 'complete');
  assert.match(wait.due_at, /Z$/);
  assert.match(wait.planned_end, /Z$/);
  assert.equal(projections[0].steps[2].action, null);
  assert.equal(rows[0].step_states[1], 'active');
  const changed = { ...rows[0], version: 12 };
  assert.equal(companionSession(changed).steps[1].alarm_key, wait.alarm_key);
  changed.step_timestamps = { ...changed.step_timestamps, 1: { ...changed.step_timestamps[1], timer_end: Date.now() + 900000 } };
  assert.notEqual(companionSession(changed).steps[1].alarm_key, wait.alarm_key);
});
test('oven start and each active oven segment expose distinct actions and urgency', () => {
  const r = row();
  r.step_states = { 0: 'done', 1: 'done', 2: 'ready', 3: 'locked' };
  assert.equal(companionSession(r).steps[2].action, 'start_baking');
  const result = engine.performTransition(sections, r.step_states, r.step_timestamps, 2, 'start_baking');
  r.step_states = result.states; r.step_timestamps = result.timestamps;
  const step = companionSession(r).steps[2];
  assert.equal(step.critical, true); assert.equal(step.action, 'complete'); assert.match(step.due_at, /Z$/);
});
test('dependency gate remains executable without pretending the locked step is complete', () => {
  const r = row();
  r.dough_sections = [{ name: 'Vorteig', steps: [{ type: 'Warten', duration: 10 }] },
    { name: 'Hauptteig', ingredients: [{ name: 'Vorteig' }], steps: [{ type: 'Aktion', duration: 5 }] }];
  r.step_states = { 0: 'done', 1: 'locked' };
  const step = companionSession(r).steps[1];
  assert.equal(step.action, 'confirm_gate'); assert.equal(step.state, 'locked');
});
test('companion API is owner scoped and disables caching', async () => {
  const calls = [];
  setPool({ query: async (sql, args) => { calls.push({sql,args}); return { rows: sql.includes('FROM users') ? [{android_bake_delivery:true}] : [row()] }; } });
  const res = response();
  await handler('/companion','get')({user:{userId:42}},res);
  assert.equal(res.code,200); assert.equal(res.body.delivery,'android'); assert.match(res.body.server_time,/Z$/);
  assert.equal(res.headers['Cache-Control'],'no-store, private');
  assert.deepEqual(calls.map(c => c.args), [[42],[42]]);
  assert.match(calls[0].sql,/bs.user_id = \$1 AND bs.finished_at IS NULL/);
});
test('delivery setting rejects invalid mode and is scoped to authenticated owner', async () => {
  const calls=[]; setPool({query:async(...args)=>{calls.push(args);return {rows:[]};}});
  const bad=response(); await handler('/companion/delivery','put')({body:{delivery:'bad'},user:{userId:3}},bad);
  assert.equal(bad.code,400); assert.equal(calls.length,0);
  const good=response(); await handler('/companion/delivery','put')({body:{delivery:'android'},user:{userId:3}},good);
  assert.deepEqual(calls[0][1],[true,3]);
});
test('Android delivery suppresses server bake push before dispatch', async () => {
  let count=0;
  const pool={query:async()=>{count++; return {rows:[{android_bake_delivery:true}]};}};
  assert.equal(await evaluateAndDispatch(pool,{id:1,user_id:2},sections),0);
  assert.equal(count,1);
});
test('oven readiness uses actual completion rather than a later original plan', () => {
  const r=row(); r.planned_at='2099-01-01T00:00:00Z';
  r.step_states={0:'done',1:'done',2:'ready',3:'locked'};
  r.step_timestamps[1].completed_at=1234567;
  assert.equal(companionSession(r).steps[2].due_at,new Date(1234567).toISOString());
});
test('stale or premature gate and malformed step IDs are rejected before mutation', async () => {
  const r=row();
  r.dough_sections=[{name:'Vorteig',steps:[{type:'Warten',duration:10}]},{name:'Hauptteig',ingredients:[{name:'Vorteig'}],steps:[{type:'Aktion',duration:5}]}];
  r.step_states={0:'active',1:'locked'};
  let writes=0;
  setPool({query:async sql=>{if(!sql.trim().startsWith('SELECT')) writes++; return {rows:[r]};}});
  const req={params:{id:'7'},user:{userId:1},body:{expectedVersion:0,stepIndex:1,action:'confirm_gate',phase:'Hauptteig'}};
  const blocked=response(); await handler('/:id/transition','post')(req,blocked);
  assert.equal(blocked.code,409); assert.equal(writes,0);
  const invalid=response(); await handler('/:id/transition','post')({...req,body:{...req.body,stepIndex:'1'}},invalid);
  assert.equal(invalid.code,400); assert.equal(writes,0);
});
