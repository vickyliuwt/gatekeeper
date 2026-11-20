// no try 6 of 5 anywhere on the page
// a job sent back from the dead letter queue can go past the max
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../public/logic.js';
import { PUBLIC_DIR } from '../src/page.js';

const { GK } = globalThis;
const after = { phase: 'RUNNING', attempt: 6, maxAttempts: 5 };

test('a job from the dead letter queue never says 6 of 5', () => {
  const words = [
    GK.statusLine(after),
    GK.statusLine({ phase: 'FAILED', attempt: 6, maxAttempts: 5 }),
    GK.statusLine({ phase: 'QUEUED', attempt: 6, maxAttempts: 5 }),
    GK.statusSummary(after),
    GK.pipelineCaption({ mode: 'tracking', ...after }),
    GK.stopNote(true, 0, { phase: 'FAILED', attempt: 6, maxAttempts: 5 }).text,
    GK.scanFacts(after)[0][1],
  ];
  for (const w of words) assert.doesNotMatch(w, /6 of 5/);
  assert.equal(GK.tryOf(6, 5), '6');
});

test('the job max wins over 5', () => {
  const v = { mode: 'tracking', phase: 'FAILED', attempt: 3, maxAttempts: 3 };
  assert.match(GK.pipelineCaption(v), /Try 3 of 3 failed/);
  assert.match(GK.stopNote(true, 0, v).text, /Try 3 of 3 failed/);
  assert.doesNotMatch(GK.pipelineCaption(v), /of 5/);
  assert.equal(GK.maxTries({}), 5);
});

test('normal jobs keep the same words as before', () => {
  assert.equal(GK.tryOf(2, 5), '2 of 5');
  assert.equal(GK.statusSummary({ phase: 'RUNNING', attempt: 2 }), 'RUNNING · try 2 of 5');
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }), /\(try 1 of 5\)/);
  assert.equal(GK.stopNote(true, 0, { phase: 'FAILED', attempt: 2 }).say, 'Waiting for try 3 of 5. This page stopped asking.');
});

test('the page keeps the job max for the AWS path and the 2 minute note', () => {
  const app = readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf8');
  assert.match(app, /current\.lastStatus = \{ phase: status\.phase, attempt, maxAttempts: GK\.maxTries\(status\) \};/);
  assert.match(app, /view = \{ mode: 'tracking', phase: status\.phase, attempt, maxAttempts: GK\.maxTries\(status\),/);
  assert.match(app, /ui\.tryText\.textContent = attempt > 0 \? GK\.tryOf\(attempt, GK\.maxTries\(status\)\) : 'not started';/);
});

test('odd try values from a bad answer never show junk', () => {
  assert.equal(GK.tryOf(undefined, undefined), '0 of 5');
  assert.equal(GK.tryOf('abc', null), '0 of 5');
  assert.equal(GK.tryOf(Infinity, 5), '0 of 5');
  assert.equal(GK.tryOf(2, 0), '2 of 5');
  assert.equal(GK.maxTries({ maxAttempts: -3 }), 5);
  assert.equal(GK.maxTries({ maxAttempts: 'x' }), 5);
  assert.equal(GK.maxTries({ maxAttempts: 3 }), 3);
  assert.equal(GK.isLastTry({ phase: 'FAILED', attempt: 0, maxAttempts: -3 }), false);
  assert.doesNotMatch(GK.statusSummary({ phase: 'RUNNING', attempt: 2, maxAttempts: 'x' }), /NaN|undefined|x/);
});
