import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

process.env.AWS_REGION = 'us-east-1';
process.env.JOBS_TABLE = 'test-jobs';
process.env.REPORTS_BUCKET = 'test-reports';
process.env.GITHUB_TOKEN = 'test-token';

const { handler } = await import('../src/handler.js');
const { publishCommitStatus } = await import('../src/github-status.js');

const HEAD_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const PR_JOB = { jobId: `pr-123-${HEAD_SHA}`, source: 'pr', repo: 'example/demo', headSha: HEAD_SHA };
const PASTE_JOB = { jobId: 'paste-1', source: 'paste', codeKey: 'pasted/paste-1.js' };
const BASE = 'https://api.github.com/repos/example/demo';

// one SQS record with the receive count SQS adds
function event(job, receiveCount) {
  const record = { messageId: 'm1', body: JSON.stringify({ jobId: job.jobId, traceId: 't1' }) };
  if (receiveCount !== undefined) record.attributes = { ApproximateReceiveCount: String(receiveCount) };
  return { Records: [record] };
}

// fake DynamoDB and S3 and GitHub
function fakes(t, job, { treeFails = false, s3Fails = false } = {}) {
  const statuses = [];
  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async (command) => {
    if (command instanceof GetCommand) return { Item: job };
    return {};
  });
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    if (command instanceof GetObjectCommand) {
      if (s3Fails) throw Object.assign(new Error('no such key'), { name: 'NoSuchKey' });
      return { Body: Readable.from([Buffer.from('const a = 1;\n')]) };
    }
    return {};
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === `${BASE}/statuses/${HEAD_SHA}`) {
      statuses.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    if (url === `${BASE}/git/commits/${HEAD_SHA}`) return Response.json({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    if (url.startsWith(`${BASE}/git/trees/`)) {
      if (treeFails) return new Response('boom', { status: 500 });
      return Response.json({ truncated: false, tree: [{ path: 'app.js', type: 'blob', mode: '100644', sha: BLOB_SHA, size: 13 }] });
    }
    return Response.json({ sha: BLOB_SHA, encoding: 'base64', content: Buffer.from('const a = 1;\n').toString('base64') });
  });
  return statuses;
}

test('every PR status gets a Details link to the page when PAGE_URL is set', async (t) => {
  process.env.PAGE_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/';
  t.after(() => { delete process.env.PAGE_URL; });
  const statuses = fakes(t, PR_JOB);
  await handler(event(PR_JOB, 1));
  assert.deepEqual(statuses.map((s) => s.state), ['pending', 'success']);
  for (const s of statuses) {
    assert.equal(s.target_url, `https://abc123.execute-api.us-east-1.amazonaws.com/?job=${encodeURIComponent(PR_JOB.jobId)}`);
  }
});

test('no PAGE_URL or a bad one means no link and the old body', async (t) => {
  for (const value of [undefined, '', 'http://plain.example/', 'https://x.example/page?x=1']) {
    if (value === undefined) delete process.env.PAGE_URL; else process.env.PAGE_URL = value;
    const statuses = fakes(t, PR_JOB);
    await handler(event(PR_JOB, 1));
    for (const s of statuses) assert.equal('target_url' in s, false);
    t.mock.restoreAll();
  }
  delete process.env.PAGE_URL;
});

test('the 5th failed try posts error so the PR is not pending forever', async (t) => {
  process.env.PAGE_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/';
  t.after(() => { delete process.env.PAGE_URL; });
  const statuses = fakes(t, PR_JOB, { treeFails: true });
  await assert.rejects(handler(event(PR_JOB, 5)), /HTTP 500/);
  assert.deepEqual(statuses.map((s) => s.state), ['pending', 'error']);
  assert.match(statuses[1].description, /stopped after 5 tries/);
  assert.ok(statuses[1].description.length <= 140);
  assert.ok(statuses[1].target_url.endsWith(`?job=${encodeURIComponent(PR_JOB.jobId)}`));
});

test('tries 1 to 4 still leave the retry to SQS with no error status', async (t) => {
  for (const n of [undefined, 1, 4]) {
    const statuses = fakes(t, PR_JOB, { treeFails: true });
    await assert.rejects(handler(event(PR_JOB, n)), /HTTP 500/);
    assert.deepEqual(statuses.map((s) => s.state), ['pending']);
    t.mock.restoreAll();
  }
});

test('a paste job on its last try never calls GitHub', async (t) => {
  const statuses = fakes(t, PASTE_JOB, { s3Fails: true });
  await assert.rejects(handler(event(PASTE_JOB, 5)), /no such key/);
  assert.equal(statuses.length, 0);
});

test('publishCommitStatus checks the Details link', async () => {
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); };
  const base = { state: 'success', description: 'ok', token: 'x', fetchImpl };
  await publishCommitStatus(PR_JOB, base);
  assert.equal('target_url' in sent[0], false);
  await publishCommitStatus(PR_JOB, { ...base, targetUrl: 'https://page.example/?job=1' });
  assert.equal(sent[1].target_url, 'https://page.example/?job=1');
  for (const bad of ['http://page.example/', 'javascript:alert(1)', 'https://a b', `https://${'a'.repeat(2050)}`, 42]) {
    await assert.rejects(publishCommitStatus(PR_JOB, { ...base, targetUrl: bad }), TypeError);
  }
});
