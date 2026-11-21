#!/usr/bin/env node
// follow one job like Trace a stuck PR in our proposal
// its DynamoDB item and its report
// and a Logs Insights query over every gk lambda log group
// read only
// give it one job ID
// add the logs flag for the log lines too
import { setTimeout as sleep } from 'node:timers/promises';
import { aws, cli, getAccount, info, step } from './lib/run.mjs';

export const HELP = 'Usage: node scripts/gk/peek-job.mjs {jobId} [--logs]';
export const JOB_ID = /^(pr-\d+-[0-9a-f]{40}|paste-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export function fromDynamo(v) {
  if (v === null || typeof v !== 'object') return v;
  if ('S' in v) return v.S;
  if ('N' in v) return Number(v.N);
  if ('BOOL' in v) return v.BOOL;
  if ('NULL' in v) return null;
  if ('M' in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, fromDynamo(x)]));
  if ('L' in v) return v.L.map(fromDynamo);
  return v;
}
export const unmarshalItem = (item) => Object.fromEntries(Object.entries(item || {}).map(([k, v]) => [k, fromDynamo(v)]));

// counts can come as HIGH or high
// the team worker writes HIGH and my laptop worker writes high
export function countsLine(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const get = (k) => counts[k] ?? counts[k.toUpperCase()] ?? '?';
  return `counts: high ${get('high')}, medium ${get('medium')}, low ${get('low')}`;
}

// the word the page shows for each verdict
// a word we do not know counts as INCOMPLETE like on the page
const PAGE_WORDS = { success: 'PASS', pass: 'PASS', failure: 'FAIL', fail: 'FAIL', error: 'INCOMPLETE', incomplete: 'INCOMPLETE' };
export const pageWord = (verdict) => PAGE_WORDS[String(verdict).toLowerCase()] ?? 'INCOMPLETE';

export const insightsQuery = (jobId) => `fields @timestamp, @log, svc, stage, msg\n| filter @message like "${jobId}"\n| sort @timestamp asc\n| limit 50`;

// the lease can be epoch seconds from my laptop worker
// or an ISO time from the team worker
export function leaseMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// where did it stop
// the worker gives up after this many tries
export const MAX_TRIES = 5;

// now can be passed in so the tests do not depend on the clock
export function explain(job, now = Date.now()) {
  if (!job) return 'No item: the front door never created it (wrong jobId, expired by TTL, or the request failed before PutItem).';
  if (job.phase === 'QUEUED') return 'QUEUED: nothing has claimed it. Check that a worker is deployed and running for this account.';
  if (job.phase === 'RUNNING') {
    const until = leaseMs(job.leaseUntil);
    if (until === null) return 'RUNNING with no lease time in the item. Look at the worker log lines below.';
    return until < now ? 'RUNNING with an old lease: the worker stopped mid-scan. SQS gives the message out again after 360 s.' : 'RUNNING: a worker holds the lease now. Check again in a few seconds.';
  }
  if (job.phase === 'FAILED') {
    const why = job.lastError || 'no error text in the item, look at the log lines below';
    // try 5 is the last one so the message is in the dead letter queue now
    if (Number(job.attempt) >= MAX_TRIES) return `FAILED on the last try (${job.attempt} of ${MAX_TRIES}): ${why}. The message is in the dead letter queue now. The page shows INCOMPLETE and a PR gets error, so the merge stays blocked.`;
    return `FAILED on try ${job.attempt}: ${why}. SQS retries after 360 s; after the 5th try it ends as INCOMPLETE.`;
  }
  if (job.phase === 'DONE') return pageWord(job.verdict) === 'INCOMPLETE' ? `DONE, INCOMPLETE: ${job.lastError || 'not every file was scanned'}.` : `DONE, verdict ${job.verdict} (the page shows ${pageWord(job.verdict)}).`;
  return `Unknown phase ${job.phase}.`;
}

async function runQuery(jobId, awsCli) {
  const groups = JSON.parse(awsCli(['logs', 'describe-log-groups', '--log-group-name-prefix', '/aws/lambda/gk-', '--query', 'logGroups[].logGroupName', '--output', 'json']).stdout || '[]');
  if (groups.length === 0) return info('No /aws/lambda/gk- log groups in this account yet.');
  const end = Math.floor(Date.now() / 1000);
  const id = awsCli(['logs', 'start-query', '--log-group-names', ...groups, '--start-time', String(end - 3600), '--end-time', String(end), '--query-string', insightsQuery(jobId), '--query', 'queryId', '--output', 'text']).stdout;
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    const res = JSON.parse(awsCli(['logs', 'get-query-results', '--query-id', id, '--output', 'json']).stdout);
    if (res.status === 'Complete') {
      for (const row of res.results) {
        const f = Object.fromEntries(row.map((c) => [c.field, c.value]));
        info(`${f['@timestamp']}  ${(f['@log'] || '').split(':').pop()}  ${f.stage || ''}  ${f.msg || ''}`);
      }
      return info(`${res.results.length} log line(s) in the last hour.`);
    }
  }
  return info('The query did not finish in 30 s. Run it in the console instead (query below).');
}

export async function peek(jobId, { logs = false, awsCli = aws, print = info, title = step } = {}) {
  if (!JOB_ID.test(jobId || '')) throw new Error('A jobId looks like pr-{digits}-{40 hex} or paste-{UUID v4} (README.md, "API").');
  const account = getAccount(awsCli);
  title(`Job ${jobId}`);
  const raw = awsCli(['dynamodb', 'get-item', '--table-name', 'gk-jobs', '--key', JSON.stringify({ jobId: { S: jobId } }), '--consistent-read', '--output', 'json'], { allowFail: true });
  if (!raw.ok) throw new Error(`Could not read gk-jobs: ${raw.stderr.split('\n').pop()}`);
  const parsed = JSON.parse(raw.stdout || '{}');
  const job = parsed.Item ? unmarshalItem(parsed.Item) : null;
  if (job) for (const k of ['source', 'repo', 'prNumber', 'phase', 'verdict', 'attempt', 'lastError', 'traceId', 'createdAt', 'updatedAt', 'reportKey']) if (job[k] !== undefined) print(`${k}: ${typeof job[k] === 'object' ? JSON.stringify(job[k]) : job[k]}`);
  const counts = countsLine(job?.counts);
  if (counts) print(counts);
  print(`Where it stopped: ${explain(job)}`);
  if (job?.reportKey) {
    const rep = awsCli(['s3', 'cp', `s3://gk-data-${account}/${job.reportKey}`, '-'], { allowFail: true });
    if (rep.ok) {
      const report = JSON.parse(rep.stdout);
      title('Report (first 5 findings; evidence lines are not printed, so this is safe on a screen recording)');
      for (const f of (report.findings || []).slice(0, 5)) print(`${f.severity} ${f.id || f.rule || '?'} ${f.file || f.filename || 'pasted code'}:${f.line ?? '?'}`);
      print(`${(report.findings || []).length} finding(s), verdict ${report.verdict} (the page shows ${pageWord(report.verdict)})`);
    }
  }
  title('Logs Insights query (CloudWatch > Logs Insights, pick every /aws/lambda/gk- group, last 1 hour)');
  process.stdout.write(`${insightsQuery(jobId)}\n`);
  print('Log lines can show up about a minute late. My laptop test worker logs on my PC, not in CloudWatch.');
  if (logs) await runQuery(jobId, awsCli);
  return job;
}

await cli(import.meta.url, HELP, (options) => peek(options.positional[0], { logs: options.logs }));
