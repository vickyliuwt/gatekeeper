import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrJob } from '../src/job.js';

const sha = 'a'.repeat(40);
const now = new Date('2026-10-27T12:00:00.000Z');

function payload() {
  return {
    repository: {
      id: 123456,
      full_name: 'example/demo',
    },
    pull_request: {
      number: 7,
      head: { sha },
    },
  };
}

test('creates the agreed initial job with a 30-day TTL', () => {
  assert.deepEqual(buildPrJob(payload(), 'delivery-1', now), {
    jobId: `pr-123456-${sha}`,
    source: 'pr',
    repo: 'example/demo',
    prNumber: 7,
    headSha: sha,
    phase: 'QUEUED',
    attempt: 0,
    traceId: 'delivery-1',
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:00.000Z',
    expiresAt: Date.parse('2026-11-26T12:00:00.000Z') / 1000,
  });
});

test('redeliveries keep the same job ID', () => {
  const first = buildPrJob(payload(), 'delivery-1', now);
  const second = buildPrJob(payload(), 'delivery-2', now);

  assert.equal(first.jobId, second.jobId);
  assert.notEqual(first.traceId, second.traceId);
});

test('a new commit gets a new job ID', () => {
  const updated = payload();
  updated.pull_request.head.sha = 'b'.repeat(40);

  assert.notEqual(
    buildPrJob(payload(), 'delivery-1', now).jobId,
    buildPrJob(updated, 'delivery-2', now).jobId,
  );
});

test('uses the base repository ID even for a fork PR', () => {
  const forkPr = payload();
  forkPr.pull_request.head.repo = {
    id: 999999,
    full_name: 'contributor/fork',
  };

  assert.equal(
    buildPrJob(forkPr, 'delivery-1', now).jobId,
    `pr-123456-${sha}`,
  );
});

test('rejects missing or invalid PR fields', () => {
  const cases = [
    null,
    {},
    { ...payload(), repository: { id: 0, full_name: 'example/demo' } },
    { ...payload(), repository: { id: 123456, full_name: '' } },
    { ...payload(), pull_request: { number: 0, head: { sha } } },
    { ...payload(), pull_request: { number: 7, head: { sha: 'abc123' } } },
  ];

  for (const value of cases) {
    assert.throws(() => buildPrJob(value, 'delivery-1', now), TypeError);
  }
});

test('rejects missing or unsafe delivery IDs', () => {
  for (const value of [undefined, '', 'bad\nid', 'a'.repeat(129)]) {
    assert.throws(
      () => buildPrJob(payload(), value, now),
      /Invalid delivery ID/,
    );
  }
});

test('rejects an invalid timestamp', () => {
  assert.throws(
    () => buildPrJob(payload(), 'delivery-1', new Date('invalid')),
    /Invalid timestamp/,
  );
});
