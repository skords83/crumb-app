const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dns = require('node:dns');
const { validatePushEndpoint, validatePushSubscription } = require('./push-security');
const { isPublicIp, safeLookup } = require('./safe-http');

test('push endpoints only accept trusted HTTPS providers', () => {
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/id', 'https://updates.push.services.mozilla.com/wpush/v2/id', 'https://web.push.apple.com/id']) assert.doesNotThrow(() => validatePushEndpoint(endpoint));
  for (const endpoint of ['https://127.0.0.1/', 'https://[::ffff:7f00:1]/', 'http://fcm.googleapis.com/id', 'https://fcm.googleapis.com:8443/id', 'https://fcm.googleapis.com.evil.example/id', 'https://evil.example/?next=fcm.googleapis.com', 'https://user:pass@fcm.googleapis.com/id', 'https://fcm.googleapis.com/id#fragment']) assert.throws(() => validatePushEndpoint(endpoint));
});

test('subscription keys must be a valid P-256 point and a 16-byte authentication secret', () => {
  const curve = crypto.createECDH('prime256v1');
  curve.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/id', keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.doesNotThrow(() => validatePushSubscription(sub));
  assert.throws(() => validatePushSubscription({ ...sub, keys: { ...sub.keys, p256dh: Buffer.alloc(65).toString('base64url') } }));
  assert.throws(() => validatePushSubscription({ ...sub, keys: { ...sub.keys, auth: 'invalid' } }));
});

test('private, mapped and transition IP addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fd00::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
});

test('connection-time DNS lookup rejects rebinding and supports all-address lookups', async t => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  const lookup = options => new Promise((resolve, reject) => safeLookup('fcm.googleapis.com', options, (err, addresses) => err ? reject(err) : resolve(addresses)));
  await assert.rejects(lookup({ all: true }));
  dns.promises.lookup.mock.mockImplementation(async () => [{ address: '8.8.8.8', family: 4 }]);
  assert.deepEqual(await lookup({ all: true }), [{ address: '8.8.8.8', family: 4 }]);
});

test('import redirects to private IP literals are rejected before connecting', async t => {
  const axios = require('axios');
  const { safeGet } = require('./safe-http');
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(axios, 'get', async (_url, options) => {
    for (const hostname of ['127.0.0.1', '169.254.169.254', '[::ffff:7f00:1]']) {
      assert.throws(() => options.beforeRedirect({ protocol: 'https:', hostname }));
    }
    assert.throws(() => options.beforeRedirect({ protocol: 'http:', hostname: 'example.com' }));
    assert.doesNotThrow(() => options.beforeRedirect({ protocol: 'https:', hostname: 'example.com' }));
    return { data: 'ok' };
  });
  assert.equal((await safeGet('https://example.com')).data, 'ok');
});
