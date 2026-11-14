import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLocalApp } from '../src/local.js';

async function startServer() {
  const local = await createLocalApp({ speed: 40, quiet: true });
  const server = await new Promise((resolve) => {
    const s = local.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...local, server, base };
}

const post = (base, code, accessCode = 'demo-1234') => fetch(`${base}/scans`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-demo-code': accessCode },
  body: JSON.stringify({ code, filename: 'demo.js' }),
});

async function waitForDone(base, jobId) {
  for (let i = 0; i < 100; i += 1) {
    const status = await (await fetch(`${base}/scans/${jobId}`)).json();
    if (status.phase === 'DONE') return status;
    await sleep(50);
  }
  throw new Error('the local worker never finished');
}

test('the local server plays the whole paste flow', async (t) => {
  const local = await startServer();
  t.after(() => {
    local.stop();
    local.server.close();
  });

  await t.test('serves the page with its policy header', async () => {
    const response = await fetch(`${local.base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'sha256-/);
    const page = await response.text();
    assert.match(page, /Your scan, through AWS/);
    assert.match(page, /Security Report/);
  });

  await t.test('lists the 3 seeded pull request scans', async () => {
    const { items } = await (await fetch(`${local.base}/scans`)).json();
    assert.equal(items.length, 3);
  });

  await t.test('a wrong access code gets 401', async () => {
    assert.equal((await post(local.base, 'x', 'nope')).status, 401);
  });

  await t.test('a risky paste ends FAIL with a masked report', async () => {
    const response = await post(local.base, 'const password = "admin123";\n');
    assert.equal(response.status, 202);
    const { jobId } = await response.json();
    const status = await waitForDone(local.base, jobId);
    assert.equal(status.verdict, 'FAIL');
    const report = await (await fetch(`${local.base}/scans/${jobId}/report`)).json();
    const secret = report.findings.find((finding) => finding.id === 'HARDCODED_SECRET');
    assert.ok(secret.evidence.includes('admi****'));
    assert.equal(JSON.stringify(report).includes('admin123'), false);
  });

  await t.test('SIMULATE_503 answers 503 queue_unavailable', async () => {
    const response = await post(local.base, '// SIMULATE_503\n');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'queue_unavailable');
  });

  await t.test('a paste flood gets 429 from the route limit', async () => {
    const codes = await Promise.all(Array.from({ length: 8 }, () => post(local.base, 'const a = 1;').then((r) => r.status)));
    assert.ok(codes.includes(429), codes.join(','));
  });

  await t.test('unknown paths answer 404', async () => {
    assert.equal((await fetch(`${local.base}/admin`)).status, 404);
  });
});
