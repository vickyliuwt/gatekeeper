// honest words for the scan states
// no made up Queued and no wrong retry time
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/logic.js';

const { GK } = globalThis;

test('a failed try says SQS gives the job back, not a wrong time', () => {
  const text = GK.statusLine({ phase: 'FAILED', attempt: 1, maxAttempts: 5 });
  assert.match(text, /Try 1 of 5 failed/);
  assert.match(text, /visibility timeout/);
  assert.doesNotMatch(text, /few minutes/);
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'FAILED', attempt: 2 }), /visibility timeout/);
});

test('reopened link before the first answer says Checking, never Queued', () => {
  const v = { mode: 'tracking', phase: null, attempt: 0 };
  assert.deepEqual(GK.phaseChip(v), { label: 'Checking', tone: 'run' });
  const s = GK.pipelineStates(v);
  // write path knows nothing yet
  for (const name of GK.WRITE_PATH) assert.equal(s[name], 'idle', name);
  // read path means this page is asking the results lambda
  for (const name of GK.READ_PATH) assert.equal(s[name], 'live', name);
  assert.match(GK.pipelineCaption(v), /Read path/);
  const steps = GK.lifecycle(v);
  for (const name of GK.STEPS) assert.equal(steps[name], 'todo', name);
});

test('Checking + Stop watching: read path turns paused', () => {
  const v = { mode: 'tracking', phase: null, attempt: 0, paused: true };
  assert.equal(GK.phaseChip(v).label, 'Paused');
  const s = GK.pipelineStates(v);
  for (const name of GK.READ_PATH) assert.equal(s[name], 'paused', name);
  for (const name of GK.WRITE_PATH) assert.equal(s[name], 'idle', name);
});

test('a real phase still wins over Checking', () => {
  assert.equal(GK.phaseChip({ mode: 'tracking', phase: 'QUEUED', attempt: 0 }).label, 'Queued');
  assert.equal(GK.phaseChip({ mode: 'tracking', phase: 'RUNNING', attempt: 1 }).label, 'Scanning');
});

test('request time text: ms under 1 s, seconds after', () => {
  assert.equal(GK.latencyText(84), '84 ms');
  assert.equal(GK.latencyText(999.4), '999 ms');
  assert.equal(GK.latencyText(1234), '1.2 s');
  assert.equal(GK.latencyText(-1), '');
  assert.equal(GK.latencyText(Number.NaN), '');
  assert.equal(GK.latencyText(undefined), '');
});

test('bad poll answers get short log words', () => {
  assert.equal(GK.pollProblem(200, false), '200 · empty answer');
  assert.equal(GK.pollProblem(429, true), '429 · slow down');
  assert.equal(GK.pollProblem(503, true), '503');
  assert.equal(GK.pollProblem(500, false), '500');
});

test('the 2 minute stop says what really came back', () => {
  assert.match(GK.stopNote(true, 503).text, /^Still scanning after 2 minutes/);
  assert.match(GK.stopNote(false, 503).text, /answered 503 for 2 minutes, never a job status/);
  assert.match(GK.stopNote(false, 429).say, /answered 429/);
  assert.match(GK.stopNote(false, 200).text, /an empty 200/);
  assert.match(GK.stopNote(false, 0).text, /^No answer from GateKeeper for 2 minutes/);
  assert.match(GK.stopNote(false, null).text, /^No answer from GateKeeper for 2 minutes/);
  // every note tells the user what to do next
  for (const n of [GK.stopNote(true, 0), GK.stopNote(false, 503), GK.stopNote(false, 0)]) assert.match(n.text, /Check again/);
});
