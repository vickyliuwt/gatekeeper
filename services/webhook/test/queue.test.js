import test from 'node:test';
import assert from 'node:assert/strict';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createJobQueue } from '../src/queue.js';

const queueUrl = 'https://example.invalid/test-queue';
const message = { jobId: 'pr-test', traceId: 'delivery-1' };

test('sends only jobId and traceId to the configured queue', async () => {
  const sent = [];
  const queue = createJobQueue({
    queueUrl,
    sqsClient: {
      async send(command) { sent.push(command); },
    },
  });

  await queue.enqueue({ ...message, phase: 'QUEUED' });

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof SendMessageCommand);
  assert.equal(sent[0].input.QueueUrl, queueUrl);
  assert.deepEqual(JSON.parse(sent[0].input.MessageBody), message);
});

test('propagates an SQS send failure to intake', async () => {
  const failure = new Error('Queue unavailable');
  const queue = createJobQueue({
    queueUrl,
    sqsClient: {
      async send() { throw failure; },
    },
  });

  await assert.rejects(
    () => queue.enqueue(message),
    (error) => error === failure,
  );
});
