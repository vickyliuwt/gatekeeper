import test from 'node:test';
import assert from 'node:assert/strict';
import { isJobId, normalizeFilename, byteLength, MAX_CODE_BYTES } from '../src/validate.js';

const sha = 'a'.repeat(40);

test('accepts the two job ID shapes from README.md', () => {
  assert.equal(isJobId(`pr-1441247564-${sha}`), true);
  assert.equal(isJobId('paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b'), true);
});

test('rejects anything else before any database read', () => {
  for (const value of [
    undefined, null, '', 'pr-0-' + sha, 'pr-12-' + 'A'.repeat(40), 'pr-12-abc',
    'paste-3f2a9c4e-8b1d-1e6f-9a7b-2c5d8e1f0a3b', 'paste-../../etc/passwd', `pr-12-${sha}/report`,
  ]) {
    assert.equal(isJobId(value), false, String(value));
  }
});

test('file names default to snippet.js and must be a plain .js, .mjs or .cjs name', () => {
  assert.equal(normalizeFilename(undefined), 'snippet.js');
  assert.equal(normalizeFilename(''), 'snippet.js');
  assert.equal(normalizeFilename('app.mjs'), 'app.mjs');
  assert.equal(normalizeFilename(`${'a'.repeat(97)}.js`), `${'a'.repeat(97)}.js`);
  for (const bad of ['../x.js', 'a/b.js', 'x.py', '.js', '-x.js', `${'a'.repeat(98)}.js`, 42]) {
    assert.equal(normalizeFilename(bad), null, String(bad));
  }
});

test('size limits count UTF-8 bytes, not characters', () => {
  assert.equal(MAX_CODE_BYTES, 102400);
  assert.equal(byteLength('é'), 2);
});
