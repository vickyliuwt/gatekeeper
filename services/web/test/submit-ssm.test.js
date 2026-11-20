// SSM can not give the access code so the submit lambda answers 503
// never a plain 500 and nothing gets saved or queued
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmit } from '../src/submit.js';

function setup(getAccessCode) {
  const calls = { put: 0, create: 0, send: 0 };
  const lines = [];
  const submit = createSubmit({
    getAccessCode,
    blobs: { put: async () => { calls.put += 1; } },
    store: { create: async () => { calls.create += 1; } },
    queue: { send: async () => { calls.send += 1; } },
    log: (stage, fields) => lines.push({ stage, ...fields }),
    newId: () => '11111111-2222-4333-8444-555555555555',
  });
  const request = {
    headers: { 'content-type': 'application/json', 'x-demo-code': 'demo-1234' },
    body: JSON.stringify({ code: 'const a = 1;', filename: 'a.js' }),
  };
  return { submit, calls, lines, request };
}

for (const [name, reader] of [
  ['SSM throws', async () => { const e = new Error('no access'); e.name = 'AccessDeniedException'; throw e; }],
  ['the parameter is empty', async () => ''],
]) {
  test(`${name} gives 503 access_code_unavailable with the trace id`, async () => {
    const { submit, calls, lines, request } = setup(reader);
    const res = await submit(request);
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'access_code_unavailable');
    assert.equal(body.traceId, '11111111-2222-4333-8444-555555555555');
    assert.deepEqual(calls, { put: 0, create: 0, send: 0 });
    const err = lines.find((l) => l.stage === 'error');
    assert.equal(err.msg, 'access_code_unavailable');
    assert.equal(err.traceId, body.traceId);
    // the log never holds the code the person typed
    assert.equal(JSON.stringify(lines).includes('demo-1234'), false);
  });
}

test('a wrong code is still 401 and a right code is still 202', async () => {
  const ok = setup(async () => 'demo-1234');
  assert.equal((await ok.submit(ok.request)).statusCode, 202);
  const bad = setup(async () => 'other-code');
  assert.equal((await bad.submit(bad.request)).statusCode, 401);
});
