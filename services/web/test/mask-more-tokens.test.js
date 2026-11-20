// more token shapes from the Learner Lab world
// ASIA temp keys and fine grained GitHub tokens and AWS session tokens
// the test tokens are joined at run time so no real looking key sits in this file
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskReport, maskTokens, maskSecretText } from '../src/mask.js';

const join = (...parts) => parts.join('');
const asia = join('AS', 'IA', 'QWERTYUIOPASDFGH');
const pat = join('github', '_pat_', '11ABCDEFG0123456789', '_', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD');
const session = join('IQoJ', 'b3JpZ2lu', 'X2VjEDgaCXVzLWVhc3QtMSJHMEUCIQ', '+abc/xyz==');

test('ASIA keys are masked like AKIA keys', () => {
  assert.equal(maskTokens(`curl -u ${asia} x`), 'curl -u ASIA**** x');
});

test('fine grained github_pat tokens are masked outside quotes', () => {
  assert.equal(maskTokens(`t = ${pat};`), 't = gith****;');
});

test('AWS session tokens are masked', () => {
  assert.equal(maskTokens(`aws_session_token = ${session} done`), 'aws_session_token = IQoJ**** done');
});

test('inside quotes the 4 char rule still wins', () => {
  assert.equal(maskSecretText(`const k = "${pat}";`), 'const k = "gith****";');
});

test('every new shape is masked in a non secret finding and twice is the same', () => {
  const report = {
    findings: [
      { id: 'INSECURE_FUNCTION', file: 'a.js', line: 1, evidence: `exec("aws s3 ls " + ${JSON.stringify(asia)});` },
      { id: 'XSS', file: 'a.js', line: 2, evidence: `el.innerHTML = ${pat};` },
      { id: 'HARDCODED_IP', file: 'a.js', line: 3, evidence: `x(${session})` },
    ],
  };
  const once = maskReport(report);
  const text = JSON.stringify(once);
  for (const raw of [asia, pat, session]) assert.equal(text.includes(raw), false);
  assert.deepEqual(maskReport(once), once);
});
