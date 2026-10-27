import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createIntake } from '../src/intake.js';

const secret = 'local-test-only';
const now = new Date('2026-10-27T12:00:00.000Z');

function payload() {
  return {
    action: 'opened',
    repository: { id: 123456, full_name: 'example/demo' },
    pull_request: { number: 7, head: { sha: 'a'.repeat(40) } },
  };
}

function signedRequest(value = payload(), eventName = 'pull_request') {
  const rawBody = Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  );

  return {
    rawBody,
    signature: 'sha256=' + createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex'),
    eventName,
    traceId: 'delivery-1',
  };
}

function setup({ failStore = false, failQueueOnce = false } = {}) {
  const jobs = new Map();
  const messages = [];
  const calls = [];
  let queueFailurePending = failQueueOnce;

  const intake = createIntake({
    secret,
    allowedRepo: 'example/demo',
    clock: () => new Date(now),
    createJobIfAbsent: async (job) => {
      calls.push('store');
      if (failStore) throw new Error('Storage unavailable');
      if (!jobs.has(job.jobId)) jobs.set(job.jobId, { ...job });
    },
    enqueue: async (message) => {
      calls.push('queue');
      if (queueFailurePending) {
        queueFailurePending = false;
        throw new Error('Queue unavailable');
      }
      messages.push(message);
    },
  });

  return { intake, jobs, messages, calls };
}

test('saves before enqueueing and then returns 202', async () => {
  const state = setup();
  const response = await state.intake(signedRequest());

  assert.equal(response.statusCode, 202);
  assert.deepEqual(state.calls, ['store', 'queue']);
  assert.equal(state.jobs.size, 1);
  assert.deepEqual(state.messages, [{
    jobId: response.body.jobId,
    traceId: 'delivery-1',
  }]);
});

test('rejects bad signatures before JSON parsing or side effects', async () => {
  const state = setup();
  const request = signedRequest('{invalid json');
  request.signature = 'sha256=' + '0'.repeat(64);

  assert.equal((await state.intake(request)).statusCode, 401);
  assert.deepEqual(state.calls, []);
});

test('rejects signed invalid JSON without side effects', async () => {
  const state = setup();

  assert.equal(
    (await state.intake(signedRequest('{invalid json'))).statusCode,
    400,
  );
  assert.deepEqual(state.calls, []);
});

test('ping and ignored actions never create jobs', async () => {
  const state = setup();
  const closed = { ...payload(), action: 'closed' };

  assert.equal(
    (await state.intake(signedRequest(payload(), 'ping'))).statusCode,
    200,
  );
  assert.equal(
    (await state.intake(signedRequest(closed))).statusCode,
    200,
  );
  assert.deepEqual(state.calls, []);
});

test('rejects another repository without side effects', async () => {
  const state = setup();
  const value = payload();
  value.repository.full_name = 'other/repo';

  assert.equal(
    (await state.intake(signedRequest(value))).statusCode,
    403,
  );
  assert.deepEqual(state.calls, []);
});

test('rejects an invalid PR before writing anything', async () => {
  const state = setup();
  const value = payload();
  value.pull_request.head.sha = 'short-sha';

  assert.equal(
    (await state.intake(signedRequest(value))).statusCode,
    400,
  );
  assert.deepEqual(state.calls, []);
});

test('storage failure returns 503 and never calls the queue', async () => {
  const state = setup({ failStore: true });

  assert.equal((await state.intake(signedRequest())).statusCode, 503);
  assert.deepEqual(state.calls, ['store']);
});

test('redelivery recovers from queue failure without overwriting the job', async () => {
  const state = setup({ failQueueOnce: true });

  const first = await state.intake(signedRequest());
  assert.equal(first.statusCode, 503);
  assert.equal(state.jobs.size, 1);
  assert.equal(state.messages.length, 0);

  const retry = signedRequest();
  retry.traceId = 'delivery-2';
  const second = await state.intake(retry);

  assert.equal(second.statusCode, 202);
  assert.equal(second.body.jobId, first.body.jobId);
  assert.equal(state.jobs.size, 1);
  assert.equal(state.jobs.get(first.body.jobId).traceId, 'delivery-1');
  assert.deepEqual(state.messages, [{
    jobId: first.body.jobId,
    traceId: 'delivery-2',
  }]);
});
