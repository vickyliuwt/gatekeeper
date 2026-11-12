import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const { DEMO_REPO, HEAD_SHA, TRACE_ID } = process.env;
if (!DEMO_REPO || !HEAD_SHA || !TRACE_ID) {
  throw new Error('Set DEMO_REPO, HEAD_SHA and TRACE_ID');
}

const secret = readFileSync(0, 'utf8').trimEnd();
if (!secret) throw new Error('Empty webhook secret');

const body = JSON.stringify({
  action: 'opened',
  repository: { id: 123456, full_name: DEMO_REPO },
  pull_request: { number: 7, head: { sha: HEAD_SHA } },
});

const signature = createHmac('sha256', secret).update(body).digest('hex');
process.stdout.write(JSON.stringify({
  version: '2.0',
  routeKey: 'POST /webhooks/github',
  headers: {
    'x-github-event': 'pull_request',
    'x-github-delivery': TRACE_ID,
    'x-hub-signature-256': 'sha256=' + signature,
  },
  isBase64Encoded: false,
  body,
}));
