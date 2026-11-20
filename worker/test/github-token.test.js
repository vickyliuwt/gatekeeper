import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { getGitHubToken } from '../src/github-token.js';

test('reads the configured SSM parameter with decryption', async () => {
  const commands = [];
  const token = await getGitHubToken({
    parameterName: '/gatekeeper/github-token',
    token: 'fallback-token',
    ssmClient: {
      async send(command) {
        commands.push(command);
        return { Parameter: { Value: ' ssm-test-token\n' } };
      },
    },
  });

  assert.equal(token, 'ssm-test-token');
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof GetParameterCommand);
  assert.deepEqual(commands[0].input, {
    Name: '/gatekeeper/github-token',
    WithDecryption: true,
  });
});

test('uses a direct token when no SSM parameter is configured', async () => {
  const token = await getGitHubToken({
    parameterName: '',
    token: ' local-test-token ',
    ssmClient: {
      async send() {
        assert.fail('Direct token must not call SSM');
      },
    },
  });

  assert.equal(token, 'local-test-token');
});

test('rejects missing configuration', async () => {
  await assert.rejects(
    getGitHubToken({ parameterName: '', token: '' }),
    /Configure GITHUB_TOKEN_PARAM or GITHUB_TOKEN/,
  );
});

test('rejects empty SSM values instead of using the fallback token', async () => {
  for (const result of [{}, { Parameter: { Value: '   ' } }]) {
    await assert.rejects(
      getGitHubToken({
        parameterName: '/gatekeeper/github-token',
        token: 'fallback-token',
        ssmClient: { async send() { return result; } },
      }),
      /GitHub token parameter is empty/,
    );
  }
});

test('propagates SSM failure instead of using the fallback token', async () => {
  const failure = new Error('SSM unavailable');

  await assert.rejects(
    getGitHubToken({
      parameterName: '/gatekeeper/github-token',
      token: 'fallback-token',
      ssmClient: { async send() { throw failure; } },
    }),
    error => error === failure,
  );
});
