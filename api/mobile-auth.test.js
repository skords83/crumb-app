const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const jwt = require('jsonwebtoken');
const { migrateMobileSessions, createMobileAuth } = require('./mobile-auth');
const secret = 'synthetic-test-only-secret-with-32-characters';
const response = () => ({ code: 200, headers: {}, set(k,v) { this.headers[k] = v; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, token_version INTEGER); INSERT INTO users VALUES (1, 'baker@example.invalid', 0), (2, 'other@example.invalid', 0)");
  const pool = { query: (sql, args) => db.query(sql, args) };
  await migrateMobileSessions(pool); await migrateMobileSessions(pool);
  return { db, auth: createMobileAuth(pool, secret), user: { id: 1, email: 'baker@example.invalid', token_version: 0 } };
}
test('mobile session stores only hashed refresh credentials and refresh does not extend lifetime', async t => {
  const { db, auth, user } = await fixture(t);
  const issued = await auth.issue(user);
  const claims = jwt.verify(issued.token, secret);
  assert.equal(claims.exp - claims.iat, 86400);
  const stored = (await db.query('SELECT * FROM mobile_sessions')).rows[0];
  assert.notEqual(stored.refresh_hash, issued.refreshToken);
  assert.equal(await auth.active(1, claims.mobileSessionId, 0), true);
  assert.equal(await auth.active(2, claims.mobileSessionId, 0), false);
  const res = response(); await auth.refresh({ body: { refreshToken: issued.refreshToken } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.sessionExpiresAt, issued.sessionExpiresAt);
  assert.equal(jwt.verify(res.body.token, secret).mobileSessionId, claims.mobileSessionId);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  // Retrying after a lost refresh response remains safe and does not lock out the device.
  const retry = response(); await auth.refresh({ body: { refreshToken: issued.refreshToken } }, retry);
  assert.equal(retry.code, 200);
});
test('logout revokes refresh and access session, without touching another device', async t => {
  const { auth, user } = await fixture(t);
  const first = await auth.issue(user); const second = await auth.issue(user);
  const claims = jwt.verify(first.token, secret);
  await auth.logout({ user: claims }, response());
  assert.equal(await auth.active(1, claims.mobileSessionId, 0), false);
  const res = response(); await auth.refresh({ body: { refreshToken: first.refreshToken } }, res); assert.equal(res.code, 401);
  const other = response(); await auth.refresh({ body: { refreshToken: second.refreshToken } }, other); assert.equal(other.code, 200);
});
test('password version change, expiration and user deletion prevent renewal', async t => {
  const { db, auth, user } = await fixture(t);
  const session = await auth.issue(user);
  await db.exec('UPDATE users SET token_version = 1 WHERE id = 1');
  let res = response(); await auth.refresh({ body: { refreshToken: session.refreshToken } }, res); assert.equal(res.code, 401);
  await db.exec('UPDATE users SET token_version = 0 WHERE id = 1');
  await db.exec("UPDATE mobile_sessions SET expires_at = NOW() - INTERVAL '1 second'");
  res = response(); await auth.refresh({ body: { refreshToken: session.refreshToken } }, res); assert.equal(res.code, 401);
  const next = await auth.issue(user);
  await db.exec('DELETE FROM users WHERE id = 1');
  res = response(); await auth.refresh({ body: { refreshToken: next.refreshToken } }, res); assert.equal(res.code, 401);
  assert.equal((await db.query('SELECT * FROM mobile_sessions')).rows.length, 0);
});
test('invalid refresh tokens are rejected before SQL; database failure is not a logout', async () => {
  const auth = createMobileAuth({ query: async () => { throw new Error('unavailable'); } }, secret);
  for (const token of [undefined, {}, 'bad', 'a'.repeat(65)]) {
    const res = response(); await auth.refresh({ body: { refreshToken: token } }, res); assert.equal(res.code, 401);
  }
  const res = response(); await auth.refresh({ body: { refreshToken: 'a'.repeat(64) } }, res); assert.equal(res.code, 503);
});

test('real login and authentication preserve web tokens and reject revoked Android access', async t => {
  const { db, user } = await fixture(t);
  const { Pool } = require('pg');
  const bcrypt = require('bcrypt');
  process.env.JWT_SECRET = secret;
  const handlers = require('./auth');
  await db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT; ALTER TABLE users ADD COLUMN username TEXT');
  await db.query('UPDATE users SET password_hash = $1, username = $2 WHERE id = 1', [await bcrypt.hash('synthetic-password', 4), 'Test baker']);
  t.mock.method(Pool.prototype, 'query', (sql, args) => db.query(sql, args));
  const web = response(); await handlers.login({ body: { email: user.email, password: 'synthetic-password' } }, web);
  assert.equal(web.code, 200); assert.equal(web.body.refreshToken, undefined);
  assert.equal(jwt.verify(web.body.token, secret).mobileSessionId, undefined);
  const mobile = response(); await handlers.login({ body: { email: user.email, password: 'synthetic-password', client: 'android' } }, mobile);
  assert.equal(mobile.code, 200); assert.match(mobile.body.refreshToken, /^[a-f0-9]{64}$/);
  const request = { headers: { authorization: `Bearer ${mobile.body.token}` } };
  let accepted = false;
  await handlers.authenticateToken(request, response(), () => { accepted = true; });
  assert.equal(accepted, true);
  await handlers.logoutMobileSession(request, response());
  const rejected = response(); await handlers.authenticateToken(request, rejected, () => assert.fail('Revoked session accepted'));
  assert.equal(rejected.code, 401);
  accepted = false;
  await handlers.authenticateToken({ headers: { authorization: `Bearer ${web.body.token}` } }, response(), () => { accepted = true; });
  assert.equal(accepted, true);
});
