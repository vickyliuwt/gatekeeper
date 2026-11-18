// shared helpers for our deploy scripts
// no npm packages
// programs start without a shell and use argument arrays
// so PowerShell quoting
// and a space in a folder name can not break a command
// on Windows and macOS and Linux
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGION = 'us-east-1';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const INFRA = join(REPO_ROOT, 'infra');
export const TFVARS_JSON = join(INFRA, 'gk.auto.tfvars.json');
export const PLACEHOLDER_DIGEST = `sha256:${'0'.repeat(64)}`;

// one row per part
// ready means its folder has a Dockerfile and a package lock file
// and its root tf file has its ECR repository
export const PARTS = Object.freeze({
  intake: { service: 'webhook', ecr: 'gatekeeper/webhook', resource: 'webhook', enableVar: 'enable_intake', digestVar: 'webhook_image_digest', tfFile: 'ecr.tf', param: '/gatekeeper/webhook-secret', owner: 'Lingsong (Part A)' },
  worker: { service: 'worker', dir: 'worker', context: '.', dockerfile: 'worker/Dockerfile', watch: ['worker', 'sast/backend'], ecr: 'gatekeeper/worker', resource: 'worker', enableVar: 'enable_worker', digestVar: 'worker_image_digest', tfFile: 'worker.tf', param: '/gatekeeper/github-token', owner: 'Yuyao (Part B)' },
  web: { service: 'web', ecr: 'gatekeeper/web', resource: 'web', enableVar: 'enable_web', digestVar: 'web_image_digest', tfFile: 'web.tf', param: '/gatekeeper/demo-code', owner: 'Weiting (Part C)' },
});
export const PART_NAMES = Object.freeze(Object.keys(PARTS));
export const ecrTarget = (name) => `aws_ecr_repository.${PARTS[name].resource}[0]`;

// where a part keeps its Dockerfile and lock file
// web and webhook live in services
// the worker lives in worker and builds from the repo root
// because its image also copies the course scanner
export function partPaths(name) {
  const p = PARTS[name];
  const dir = p.dir ?? `services/${p.service}`;
  return { dir, context: p.context ?? dir, dockerfile: p.dockerfile ?? `${dir}/Dockerfile`, watch: p.watch ?? [dir] };
}

export function run(cmd, args, { input, inherit = false, allowFail = false, cwd = REPO_ROOT, env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, AWS_REGION: REGION, AWS_DEFAULT_REGION: REGION, AWS_PAGER: '', ...env },
    input,
    encoding: 'utf8',
    stdio: inherit ? ['inherit', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const message = result.error.code === 'ENOENT'
      ? `"${cmd}" was not found. Install it, then close every terminal and IDE and open a new one (only a new window reads the new PATH).`
      : `${cmd} could not start: ${result.error.message}`;
    if (allowFail) return { ok: false, code: -1, stdout: '', stderr: message };
    throw new Error(message);
  }
  const out = { ok: result.status === 0, code: result.status, stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? '').trim() };
  if (!out.ok && !allowFail) {
    const tail = out.stderr.split('\n').slice(-12).join('\n');
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${out.code}).${tail ? `\n${tail}` : ''}`);
  }
  return out;
}

export const aws = (args, options = {}) => run('aws', [...args, '--region', REGION, '--no-cli-pager'], options);
export const terraform = (args, options = {}) => run('terraform', args, options);

export const isRepoName = (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v);
export const isDigest = (v) => typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v);
export const isCommitSha = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

export function parseArgs(argv) {
  const o = { core: false, parts: [], repo: null, listRepo: null, yes: false, help: false, logs: false, withCode: false, show: false, renew: false, allowRemove: false, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--part') o.parts.push(value());
    else if (a.startsWith('--part=')) o.parts.push(a.slice(7));
    else if (a === '--repo') o.repo = value();
    else if (a.startsWith('--repo=')) o.repo = a.slice(7);
    else if (a === '--list-repo') o.listRepo = value();
    else if (a === '--core') o.core = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--logs') o.logs = true;
    else if (a === '--with-code') o.withCode = true;
    else if (a === '--show') o.show = true;
    else if (a === '--new') o.renew = true;
    else if (a === '--allow-remove') o.allowRemove = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else o.positional.push(a);
  }
  o.parts = [...new Set(o.parts)];
  for (const p of o.parts) if (!PART_NAMES.includes(p)) throw new Error(`--part must be one of ${PART_NAMES.join(', ')} (got "${p}")`);
  for (const [flag, v] of [['--repo', o.repo], ['--list-repo', o.listRepo]]) {
    if (v !== null && !isRepoName(v)) throw new Error(`${flag} must look like OWNER/REPO, for example vickyliuwt/gatekeeper-demo`);
  }
  if (o.parts.includes('intake') && !o.repo) throw new Error('--part intake needs --repo OWNER/REPO (the demo repo the webhook accepts).');
  return o;
}

// Terraform vars for one deploy
// every switch is set so no deploy builds
// a part you did not name even if an old local switches file says so
export function varsFor({ parts, repo = null, listRepo = null, digests = {} }) {
  const vars = {};
  for (const name of PART_NAMES) vars[PARTS[name].enableVar] = parts.includes(name);
  for (const name of parts) if (digests[name]) vars[PARTS[name].digestVar] = digests[name];
  if (repo) vars.allowed_repo = repo;
  if (listRepo) vars.web_list_repo = listRepo;
  return vars;
}
export const varFlags = (vars) => Object.entries(vars).flatMap(([k, v]) => ['-var', `${k}=${v}`]);
export const placeholderDigests = (parts) => Object.fromEntries(parts.map((p) => [p, PLACEHOLDER_DIGEST]));

export function partProblems(name, root = REPO_ROOT) {
  const p = PARTS[name];
  const problems = [];
  const rel = partPaths(name).dir;
  const dir = join(root, ...rel.split('/'));
  if (!existsSync(join(dir, 'Dockerfile'))) problems.push(`${rel}/Dockerfile is missing`);
  if (!existsSync(join(dir, 'package-lock.json'))) problems.push(`${rel}/package-lock.json is missing (run npm install there and commit it)`);
  const tf = join(root, 'infra', p.tfFile);
  const declares = existsSync(tf) && new RegExp(`resource\\s+"aws_ecr_repository"\\s+"${p.resource}"`).test(readFileSync(tf, 'utf8'));
  if (!declares) problems.push(`infra/${p.tfFile} has no aws_ecr_repository "${p.resource}" yet (${p.owner} adds it)`);
  return problems;
}

export const newSecretHex = () => randomBytes(32).toString('hex');
// 32 letters and digits with no l o 0 or 1
// easy to read out loud
// 12 random chars
export function newDemoCode(bytes = randomBytes(12)) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const c = [...bytes].map((b) => alphabet[b & 31]).join('');
  return `gk-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

export function writeTfvars(vars, path = TFVARS_JSON) {
  writeFileSync(path, `${JSON.stringify(vars, null, 2)}\n`);
}

export function readOutputs({ tf = terraform } = {}) {
  const r = tf(['-chdir=infra', 'output', '-json'], { allowFail: true });
  if (!r.ok || !r.stdout) return {};
  const raw = JSON.parse(r.stdout);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v?.value ?? null]));
}

export function getAccount(awsCli = aws) {
  const r = awsCli(['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'], { allowFail: true });
  if (!r.ok || !/^\d{12}$/.test(r.stdout)) {
    throw new Error('AWS keys are missing or expired. Start the lab, copy the AWS CLI block from Learner Lab "AWS Details" into your .aws/credentials file, then run again.');
  }
  return r.stdout;
}

export function terraformInit(account, { tf = terraform } = {}) {
  tf(['-chdir=infra', 'init', '-input=false', '-reconfigure', `-backend-config=bucket=gk-tfstate-${account}`], { inherit: true });
}

export const step = (text) => process.stdout.write(`\n=== ${text}\n`);
export const info = (text) => process.stdout.write(`    ${text}\n`);

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const a = resolve(process.argv[1]);
  const b = fileURLToPath(metaUrl);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function cli(metaUrl, help, main) {
  if (!isMain(metaUrl)) return;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${help}\n`);
      return;
    }
    await main(options);
  } catch (error) {
    process.stderr.write(`\nERROR: ${error.message}\n`);
    process.exit(1);
  }
}
