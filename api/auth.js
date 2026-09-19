const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// A predictable fallback would allow anyone to forge bearer tokens when the
// deployment configuration is incomplete. Refuse to start instead.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured and contain at least 32 characters');
}

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  const match = /^Bearer ([^ ]+)$/.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ error: 'Anmeldung erforderlich' });
  let verified;
  try {
    verified = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    if (!Number.isInteger(verified.userId) || !Number.isInteger(verified.tokenVersion)) throw new Error('Invalid claims');
  } catch {
    return res.status(401).json({ error: 'Anmeldung abgelaufen. Bitte erneut anmelden.' });
  }
  try {
    const result = await pool.query('SELECT token_version FROM users WHERE id = $1', [verified.userId]);
    if (!result.rows[0] || result.rows[0].token_version !== verified.tokenVersion) {
      return res.status(401).json({ error: 'Anmeldung abgelaufen. Bitte erneut anmelden.' });
    }
    req.user = verified;
    next();
  } catch (err) {
    console.error('Session verification failed:', err.message);
    res.status(503).json({ error: 'Anmeldung momentan nicht prüfbar' });
  }
};

// Login
const login = async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, tokenVersion: user.token_version },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Register
const register = async (req, res) => {
  const { email, password, username, inviteCode } = req.body || {};
  const expected = process.env.REGISTRATION_INVITE_CODE;
  if (!expected || expected.length < 32 || typeof inviteCode !== 'string' || inviteCode.length > 256 ||
      !crypto.timingSafeEqual(crypto.createHash('sha256').update(inviteCode).digest(), crypto.createHash('sha256').update(expected).digest())) {
    return res.status(403).json({ error: 'Registrierung nur mit gültigem Einladungscode möglich.' });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || typeof username !== 'string' || !email || !password || !username) {
    return res.status(400).json({ error: 'Email, username and password required' });
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters` });
  }

  if (username.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }

  try {
    const existingEmail = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const existingUsername = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, token_version',
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, tokenVersion: user.token_version },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Verify token
const verify = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Password reset request
const requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  if (typeof email !== 'string' || !email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    return res.status(503).json({ error: 'Passwortreset ist derzeit nicht eingerichtet. Bitte den Betreiber kontaktieren.' });
  }

  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({ message: 'If an account exists, a reset link will be sent' });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 12);
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
      [resetTokenHash, resetExpires, user.id]
    );

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } : undefined
    });

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}&uid=${user.id}`;
      
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@crumb.app',
      to: email,
      subject: 'Passwort zurücksetzen - Crumb',
      html: `
        <h1>Passwort zurücksetzen</h1>
        <p>Klicke auf den folgenden Link, um dein Passwort zurückzusetzen:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>Dieser Link ist 1 Stunde gültig.</p>
        <p>Falls du dies nicht angefordert hast, ignoriere diese E-Mail.</p>
      `
    });

    res.json({ message: 'If an account exists, a reset link will be sent' });
  } catch (err) {
    console.error('Password reset request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Reset password with token
const resetPassword = async (req, res) => {
  const { token, userId, newPassword } = req.body;

  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !userId || !newPassword) {
    return res.status(400).json({ error: 'Token, user ID and new password are required' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters` });
  }

  try {
    const result = await pool.query(
      'SELECT reset_token_hash, reset_token_expires FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const user = result.rows[0];

    if (!user.reset_token_hash || !user.reset_token_expires) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Token has expired' });
    }

    const validToken = await bcrypt.compare(token, user.reset_token_hash);
    if (!validToken) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2 AND reset_token_hash = $3 AND reset_token_expires > CURRENT_TIMESTAMP RETURNING id',
      [passwordHash, userId, user.reset_token_hash]
    );
    if (!updated.rowCount) return res.status(400).json({ error: 'Invalid or expired token' });

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Change password (logged in user)
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.userId;

  if (typeof currentPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters` });
  }

  try {
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1, reset_token_hash = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND password_hash = $3 RETURNING id',
      [passwordHash, userId, result.rows[0].password_hash]
    );
    if (!updated.rowCount) return res.status(409).json({ error: 'Passwort wurde bereits geändert. Bitte erneut anmelden.' });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  authenticateToken,
  login,
  register,
  verify,
  requestPasswordReset,
  resetPassword,
  changePassword
};
