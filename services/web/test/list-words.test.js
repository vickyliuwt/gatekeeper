// honest words for the PR list and the job link
// a job in the queue is not scanning yet
// a scan that skipped files never shows 0 counts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../public/logic.js';
import { PUBLIC_DIR } from '../src/page.js';

const { GK } = globalThis;
const app = readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf8');

test('a PR row chip follows the real phase', () => {
  assert.deepEqual(GK.listChip({ phase: 'QUEUED' }), { label: 'QUEUED', tone: 'run' });
  assert.deepEqual(GK.listChip({ phase: 'RUNNING' }), { label: 'SCANNING', tone: 'run' });
  assert.deepEqual(GK.listChip({ phase: 'FAILED' }), { label: 'RETRYING', tone: 'hold' });
  assert.deepEqual(GK.listChip({ phase: 'DONE', verdict: 'FAIL' }), { label: 'FAIL', tone: 'stop' });
  assert.deepEqual(GK.listChip({ phase: 'DONE', verdict: 'PASS' }), { label: 'PASS', tone: 'pass' });
  assert.deepEqual(GK.listChip({ phase: 'DONE', verdict: 'INCOMPLETE' }), { label: 'INCOMPLETE', tone: 'hold' });
  // no phase or an odd phase is not a scan in progress
  assert.deepEqual(GK.listChip({ phase: null }), { label: 'CHECKING', tone: 'idle' });
  assert.deepEqual(GK.listChip(null), { label: 'CHECKING', tone: 'idle' });
  assert.match(app, /const info = GK\.listChip\(item\);/);
  assert.doesNotMatch(app, /'RETRYING' : 'SCANNING'/);
});

test('the latest PR card uses the same words as the list', () => {
  assert.match(app, /const chip = GK\.listChip\(item\);/);
  assert.doesNotMatch(app, /label: 'scanning', tone: 'run'/);
});

test('PR row counts never show 0 for a scan that is not done or skipped files', () => {
  assert.equal(GK.listCountsWord({ phase: 'QUEUED', counts: null }), 'not yet');
  assert.equal(GK.listCountsWord({ phase: 'RUNNING', counts: null }), 'not yet');
  assert.equal(GK.listCountsWord({ phase: 'DONE', verdict: 'INCOMPLETE', counts: null }), 'not checked');
  assert.equal(GK.listCountsWord({ phase: 'DONE', verdict: 'FAIL', counts: null }), 'no counts');
  assert.equal(GK.listCountsWord({ phase: 'DONE', verdict: 'FAIL', counts: { high: 1, medium: 0, low: 0 } }), '');
  assert.match(app, /const word = GK\.listCountsWord\(item\);/);
});

test('a 200 answer with no phase is a bad answer and never a status', () => {
  assert.equal(GK.isStatusBody({ phase: 'QUEUED', attempt: 0 }), true);
  assert.equal(GK.isStatusBody({}), false);
  assert.equal(GK.isStatusBody(null), false);
  assert.equal(GK.isStatusBody({ phase: 7 }), false);
  assert.equal(GK.isStatusBody([]), false);
  assert.equal(GK.pollProblem(200, true), '200 · no phase');
  assert.equal(GK.pollProblem(200, false), '200 · empty answer');
  assert.match(app, /if \(code === 200 && GK\.isStatusBody\(body\)\) \{/);
});

test('a job link that is not a scan id says so and a missing one says nothing', () => {
  assert.equal(GK.linkProblem(null), null);
  assert.equal(GK.linkProblem(''), null);
  assert.equal(GK.linkProblem('paste-11111111-1111-4111-8111-111111111111'), null);
  assert.match(GK.linkProblem('abc'), /not a GateKeeper scan link/);
  assert.match(GK.linkProblem('paste-123'), /Paste code above/);
  assert.match(app, /const linkWords = GK\.linkProblem\(fromLink\);/);
});

test('the share link encodes the job id and an odd date never leaves an empty row', () => {
  assert.match(app, /\?job=\$\{encodeURIComponent\(status\.jobId\)\}/);
  assert.match(app, /const ago = when \? GK\.timeAgo\(when, Date\.now\(\)\) : '';/);
  assert.match(app, /if \(ago\) rows\.push\(subjectRow\('Scanned', ago\)\);/);
});
