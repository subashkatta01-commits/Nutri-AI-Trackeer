import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { sendMail } from './mailer.js';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('requires a Brevo API key and verified sender address', async () => {
  delete process.env.BREVO_API_KEY;
  process.env.MAIL_FROM_EMAIL = 'verified@example.com';

  await assert.rejects(
    sendMail({ to: 'recipient@example.com', subject: 'Test', html: '<p>Test</p>' }),
    /Set BREVO_API_KEY and MAIL_FROM_EMAIL/
  );
});

test('sends email using the Brevo HTTPS API', async () => {
  process.env.BREVO_API_KEY = 'test-key';
  process.env.MAIL_FROM_EMAIL = 'verified@example.com';
  process.env.MAIL_FROM_NAME = 'Test App';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return { ok: true, json: async () => ({ messageId: 'test-message' }) };
  };

  const result = await sendMail({
    to: 'recipient@example.com',
    subject: 'Test',
    html: '<p>Hello</p>',
    text: 'Hello'
  });

  assert.equal(result.messageId, 'test-message');
  assert.equal(capturedRequest.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(capturedRequest.options.headers['api-key'], 'test-key');
  assert.deepEqual(JSON.parse(capturedRequest.options.body), {
    sender: { name: 'Test App', email: 'verified@example.com' },
    to: [{ email: 'recipient@example.com' }],
    subject: 'Test',
    htmlContent: '<p>Hello</p>',
    textContent: 'Hello'
  });
});

test('preserves Brevo error status and response details', async () => {
  process.env.BREVO_API_KEY = 'test-key';
  process.env.MAIL_FROM_EMAIL = 'verified@example.com';
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'invalid key'
  });

  await assert.rejects(
    sendMail({ to: 'recipient@example.com', subject: 'Test', html: '<p>Test</p>' }),
    error => error.status === 401 && /invalid key/.test(error.message)
  );
});
