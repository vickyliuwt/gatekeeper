// masking rule 3: token shapes are masked in every finding (also outside quotes)
// a report shows at most 500 findings. public page, so extra safety
// on top of rules 1 and 2
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskReport, MAX_FINDINGS } from '../src/mask.js';

test('token shapes are masked outside quotes in non-secret findings, and masking twice changes nothing', () => {
  const report = {
    findings: [
      { id: 'INSECURE_FUNCTION', file: 'a.js', line: 2, evidence: 'exec(curl -u AKIAIOSFODNN7EXAMPLE x);' },
      { id: 'XSS', file: 'a.js', line: 3, evidence: 'el.innerHTML = sk_live_abcdefgh12345678 + name;' },
      { id: 'HARDCODED_IP', file: 'a.js', line: 4, evidence: 'const host = "10.0.0.5";' },
    ],
  };
  const once = maskReport(report);
  assert.equal(once.findings[0].evidence, 'exec(curl -u AKIA**** x);');
  assert.equal(once.findings[1].evidence, 'el.innerHTML = sk_l**** + name;');
  assert.equal(once.findings[2].evidence, 'const host = "10.0.0.5";');
  assert.deepEqual(maskReport(once), once);
});

test('a huge report is cut to MAX_FINDINGS findings', () => {
  const findings = Array.from({ length: MAX_FINDINGS + 25 }, (_, i) => ({ id: 'HARDCODED_IP', file: 'b.js', line: i + 1, evidence: 'x' }));
  assert.equal(maskReport({ findings }).findings.length, MAX_FINDINGS);
});
