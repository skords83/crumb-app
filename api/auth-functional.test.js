const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
process.env.JWT_SECRET = 'functional-test-secret-with-at-least-32-characters';
const { requestPasswordReset } = require('./auth');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('missing SMTP configuration reports unavailable without disclosing account existence', async t => {
  delete process.env.SMTP_HOST;
  t.mock.method(Pool.prototype, 'query', async () => assert.fail('Should not look up accounts without SMTP'));
  const res = response();
  await requestPasswordReset({ body: { email: 'baker@example.com' } }, res);
  assert.equal(res.code, 503);
});

test('configured password reset creates a usable link and stores only its hash', async t => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_FROM = 'crumb@example.com';
  process.env.FRONTEND_URL = 'https://crumb.example.com';
  let savedHash, mail;
  t.mock.method(Pool.prototype, 'query', async (sql, values) => {
    if (sql.startsWith('SELECT')) return { rows: [{ id: 7 }] };
    savedHash = values[0];
    return { rowCount: 1 };
  });
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async message => { mail = message; } }));
  const res = response();
  await requestPasswordReset({ body: { email: 'baker@example.com' } }, res);
  assert.equal(res.code, 200);
  assert.equal(mail.to, 'baker@example.com');
  const link = new URL(mail.html.match(/href="([^"]+)"/)[1]);
  assert.equal(link.origin, 'https://crumb.example.com');
  assert.equal(link.pathname, '/reset-password');
  assert.equal(link.searchParams.get('uid'), '7');
  assert.equal(await bcrypt.compare(link.searchParams.get('token'), savedHash), true);
});
