import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayHandler, toRequest } from '../src/gateway.js';
import { captureLog } from './helpers.js';

test('unknown routes answer 404 and never reach a handler', async () => {
  const { log } = captureLog();
  const handler = createGatewayHandler({}, { log });
  const response = await handler({ routeKey: 'GET /admin' });
  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'not_found');
});

test('decodes base64 bodies, lowercases headers and passes path parameters', () => {
  const request = toRequest({
    routeKey: 'POST /scans',
    rawPath: '/scans',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Code': 'abc' },
    pathParameters: { jobId: 'x' },
    isBase64Encoded: true,
    body: Buffer.from('{"code":"你好"}', 'utf8').toString('base64'),
    requestContext: { http: { method: 'POST' }, requestId: 'r-1' },
  });
  assert.equal(request.body, '{"code":"你好"}');
  assert.equal(request.headers['x-demo-code'], 'abc');
  assert.equal(request.params.jobId, 'x');
  assert.equal(request.method, 'POST');
  assert.equal(request.requestId, 'r-1');
});

test('a crash becomes a 500 without a stack trace, and is logged', async () => {
  const { log, lines } = captureLog();
  const handler = createGatewayHandler({
    'GET /scans': async () => {
      throw new TypeError('boom at line 42');
    },
  }, { log });
  const response = await handler({ routeKey: 'GET /scans' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes('boom'), false);
  assert.equal(lines[0].errorType, 'TypeError');
});
