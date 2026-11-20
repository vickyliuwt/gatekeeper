import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createAwsIntake } from '../src/aws-intake.js';
import { createGatewayHandler } from '../src/gateway.js';

const secret = 'local-gateway-test';
const text = '{ "zen": "你好", "repository": { "full_name": "example/demo" } }\n';
const bytes = Buffer.from(text, 'utf8');
const signature = 'sha256=' + createHmac('sha256', secret)
  .update(bytes)
  .digest('hex');

const handler = createGatewayHandler(createAwsIntake({
  secret,
  allowedRepo: 'example/demo',
  tableName: 'test-jobs',
  queueUrl: 'https://example.invalid/test-queue',
}));

for (const [encoding, isBase64Encoded] of [['utf8', false], ['base64', true]]) {
  test(`preserves signed webhook bytes from a ${encoding} gateway event`, async () => {
    const response = await handler({
      version: '2.0',
      routeKey: 'POST /webhooks/github',
      headers: {
        'x-hub-signature-256': signature,
        'x-github-event': 'ping',
        'x-github-delivery': 'delivery-gateway-test',
      },
      isBase64Encoded,
      body: isBase64Encoded ? bytes.toString('base64') : text,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(response.body), { message: 'pong' });
  });
}
