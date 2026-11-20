// tests for the worker hookup
// the worker lives in worker and builds from the repo root
// web and webhook still build from their services folder
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partPaths, partProblems } from '../lib/run.mjs';
import { ensureImage, serviceTag } from '../lib/images.mjs';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function fakeTools() {
  const calls = [];
  const runner = (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, stdout: cmd === 'git' && args[0] === 'log' ? SHA : '', stderr: '' }; };
  let looked = 0;
  const awsCli = (args) => {
    if (args[1] === 'describe-images') { looked += 1; return looked === 1 ? { ok: false, stdout: '', stderr: 'ImageNotFoundException' } : { ok: true, stdout: DIGEST, stderr: '' }; }
    if (args[1] === 'describe-repositories') return { ok: true, stdout: '123456789012.dkr.ecr.us-east-1.amazonaws.com/gatekeeper/x', stderr: '' };
    return { ok: true, stdout: 'pw', stderr: '' };
  };
  return { calls, runner, awsCli };
}

test('web and webhook keep their services folder', () => {
  assert.deepEqual(partPaths('web'), { dir: 'services/web', context: 'services/web', dockerfile: 'services/web/Dockerfile', watch: ['services/web'] });
  assert.equal(partPaths('intake').dir, 'services/webhook');
});

test('the worker builds from the repo root with worker Dockerfile', () => {
  assert.deepEqual(partPaths('worker'), { dir: 'worker', context: '.', dockerfile: 'worker/Dockerfile', watch: ['worker', 'sast/backend'] });
});

test('a worker folder with its ECR repo is ready to deploy', () => {
  const root = mkdtempSync(join(tmpdir(), 'gk-worker-'));
  mkdirSync(join(root, 'worker'));
  mkdirSync(join(root, 'infra'));
  writeFileSync(join(root, 'worker', 'Dockerfile'), 'FROM x\n');
  writeFileSync(join(root, 'worker', 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'infra', 'worker.tf'), 'resource "aws_ecr_repository" "worker" {\n}\n');
  assert.deepEqual(partProblems('worker', root), []);
});

test('a missing worker Dockerfile names the worker folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'gk-worker-'));
  const problems = partProblems('worker', root);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /^worker\/Dockerfile is missing/);
});

test('the worker image tag counts the scanner folder too', () => {
  const { calls, runner } = fakeTools();
  assert.equal(serviceTag('worker', runner, ['worker', 'sast/backend']), SHA);
  assert.deepEqual(calls[0], ['git', 'status', '--porcelain', '--', 'worker', 'sast/backend']);
  assert.deepEqual(calls[1], ['git', 'log', '-1', '--format=%H', '--', 'worker', 'sast/backend']);
});

test('the worker build uses the repo root and worker Dockerfile', () => {
  const { calls, runner, awsCli } = fakeTools();
  const out = ensureImage('worker', { runner, awsCli });
  assert.equal(out.digest, DIGEST);
  const build = calls.find((c) => c[0] === 'docker' && c[1] === 'buildx');
  assert.deepEqual(build.slice(-6), ['--file', 'worker/Dockerfile', '--tag', `123456789012.dkr.ecr.us-east-1.amazonaws.com/gatekeeper/x:${SHA}`, '--push', '.']);
});

test('the web build is the same as before', () => {
  const { calls, runner, awsCli } = fakeTools();
  ensureImage('web', { runner, awsCli });
  const build = calls.find((c) => c[0] === 'docker' && c[1] === 'buildx');
  assert.deepEqual(build.slice(-6), ['--file', 'services/web/Dockerfile', '--tag', `123456789012.dkr.ecr.us-east-1.amazonaws.com/gatekeeper/x:${SHA}`, '--push', 'services/web']);
  assert.deepEqual(calls[0].slice(-1), ['services/web']);
});

test('the worker ECR can live in worker-ecr.tf like on part a', () => {
  const root = mkdtempSync(join(tmpdir(), 'gk-worker-'));
  mkdirSync(join(root, 'worker'));
  mkdirSync(join(root, 'infra'));
  writeFileSync(join(root, 'worker', 'Dockerfile'), 'FROM x\n');
  writeFileSync(join(root, 'worker', 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'infra', 'worker.tf'), 'variable "enable_worker" {\n}\n');
  writeFileSync(join(root, 'infra', 'worker-ecr.tf'), 'resource "aws_ecr_repository" "worker" {\n  count = 1\n}\n');
  assert.deepEqual(partProblems('worker', root), []);
});

test('no ECR in any infra file is still a problem', () => {
  const root = mkdtempSync(join(tmpdir(), 'gk-worker-'));
  mkdirSync(join(root, 'infra'));
  writeFileSync(join(root, 'infra', 'worker.tf'), 'variable "enable_worker" {\n}\n');
  assert.match(partProblems('worker', root).join(' '), /aws_ecr_repository "worker"/);
});
