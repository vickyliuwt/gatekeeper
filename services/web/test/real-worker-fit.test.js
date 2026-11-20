// checks that my page fits the real worker on part a
// it reads codeKey and writes success or failure and HIGH MEDIUM LOW
// its report has a number of files and scan times
// and it leaves a job FAILED after the last try
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSubmit } from '../src/submit.js';
import { createResults, toStatus, toListItem, stopReason, STOP_AFTER_MS, LIST_STOP_AFTER_MS } from '../src/results.js';
import { maskReport, cleanScanned } from '../src/mask.js';
import { createMemoryBlobs, createMemoryQueue, createMemoryStore } from '../src/memory.js';
import '../public/logic.js';

const GK = globalThis.GK;
const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const workerReport = JSON.parse(readFileSync(new URL('./fixtures/report.paste.worker.json', import.meta.url), 'utf8'));

async function pasteJob() {
  const store = createMemoryStore();
  const submit = createSubmit({ getAccessCode: async () => 'demo-code-1234', blobs: createMemoryBlobs(), store, queue: createMemoryQueue(), log: () => {} });
  const res = await submit({ headers: { 'x-demo-code': 'demo-code-1234', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'const a = 1;\n', filename: 'a.js' }) });
  assert.equal(res.statusCode, 202);
  return store.get(JSON.parse(res.body).jobId);
}

function resultsWith(job, report) {
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  store.items.set(job.jobId, job);
  if (report) blobs.objects.set(job.reportKey, { text: JSON.stringify(report), contentType: 'application/json' });
  return createResults({ store, blobs, allowedRepo: 'vickyliuwt/gatekeeper-demo', page: { html: '<p>x</p>', csp: "default-src 'none'" }, log: () => {}, clock: () => NOW });
}

const PASTE = 'paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b';

test('submit saves codeKey with the same value as pastedKey', async () => {
  const job = await pasteJob();
  assert.equal(job.codeKey, job.pastedKey);
  assert.match(job.codeKey, /^pasted\/paste-[0-9a-f-]+\.js$/);
});

test('success and HIGH from the worker show as PASS and high', () => {
  const s = toStatus({ jobId: PASTE, source: 'paste', phase: 'DONE', verdict: 'success', counts: { HIGH: 0, MEDIUM: 2, LOW: 0 }, attempt: 1, reportKey: 'r' }, NOW);
  assert.equal(s.verdict, 'PASS');
  assert.deepEqual(s.counts, { high: 0, medium: 2, low: 0 });
  const f = toStatus({ jobId: PASTE, source: 'paste', phase: 'DONE', verdict: 'failure', counts: { HIGH: 1, MEDIUM: 0, LOW: 0 }, attempt: 1, reportKey: 'r' }, NOW);
  assert.equal(f.verdict, 'FAIL');
  assert.equal(GK.verdictInfo(f.verdict).label, 'FAIL');
});

test('FAILED after the last try shows DONE and INCOMPLETE with no report', () => {
  const s = toStatus({ jobId: PASTE, source: 'paste', phase: 'FAILED', attempt: 5, updatedAt: ago(1000) }, NOW);
  assert.equal(s.phase, 'DONE');
  assert.equal(s.verdict, 'INCOMPLETE');
  assert.equal(s.counts, null);
  assert.equal(s.hasReport, false);
  assert.equal(s.stopped, 'last_try');
  assert.equal(s.storedPhase, 'FAILED');
  assert.match(GK.finishLine(s, false, null), /stopped after try 5 of 5/);
  assert.match(GK.reportMissingText(s, null), /stopped before a report/);
  assert.equal(GK.countsState(s, false), 'none');
});

test('FAILED before the last try keeps waiting', () => {
  const s = toStatus({ jobId: PASTE, source: 'paste', phase: 'FAILED', attempt: 2, updatedAt: ago(60 * 1000) }, NOW);
  assert.equal(s.phase, 'FAILED');
  assert.equal(s.verdict, null);
  assert.equal('stopped' in s, false);
});

test('no update for 20 min counts as stopped but QUEUED never does', () => {
  const failed = { jobId: PASTE, source: 'paste', phase: 'FAILED', attempt: 2, updatedAt: ago(STOP_AFTER_MS) };
  assert.equal(stopReason(failed, NOW), 'no_update');
  const running = { jobId: PASTE, source: 'paste', phase: 'RUNNING', attempt: 5, updatedAt: ago(STOP_AFTER_MS + 1) };
  assert.equal(toStatus(running, NOW).stopped, 'no_update');
  assert.equal(stopReason({ ...running, updatedAt: ago(90 * 1000) }, NOW), null);
  assert.equal(stopReason({ jobId: PASTE, phase: 'QUEUED', attempt: 0, updatedAt: ago(5 * STOP_AFTER_MS) }, NOW), null);
  assert.equal(stopReason({ jobId: PASTE, phase: 'DONE', attempt: 1, updatedAt: ago(5 * STOP_AFTER_MS) }, NOW), null);
  assert.match(GK.stoppedText({ stopped: 'no_update' }), /No update for 20 minutes/);
});

test('an old FAILED row in the PR list shows INCOMPLETE', () => {
  const sha = 'a'.repeat(40);
  const old = toListItem({ jobId: `pr-1-${sha}`, repo: 'o/r', prNumber: 3, headSha: sha, phase: 'FAILED', createdAt: ago(LIST_STOP_AFTER_MS) }, NOW);
  assert.equal(old.phase, 'DONE');
  assert.equal(old.verdict, 'INCOMPLETE');
  assert.equal(old.stopped, 'no_update');
  const fresh = toListItem({ jobId: `pr-1-${sha}`, repo: 'o/r', prNumber: 3, headSha: sha, phase: 'FAILED', createdAt: ago(60 * 1000) }, NOW);
  assert.equal(fresh.phase, 'FAILED');
  assert.equal(GK.listChip(old).label, 'INCOMPLETE');
});

test('the worker report keeps its numbers and drops traceId', () => {
  const out = maskReport(workerReport);
  assert.equal(out.scannedFiles, 1);
  assert.equal(out.sourceBytes, workerReport.sourceBytes);
  assert.equal(out.scanMs, 2);
  assert.equal(out.elapsedMs, 412);
  assert.equal('traceId' in out, false);
  assert.equal(JSON.stringify(out).includes('FAKEdemo1234'), false);
  assert.deepEqual(maskReport(out), out);
});

test('bad worker numbers are dropped and file names are masked', () => {
  const out = maskReport({ scanMs: -1, elapsedMs: '9', sourceBytes: Number.NaN, scannedFiles: ['a.js', 7, 'ghp_FAKEdemo00001234.js'], findings: [] });
  assert.equal('scanMs' in out, false);
  assert.equal('elapsedMs' in out, false);
  assert.equal('sourceBytes' in out, false);
  assert.deepEqual(out.scannedFiles, ['a.js', 'ghp_****.js']);
  assert.equal(cleanScanned(2.5), null);
  assert.equal(cleanScanned(3), 3);
});

test('the report route serves the worker report as FAIL with low case counts', async () => {
  const results = resultsWith({ jobId: PASTE, source: 'paste', phase: 'DONE', verdict: 'failure', counts: workerReport.counts, attempt: 1, reportKey: `reports/${PASTE}.json`, traceId: 't' }, workerReport);
  const res = await results.getReport({ params: { jobId: PASTE } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.verdict, 'FAIL');
  assert.equal(body.counts.high, workerReport.counts.HIGH);
  assert.deepEqual(GK.reportFacts(body).map((row) => row[0]), ['Files scanned', 'Code size', 'Scanner time', 'Worker time']);
});

test('a stopped job has no report and the status route says DONE', async () => {
  const results = resultsWith({ jobId: PASTE, source: 'paste', phase: 'FAILED', attempt: 5, updatedAt: ago(1000), traceId: 't' });
  const report = await results.getReport({ params: { jobId: PASTE } });
  assert.equal(report.statusCode, 404);
  assert.match(JSON.parse(report.body).message, /stopped before a report/);
  const status = JSON.parse((await results.getStatus({ params: { jobId: PASTE } })).body);
  assert.equal(status.phase, 'DONE');
  assert.equal(status.verdict, 'INCOMPLETE');
});

test('report facts accept a file list and skip missing numbers', () => {
  assert.deepEqual(GK.reportFacts({ scannedFiles: ['a.js', 'b.js'] }), [['Files scanned', '2']]);
  assert.deepEqual(GK.reportFacts(null), []);
});
