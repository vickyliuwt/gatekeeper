import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrFiles } from '../src/pr-source.js';

const HEAD_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const CODE = 'const answer = 42;\n';

const JOB = {
  source: 'pr',
  repo: 'example/demo',
  headSha: HEAD_SHA,
};

function sourceEntry(overrides = {}) {
  return {
    path: 'src/main.js',
    type: 'blob',
    mode: '100644',
    sha: BLOB_SHA,
    size: Buffer.byteLength(CODE),
    ...overrides,
  };
}

function mockGitHub({
  entries = [sourceEntry()],
  truncated = false,
  commitSha = HEAD_SHA,
  blobCode = CODE,
  blobStatus = 200,
} = {}) {
  const calls = [];
  const base = 'https://api.github.com/repos/example/demo';

  async function fetchImpl(url, options) {
    calls.push({ url, options });

    if (url === `${base}/git/commits/${HEAD_SHA}`) {
      return Response.json({
        sha: commitSha,
        tree: { sha: TREE_SHA },
      });
    }

    if (url === `${base}/git/trees/${TREE_SHA}?recursive=1`) {
      return Response.json({ tree: entries, truncated });
    }

    if (url === `${base}/git/blobs/${BLOB_SHA}`) {
      return Response.json({
        sha: BLOB_SHA,
        encoding: 'base64',
        content: Buffer.from(blobCode).toString('base64'),
      }, { status: blobStatus });
    }

    throw new Error(`Unexpected GitHub URL: ${url}`);
  }

  return { calls, fetchImpl };
}

test('loads source at the exact head SHA and preserves its path', async () => {
  const mock = mockGitHub();
  const files = await fetchPrFiles(JOB, {
    fetchImpl: mock.fetchImpl,
    token: 'test-token',
  });

  assert.deepEqual(files, [{ filename: 'src/main.js', code: CODE }]);
  assert.equal(mock.calls.length, 3);
  assert.ok(mock.calls[0].url.endsWith(`/git/commits/${HEAD_SHA}`));

  for (const call of mock.calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('filters unsupported files, hidden directories, dependencies and symlinks', async () => {
  const mock = mockGitHub({
    entries: [
      sourceEntry({ path: 'src/main.ts' }),
      sourceEntry({ path: 'README.md' }),
      sourceEntry({ path: 'node_modules/example/index.js' }),
      sourceEntry({ path: 'src/.cache/generated.js' }),
      sourceEntry({ path: 'linked.js', mode: '120000' }),
      sourceEntry({ path: 'vendor', type: 'commit', mode: '160000' }),
    ],
  });

  const files = await fetchPrFiles(JOB, mock);
  assert.deepEqual(files, [{ filename: 'src/main.ts', code: CODE }]);
  assert.equal(mock.calls.length, 3);
});

test('rejects invalid jobs before making requests', async () => {
  const mock = mockGitHub();

  for (const job of [
    { ...JOB, source: 'paste' },
    { ...JOB, repo: 'example/demo/extra' },
    { ...JOB, headSha: 'main' },
  ]) {
    await assert.rejects(fetchPrFiles(job, mock), TypeError);
  }

  assert.equal(mock.calls.length, 0);
});

test('rejects a different commit and a truncated tree', async () => {
  await assert.rejects(
    fetchPrFiles(JOB, mockGitHub({ commitSha: 'd'.repeat(40) })),
    /unexpected commit/,
  );

  const mock = mockGitHub({ truncated: true });
  await assert.rejects(fetchPrFiles(JOB, mock), /tree is incomplete/);
  assert.equal(mock.calls.length, 2);
});

test('rejects file-count and size limits before downloading blobs', async () => {
  const cases = [
    {
      entries: Array.from({ length: 51 }, (_, i) =>
        sourceEntry({ path: `src/file-${i}.js` })),
      error: /file count exceeds/,
    },
    {
      entries: [sourceEntry({ size: 256 * 1024 + 1 })],
      error: /Source file exceeds/,
    },
    {
      entries: Array.from({ length: 5 }, (_, i) =>
        sourceEntry({ path: `src/file-${i}.js`, size: 256 * 1024 })),
      error: /Source files exceed/,
    },
  ];

  for (const { entries, error } of cases) {
    const mock = mockGitHub({ entries });
    await assert.rejects(fetchPrFiles(JOB, mock), error);
    assert.equal(mock.calls.length, 2);
  }
});

test('propagates GitHub failures instead of returning partial source', async () => {
  await assert.rejects(
    fetchPrFiles(JOB, mockGitHub({ blobStatus: 403 })),
    /HTTP 403/,
  );
});

test('rejects downloaded content with an unexpected size', async () => {
  await assert.rejects(
    fetchPrFiles(JOB, mockGitHub({ blobCode: CODE + 'extra' })),
    /size does not match/,
  );
});

test('returns an empty list when the commit has no supported source files', async () => {
  const mock = mockGitHub({
    entries: [sourceEntry({ path: 'README.md' })],
  });

  assert.deepEqual(await fetchPrFiles(JOB, mock), []);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].options.headers.Authorization, undefined);
});
