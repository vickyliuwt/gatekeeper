#!/usr/bin/env node
// Smoke test after a deploy: proves each piece works, with one PASS/FAIL table.
//   node scripts/gk/smoke.mjs              core checks, plus the page checks when Part C is deployed
//   node scripts/gk/smoke.mjs --with-code  also one real paste (reads the access code inside the script, never prints it)
import { aws, cli, info, readOutputs, step } from './lib/run.mjs';

export const HELP = 'Usage: node scripts/gk/smoke.mjs [--with-code]';
// A deliberately vulnerable line for the real paste, joined at run time so our own scanner does not flag this file.
export const SAMPLE_SECRET_LINE = ['const pass', 'word = "smoke-test-1234";'].join('');

async function probe(fetchFn, url, init) {
  try {
    const res = await fetchFn(url, { redirect: 'manual', ...init });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', error: error.message };
  }
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function runChecks({ outputs, awsCli = aws, fetchFn = fetch, withCode = false, readCode = null }) {
  const results = [];
  const add = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail });
  const api = outputs.api_endpoint;
  if (!api) throw new Error('No api_endpoint output. Deploy first: node scripts/gk/deploy.mjs --part web');

  let r = await probe(fetchFn, `${api}/does-not-exist`);
  add('unknown path gets 404 from API Gateway', r.status === 404, `HTTP ${r.status}`);

  const table = awsCli(['dynamodb', 'describe-table', '--table-name', outputs.jobs_table_name || 'gk-jobs', '--query', 'Table.[TableStatus,GlobalSecondaryIndexes[0].IndexName]', '--output', 'json'], { allowFail: true });
  const t = table.ok ? parse(table.stdout) ?? [] : [];
  add('table gk-jobs is ACTIVE with index byRepoTime', t[0] === 'ACTIVE' && t[1] === 'byRepoTime', table.ok ? t.join(' ') : table.stderr.slice(0, 80));

  const ttl = awsCli(['dynamodb', 'describe-time-to-live', '--table-name', outputs.jobs_table_name || 'gk-jobs', '--query', 'TimeToLiveDescription.[TimeToLiveStatus,AttributeName]', '--output', 'json'], { allowFail: true });
  const tt = ttl.ok ? parse(ttl.stdout) ?? [] : [];
  add('TTL on expiresAt', /^ENABL/.test(tt[0] || '') && tt[1] === 'expiresAt', ttl.ok ? tt.join(' ') : ttl.stderr.slice(0, 80));

  const queue = awsCli(['sqs', 'get-queue-attributes', '--queue-url', outputs.jobs_queue_url || '', '--attribute-names', 'RedrivePolicy', 'VisibilityTimeout', '--output', 'json'], { allowFail: true });
  const qa = queue.ok ? parse(queue.stdout)?.Attributes ?? {} : {};
  const redrive = parse(qa.RedrivePolicy || '{}') ?? {};
  add('queue: 5 tries, then the DLQ; visibility 360 s', Number(redrive.maxReceiveCount) === 5 && qa.VisibilityTimeout === '360', queue.ok ? `maxReceiveCount ${redrive.maxReceiveCount}, visibility ${qa.VisibilityTimeout}` : queue.stderr.slice(0, 80));

  r = await probe(fetchFn, `https://${outputs.data_bucket_name}.s3.amazonaws.com/reports/smoke.json`);
  add('data bucket is private (403)', r.status === 403, `HTTP ${r.status}`);

  if (outputs.web_page_url) {
    r = await probe(fetchFn, outputs.web_page_url);
    add('GET / serves the page', r.status === 200 && /text\/html/.test(r.headers.get('content-type') || '') && r.text.includes('<html'), `HTTP ${r.status}`);
    add('the page sends a Content-Security-Policy', /default-src 'none'/.test(r.headers.get('content-security-policy') || ''), r.headers.get('content-security-policy') ? 'present' : 'missing');
    r = await probe(fetchFn, `${api}/scans`);
    add('GET /scans lists recent PR scans', r.status === 200 && Array.isArray(parse(r.text)?.items), `HTTP ${r.status}`);
    r = await probe(fetchFn, `${api}/scans/paste-00000000-0000-4000-8000-000000000000`);
    add('unknown job gets 404', r.status === 404, `HTTP ${r.status}`);
    r = await probe(fetchFn, `${api}/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'const a = 1;' }) });
    add('POST /scans without the access code gets 401', r.status === 401, `HTTP ${r.status}`);
    if (withCode && readCode) {
      r = await probe(fetchFn, `${api}/scans`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-code': readCode() }, body: JSON.stringify({ code: SAMPLE_SECRET_LINE, filename: 'smoke.js' }) });
      const body = parse(r.text) ?? {};
      add('POST /scans with the access code gets 202 and a jobId', r.status === 202 && /^paste-/.test(body.jobId || ''), `HTTP ${r.status} ${body.jobId || ''}`);
    }
  }
  return results;
}

export function printTable(results, print = info) {
  for (const x of results) print(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}  (${x.detail})`);
  const failed = results.filter((x) => !x.pass).length;
  print(failed === 0 ? `All ${results.length} checks passed.` : `${failed} of ${results.length} checks failed.`);
  return failed;
}

const readCodeFromSsm = () => aws(['ssm', 'get-parameter', '--name', '/gatekeeper/demo-code', '--with-decryption', '--query', 'Parameter.Value', '--output', 'text']).stdout;

await cli(import.meta.url, HELP, async (options) => {
  step('Smoke test');
  const failed = printTable(await runChecks({ outputs: readOutputs(), withCode: options.withCode, readCode: readCodeFromSsm }));
  if (failed > 0) process.exit(1);
});
