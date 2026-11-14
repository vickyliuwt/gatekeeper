// served report keeps only known fields, so an extra worker field
// never reaches the public page
import test from 'node:test';
import assert from 'node:assert/strict';
import { FINDING_FIELDS, REPORT_FIELDS, maskReport } from '../src/mask.js';

const secretLine = 'const password = "admin1234";';

test('fields outside the report allow-list are dropped', () => {
  const served = maskReport({
    jobId: 'paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b',
    verdict: 'FAIL',
    counts: { high: 1, medium: 0, low: 0 },
    findings: [],
    rawCode: secretLine,
    debug: { evidence: secretLine },
  });
  assert.deepEqual(Object.keys(served).sort(), ['counts', 'findings', 'jobId', 'verdict']);
  assert.ok(!JSON.stringify(served).includes('admin1234'));
  for (const key of Object.keys(served)) assert.ok(key === 'findings' || REPORT_FIELDS.includes(key));
});

test('a report in the scanner server shape (vulnerabilities) is shown and masked like findings', () => {
  const served = maskReport({
    success: true,
    summary: { totalVulnerabilities: 1, high: 1, medium: 0, low: 0 },
    vulnerabilities: [{ id: 'HARDCODED_SECRET', name: 'Hardcoded Secret', severity: 'HIGH', file: 'a.js', line: 7, column: 7, evidence: secretLine }],
  });
  assert.equal(served.vulnerabilities, undefined);
  assert.equal(served.summary, undefined);
  assert.equal(served.findings.length, 1);
  assert.equal(served.findings[0].evidence, 'const password = "admi****";');
  assert.ok(!JSON.stringify(served).includes('admin1234'));
});

test('extra fields inside a finding are dropped, and the result is stable when masked again', () => {
  const served = maskReport({
    findings: [{ id: 'HARDCODED_SECRET', severity: 'HIGH', file: 'a.js', line: 1, evidence: secretLine, match: 'admin1234', source: secretLine }],
  });
  assert.deepEqual(Object.keys(served.findings[0]).sort(), ['evidence', 'file', 'id', 'line', 'severity']);
  for (const key of Object.keys(served.findings[0])) assert.ok(FINDING_FIELDS.includes(key));
  assert.ok(!JSON.stringify(served).includes('admin1234'));
  assert.deepEqual(maskReport(served), served);
});

test('a report that is not an object becomes an empty report', () => {
  for (const bad of [null, 'text', 42, [1, 2]]) assert.deepEqual(maskReport(bad), { findings: [] });
});
