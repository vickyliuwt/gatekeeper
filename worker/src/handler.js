import crypto from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { scanCode } from '../../sast/backend/scanner.js';

const REGION = process.env.AWS_REGION || 'us-east-1';
const JOBS_TABLE = process.env.JOBS_TABLE;
const REPORTS_BUCKET = process.env.REPORTS_BUCKET;
const LEASE_SECONDS = 90;
const SCAN_BUDGET_MS = 60_000;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// One JSON line per event, always carrying jobId and traceId.
function log(stage, fields = {}) {
  console.log(JSON.stringify({ svc: 'worker', stage, ...fields }));
}

// Reports must never echo a secret back to the reader.
function maskEvidence(finding) {
  if (finding.id !== 'HARDCODED_SECRET') return finding;
  return { ...finding, evidence: finding.evidence.replace(/(['"])[^'"]{4,}\1/g, '$1***$1') };
}

function summarize(findings) {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const verdict = counts.HIGH > 0 ? 'failure' : 'success';
  return { counts, verdict };
}

async function readBody(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// Claim the job so two workers never scan the same commit.
async function claimJob(jobId, owner) {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();

  await ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET phase = :running, leaseOwner = :owner, leaseUntil = :until, updatedAt = :now ADD attempt :one',
    ConditionExpression: 'attribute_exists(jobId) AND (phase IN (:queued, :failed) OR (phase = :running AND leaseUntil < :now))',
    ExpressionAttributeValues: {
      ':running': 'RUNNING',
      ':queued': 'QUEUED',
      ':failed': 'FAILED',
      ':owner': owner,
      ':until': leaseUntil,
      ':now': now,
      ':one': 1
    }
  }));
}

async function finishJob(jobId, owner, patch) {
  await ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET phase = :phase, verdict = :verdict, counts = :counts, reportKey = :key, updatedAt = :now',
    ConditionExpression: 'leaseOwner = :owner',
    ExpressionAttributeValues: {
      ':phase': 'DONE',
      ':verdict': patch.verdict,
      ':counts': patch.counts,
      ':key': patch.reportKey,
      ':owner': owner,
      ':now': new Date().toISOString()
    }
  }));
}

async function processJob({ jobId, traceId }) {
  const owner = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    await claimJob(jobId, owner);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      log('claim_skipped', { jobId, traceId, reason: 'another worker holds the lease' });
      return;
    }
    throw err;
  }
  log('claimed', { jobId, traceId, owner });

  const { Item: job } = await ddb.send(new GetCommand({ TableName: JOBS_TABLE, Key: { jobId } }));
  if (!job?.codeKey) throw new Error(`job ${jobId} has no codeKey`);

  const obj = await s3.send(new GetObjectCommand({ Bucket: REPORTS_BUCKET, Key: job.codeKey }));
  const code = await readBody(obj.Body);
  log('code_loaded', { jobId, traceId, bytes: code.length });

  const findings = scanCode(code, job.filename || 'pasted.js').map(maskEvidence);
  const scanMs = Date.now() - startedAt;

  if (scanMs > SCAN_BUDGET_MS) throw new Error(`scan exceeded budget: ${scanMs} ms`);

  const { counts, verdict } = summarize(findings);
  const reportKey = `reports/${jobId}.json`;

  // Report first, verdict second: a reader never sees a verdict with no report behind it.
  await s3.send(new PutObjectCommand({
    Bucket: REPORTS_BUCKET,
    Key: reportKey,
    ContentType: 'application/json',
    Body: JSON.stringify({ jobId, traceId, verdict, counts, scanMs, findings }, null, 2)
  }));
  log('report_written', { jobId, traceId, reportKey, findings: findings.length });

  await finishJob(jobId, owner, { verdict, counts, reportKey });
  log('done', { jobId, traceId, verdict, ...counts, scanMs });
}

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const body = JSON.parse(record.body);
    try {
      await processJob(body);
    } catch (err) {
      log('error', { jobId: body.jobId, traceId: body.traceId, message: err.message });
      throw err; // let SQS retry, then the DLQ
    }
  }
  return { ok: true };
};