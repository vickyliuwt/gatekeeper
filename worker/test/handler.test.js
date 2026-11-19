import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

process.env.AWS_REGION = 'us-east-1';
process.env.JOBS_TABLE = 'test-jobs';
process.env.REPORTS_BUCKET = 'test-reports';
process.env.GITHUB_TOKEN = 'test-token';

const { handler } = await import('../src/handler.js');

const HEAD_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const CODE = 'eval(userInput);\n';
const JOB_ID = `pr-123-${HEAD_SHA}`;
const TRACE_ID = 'test-delivery-1';

function event() {
  return {
    Records: [{
      messageId: 'test-message-1',
      body: JSON.stringify({ jobId: JOB_ID, traceId: TRACE_ID }),
    }],
  };
}

function mockServices(t, job) {
  const state = { reads: [], reports: [], updates: [], order: [] };

  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async command => {
    assert.equal(command.input.TableName, 'test-jobs');
    assert.deepEqual(command.input.Key, { jobId: JOB_ID });

    if (command instanceof GetCommand) return { Item: job };

    assert.ok(command instanceof UpdateCommand);
    state.updates.push(command.input);
    const expression = command.input.UpdateExpression;
    if (expression.startsWith('SET phase = :phase,')) {
      state.order.push('done');
    } else if (expression.startsWith('SET phase = :failed,')) {
      state.order.push('failed');
    } else {
      assert.ok(expression.startsWith('SET phase = :running,'));
      state.order.push('claim');
    }
    return {};
  });

  t.mock.method(S3Client.prototype, 'send', async command => {
    assert.equal(command.input.Bucket, 'test-reports');

    if (command instanceof GetObjectCommand) {
      state.reads.push(command.input);
      return { Body: Readable.from([Buffer.from(CODE)]) };
    }

    assert.ok(command instanceof PutObjectCommand);
    state.order.push('report');
    state.reports.push({
      key: command.input.Key,
      body: JSON.parse(command.input.Body),
    });
    return {};
  });

  return state;
}

function assertCompleted(state, filename) {
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].key, `reports/${JOB_ID}.json`);

  const report = state.reports[0].body;
  assert.equal(report.jobId, JOB_ID);
  assert.equal(report.traceId, TRACE_ID);
  assert.equal(report.scannedFiles, 1);
  assert.equal(report.sourceBytes, Buffer.byteLength(CODE));
  assert.equal(report.verdict, 'failure');
  assert.ok(report.counts.HIGH > 0);
  assert.ok(report.findings.every(finding => finding.file === filename));

  assert.equal(state.updates.length, 2);
  const claim = state.updates[0].ExpressionAttributeValues;
  const finish = state.updates[1].ExpressionAttributeValues;
  assert.equal(finish[':phase'], 'DONE');
  assert.equal(finish[':owner'], claim[':owner']);
  assert.equal(finish[':key'], state.reports[0].key);
}

test('PR worker fetches the pinned commit, writes a report and completes the job', async t => {
  const state = mockServices(t, {
    jobId: JOB_ID,
    source: 'pr',
    repo: 'example/demo',
    headSha: HEAD_SHA,
  });

  const base = 'https://api.github.com/repos/example/demo';
  const urls = [];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url);

    if (url === `${base}/statuses/${HEAD_SHA}`) {
      assert.equal(options.method, 'POST');
      const status = JSON.parse(options.body);
      assert.equal(status.context, 'gatekeeper/sast');
      state.order.push(status.state);
      return new Response(null, { status: 201 });
    }

    if (url === `${base}/git/commits/${HEAD_SHA}`) {
      return Response.json({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    }
    if (url === `${base}/git/trees/${TREE_SHA}?recursive=1`) {
      return Response.json({
        truncated: false,
        tree: [{
          path: 'src/example.js',
          type: 'blob',
          mode: '100644',
          sha: BLOB_SHA,
          size: Buffer.byteLength(CODE),
        }],
      });
    }

    assert.equal(url, `${base}/git/blobs/${BLOB_SHA}`);
    return Response.json({
      sha: BLOB_SHA,
      encoding: 'base64',
      content: Buffer.from(CODE).toString('base64'),
    });
  });

  assert.deepEqual(await handler(event()), { ok: true });
  assert.equal(urls.length, 5);
  assert.deepEqual(state.order, [
    'claim', 'pending', 'report', 'failure', 'done',
  ]);
  assert.equal(state.reads.length, 0);
  assertCompleted(state, 'src/example.js');
});

test('paste worker reads its S3 object and completes the job', async t => {
  const state = mockServices(t, {
    jobId: JOB_ID,
    source: 'paste',
    codeKey: 'pasted/example.js',
    filename: 'example.js',
  });

  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Paste jobs must not request GitHub source');
  });

  assert.deepEqual(await handler(event()), { ok: true });
  assert.equal(state.reads.length, 1);
  assert.equal(state.reads[0].Key, 'pasted/example.js');
  assertCompleted(state, 'example.js');
});

test('GitHub failure rejects the invocation without publishing a completed report', async t => {
  const state = mockServices(t, {
    jobId: JOB_ID,
    source: 'pr',
    repo: 'example/demo',
    headSha: HEAD_SHA,
  });

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  });

  await assert.rejects(handler(event()), /HTTP 403/);
  assert.equal(state.reports.length, 0);
  assert.equal(state.updates.length, 2);
  assert.equal(state.updates[1].ExpressionAttributeValues[':failed'], 'FAILED');
  assert.deepEqual(state.order, ['claim', 'failed']);
});

test('final status failure releases the job and a subsequent invocation completes', async t => {
  const state = mockServices(t, {
    jobId: JOB_ID,
    source: 'pr',
    repo: 'example/demo',
    headSha: HEAD_SHA,
  });
  let rejectFinalStatus = true;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') {
      const status = JSON.parse(options.body);
      state.order.push(status.state);

      if (status.state === 'success' && rejectFinalStatus) {
        rejectFinalStatus = false;
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 201 });
    }

    if (url.endsWith(`/git/commits/${HEAD_SHA}`)) {
      return Response.json({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    }

    assert.ok(url.endsWith(`/git/trees/${TREE_SHA}?recursive=1`));
    return Response.json({ truncated: false, tree: [] });
  });

  await assert.rejects(handler(event()), /HTTP 503/);

  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].body.scannedFiles, 0);
  assert.equal(state.updates.length, 2);

  const claim = state.updates[0];
  const recovery = state.updates[1];
  assert.equal(recovery.ExpressionAttributeValues[':failed'], 'FAILED');
  assert.equal(
    recovery.ExpressionAttributeValues[':owner'],
    claim.ExpressionAttributeValues[':owner'],
  );
  assert.equal(
    recovery.ConditionExpression,
    'leaseOwner = :owner AND phase = :running',
  );
  assert.ok(recovery.UpdateExpression.includes('REMOVE leaseOwner, leaseUntil'));
  assert.ok(!state.order.includes('done'));

  assert.deepEqual(await handler(event()), { ok: true });
  assert.equal(state.reports.length, 2);
  assert.equal(state.updates.length, 4);

  const secondClaim = state.updates[2];
  const finish = state.updates[3];
  assert.notEqual(
    secondClaim.ExpressionAttributeValues[':owner'],
    claim.ExpressionAttributeValues[':owner'],
  );
  assert.equal(finish.ExpressionAttributeValues[':phase'], 'DONE');
  assert.equal(
    finish.ExpressionAttributeValues[':owner'],
    secondClaim.ExpressionAttributeValues[':owner'],
  );
  assert.deepEqual(state.order, [
    'claim', 'pending', 'report', 'success', 'failed',
    'claim', 'pending', 'report', 'success', 'done',
  ]);
});

test('already completed jobs skip source retrieval and status publishing', async t => {
  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async command => {
    if (command instanceof UpdateCommand) {
      throw Object.assign(new Error('Claim rejected'), {
        name: 'ConditionalCheckFailedException',
      });
    }

    assert.ok(command instanceof GetCommand);
    assert.equal(command.input.ConsistentRead, true);
    return { Item: { jobId: JOB_ID, phase: 'DONE' } };
  });

  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Completed jobs must not call GitHub');
  });
  t.mock.method(S3Client.prototype, 'send', async () => {
    assert.fail('Completed jobs must not access S3');
  });

  assert.deepEqual(await handler(event()), { ok: true });
});

test('an occupied lease rejects the invocation so the message can retry', async t => {
  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async command => {
    if (command instanceof UpdateCommand) {
      throw Object.assign(new Error('Claim rejected'), {
        name: 'ConditionalCheckFailedException',
      });
    }

    assert.ok(command instanceof GetCommand);
    assert.equal(command.input.ConsistentRead, true);
    return {
      Item: {
        jobId: JOB_ID,
        phase: 'RUNNING',
        leaseOwner: 'another-worker',
      },
    };
  });

  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Unclaimed jobs must not call GitHub');
  });
  t.mock.method(S3Client.prototype, 'send', async () => {
    assert.fail('Unclaimed jobs must not access S3');
  });

  await assert.rejects(handler(event()), /another worker holds the lease/);
});
