import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSecretText, maskFinding, maskReport } from '../src/mask.js';

const CASES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mask-cases.json');

test('keeps the first 4 characters of each quoted text', () => {
  assert.equal(maskSecretText('const apiKey = "sk_live_FAKEdemo1234";'), 'const apiKey = "sk_l****";');
  assert.equal(maskSecretText("const password = 'admin123';"), "const password = 'admi****';");
});

test('short secrets are hidden completely', () => {
  assert.equal(maskSecretText('pwd: "abcd"'), 'pwd: "****"');
});

test('masking twice changes nothing', () => {
  const once = maskSecretText('const token = "ghp_FAKEdemo00001234";');
  assert.equal(maskSecretText(once), once);
});

test('a quote cut off by the 100-character evidence limit is masked to the end', () => {
  assert.equal(maskSecretText('const secretKey = "abcdefghijklmnopqrst...'), 'const secretKey = "abcd****');
});

test('a finding alone on its line is masked only when it is a secret', () => {
  const ip = { id: 'HARDCODED_IP', file: 'a.js', line: 2, evidence: 'const dbHost = "192.168.1.10";' };
  assert.deepEqual(maskFinding(ip), ip);
  const report = maskReport({ jobId: 'x', findings: [ip, { id: 'HARDCODED_SECRET', file: 'a.js', line: 9, evidence: 'password = "hunter22"' }] });
  assert.equal(report.findings[0].evidence, 'const dbHost = "192.168.1.10";');
  assert.equal(report.findings[1].evidence, 'password = "hunt****"');
});

test('a finding on the same line as a secret is masked too', () => {
  const line = 'const password = "admin123"; eval(input);';
  const report = maskReport({
    findings: [
      { id: 'HARDCODED_SECRET', file: 'a.js', line: 3, evidence: line },
      { id: 'INSECURE_FUNCTION', file: 'a.js', line: 3, evidence: line },
      { id: 'HARDCODED_IP', file: 'b.js', line: 3, evidence: 'const host = "10.0.0.5";' },
    ],
  });
  assert.equal(report.findings[0].evidence, 'const password = "admi****"; eval(input);');
  assert.equal(report.findings[1].evidence, 'const password = "admi****"; eval(input);');
  assert.equal(report.findings[2].evidence, 'const host = "10.0.0.5";');
  assert.deepEqual(maskReport(report), report);
});

test('a report without findings gets an empty list', () => {
  assert.deepEqual(maskReport({ jobId: 'x' }).findings, []);
});

test('the masking vectors in test/fixtures/mask-cases.json pass (Part B runs the same vectors)', () => {
  assert.ok(existsSync(CASES), 'test/fixtures/mask-cases.json is missing');
  const cases = JSON.parse(readFileSync(CASES, 'utf8'));
  for (const c of cases.text) {
    assert.equal(maskSecretText(c.in), c.out, c.in);
    assert.equal(maskSecretText(c.out), c.out, `idempotent: ${c.out}`);
  }
  for (const r of cases.reports) assert.deepEqual(maskReport({ findings: r.in }).findings, r.out, r.name);
});
