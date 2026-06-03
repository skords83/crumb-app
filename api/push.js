// api/push.js
// ============================================================
// PUSH SUBSCRIPTIONS API — Web Push Subscribe/Unsubscribe
//
// Verwaltet Push-Subscriptions pro User (eine pro Browser/Gerät).
// Wird vom Frontend nach erfolgreicher Browser-Permission angesteuert.
// ============================================================
const express = require('express');
const router = express.Router();

// Pool wird vom Parent-Module injiziert
let pool;
function setPool(p) { pool = p; }

// ── GET /api/push/vapid-key — öffentlicher VAPID-Key fürs Frontend ──
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ── GET /api/push/status — hat dieser User Subscriptions? ──
router.get('/status', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1',
      [req.user.userId]
    );
    const n = result.rows[0].n;
    res.json({
      subscribed: n > 0,
      count: n,
      vapidConfigured: !!process.env.VAPID_PUBLIC_KEY,
    });
  } catch (err) {
    console.error('❌ push status Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/push/subscribe — Subscription registrieren ──
// Body: { endpoint, keys: { p256dh, auth }, userAgent? }
// Upsert: gleiche endpoint → update (z.B. wenn ein User Account-Wechsel macht).
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys, userAgent } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'endpoint, keys.p256dh, keys.auth erforderlich' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent`,
      [req.user.userId, endpoint, keys.p256dh, keys.auth, userAgent || null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('❌ subscribe Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/push/unsubscribe — Subscription entfernen ──
// Body: { endpoint? } — falls endpoint übergeben, nur diese; sonst alle dieses Users.
router.delete('/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  try {
    if (endpoint) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
        [endpoint, req.user.userId]
      );
    } else {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1',
        [req.user.userId]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ unsubscribe Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/push/test — Test-Notification an alle Subs des Users ──
// Praktisch beim Setup um zu prüfen ob Permissions + Subscription tatsächlich liefern.
router.post('/test', async (req, res) => {
  try {
    const { sendNotification } = require('./notification-engine');
    await sendNotification(pool, req.user.userId, {
      notificationId: `test-${Date.now()}`,
      title: '🧪 Crumb Test',
      message: 'Push-Benachrichtigungen funktionieren.',
      priority: 4,
      tags: 'test_tube',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ push test Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };