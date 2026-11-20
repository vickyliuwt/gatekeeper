import test from 'node:test';
import assert from 'node:assert/strict';
import { createResults, resultsRoutes, toStatus } from '../src/results.js';
import { createMemoryBlobs, createMemoryStore } from '../src/memory.js';
import { renderPage } from '../src/page.js';
import { captureLog } from './helpers.js';

const REPO = 'owner/gatekeeper-demo';
const PASTE_ID = 'paste-3f2a9c4e-8b1d-4e6f-9a7b-2c5d8e1f0a3b';
const page = renderPage({
  template: '<!doctype html><html><head><!--STYLE--></head><body><!--SCRIPT--></body></html>',
  style: 'body{color:#000}',
  scripts: ['var a = 1;'],
});

function prJob(n, fields = {}) {
  const sha = n.toString(16).padStart(40, '0');
  return {
    jobId: `pr-7812-${sha}`,
    source: 'pr',
    repo: REPO,
    prNumber: n,
    headSha: sha,
    phase: 'DONE',
    verdict: 'PASS',
    counts: { high: 0, medium: 1, low: 0 },
    attempt: 1,
    traceId: `trace-${n}`,
    createdAt: new Date(Date.UTC(2026, 10, 2, 12, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 10, 2, 12, n)).toISOString(),
    ...fields,
  };
}

function setup() {
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  let reads = 0;
  const countingStore = {
    ...store,
    async get(jobId) {
      reads += 1;
      return store.get(jobId);
    },
  };
  const { log, lines } = captureLog();
  const results = createResults({ store: countingStore, blobs, allowedRepo: REPO, page, log });
  return { store, blobs, results, lines, reads: () => reads };
}

const request = (jobId) => ({ params: { jobId }, headers: {} });

test('GET / serves the page with a strict policy and safe headers', async () => {
  const { results } = setup();
  const response = await results.showPage({});
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(response.headers['content-security-policy'], /default-src 'none'; script-src 'sha256-/);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
});

test('GET /scans lists the newest 20 PR scans of the demo repo only', async () => {
  const s = setup();
  for (let n = 1; n <= 22; n += 1) await s.store.put(prJob(n));
  await s.store.put(prJob(30, { repo: 'someone/else' }));
  await s.store.put({ jobId: PASTE_ID, source: 'paste', phase: 'DONE', createdAt: '2026-11-03T00:00:00.000Z' });

  const response = await s.results.listRecent({});
  const { items } = JSON.parse(response.body);
  assert.equal(items.length, 20);
  assert.equal(items[0].prNumber, 22);
  assert.equal(items[19].prNumber, 3);
  assert.ok(items.every((item) => item.repo === REPO));
  assert.deepEqual(Object.keys(items[0]), ['jobId', 'repo', 'prNumber', 'headSha', 'phase', 'verdict', 'counts', 'createdAt']);
});

test('GET /scans with no scans answers an empty list', async () => {
  const { results } = setup();
  assert.deepEqual(JSON.parse((await results.listRecent({})).body), { items: [] });
});

test('a malformed job ID answers 404 without reading the table', async () => {
  const s = setup();
  for (const id of ['', 'abc', '../../etc', 'pr-1-xyz']) {
    assert.equal((await s.results.getStatus(request(id))).statusCode, 404);
  }
  assert.equal(s.reads(), 0);
});

test('an unknown job answers 404', async () => {
  const { results } = setup();
  assert.equal((await results.getStatus(request(PASTE_ID))).statusCode, 404);
});

test('while a job runs, verdict and counts stay null', async () => {
  const s = setup();
  await s.store.put({ jobId: PASTE_ID, source: 'paste', filename: 'demo.js', phase: 'RUNNING', attempt: 2, traceId: 't', createdAt: 'c', updatedAt: 'u' });
  const body = JSON.parse((await s.results.getStatus(request(PASTE_ID))).body);
  assert.deepEqual(body, {
    jobId: PASTE_ID,
    source: 'paste',
    phase: 'RUNNING',
    verdict: null,
    counts: null,
    attempt: 2,
    maxAttempts: 5,
    hasReport: false,
    createdAt: 'c',
    updatedAt: 'u',
    filename: 'demo.js',
  });
});

test('a finished PR job shows its verdict, counts and commit', async () => {
  const job = prJob(5, { verdict: 'FAIL', counts: { high: 1, medium: 0, low: 0 }, reportKey: 'reports/x.json' });
  const status = toStatus(job);
  assert.equal(status.verdict, 'FAIL');
  assert.equal(status.hasReport, true);
  assert.equal(status.repo, REPO);
  assert.equal(status.prNumber, 5);
  assert.equal(status.headSha, job.headSha);
});

test('the report route answers 409 while the scan is not finished', async () => {
  const s = setup();
  await s.store.put({ jobId: PASTE_ID, source: 'paste', phase: 'QUEUED', traceId: 't' });
  const response = await s.results.getReport(request(PASTE_ID));
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).phase, 'QUEUED');
});

test('DONE without a report, or an expired report, answers 404', async () => {
  const s = setup();
  await s.store.put({ jobId: PASTE_ID, source: 'paste', phase: 'DONE', verdict: 'INCOMPLETE', traceId: 't' });
  assert.equal((await s.results.getReport(request(PASTE_ID))).statusCode, 404);
  const expired = prJob(1, { reportKey: 'reports/gone.json' });
  await s.store.put(expired);
  assert.equal((await s.results.getReport(request(expired.jobId))).statusCode, 404);
});

test('a broken report file answers 500 bad_report', async () => {
  const s = setup();
  const job = prJob(2, { reportKey: 'reports/bad.json' });
  await s.store.put(job);
  await s.blobs.put('reports/bad.json', '{broken', 'application/json');
  const response = await s.results.getReport(request(job.jobId));
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'bad_report');
});

test('the report is masked again before it leaves, even if the worker forgot', async () => {
  const s = setup();
  const job = prJob(3, { reportKey: 'reports/r.json' });
  await s.store.put(job);
  await s.blobs.put('reports/r.json', JSON.stringify({
    jobId: job.jobId,
    findings: [{ id: 'HARDCODED_SECRET', severity: 'HIGH', evidence: 'const apiKey = "sk_live_FAKEdemo1234";' }],
  }), 'application/json');
  const response = await s.results.getReport(request(job.jobId));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).findings[0].evidence, 'const apiKey = "sk_l****";');
});

test('exactly four read routes exist', () => {
  const { results } = setup();
  assert.deepEqual(Object.keys(resultsRoutes(results)), ['GET /', 'GET /scans', 'GET /scans/{jobId}', 'GET /scans/{jobId}/report']);
});
