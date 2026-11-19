import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishCommitStatus } from '../src/github-status.js';

const HEAD_SHA = 'a'.repeat(40);
const JOB = {
  source: 'pr',
  repo: 'example/demo',
  headSha: HEAD_SHA,
};

function options(overrides = {}) {
  return {
    state: 'pending',
    description: 'Scan in progress.',
    token: 'test-token',
    ...overrides,
  };
}

test('publishes all supported states to the exact commit and context', async () => {
  for (const state of ['pending', 'success', 'failure', 'error']) {
    const calls = [];

    await publishCommitStatus(JOB, options({
      state,
      fetchImpl: async (url, request) => {
        calls.push({ url, request });
        return new Response(null, { status: 201 });
      },
    }));

    assert.equal(calls.length, 1);
    const { url, request } = calls[0];

    assert.equal(
      url,
      `https://api.github.com/repos/example/demo/statuses/${HEAD_SHA}`,
    );
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(request.body), {
      state,
      context: 'gatekeeper/sast',
      description: 'Scan in progress.',
    });
  }
});

test('rejects invalid jobs before sending a request', async () => {
  let requests = 0;
  const config = options({
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 201 });
    },
  });

  for (const job of [
    { ...JOB, source: 'paste' },
    { ...JOB, repo: 'example/demo/extra' },
    { ...JOB, headSha: 'main' },
  ]) {
    await assert.rejects(publishCommitStatus(job, config), TypeError);
  }

  assert.equal(requests, 0);
});

test('rejects invalid states and descriptions before sending a request', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(null, { status: 201 });
  };

  for (const invalid of [
    { state: 'DONE' },
    { description: '' },
    { description: '   ' },
    { description: 'x'.repeat(141) },
  ]) {
    await assert.rejects(
      publishCommitStatus(JOB, options({ fetchImpl, ...invalid })),
      TypeError,
    );
  }

  assert.equal(requests, 0);
});

test('requires a token before sending a request', async () => {
  let requests = 0;

  for (const token of [undefined, '', '   ']) {
    await assert.rejects(
      publishCommitStatus(JOB, options({
        token,
        fetchImpl: async () => {
          requests += 1;
          return new Response(null, { status: 201 });
        },
      })),
      /GitHub token is required/,
    );
  }

  assert.equal(requests, 0);
});

test('propagates unsuccessful HTTP responses without exposing response contents', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      publishCommitStatus(JOB, options({
        fetchImpl: async () => Response.json(
          { message: 'private diagnostic information' },
          { status },
        ),
      })),
      error => {
        assert.equal(
          error.message,
          `GitHub status request failed: HTTP ${status}`,
        );
        return true;
      },
    );
  }
});

test('propagates network failure to the caller', async () => {
  const failure = new Error('Connection unavailable');

  await assert.rejects(
    publishCommitStatus(JOB, options({
      fetchImpl: async () => {
        throw failure;
      },
    })),
    error => error === failure,
  );
});
