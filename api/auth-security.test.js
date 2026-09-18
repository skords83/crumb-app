const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
const originalQuery = Pool.prototype.query;
let query;
Pool.prototype.query = function (...args) { return query(...args); };
after(() => { Pool.prototype.query = originalQuery; });
const auth = require('./auth');
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(token) { return { headers: { authorization: `Bearer ${token}` } }; }
function token(version = 0) { return jwt.sign({ userId: 1, tokenVersion: version }, process.env.JWT_SECRET); }

test('registration is closed by default and rejects wrong invitations without querying DB', async () => {
  query = () => { throw new Error('Database must not be reached'); };
  delete process.env.REGISTRATION_INVITE_CODE;
  let res = response();
  await auth.register({ body: {} }, res);
  assert.equal(res.code, 403);
  process.env.REGISTRATION_INVITE_CODE = 'a'.repeat(64);
  res = response();
  await auth.register({ body: { inviteCode: 'b'.repeat(64) } }, res);
  assert.equal(res.code, 403);
});

test('valid invitation permits registration and issues a versioned token', async () => {
  query = async sql => sql.startsWith('INSERT') ? { rows: [{ id: 1, username: 'baker', email: 'baker@example.com', token_version: 0 }] } : { rows: [] };
  const res = response();
  await auth.register({ body: { inviteCode: 'a'.repeat(64), username: 'baker', email: 'baker@example.com', password: 'a-valid-password' } }, res);
  assert.equal(res.code, 201);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).tokenVersion, 0);
});

test('password change revokes existing tokens and clears reset links', async () => {
  let version = 0;
  const hash = await bcrypt.hash('old-password', 4);
  query = async (sql, values) => {
    if (sql.startsWith('SELECT token_version')) return { rows: [{ token_version: version }] };
    if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: hash }] };
    assert.match(sql, /token_version = token_version \+ 1/);
    assert.match(sql, /reset_token_hash = NULL/);
    assert.match(sql, /AND password_hash = \$3/);
    assert.equal(values[2], hash);
    assert.ok(await bcrypt.compare('new-password-123', values[0]));
    version++;
    return { rowCount: 1 };
  };
  const oldToken = token();
  let accepted = false;
  await auth.authenticateToken(request(oldToken), response(), () => { accepted = true; });
  assert.ok(accepted);
  const res = response();
  await auth.changePassword({ user: { userId: 1 }, body: { currentPassword: 'old-password', newPassword: 'new-password-123' } }, res);
  assert.equal(res.code, 200);
  const denied = response();
  await auth.authenticateToken(request(oldToken), denied, () => assert.fail('Revoked token accepted'));
  assert.equal(denied.code, 401);
  await auth.authenticateToken(request(token(1)), response(), () => { accepted = true; });
});

test('legacy, expired and deleted-account tokens are rejected', async () => {
  query = async () => ({ rows: [] });
  for (const bearer of [jwt.sign({ userId: 1 }, process.env.JWT_SECRET), jwt.sign({ userId: 1, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: -1 }), token()]) {
    const res = response();
    await auth.authenticateToken(request(bearer), res, () => assert.fail('Invalid token accepted'));
    assert.equal(res.code, 401);
  }
});

test('reset link consumption is conditional and rejects concurrent reuse', async () => {
  const resetToken = 'a'.repeat(64);
  const resetHash = await bcrypt.hash(resetToken, 4);
  let consumed = false;
  query = async sql => {
    if (sql.startsWith('SELECT')) return { rows: [{ reset_token_hash: resetHash, reset_token_expires: new Date(Date.now() + 60000) }] };
    assert.match(sql, /token_version = token_version \+ 1/);
    assert.match(sql, /AND reset_token_hash = \$3 AND reset_token_expires > CURRENT_TIMESTAMP/);
    const rowCount = consumed ? 0 : 1;
    consumed = true;
    return { rowCount };
  };
  const results = [response(), response()];
  await Promise.all(results.map(res => auth.resetPassword({ body: { token: resetToken, userId: 1, newPassword: 'new-password-123' } }, res)));
  assert.deepEqual(results.map(r => r.code).sort(), [200, 400]);
});
