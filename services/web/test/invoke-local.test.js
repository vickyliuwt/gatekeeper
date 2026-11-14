// tests invoke-local.js without Docker: 2 fake emulators call the real
// handlers on memory stand-ins
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runChecks } from '../scripts/invoke-local.js';
import { createGatewayHandler } from '../src/gateway.js';
import { createMemoryBlobs, createMemoryQueue, createMemoryStore } from '../src/memory.js';
import { loadPage } from '../src/page.js';
import { createResults, resultsRoutes } from '../src/results.js';
import { createSubmit } from '../src/submit.js';

const quiet = () => {};

function fakeEmulator(handler) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const answer = await handler(JSON.parse(raw));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function startBoth() {
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  const results = createGatewayHandler(
    resultsRoutes(createResults({ store, blobs, allowedRepo: 'vickyliuwt/gatekeeper-demo', page: loadPage(), log: quiet })),
    { log: quiet },
  );
  const submit = createGatewayHandler(
    { 'POST /scans': createSubmit({ getAccessCode: async () => 'the-real-code', blobs, store, queue: createMemoryQueue(), log: quiet }) },
    { log: quiet },
  );
  const r = await fakeEmulator(results);
  const s = await fakeEmulator(submit);
  return {
    resultsUrl: `http://localhost:${r.address().port}`,
    submitUrl: `http://localhost:${s.address().port}`,
    close: () => { r.close(); s.close(); },
  };
}

test('invoke-local passes every check against the real handlers (no AWS mode)', async () => {
  const env = await startBoth();
  try {
    const summary = await runChecks({ resultsUrl: env.resultsUrl, submitUrl: env.submitUrl, aws: false });
    assert.equal(summary.failed, 0, JSON.stringify(summary.outcomes));
    assert.equal(summary.passed, 4);
  } finally {
    env.close();
  }
});

test('invoke-local --aws mode expects 200 on the list and 401 for a wrong access code', async () => {
  const env = await startBoth();
  try {
    const summary = await runChecks({ resultsUrl: env.resultsUrl, submitUrl: env.submitUrl, aws: true });
    assert.equal(summary.failed, 0, JSON.stringify(summary.outcomes));
    assert.equal(summary.passed, 5);
  } finally {
    env.close();
  }
});

test('invoke-local reports a clear failure when no container is running', async () => {
  const summary = await runChecks({ resultsUrl: 'http://localhost:9', submitUrl: 'http://localhost:9', aws: false });
  assert.equal(summary.passed, 0);
  assert.match(summary.outcomes[0].detail, /docker compose --profile web up/);
});
