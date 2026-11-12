#!/usr/bin/env node
// Follow one job (README.md, proposal "Trace a stuck PR"): its DynamoDB item, its report, and a
// CloudWatch Logs Insights query over every gk- Lambda log group. Read only.
//   node scripts/gk/peek-job.mjs paste-3f2a...        node scripts/gk/peek-job.mjs pr-7812-9c1e... --logs
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

export const insightsQuery = (jobId) => `fields @timestamp, @log, svc, stage, msg\n| filter @message like "${jobId}"\n| sort @timestamp asc\n| limit 50`;

// Where did it stop? (README.md, "Job item")
export function explain(job) {
  if (!job) return 'No item: the front door never created it (wrong jobId, expired by TTL, or the request failed before PutItem).';
  if (job.phase === 'QUEUED') return 'QUEUED: nothing has claimed it. Check that a worker is deployed and running for this account.';
  if (job.phase === 'RUNNING') {
    const late = Number(job.leaseUntil) * 1000 < Date.now();
    return late ? 'RUNNING with an old lease: the worker stopped mid-scan. SQS gives the message out again after 360 s.' : 'RUNNING: a worker holds the lease now. Check again in a few seconds.';
  }
  if (job.phase === 'FAILED') return `FAILED on try ${job.attempt}: ${job.lastError || 'no lastError'}. SQS retries after 360 s; after the 5th try it ends as INCOMPLETE.`;
  if (job.phase === 'DONE') return job.verdict === 'INCOMPLETE' ? `DONE, INCOMPLETE: ${job.lastError || 'not every file was scanned'}.` : `DONE, verdict ${job.verdict}.`;
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
  if (job?.counts) print(`counts: high ${job.counts.high}, medium ${job.counts.medium}, low ${job.counts.low}`);
  print(`Where it stopped: ${explain(job)}`);
  if (job?.reportKey) {
    const rep = awsCli(['s3', 'cp', `s3://gk-data-${account}/${job.reportKey}`, '-'], { allowFail: true });
    if (rep.ok) {
      const report = JSON.parse(rep.stdout);
      title('Report (first 5 findings; evidence lines are not printed, so this is safe on a screen recording)');
      for (const f of (report.findings || []).slice(0, 5)) print(`${f.severity} ${f.id} ${f.file}:${f.line}`);
      print(`${(report.findings || []).length} finding(s), verdict ${report.verdict}`);
    }
  }
  title('Logs Insights query (CloudWatch > Logs Insights, pick every /aws/lambda/gk- group, last 1 hour)');
  process.stdout.write(`${insightsQuery(jobId)}\n`);
  if (logs) await runQuery(jobId, awsCli);
  return job;
}

await cli(import.meta.url, HELP, (options) => peek(options.positional[0], { logs: options.logs }));
