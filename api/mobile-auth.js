const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Fixed maximum lifetime; refreshing never silently extends a device session.
const SESSION_DAYS = 30;
async function migrateMobileSessions(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS mobile_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash TEXT NOT NULL UNIQUE,
    token_version INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS mobile_sessions_user ON mobile_sessions(user_id)');
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function createMobileAuth(pool, secret) {
  function access(user, session) {
    return jwt.sign({ userId: user.id, email: user.email, tokenVersion: user.token_version, mobileSessionId: session.id },
      secret, { algorithm: 'HS256', expiresIn: Math.max(1, Math.min(86400, Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000))) });
  }
  async function issue(user) {
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomUUID();
    // Cleanup is scoped; existing devices are not logged out by a new login.
    await pool.query('DELETE FROM mobile_sessions WHERE user_id = $1 AND (expires_at <= NOW() OR token_version <> $2)', [user.id, user.token_version]);
    const { rows } = await pool.query(`INSERT INTO mobile_sessions (id, user_id, refresh_hash, token_version, expires_at)
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days') RETURNING id, expires_at`, [id, user.id, hash(refreshToken), user.token_version]);
    return { token: access(user, rows[0]), refreshToken, sessionExpiresAt: new Date(rows[0].expires_at).toISOString() };
  }
  async function active(userId, id, version) {
    if (typeof id !== 'string') return false;
    const { rows } = await pool.query('SELECT id FROM mobile_sessions WHERE id = $1 AND user_id = $2 AND token_version = $3 AND expires_at > NOW()', [id, userId, version]);
    return rows.length > 0;
  }
  async function refresh(req, res) {
    res.set('Cache-Control', 'no-store, private');
    const token = req.body?.refreshToken;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Gerätesitzung ungültig oder abgelaufen.' });
    try {
      const { rows } = await pool.query(`SELECT ms.id AS session_id, ms.expires_at, u.id, u.email, u.token_version
        FROM mobile_sessions ms JOIN users u ON u.id = ms.user_id
        WHERE ms.refresh_hash = $1 AND ms.expires_at > NOW() AND ms.token_version = u.token_version`, [hash(token)]);
      if (!rows[0]) return res.status(401).json({ error: 'Gerätesitzung ungültig oder abgelaufen.' });
      const user = rows[0];
      res.json({ token: access(user, { id: user.session_id, expires_at: user.expires_at }), sessionExpiresAt: new Date(user.expires_at).toISOString() });
    } catch { res.status(503).json({ error: 'Anmeldung momentan nicht erneuerbar.' }); }
  }
  async function logout(req, res) {
    res.set('Cache-Control', 'no-store, private');
    try {
      if (req.user.mobileSessionId) await pool.query('DELETE FROM mobile_sessions WHERE id = $1 AND user_id = $2', [req.user.mobileSessionId, req.user.userId]);
      res.json({ ok: true });
    } catch { res.status(503).json({ error: 'Gerätesitzung momentan nicht widerrufbar.' }); }
  }
  return { issue, active, refresh, logout };
}
module.exports = { migrateMobileSessions, createMobileAuth, SESSION_DAYS };
