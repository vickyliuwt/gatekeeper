import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLACEHOLDER_DIGEST, ecrTarget, newDemoCode, parseArgs, partProblems, varFlags, varsFor } from '../lib/run.mjs';
import { deploy, ensureParameter, liveParts } from '../deploy.mjs';
import { destroy, gatekeeperLeftovers, printLeftovers } from '../destroy.mjs';
import { JOB_ID, explain, unmarshalItem } from '../peek-job.mjs';
import { runChecks } from '../smoke.mjs';

const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '' });
const fail = (stderr) => ({ ok: false, code: 1, stdout: '', stderr });
const DIGEST = `sha256:${'a'.repeat(64)}`;

function readyRepo() {
  const root = mkdtempSync(join(tmpdir(), 'gk-tools-'));
  mkdirSync(join(root, 'services', 'web'), { recursive: true });
  mkdirSync(join(root, 'infra'), { recursive: true });
  writeFileSync(join(root, 'services', 'web', 'Dockerfile'), 'FROM x\n');
  writeFileSync(join(root, 'services', 'web', 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'infra', 'web.tf'), 'resource "aws_ecr_repository" "web" {\n  count = 1\n}\n');
  return root;
}

test('parseArgs reads parts, repo and flags', () => {
  const o = parseArgs(['--part', 'web', '--part=worker', '--yes', '--list-repo', 'vickyliuwt/gatekeeper-demo']);
  assert.deepEqual(o.parts, ['web', 'worker']);
  assert.equal(o.yes, true);
  assert.equal(o.listRepo, 'vickyliuwt/gatekeeper-demo');
});

test('parseArgs refuses bad input', () => {
  assert.throws(() => parseArgs(['--part', 'frontend']), /must be one of/);
  assert.throws(() => parseArgs(['--part', 'intake']), /needs --repo/);
  assert.throws(() => parseArgs(['--repo', 'not a repo']), /OWNER\/REPO/);
  assert.throws(() => parseArgs(['--colour']), /Unknown option/);
});

test('every switch is explicit, so a deploy never builds a part you did not name', () => {
  const vars = varsFor({ parts: ['web'], digests: { web: DIGEST } });
  assert.deepEqual(vars, { enable_intake: false, enable_worker: false, enable_web: true, web_image_digest: DIGEST });
  assert.deepEqual(varFlags({ enable_web: true }), ['-var', 'enable_web=true']);
  assert.equal(ecrTarget('web'), 'aws_ecr_repository.web[0]');
  assert.equal(ecrTarget('intake'), 'aws_ecr_repository.webhook[0]');
});

test('a part is ready only with a Dockerfile, a lock file and its ECR resource', () => {
  const root = readyRepo();
  assert.deepEqual(partProblems('web', root), []);
  assert.equal(partProblems('worker', root).length, 3);
});

test('the access code is readable and random', () => {
  assert.match(newDemoCode(), /^gk-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.notEqual(newDemoCode(), newDemoCode());
  assert.doesNotMatch(newDemoCode(Buffer.alloc(12, 255)), /[lo01]/);
});

test('ensureParameter creates a missing SecureString and never prints the value', () => {
  const calls = [];
  const awsCli = (args) => {
    calls.push(args);
    return args[1] === 'describe-parameters' ? ok('None') : ok();
  };
  const printed = [];
  assert.equal(ensureParameter('/gatekeeper/demo-code', () => 'gk-secret-value', { awsCli, print: (t) => printed.push(t) }), 'created');
  assert.ok(calls[1].includes('SecureString'));
  assert.ok(!printed.join(' ').includes('gk-secret-value'));
  assert.throws(() => ensureParameter('/gatekeeper/github-token', null, { awsCli, create: false }), /missing/);
});

test('deploy runs the 7 steps in order: SSM, state bucket, init, ECR-only apply, image, full apply', async () => {
  const tfCalls = [];
  const awsCalls = [];
  const saved = [];
  const awsCli = (args) => {
    awsCalls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'sts') return ok('123456789012');
    if (args[1] === 'describe-parameters') return ok('None');
    if (args[1] === 'head-bucket') return fail('An error occurred (404) when calling the HeadBucket operation: Not Found');
    return ok();
  };
  const runner = (cmd, args) => (cmd === 'docker' && args[0] === 'info' ? ok('linux') : ok('1.0'));
  const tf = (args) => {
    tfCalls.push(args);
    if (args[1] === 'output') return ok(JSON.stringify({ web_page_url: { value: 'https://x.execute-api.us-east-1.amazonaws.com/' }, api_endpoint: { value: 'https://x' } }));
    return ok();
  };
  const result = await deploy({ parts: ['web'], yes: true }, {
    runner, awsCli, tf, root: readyRepo(), print: () => {}, title: () => {},
    buildImage: () => ({ digest: DIGEST }), saveVars: (v) => saved.push(v),
  });
  assert.deepEqual(tfCalls.map((a) => a[1]), ['init', 'state', 'apply', 'apply', 'output']);
  assert.ok(tfCalls[0].includes('-backend-config=bucket=gk-tfstate-123456789012'));
  const first = tfCalls[2];
  assert.ok(first.includes('aws_ecr_repository.web[0]') && first.includes('-auto-approve'));
  assert.ok(first.includes('enable_web=true') && first.includes('enable_intake=false'));
  assert.ok(first.includes(`web_image_digest=${PLACEHOLDER_DIGEST}`));
  assert.ok(!tfCalls[3].includes('-target'));
  assert.equal(saved[0].web_image_digest, DIGEST);
  assert.ok(awsCalls.includes('ssm put-parameter') && awsCalls.includes('s3api create-bucket'));
  assert.equal(result.outputs.web_page_url, 'https://x.execute-api.us-east-1.amazonaws.com/');
});

test('deploy --core builds only the shared core: no SSM, no image, every part off', async () => {
  const tfCalls = [];
  const saved = [];
  const awsCalls = [];
  await deploy({ core: true, yes: true }, {
    runner: (cmd, args) => (cmd === 'docker' && args[0] === 'info' ? ok('linux') : ok('1.0')),
    awsCli: (args) => { awsCalls.push(args[0]); return args[0] === 'sts' ? ok('123456789012') : (args[1] === 'head-bucket' ? ok() : ok()); },
    tf: (args) => { tfCalls.push(args); return args[1] === 'output' ? ok('{}') : ok(); },
    buildImage: () => { throw new Error('no image in core mode'); }, saveVars: (v) => saved.push(v), print: () => {}, title: () => {},
  });
  assert.deepEqual(tfCalls.map((a) => a[1]), ['init', 'state', 'apply', 'output']);
  assert.deepEqual(saved[0], { enable_intake: false, enable_worker: false, enable_web: false });
  assert.ok(!awsCalls.includes('ssm'));
});

test('deploy stops early when a part is not ready', async () => {
  await assert.rejects(() => deploy({ parts: ['worker'] }, { root: readyRepo(), print: () => {}, title: () => {} }), /not ready/);
  await assert.rejects(() => deploy({ parts: [] }, {}), /--core/);
});

test('destroy runs terraform destroy, removes the vars file and lists GateKeeper leftovers', async () => {
  const order = [];
  const left = await destroy({ yes: true }, {
    awsCli: () => ok('123456789012'),
    tf: (args) => { order.push(args[1]); return ok(); },
    removeVars: () => order.push('removeVars'),
    leftovers: () => [{ label: 'Lambda functions', ok: true, names: [] }],
    print: () => {}, title: () => {},
  });
  assert.deepEqual(order, ['init', 'destroy', 'removeVars']);
  assert.equal(left, 0);
});

test('leftover check parses the AWS answers and counts what is left', () => {
  const rows = gatekeeperLeftovers((args) => (args[0] === 'lambda' ? ok('["gk-submit"]') : args[0] === 'sqs' ? ok('null') : fail('AccessDenied')));
  assert.deepEqual(rows[0], { label: 'Lambda functions', ok: true, names: ['gk-submit'] });
  assert.equal(rows.find((r) => r.label === 'SQS queues').names.length, 0);
  assert.equal(printLeftovers(rows, () => {}), 1);
});

test('the intake part is found in infra/ecr.tf, where Part A declares its repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'gk-intake-'));
  mkdirSync(join(root, 'services', 'webhook'), { recursive: true });
  mkdirSync(join(root, 'infra'), { recursive: true });
  writeFileSync(join(root, 'services', 'webhook', 'Dockerfile'), 'FROM x');
  writeFileSync(join(root, 'services', 'webhook', 'package-lock.json'), '{}');
  writeFileSync(join(root, 'infra', 'ecr.tf'), 'resource "aws_ecr_repository" "webhook" {\n  count = 1\n}\n');
  assert.deepEqual(partProblems('intake', root), []);
});
test('peek-job reads DynamoDB JSON and explains where a job stopped', () => {
  const job = unmarshalItem({ jobId: { S: 'paste-x' }, phase: { S: 'FAILED' }, attempt: { N: '2' }, lastError: { S: 'BOOM' }, counts: { M: { high: { N: '1' } } } });
  assert.equal(job.attempt, 2);
  assert.equal(job.counts.high, 1);
  assert.match(explain(job), /FAILED on try 2: BOOM/);
  assert.match(explain(null), /No item/);
  assert.ok(JOB_ID.test(`pr-7812-${'9'.repeat(40)}`));
  assert.ok(JOB_ID.test('paste-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'));
  assert.ok(!JOB_ID.test('paste-../x'));
});

test('smoke checks pass on a healthy deploy and fail loudly on a broken one', async () => {
  const outputs = { api_endpoint: 'https://api', jobs_table_name: 'gk-jobs', jobs_queue_url: 'https://q', data_bucket_name: 'gk-data-1', web_page_url: 'https://api/' };
  const awsCli = (args) => {
    if (args[1] === 'describe-table') return ok('["ACTIVE","byRepoTime"]');
    if (args[1] === 'describe-time-to-live') return ok('["ENABLED","expiresAt"]');
    if (args[1] === 'get-queue-attributes') return ok(JSON.stringify({ Attributes: { VisibilityTimeout: '360', RedrivePolicy: JSON.stringify({ maxReceiveCount: 5 }) } }));
    return ok();
  };
  const fetchFn = async (url, init = {}) => {
    const headers = new Headers();
    let status = 404;
    let body = '{"message":"Not Found"}';
    if (url.includes('s3.amazonaws.com')) status = 403;
    else if (url === 'https://api/') { status = 200; headers.set('content-type', 'text/html'); headers.set('content-security-policy', "default-src 'none'"); body = '<html></html>'; }
    else if (url === 'https://api/scans' && init.method === 'POST') { status = init.headers['x-demo-code'] ? 202 : 401; body = JSON.stringify({ jobId: 'paste-1' }); }
    else if (url === 'https://api/scans') { status = 200; body = '{"items":[]}'; }
    return new Response(body, { status, headers });
  };
  const good = await runChecks({ outputs, awsCli, fetchFn, withCode: true, readCode: () => 'gk-test' });
  assert.equal(good.filter((x) => !x.pass).length, 0, JSON.stringify(good.filter((x) => !x.pass)));
  assert.equal(good.length, 11);
  const bad = await runChecks({ outputs: { ...outputs, web_page_url: null }, awsCli: () => fail('AccessDenied'), fetchFn: async () => { throw new Error('offline'); } });
  assert.ok(bad.every((x) => !x.pass));
});


test('liveParts reads terraform state list and never mixes up web and webhook', () => {
  const partA = ['data.aws_caller_identity.current', 'aws_ecr_repository.webhook[0]', 'aws_lambda_function.webhook[0]', 'module.core.aws_sqs_queue.jobs'].join('\n');
  assert.deepEqual(liveParts(partA), ['intake']);
  assert.deepEqual(liveParts(`${partA}\naws_ecr_repository.web[0]\nmodule.web[0].aws_lambda_function.submit`), ['intake', 'web']);
  assert.deepEqual(liveParts(''), []);
  assert.equal(parseArgs(['--core', '--allow-remove']).allowRemove, true);
});

test('deploy stops before it would delete a part that is live in this account', async () => {
  const deps = (calls) => ({
    runner: (cmd, args) => (cmd === 'docker' && args[0] === 'info' ? ok('linux') : ok('1.0')),
    awsCli: (args) => (args[0] === 'sts' ? ok('123456789012') : args[1] === 'describe-parameters' ? ok('SecureString') : ok()),
    tf: (args) => { calls.push(args[1]); if (args[1] === 'state') return ok('aws_lambda_function.webhook[0]\naws_ecr_repository.webhook[0]'); return args[1] === 'output' ? ok('{}') : ok(); },
    root: readyRepo(), print: () => {}, title: () => {}, buildImage: () => ({ digest: DIGEST }), saveVars: () => {},
  });
  const stopped = [];
  await assert.rejects(() => deploy({ parts: ['web'], yes: true }, deps(stopped)), /already runs Part intake/);
  assert.deepEqual(stopped, ['init', 'state'], 'nothing was applied');
  const allowed = [];
  await deploy({ parts: ['web'], yes: true, allowRemove: true }, deps(allowed));
  assert.ok(allowed.includes('apply'));
});
