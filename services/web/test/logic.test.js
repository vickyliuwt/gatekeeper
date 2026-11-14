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

// ---- console helpers ----
const all = (state) => Object.fromEntries(GK.PIPELINE.map((n) => [n, state]));

test('the write path lights from the real phase only', () => {
  const W = (states) => Object.fromEntries(GK.WRITE_PATH.map((n) => [n, states[n] || 'idle']));
  const pick = (view) => W(GK.pipelineStates(view));
  assert.deepEqual(GK.pipelineStates({ mode: 'idle' }), all('idle'));
  assert.deepEqual(pick({ mode: 'sending' }), W({ api: 'active', submit: 'active' }));
  assert.deepEqual(pick({ mode: 'limited' }), W({ api: 'error' }));
  assert.deepEqual(pick({ mode: 'rejected' }), W({ api: 'done', submit: 'error' }));
  assert.deepEqual(pick({ mode: 'tracking', phase: 'QUEUED', attempt: 0 }), W({ api: 'done', submit: 'done', queue: 'active' }));
  assert.deepEqual(pick({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }), W({ api: 'done', submit: 'done', queue: 'done', worker: 'active' }));
  assert.deepEqual(pick({ mode: 'tracking', phase: 'FAILED', attempt: 1 }), W({ api: 'done', submit: 'done', queue: 'retry', worker: 'retry' }));
  assert.deepEqual(pick({ mode: 'tracking', phase: 'QUEUED', attempt: 1 }), W({ api: 'done', submit: 'done', queue: 'retry', worker: 'retry' }));
  assert.deepEqual(pick({ mode: 'tracking', phase: 'DONE', verdict: 'FAIL', reportReady: true }), W({ api: 'done', submit: 'done', queue: 'done', worker: 'done', store: 'done' }));
  assert.equal(GK.pipelineStates({ mode: 'tracking', phase: 'DONE', verdict: 'INCOMPLETE', reportReady: true }).worker, 'hold');
});

test('the read path polls while the job runs and reads the report once at DONE', () => {
  const R = (view) => GK.READ_PATH.map((n) => GK.pipelineStates(view)[n]);
  assert.deepEqual(GK.PIPELINE, [...GK.WRITE_PATH, ...GK.READ_PATH]);
  assert.deepEqual(R({ mode: 'idle' }), ['idle', 'idle', 'idle']);
  assert.deepEqual(R({ mode: 'sending' }), ['idle', 'idle', 'idle']);
  assert.deepEqual(R({ mode: 'tracking', phase: 'QUEUED', attempt: 0 }), ['live', 'live', 'live']);
  assert.deepEqual(R({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }), ['live', 'live', 'live']);
  assert.deepEqual(R({ mode: 'tracking', phase: 'DONE', verdict: 'PASS', reportReady: false }), ['done', 'active', 'active']);
  assert.deepEqual(R({ mode: 'tracking', phase: 'DONE', verdict: 'PASS', reportReady: true }), ['done', 'done', 'done']);
  // a dead link: nothing was sent now, the read path finds no item
  const lost = GK.pipelineStates({ mode: 'lost' });
  assert.deepEqual(GK.WRITE_PATH.map((n) => lost[n]), ['idle', 'idle', 'idle', 'idle', 'idle']);
  assert.deepEqual(R({ mode: 'lost' }), ['done', 'done', 'error']);
  assert.equal(GK.nodeLabel('live'), 'Polling');
});

test('every node state has a plain label, and captions never invent numbers', () => {
  for (const state of ['idle', 'active', 'done', 'retry', 'hold', 'error', 'live', 'paused']) assert.ok(GK.nodeLabel(state).length > 0);
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'RUNNING', attempt: 2 }), /try 2 of 5/);
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'FAILED', attempt: 1 }), /Try 1 of 5 failed/);
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'DONE', verdict: 'INCOMPLETE' }), /not safe/);
  assert.doesNotMatch(GK.pipelineCaption({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }), /%/);
});

test('chips and the 4 activity steps follow the job phase', () => {
  assert.deepEqual(GK.phaseChip({ mode: 'idle' }), { label: 'Idle', tone: 'idle' });
  assert.equal(GK.phaseChip({ mode: 'tracking', phase: 'QUEUED', attempt: 1 }).label, 'Retrying');
  assert.equal(GK.phaseChip({ mode: 'tracking', phase: 'DONE', verdict: 'FAIL' }).tone, 'stop');
  assert.deepEqual(GK.lifecycle({ mode: 'idle' }), { received: 'todo', queued: 'todo', scanning: 'todo', report: 'todo' });
  assert.deepEqual(GK.lifecycle({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }), { received: 'done', queued: 'done', scanning: 'active', report: 'todo' });
  assert.deepEqual(GK.lifecycle({ mode: 'tracking', phase: 'DONE', verdict: 'PASS', reportReady: true, hasReport: true }), { received: 'done', queued: 'done', scanning: 'done', report: 'done' });
  assert.deepEqual(GK.lifecycle({ mode: 'tracking', phase: 'DONE', verdict: 'INCOMPLETE', reportReady: true, hasReport: false }), { received: 'done', queued: 'done', scanning: 'hold', report: 'hold' });
});

test('the donut uses only real counts and fills the circle', () => {
  assert.deepEqual(GK.donutParts({ high: 0, medium: 0, low: 0 }, 100), { total: 0, parts: [] });
  const { total, parts } = GK.donutParts({ high: 1, medium: 2, low: 0 }, 300);
  assert.equal(total, 3);
  assert.deepEqual(parts.map((p) => p.key), ['high', 'medium']);
  const lengths = parts.map((p) => p.dash.split(' ').map(Number).reduce((a, b) => a + b, 0));
  for (const len of lengths) assert.ok(Math.abs(len - 300) < 0.05);
  assert.equal(parts[0].offset, 0);
});

test('findings sort HIGH first and counts match the list', () => {
  const list = [{ severity: 'LOW', file: 'a.js', line: 1 }, { severity: 'HIGH', file: 'b.js', line: 9 }, { severity: 'HIGH', file: 'b.js', line: 2 }, { severity: 'MEDIUM', file: 'a.js', line: 3 }];
  assert.deepEqual(GK.sortFindings(list).map((f) => `${f.severity}:${f.line}`), ['HIGH:2', 'HIGH:9', 'MEDIUM:3', 'LOW:1']);
  assert.deepEqual(GK.countBySeverity(list), { high: 2, medium: 1, low: 1 });
  assert.deepEqual(GK.sortFindings(null), []);
});

test('times, the env pill and the log text stay honest', () => {
  assert.equal(GK.formatDuration(5900), '5.9 s');
  assert.equal(GK.formatDuration(42000), '42 s');
  assert.equal(GK.formatDuration(72000), '1 min 12 s');
  assert.equal(GK.jobDurationMs({ phase: 'DONE', createdAt: '2026-11-11T22:34:10.000Z', updatedAt: '2026-11-11T22:34:15.900Z' }), 5900);
  assert.equal(GK.jobDurationMs({ phase: 'RUNNING', createdAt: '2026-11-11T22:34:10.000Z', updatedAt: '2026-11-11T22:34:15.900Z' }), null);
  assert.deepEqual(GK.envLabel('abc123xyz.execute-api.us-east-1.amazonaws.com'), { tone: 'aws', text: 'AWS · API Gateway · us-east-1' });
  assert.equal(GK.envLabel('127.0.0.1').tone, 'local');
  assert.equal(GK.statusSummary({ phase: 'DONE', verdict: 'FAIL' }), 'DONE · FAIL');
  assert.equal(GK.statusSummary({ phase: 'QUEUED', attempt: 1, maxAttempts: 5 }), 'QUEUED · try 1 of 5');
  assert.equal(GK.lineCount(''), 0);
  assert.equal(GK.lineCount('a\nb'), 2);
  assert.match(GK.verdictInfo('INCOMPLETE').gate, /blocked/);
  assert.equal(GK.shortJobId('paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b'), 'paste-3f2a9c4e…');
});

test('a paused job stops looking busy but keeps what is done', () => {
  const p = { mode: 'tracking', phase: 'RUNNING', attempt: 1, paused: true };
  const s = GK.pipelineStates(p);
  assert.deepEqual([s.api, s.submit, s.queue], ['done', 'done', 'done']);
  assert.deepEqual([s.worker, s.poll, s.results, s.read], ['paused', 'paused', 'paused', 'paused']);
  assert.equal(GK.nodeLabel('paused'), 'Paused');
  assert.deepEqual(GK.phaseChip(p), { label: 'Paused', tone: 'idle' });
  assert.match(GK.pipelineCaption(p), /stopped asking/);
  assert.match(GK.pipelineCaption(p), /may still run on AWS/);
  assert.equal(GK.lifecycle(p).scanning, 'paused');
  assert.equal(GK.pipelineStates({ mode: 'tracking', phase: 'QUEUED', attempt: 1, paused: true }).queue, 'paused');
});

test('paused is ignored once the job is DONE', () => {
  const d = { mode: 'tracking', phase: 'DONE', verdict: 'PASS', reportReady: true, paused: true };
  assert.equal(GK.phaseChip(d).label, 'PASS');
  assert.doesNotMatch(GK.pipelineCaption(d), /stopped asking/);
  assert.deepEqual(GK.pipelineStates(d), GK.pipelineStates({ ...d, paused: false }));
  assert.deepEqual(GK.lifecycle(d), GK.lifecycle({ ...d, paused: false }));
});

test('scan facts come from the job record and never print undefined', () => {
  const done = { phase: 'DONE', verdict: 'PASS', attempt: 2, maxAttempts: 5,
    createdAt: '2026-11-11T22:34:10.000Z', updatedAt: '2026-11-11T22:34:23.000Z' };
  assert.deepEqual(GK.scanFacts(done), [['Tries', '2 of 5'], ['Time to result', '13 s'], ['Result', 'DONE · PASS']]);
  const bare = GK.scanFacts({ phase: 'DONE', verdict: 'INCOMPLETE' });
  assert.deepEqual(bare.map(([k]) => k), ['Tries', 'Time to result', 'Result']);
  assert.equal(bare[0][1], 'not started');
  assert.equal(bare[1][1], '—');
  assert.doesNotMatch(JSON.stringify(bare), /undefined|NaN|null/);
});

test('the scan log opens by itself only after a retry or INCOMPLETE', () => {
  assert.equal(GK.scanLogOpen({ verdict: 'PASS', attempt: 1 }), false);
  assert.equal(GK.scanLogOpen({ verdict: 'FAIL', attempt: 1 }), false);
  assert.equal(GK.scanLogOpen({ verdict: 'PASS', attempt: 2 }), true);
  assert.equal(GK.scanLogOpen({ verdict: 'INCOMPLETE', attempt: 1 }), true);
});

test('local tests show only on my own machine', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', 'LOCALHOST']) assert.equal(GK.isLocalHost(h), true);
  for (const h of ['abc123.execute-api.us-east-1.amazonaws.com', 'example.com', '', undefined]) assert.equal(GK.isLocalHost(h), false);
});
