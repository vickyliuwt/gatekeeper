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
  const state = { reads: [], reports: [], updates: [] };

  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async command => {
    assert.equal(command.input.TableName, 'test-jobs');
    assert.deepEqual(command.input.Key, { jobId: JOB_ID });

    if (command instanceof GetCommand) return { Item: job };

    assert.ok(command instanceof UpdateCommand);
    state.updates.push(command.input);
    return {};
  });

  t.mock.method(S3Client.prototype, 'send', async command => {
    assert.equal(command.input.Bucket, 'test-reports');

    if (command instanceof GetObjectCommand) {
      state.reads.push(command.input);
      return { Body: Readable.from([Buffer.from(CODE)]) };
    }

    assert.ok(command instanceof PutObjectCommand);
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

  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);

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
  assert.equal(urls.length, 3);
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

  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'Forbidden' }, { status: 403 })
  );

  await assert.rejects(handler(event()), /HTTP 403/);
  assert.equal(state.reports.length, 0);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].ExpressionAttributeValues[':running'], 'RUNNING');
});
