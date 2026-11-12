import test from 'node:test';
import assert from 'node:assert/strict';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { createJobStore } from '../src/store.js';

const job = { jobId: 'pr-123-' + 'a'.repeat(40), phase: 'QUEUED' };

test('creates a job only when its ID does not exist', async () => {
  const commands = [];
  const store = createJobStore({
    tableName: 'test-jobs',
    documentClient: {
      async send(command) { commands.push(command); },
    },
  });

  assert.deepEqual(await store.createJobIfAbsent(job), { created: true });
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof PutCommand);
  assert.deepEqual(commands[0].input, {
    TableName: 'test-jobs',
    Item: job,
    ConditionExpression: 'attribute_not_exists(#jobId)',
    ExpressionAttributeNames: { '#jobId': 'jobId' },
  });
});

test('an existing job returns created false without another write', async () => {
  let calls = 0;
  const store = createJobStore({
    tableName: 'test-jobs',
    documentClient: {
      async send() {
        calls += 1;
        const error = new Error('Job already exists');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      },
    },
  });

  assert.deepEqual(await store.createJobIfAbsent(job), { created: false });
  assert.equal(calls, 1);
});

test('a database permission error reaches the caller', async () => {
  const error = new Error('Access denied');
  error.name = 'AccessDeniedException';
  const store = createJobStore({
    tableName: 'test-jobs',
    documentClient: {
      async send() { throw error; },
    },
  });

  await assert.rejects(
    () => store.createJobIfAbsent(job),
    (received) => received === error,
  );
});

test('rejects an empty table name', () => {
  assert.throws(
    () => createJobStore({
      tableName: '',
      documentClient: { send: async () => ({}) },
    }),
    /table name is required/,
  );
});
