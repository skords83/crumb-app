const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { apiFetch } = require('./load-ts.cjs')(path.resolve(__dirname, '../src/lib/api.ts'));
function storage(t) {
  let token = 'saved-token';
  for (const [name, value] of Object.entries({ localStorage: { getItem: () => token, removeItem: () => { token = null; } }, window: { location: { href: '' } } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  return () => token;
}
test('network failure keeps the stored token', async t => {
  const getToken = storage(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  await assert.rejects(apiFetch('https://example.test/api/recipes'));
  assert.equal(getToken(), 'saved-token');
});
test('expired authentication clears the token and redirects to login', async t => {
  const getToken = storage(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await assert.rejects(apiFetch('https://example.test/api/recipes'));
  assert.equal(getToken(), null);
  assert.equal(window.location.href, '/login');
});
test('uploads retain multipart boundaries and attach authorization', async t => {
  storage(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.has('Content-Type'), false);
    assert.equal(options.headers.get('Authorization'), 'Bearer saved-token');
    return new Response('{}');
  });
  await apiFetch('https://example.test/api/upload', { method: 'POST', body: new FormData() });
});
