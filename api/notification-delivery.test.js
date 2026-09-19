const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const webpush = require('web-push');
const { initWebPush, sendNotification, dispatch } = require('./notification-engine');
const { router, setPool } = require('./push');

function configure() {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  initWebPush();
}
function fixture() {
  const curve = crypto.createECDH('prime256v1'); curve.generateKeys();
  let devices = [{ id: 1, endpoint: 'https://fcm.googleapis.com/id', p256dh: curve.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }];
  let claimed = false;
  const pool = { query: async sql => {
    if (sql.startsWith('SELECT id, endpoint')) return { rows: devices };
    if (sql.startsWith('DELETE FROM push_subscriptions')) { devices = []; return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE push_subscriptions')) return { rowCount: 1 };
    if (sql.startsWith('INSERT INTO sent_notifications')) {
      if (claimed) return { rowCount: 0, rows: [] };
      claimed = true; return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (sql.startsWith('DELETE FROM sent_notifications')) { claimed = false; return { rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return { pool };
}
const candidate = { notificationId: 'test-id', title: 'Test', message: 'Test' };

test('disabled push is not reported as successful by test endpoint', async () => {
  delete process.env.VAPID_PRIVATE_KEY; initWebPush();
  const { pool } = fixture(); setPool(pool);
  const route = router.stack.find(layer => layer.route?.path === '/test').route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await route({ user: { userId: 1 } }, res);
  assert.equal(res.code, 503);
});

test('failed provider delivery can be retried and successful delivery is deduplicated', async t => {
  configure(); const { pool } = fixture();
  const sender = t.mock.method(webpush, 'sendNotification', async () => { throw new Error('Provider unavailable'); });
  assert.equal(await dispatch(pool, 1, 1, candidate), false);
  sender.mock.mockImplementation(async () => ({}));
  assert.equal(await dispatch(pool, 1, 1, candidate), true);
  assert.equal(await dispatch(pool, 1, 1, candidate), false);
  assert.equal(sender.mock.callCount(), 2);
});

test('expired subscriptions are removed and no-device delivery remains unsuccessful', async t => {
  configure(); const { pool } = fixture();
  t.mock.method(webpush, 'sendNotification', async () => { throw Object.assign(new Error('Expired'), { statusCode: 410 }); });
  const failed = await sendNotification(pool, 1, candidate);
  assert.equal(failed.sent, 0); assert.equal(failed.failed, 1);
  const empty = await sendNotification(pool, 1, candidate);
  assert.equal(empty.attempted, 0); assert.equal(empty.sent, 0);
});
