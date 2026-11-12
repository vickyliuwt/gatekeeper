import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/logic.js';

const { GK } = globalThis;

test('polls every 2 s for 20 s, then every 5 s, and at most 30 times in 2 minutes', () => {
  const times = GK.pollTimes();
  assert.equal(times.length, 30);
  assert.deepEqual(times.slice(0, 11), [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000]);
  assert.equal(times[11] - times[10], 5000);
  assert.ok(times.at(-1) < GK.POLL_LIMIT_MS);
});

test('polling stops when the job is DONE or after 2 minutes', () => {
  assert.equal(GK.shouldKeepPolling(5000, 'RUNNING'), true);
  assert.equal(GK.shouldKeepPolling(5000, 'DONE'), false);
  assert.equal(GK.shouldKeepPolling(120000, 'RUNNING'), false);
});

test('status lines use plain words and show the try number', () => {
  assert.equal(GK.statusLine({ phase: 'QUEUED', attempt: 0, maxAttempts: 5 }), 'Waiting in line for a scanner.');
  assert.equal(GK.statusLine({ phase: 'RUNNING', attempt: 2, maxAttempts: 5 }), 'Scanning, try 2 of 5.');
  assert.match(GK.statusLine({ phase: 'FAILED', attempt: 1, maxAttempts: 5 }), /Try 1 of 5 failed/);
});

test('each verdict has a tone and a summary', () => {
  assert.equal(GK.verdictInfo('PASS').tone, 'pass');
  assert.equal(GK.verdictInfo('FAIL').tone, 'stop');
  assert.equal(GK.verdictInfo('INCOMPLETE').tone, 'hold');
  assert.equal(GK.verdictInfo('???').label, 'UNKNOWN');
});

test('the page uses the same input rules as the server', () => {
  assert.equal(GK.isJobId('paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b'), true);
  assert.equal(GK.isJobId('paste-nope'), false);
  assert.equal(GK.isFilename('app.cjs'), true);
  assert.equal(GK.isFilename('../app.js'), false);
  assert.equal(GK.codeBytes('é'), 2);
});

test('small formatting helpers', () => {
  const now = Date.parse('2026-11-02T12:00:00.000Z');
  assert.equal(GK.timeAgo('2026-11-02T11:59:50.000Z', now), 'just now');
  assert.equal(GK.timeAgo('2026-11-02T11:53:00.000Z', now), '7 min ago');
  assert.equal(GK.timeAgo('2026-11-02T09:00:00.000Z', now), '3 h ago');
  assert.equal(GK.shortSha('9c1e2ab4d5e6f708'), '9c1e2ab');
  assert.equal(GK.countsLine({ high: 1, medium: 2 }), '1 high, 2 medium, 0 low');
  assert.equal(GK.formatKB(1536), '1.5 KB');
});
