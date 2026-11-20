// the worker and the page must use the same words
// these tests keep the results Lambda safe even if a worker says success or HIGH
import test from 'node:test';
import assert from 'node:assert/strict';
import { toStatus, toListItem, normVerdict, normCounts, createResults } from '../src/results.js';
import { createMemoryStore, createMemoryBlobs } from '../src/memory.js';

test('GitHub words map to the page words', () => {
  assert.equal(normVerdict('success'), 'PASS');
  assert.equal(normVerdict('failure'), 'FAIL');
  assert.equal(normVerdict('error'), 'INCOMPLETE');
  assert.equal(normVerdict('PASS'), 'PASS');
  assert.equal(normVerdict('fail'), 'FAIL');
});

test('a verdict word we do not know is INCOMPLETE and never PASS', () => {
  assert.equal(normVerdict('ok'), 'INCOMPLETE');
  assert.equal(normVerdict(42), 'INCOMPLETE');
  assert.equal(normVerdict(null), null);
  assert.equal(normVerdict(undefined), null);
});

test('counts in upper case or as text still count', () => {
  assert.deepEqual(normCounts({ HIGH: 2, MEDIUM: '1', LOW: 0 }), { high: 2, medium: 1, low: 0 });
  assert.deepEqual(normCounts({ high: -1, medium: 'x' }), { high: 0, medium: 0, low: 0 });
  assert.equal(normCounts(null), null);
  assert.equal(normCounts([1, 2]), null);
});

test('a worker that says failure and HIGH still shows FAIL with the right count', () => {
  const s = toStatus({ jobId: 'paste-x', source: 'paste', phase: 'DONE', verdict: 'failure', counts: { HIGH: 1, MEDIUM: 2, LOW: 0 }, reportKey: 'reports/x.json' });
  assert.equal(s.verdict, 'FAIL');
  assert.deepEqual(s.counts, { high: 1, medium: 2, low: 0 });
  const row = toListItem({ jobId: 'pr-1-a', repo: 'o/r', verdict: 'success', counts: { HIGH: 0 } });
  assert.equal(row.verdict, 'PASS');
  assert.deepEqual(row.counts, { high: 0, medium: 0, low: 0 });
});

test('the report route maps the words too', async () => {
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  const jobId = 'paste-11111111-1111-4111-8111-111111111111';
  await store.create({ jobId, source: 'paste', phase: 'DONE', verdict: 'failure', reportKey: `reports/${jobId}.json`, traceId: 't' });
  await blobs.put(`reports/${jobId}.json`, JSON.stringify({ verdict: 'failure', counts: { HIGH: 1, MEDIUM: 0, LOW: 0 }, findings: [] }), 'application/json');
  const results = createResults({ store, blobs, page: { html: '', csp: '' }, log: () => {} });
  const res = await results.getReport({ params: { jobId } });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.verdict, 'FAIL');
  assert.deepEqual(body.counts, { high: 1, medium: 0, low: 0 });
});
