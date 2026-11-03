import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueSession, passwordsEqual, readAuthConfig, sessionValid } from '../src/server/auth.ts';

const config = { password: 'test-password', secret: 'a'.repeat(64), production: false };

test('signed sessions reject tampering, expiry, and another signing key', () => {
  const now = 10_000;
  const token = issueSession(config, now);
  assert.equal(sessionValid(token, config, now + 1), true);
  assert.equal(sessionValid(`${token}x`, config, now + 1), false);
  assert.equal(sessionValid(token, { ...config, secret: 'b'.repeat(64) }, now + 1), false);
  assert.equal(sessionValid(token, config, now + 13 * 60 * 60 * 1_000), false);
  assert.equal(sessionValid('not-a-session', config, now), false);
});

test('password comparison and production config fail closed', () => {
  assert.equal(passwordsEqual('test-password', config.password), true);
  assert.equal(passwordsEqual('other', config.password), false);
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production' }), /Set DEMO_PASSWORD/);
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production', DEMO_PASSWORD: 'secret', SESSION_SECRET: 'short' }));
});
