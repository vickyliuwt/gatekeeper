import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySignature } from '../src/signature.js';

const secret = "It's a Secret to Everybody";
const body = Buffer.from('Hello, World!', 'utf8');
const signature =
  'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

test('accepts the official GitHub test signature', () => {
  assert.equal(verifySignature(body, signature, secret), true);
});

test('rejects a modified request body', () => {
  const modifiedBody = Buffer.from('Hello, World! ');
  assert.equal(verifySignature(modifiedBody, signature, secret), false);
});

test('rejects a signature checked with the wrong secret', () => {
  assert.equal(verifySignature(body, signature, 'wrong-secret'), false);
});

test('rejects missing or malformed signatures without crashing', () => {
  for (const invalid of [
    undefined,
    '',
    'sha256=abc',
    'sha256=' + 'z'.repeat(64),
    'sha1=' + 'a'.repeat(40),
  ]) {
    assert.equal(verifySignature(body, invalid, secret), false);
  }
});

test('fails explicitly when the server secret is missing', () => {
  assert.throws(
    () => verifySignature(body, signature, ''),
    /secret is not configured/,
  );
});
