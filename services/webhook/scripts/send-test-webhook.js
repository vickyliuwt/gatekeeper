import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const secret = process.env.WEBHOOK_SECRET;

if (!secret) {
  throw new Error('Set WEBHOOK_SECRET before running this script');
}

const payload = {
  action: 'opened',
  repository: {
    id: 123456,
    full_name: 'example/demo',
  },
  pull_request: {
    number: 7,
    head: {
      sha: 'a'.repeat(40),
    },
  },
};

const body = JSON.stringify(payload);
const traceId = randomUUID();
const signature = 'sha256=' + createHmac('sha256', secret)
  .update(body, 'utf8')
  .digest('hex');

const response = await fetch(
  'http://127.0.0.1:3001/webhooks/github',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': traceId,
    },
    body,
    signal: AbortSignal.timeout(5000),
  },
);

const result = await response.json();

console.log('HTTP status:', response.status);
console.log('Delivery ID:', traceId);
console.log('Response:', JSON.stringify(result, null, 2));

assert.equal(response.status, 202);
assert.equal(result.jobId, `pr-123456-${payload.pull_request.head.sha}`);

console.log('PASS: signed PR accepted');
