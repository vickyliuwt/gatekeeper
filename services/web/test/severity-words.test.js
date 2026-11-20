// small checks for severity levels and edge words
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/logic.js';

const { GK } = globalThis;

test('high in any case is still HIGH', () => {
  assert.equal(GK.severityTone('high'), 'high');
  assert.equal(GK.severityTone(' Medium '), 'medium');
  assert.equal(GK.severityLabel('low'), 'Low');
  assert.deepEqual(GK.countBySeverity([{ severity: 'high' }, { severity: 'HIGH' }, { severity: 'medium' }]), { high: 2, medium: 1, low: 0 });
});

test('an unknown level never turns into low', () => {
  assert.equal(GK.severityTone(undefined), 'unknown');
  assert.equal(GK.severityLabel(null), 'Unknown');
  assert.equal(GK.severityLabel('critical'), 'CRITICAL');
  assert.deepEqual(GK.countBySeverity([{}, { severity: 'CRITICAL' }, { severity: 'LOW' }]), { high: 0, medium: 0, low: 1 });
});

test('sorted findings keep HIGH first even in small letters', () => {
  const out = GK.sortFindings([{ severity: 'LOW', line: 2 }, { severity: 'high', line: 9 }, { severity: null, line: 1 }]);
  assert.deepEqual(out.map((f) => f.severity), ['HIGH', 'LOW', 'UNKNOWN']);
});

test('a job sent back from the dead letter queue never says try 6 of 5', () => {
  const line = GK.statusLine({ phase: 'RUNNING', attempt: 6, maxAttempts: 5 });
  assert.doesNotMatch(line, /6 of 5/);
  assert.match(line, /try 6/);
});

test('last try uses the max from the job', () => {
  assert.equal(GK.isLastTry({ phase: 'FAILED', attempt: 3, maxAttempts: 3 }), true);
  assert.equal(GK.isLastTry({ phase: 'FAILED', attempt: 3 }), false);
});

test('no answer is said in words', () => {
  assert.equal(GK.pollProblem(0, false), 'no answer');
  assert.equal(GK.pollProblem(503, true), '503');
});

test('over the size limit never shows 100 KB', () => {
  assert.equal(GK.formatKB(100 * 1024), '100 KB');
  assert.notEqual(GK.formatKB(100 * 1024 + 1), '100 KB');
});
