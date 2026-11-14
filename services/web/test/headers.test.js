// page must pass the course pentest SECURITY_HEADERS test (pentest/backend)
import test from 'node:test';
import assert from 'node:assert/strict';
import { html } from '../src/http.js';

test('the page sends every header the course pentest tool checks, and no technology header', () => {
  const { headers } = html(200, '<p>hi</p>', "default-src 'none'");
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-xss-protection'], '1; mode=block');
  assert.match(headers['strict-transport-security'], /max-age=\d+/);
  assert.ok(headers['content-security-policy']);
  assert.equal(headers.server, undefined);
  assert.equal(headers['x-powered-by'], undefined);
});
