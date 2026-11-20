// a DONE job with no verdict must never look like a pass
// the page and Recent PR Checks both say INCOMPLETE for it
import test from 'node:test';
import assert from 'node:assert/strict';
import { doneVerdict, toListItem, toStatus } from '../src/results.js';

const paste = { jobId: 'paste-0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', source: 'paste', attempt: 1, createdAt: '2026-11-19T10:00:00.000Z', updatedAt: '2026-11-19T10:00:05.000Z' };
const pr = { jobId: `pr-123-${'a'.repeat(40)}`, repo: 'vickyliuwt/gatekeeper-demo', prNumber: 3, headSha: 'a'.repeat(40), createdAt: '2026-11-19T10:00:00.000Z' };
const now = Date.parse('2026-11-19T10:01:00.000Z');

test('DONE with no verdict says INCOMPLETE on the poll route', () => {
  const s = toStatus({ ...paste, phase: 'DONE', reportKey: 'reports/x.json' }, now);
  assert.equal(s.phase, 'DONE');
  assert.equal(s.verdict, 'INCOMPLETE');
});

test('DONE with no verdict says INCOMPLETE in Recent PR Checks', () => {
  assert.equal(toListItem({ ...pr, phase: 'DONE' }, now).verdict, 'INCOMPLETE');
});

test('a job that is not done yet still has no verdict', () => {
  assert.equal(toStatus({ ...paste, phase: 'QUEUED' }, now).verdict, null);
  assert.equal(toStatus({ ...paste, phase: 'RUNNING' }, now).verdict, null);
  assert.equal(toListItem({ ...pr, phase: 'QUEUED' }, now).verdict, null);
});

test('real words still map the same', () => {
  assert.equal(doneVerdict('success'), 'PASS');
  assert.equal(doneVerdict('failure'), 'FAIL');
  assert.equal(doneVerdict('error'), 'INCOMPLETE');
  assert.equal(doneVerdict(''), 'INCOMPLETE');
  assert.equal(doneVerdict(undefined), 'INCOMPLETE');
});
