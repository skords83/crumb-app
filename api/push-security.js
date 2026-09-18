const https = require('node:https');
const crypto = require('node:crypto');
const { safeLookup } = require('./safe-http');

function validatePushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 4096) throw new Error('Ungültiger Push-Endpunkt');
  const url = new URL(endpoint);
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.updates.push.services.mozilla.com') || host === 'web.push.apple.com' ||
    host.endsWith('.push.apple.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !allowed) {
    throw new Error('Push-Anbieter nicht erlaubt');
  }
  return url;
}

function validatePushSubscription({ endpoint, keys, userAgent }) {
  validatePushEndpoint(endpoint);
  if (userAgent !== undefined && (typeof userAgent !== 'string' || userAgent.length > 512)) throw new Error('Ungültiger User-Agent');
  if (!keys || typeof keys.auth !== 'string' || typeof keys.p256dh !== 'string' ||
      !/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth) ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh)) throw new Error('Ungültige Push-Schlüssel');
  if (Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('Ungültiger Auth-Schlüssel');
  crypto.ECDH.convertKey(Buffer.from(keys.p256dh, 'base64url'), 'prime256v1');
}

// Validate DNS at connection time as well, including records changed after subscription.
const pushAgent = new https.Agent({ lookup: safeLookup });
module.exports = { validatePushEndpoint, validatePushSubscription, pushAgent };
