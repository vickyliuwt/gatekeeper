import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent } from '../src/event.js';

const allowedRepo = 'example/demo';

function payload(action = 'opened', repo = allowedRepo) {
  return {
    action,
    repository: { full_name: repo },
  };
}

test('accepts all three planned PR actions', () => {
  for (const action of ['opened', 'reopened', 'synchronize']) {
    assert.deepEqual(
      classifyEvent('pull_request', payload(action), allowedRepo),
      { kind: 'pr' },
    );
  }
});

test('acknowledges ping without selecting a PR job', () => {
  assert.deepEqual(
    classifyEvent('ping', payload(), allowedRepo),
    { kind: 'ping' },
  );
});

test('ignores unrelated events and PR actions', () => {
  assert.equal(
    classifyEvent('push', payload(), allowedRepo).kind,
    'ignored',
  );
  assert.equal(
    classifyEvent('pull_request', payload('closed'), allowedRepo).kind,
    'ignored',
  );
});

test('rejects another repository for both PR and ping', () => {
  for (const event of ['pull_request', 'ping']) {
    assert.equal(
      classifyEvent(event, payload('opened', 'other/repo'), allowedRepo).kind,
      'forbidden',
    );
  }
});

test('compares repository names case-insensitively', () => {
  assert.equal(
    classifyEvent('pull_request', payload('opened', 'Example/Demo'), allowedRepo).kind,
    'pr',
  );
});

test('rejects malformed payloads and missing fields', () => {
  for (const value of [
    null,
    [],
    {},
    { repository: { full_name: allowedRepo } },
  ]) {
    assert.equal(
      classifyEvent('pull_request', value, allowedRepo).kind,
      'invalid',
    );
  }
});

test('fails explicitly when repository configuration is missing', () => {
  assert.throws(
    () => classifyEvent('pull_request', payload(), ''),
    /repository is not configured/,
  );
});
