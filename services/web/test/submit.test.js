import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCodeMatches, createSubmit } from '../src/submit.js';
import { createMemoryBlobs, createMemoryQueue, createMemoryStore } from '../src/memory.js';
import { captureLog, idSequence, postRequest } from './helpers.js';

const NOW = new Date('2026-11-02T15:04:05.000Z');
const TRACE_ID = '00000000-0000-4000-8000-000000000001';
const JOB_ID = 'paste-00000000-0000-4000-8000-000000000002';

function setup({ failBlob = false, failStore = false, failQueue = false } = {}) {
  const calls = [];
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  const queue = createMemoryQueue();
  const { log, lines } = captureLog();
  const submit = createSubmit({
    getAccessCode: async () => 'demo-1234',
    blobs: {
      async put(...args) {
        calls.push('blob');
        if (failBlob) throw new Error('S3 down');
        return blobs.put(...args);
      },
    },
    store: {
      async create(job) {
        calls.push('store');
        if (failStore) throw new Error('DynamoDB down');
        return store.create(job);
      },
    },
    queue: {
      async send(message) {
        calls.push('queue');
        if (failQueue) throw new Error('SQS down');
        return queue.send(message);
      },
    },
    log,
    clock: () => new Date(NOW),
    newId: idSequence(),
  });
  return { submit, store, blobs, queue, calls, lines };
}

test('saves the code, then the job, then the message, and answers 202', async () => {
  const s = setup();
  const response = await s.submit(postRequest({ body: { code: 'const x = 1;\n', filename: 'app.js' } }));

  assert.equal(response.statusCode, 202);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { jobId: JOB_ID, traceId: TRACE_ID, statusUrl: `/scans/${JOB_ID}` });
  assert.deepEqual(s.calls, ['blob', 'store', 'queue']);
  assert.deepEqual(await s.store.get(JOB_ID), {
    jobId: JOB_ID,
    source: 'paste',
    filename: 'app.js',
    pastedKey: `pasted/${JOB_ID}.js`,
    phase: 'QUEUED',
    attempt: 0,
    traceId: TRACE_ID,
    createdAt: '2026-11-02T15:04:05.000Z',
    updatedAt: '2026-11-02T15:04:05.000Z',
    expiresAt: Date.parse('2026-11-03T15:04:05.000Z') / 1000,
  });
  assert.equal(await s.blobs.getText(`pasted/${JOB_ID}.js`), 'const x = 1;\n');
  assert.deepEqual(s.queue.messages, [{ jobId: JOB_ID, traceId: TRACE_ID }]);
});

test('a paste job has no repo field, so it can never enter the public list', async () => {
  const s = setup();
  await s.submit(postRequest());
  assert.equal('repo' in (await s.store.get(JOB_ID)), false);
  assert.equal((await s.store.get(JOB_ID)).filename, 'snippet.js');
});

test('checks the access code before reading the body', async () => {
  for (const accessCode of [null, '', 'wrong-code']) {
    const s = setup();
    const response = await s.submit(postRequest({ accessCode, body: '{not json' }));
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).error, 'bad_demo_code');
    assert.deepEqual(s.calls, []);
  }
});

test('asks for JSON', async () => {
  const s = setup();
  const response = await s.submit(postRequest({ contentType: 'text/plain' }));
  assert.equal(response.statusCode, 415);
});

test('rejects bad JSON, non-objects and missing code without side effects', async () => {
  const cases = [
    ['{not json', 'invalid_json'],
    ['[1,2]', 'invalid_json'],
    [{ code: '   \n ' }, 'missing_code'],
    [{ code: 42 }, 'missing_code'],
    [{}, 'missing_code'],
  ];
  for (const [body, error] of cases) {
    const s = setup();
    const response = await s.submit(postRequest({ body }));
    assert.equal(response.statusCode, 400, JSON.stringify(body));
    assert.equal(JSON.parse(response.body).error, error);
    assert.deepEqual(s.calls, []);
  }
});

test('the 100 KB limit counts UTF-8 bytes', async () => {
  const over = setup();
  assert.equal((await over.submit(postRequest({ body: { code: 'é'.repeat(51201) } }))).statusCode, 413);
  assert.deepEqual(over.calls, []);
  const atLimit = setup();
  assert.equal((await atLimit.submit(postRequest({ body: { code: 'a'.repeat(102400) } }))).statusCode, 202);
});

test('a huge body is refused before JSON parsing', async () => {
  const s = setup();
  const response = await s.submit(postRequest({ body: `{"code":"${'b'.repeat(700 * 1024)}"}` }));
  assert.equal(response.statusCode, 413);
});

test('rejects unsafe file names', async () => {
  for (const filename of ['../x.js', 'x.py', '.js', 'a/b.js']) {
    const s = setup();
    const response = await s.submit(postRequest({ body: { code: 'x', filename } }));
    assert.equal(response.statusCode, 400, filename);
    assert.equal(JSON.parse(response.body).error, 'bad_filename');
  }
});

test('an S3 failure answers 503 and writes nothing else', async () => {
  const s = setup({ failBlob: true });
  const response = await s.submit(postRequest());
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'storage_unavailable');
  assert.deepEqual(s.calls, ['blob']);
});

test('a DynamoDB failure answers 503 and sends no message', async () => {
  const s = setup({ failStore: true });
  assert.equal((await s.submit(postRequest())).statusCode, 503);
  assert.deepEqual(s.calls, ['blob', 'store']);
});

test('an SQS failure answers 503 queue_unavailable after the job is saved', async () => {
  const s = setup({ failQueue: true });
  const response = await s.submit(postRequest());
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'queue_unavailable');
  assert.deepEqual(s.calls, ['blob', 'store', 'queue']);
});

test('never logs the pasted code or the access code', async () => {
  const s = setup();
  await s.submit(postRequest({ body: { code: 'const marker = "VERY_PRIVATE_CODE_TEXT";' } }));
  const text = JSON.stringify(s.lines);
  assert.equal(text.includes('VERY_PRIVATE_CODE_TEXT'), false);
  assert.equal(text.includes('demo-1234'), false);
  assert.deepEqual(s.lines.map((line) => line.stage), ['received', 'job_created', 'enqueued']);
});

test('accessCodeMatches compares safely and refuses a missing configuration', () => {
  assert.equal(accessCodeMatches('demo-1234', 'demo-1234'), true);
  assert.equal(accessCodeMatches('demo-1235', 'demo-1234'), false);
  assert.equal(accessCodeMatches(undefined, 'demo-1234'), false);
  assert.throws(() => accessCodeMatches('x', ''), /not configured/);
});
