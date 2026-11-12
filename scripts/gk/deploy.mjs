#!/usr/bin/env node
// GateKeeper deploy tool. One command on Windows PowerShell 5.1, the PyCharm
// terminal and macOS. Deploys core plus ONLY the parts you name into YOUR OWN Learner Lab account.
import { ensureImage } from './lib/images.mjs';
import {
  PARTS, PART_NAMES, REGION, aws, cli, ecrTarget, getAccount, info, newDemoCode, newSecretHex, partProblems, placeholderDigests,
  readOutputs, run, step, terraform, terraformInit, varFlags, varsFor, writeTfvars,
} from './lib/run.mjs';

export const HELP = `Usage (from the repo root):
  node scripts/gk/deploy.mjs --core                            first deploy: core + data bucket only, no part
  node scripts/gk/deploy.mjs --part web                        Weiting, Part C
  node scripts/gk/deploy.mjs --part worker                     Yuyao, Part B (once infra/worker.tf has its ECR)
  node scripts/gk/deploy.mjs --part intake --repo OWNER/REPO   Lingsong, Part A (same result as scripts/deploy.sh)
  node scripts/gk/deploy.mjs --part intake --part worker --part web --repo OWNER/REPO   integration (demo account)
Options: --allow-remove (only on purpose: lets this deploy delete a part that is live in this account),
  --list-repo OWNER/REPO (repo the recent list shows when Part A is off), --yes (skip Terraform's two "yes"
questions; use it only after you have read one plan).
Steps: tools -> SSM parameters -> state bucket -> init -> apply 1 (ECR only) -> images -> apply 2 (everything).`;

export function requireTools(runner = run) {
  for (const [cmd, args] of [['git', ['--version']], ['aws', ['--version']], ['terraform', ['-version']], ['docker', ['version', '--format', '{{.Server.Version}}']]]) {
    const r = runner(cmd, args, { allowFail: true });
    if (!r.ok) throw new Error(cmd === 'docker' ? 'Docker Desktop is not running. Start it and wait for "Engine running".' : `${cmd} is not installed or not on PATH (install it, then open a new terminal).`);
  }
  const os = runner('docker', ['info', '--format', '{{.OSType}}'], { allowFail: true });
  if (os.ok && os.stdout !== 'linux') throw new Error('Docker Desktop must use Linux containers (whale icon > Switch to Linux containers).');
}

export function ensureParameter(name, makeValue, { awsCli = aws, print = info, create = true } = {}) {
  const r = awsCli(['ssm', 'describe-parameters', '--parameter-filters', `Key=Name,Values=${name}`, '--query', 'Parameters[0].Type', '--output', 'text'], { allowFail: true });
  if (!r.ok) throw new Error(`Could not check ${name}: ${r.stderr.split('\n').pop()}`);
  if (r.stdout === 'SecureString') {
    print(`${name}: exists`);
    return 'exists';
  }
  if (r.stdout && r.stdout !== 'None') throw new Error(`${name} exists but is a ${r.stdout}. Delete it in Systems Manager > Parameter Store, then run again.`);
  if (!create) throw new Error(`${name} is missing. Its owner creates it once with aws ssm put-parameter --type SecureString (never in git or Terraform).`);
  awsCli(['ssm', 'put-parameter', '--name', name, '--type', 'SecureString', '--value', makeValue()]);
  print(`${name}: created (value not shown)`);
  return 'created';
}

export function ensureStateBucket(account, { awsCli = aws, print = info } = {}) {
  const bucket = `gk-tfstate-${account}`;
  const shown = `gk-tfstate-...${account.slice(-4)}`; // never print the full account ID
  const head = awsCli(['s3api', 'head-bucket', '--bucket', bucket, '--expected-bucket-owner', account], { allowFail: true });
  if (head.ok) print(`${shown}: exists`);
  else if (/404|Not Found/i.test(head.stderr)) {
    awsCli(['s3api', 'create-bucket', '--bucket', bucket]);
    print(`${shown}: created`);
  } else throw new Error(`Cannot check ${shown}: ${head.stderr.split('\n').pop()}`);
  awsCli(['s3api', 'put-bucket-versioning', '--bucket', bucket, '--versioning-configuration', 'Status=Enabled']);
  awsCli(['s3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration',
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']);
  return bucket;
}

// Parts that already live in THIS account's Terraform state. Every switch is explicit, so a deploy that leaves a
// live part out would delete it (for example --part web in Lingsong's integration account would delete gk-webhook).
// The tool stops first, unless --allow-remove says that is really wanted.
export function liveParts(stateList) {
  const lines = String(stateList ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return PART_NAMES.filter((name) => {
    const r = PARTS[name].resource;
    const own = new RegExp(`^(?:aws_ecr_repository|aws_lambda_function)\\.${r}(?:\\[|$)|^module\\.${r}(?:\\[|\\.)`);
    return lines.some((l) => own.test(l));
  });
}

export function guardLiveParts({ live, parts, allowRemove = false }) {
  const missing = live.filter((name) => !parts.includes(name));
  if (missing.length === 0 || allowRemove) return missing;
  const keep = missing.map((n) => (n === 'intake' ? '--part intake --repo OWNER/REPO' : `--part ${n}`)).join(' ');
  throw new Error(`This account already runs ${missing.map((n) => `Part ${n} (${PARTS[n].owner})`).join(' and ')}, and this deploy would delete it.\n`
    + `  To keep it: run the same command again and add ${keep}\n  To delete it on purpose: add --allow-remove`);
}

export async function deploy(options, deps = {}) {
  const { runner = run, awsCli = aws, tf = terraform, print = info, title = step, buildImage = ensureImage, saveVars = writeTfvars, root } = deps;
  const { parts = [], repo = null, listRepo = null, yes = false, core = false, allowRemove = false } = options;
  if (parts.length === 0 && !core) throw new Error('Name a part (--part web, --part worker, --part intake --repo OWNER/REPO) or deploy only the shared core with --core.');

  title('1/7 Tools, Docker and AWS keys');
  for (const name of parts) {
    const problems = partProblems(name, root);
    if (problems.length > 0) throw new Error(`Part ${name} is not ready:\n  - ${problems.join('\n  - ')}`);
  }
  requireTools(runner);
  const account = getAccount(awsCli);
  print(`account ...${account.slice(-4)}, region ${REGION}, parts: ${parts.join(', ') || 'none (core only)'}`);

  title('2/7 SSM parameters (values never go into git, Terraform state or this window)');
  if (parts.includes('intake')) ensureParameter(PARTS.intake.param, newSecretHex, { awsCli, print });
  if (parts.includes('web')) ensureParameter(PARTS.web.param, newDemoCode, { awsCli, print });
  if (parts.includes('worker')) ensureParameter(PARTS.worker.param, null, { awsCli, print, create: false });

  title('3/7 Terraform state bucket (made once per account; destroy never deletes it)');
  ensureStateBucket(account, { awsCli, print });

  title('4/7 terraform init');
  terraformInit(account, { tf });
  const state = tf(['-chdir=infra', 'state', 'list'], { allowFail: true });
  const live = liveParts(state.ok ? state.stdout : '');
  if (live.length > 0) print(`live in this account already: ${live.join(', ')}`);
  for (const name of guardLiveParts({ live, parts, allowRemove })) print(`--allow-remove: this deploy deletes Part ${name}`);

  const auto = yes ? ['-auto-approve'] : [];
  const digests = {};
  if (parts.length > 0) {
    title('5/7 Apply 1 of 2: only the ECR repositories (a Lambda image must exist before its function)');
    const targets = parts.flatMap((name) => ['-target', ecrTarget(name)]);
    tf(['-chdir=infra', 'apply', '-input=false', ...auto, ...targets, ...varFlags(varsFor({ parts, repo, listRepo, digests: placeholderDigests(parts) }))], { inherit: true });
    title('6/7 Images (tag = last commit of the service folder; reused when ECR already has it)');
    for (const name of parts) digests[name] = buildImage(name, { awsCli, runner }).digest;
  } else {
    title('5/7 and 6/7 skipped: core only, no image to build');
  }
  saveVars(varsFor({ parts, repo, listRepo, digests }));
  print('wrote infra/gk.auto.tfvars.json (git-ignored), so plain terraform plan and destroy use the same switches');

  title(parts.length > 0 ? '7/7 Apply 2 of 2: everything else' : '7/7 Apply: the shared core (API, table, queues, data bucket, alert topic)');
  tf(['-chdir=infra', 'apply', '-input=false', ...auto], { inherit: true });

  const outputs = readOutputs({ tf });
  title('Done');
  const show = [['Paste and Scan page', outputs.web_page_url], ['API endpoint', outputs.api_endpoint], ['GitHub webhook URL', outputs.webhook_url], ['Dashboard gk-web', outputs.web_dashboard_url]];
  for (const [label, value] of show) if (value) print(`${label}: ${value}`);
  print('Next: node scripts/gk/smoke.mjs   (and when you finish: node scripts/gk/destroy.mjs, then End Lab)');
  if (parts.includes('web')) print('Access code (only in YOUR terminal, never in a chat): node scripts/gk/demo-code.mjs --show');
  return { account, digests, outputs };
}

await cli(import.meta.url, HELP, (options) => deploy(options));
