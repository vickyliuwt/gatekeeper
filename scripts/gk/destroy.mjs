#!/usr/bin/env node
// GateKeeper destroy tool. Deletes everything Terraform made in YOUR account and keeps the state bucket and
// the SSM parameters on purpose (the next deploy reuses them). Then lists any GateKeeper resource still there.
import { rmSync } from 'node:fs';
import { TFVARS_JSON, aws, cli, getAccount, info, step, terraform, terraformInit } from './lib/run.mjs';

export const HELP = 'Usage: node scripts/gk/destroy.mjs [--yes]   (--yes skips Terraform\'s "yes" question)';

// Everything GateKeeper creates is named gk-* or gatekeeper/*. After a destroy, only the state bucket
// gk-tfstate-ACCOUNT and the SSM parameters /gatekeeper/* should remain (both kept on purpose).
export const LEFTOVER_CHECKS = Object.freeze([
  ['Lambda functions', ['lambda', 'list-functions', '--query', "Functions[?starts_with(FunctionName, 'gk-')].FunctionName", '--output', 'json']],
  ['ECR repositories', ['ecr', 'describe-repositories', '--query', "repositories[?starts_with(repositoryName, 'gatekeeper/')].repositoryName", '--output', 'json']],
  ['DynamoDB tables', ['dynamodb', 'list-tables', '--query', "TableNames[?starts_with(@, 'gk-')]", '--output', 'json']],
  ['SQS queues', ['sqs', 'list-queues', '--queue-name-prefix', 'gk-', '--query', 'QueueUrls', '--output', 'json']],
  ['HTTP APIs', ['apigatewayv2', 'get-apis', '--query', "Items[?Name=='gk-api'].ApiId", '--output', 'json']],
  ['S3 data buckets', ['s3api', 'list-buckets', '--query', "Buckets[?starts_with(Name, 'gk-data-')].Name", '--output', 'json']],
  ['CloudWatch alarms', ['cloudwatch', 'describe-alarms', '--alarm-name-prefix', 'gk-', '--query', 'MetricAlarms[].AlarmName', '--output', 'json']],
  ['Dashboards', ['cloudwatch', 'list-dashboards', '--dashboard-name-prefix', 'gk-', '--query', 'DashboardEntries[].DashboardName', '--output', 'json']],
]);

export function gatekeeperLeftovers(awsCli = aws) {
  return LEFTOVER_CHECKS.map(([label, args]) => {
    const r = awsCli(args, { allowFail: true });
    let names = [];
    if (r.ok) {
      try {
        names = JSON.parse(r.stdout || '[]') ?? [];
      } catch {
        names = [];
      }
    }
    return { label, ok: r.ok, names: Array.isArray(names) ? names : [] };
  });
}

export function printLeftovers(rows, print = info) {
  let left = 0;
  for (const row of rows) {
    if (!row.ok) {
      print(`?     ${row.label}: could not check`);
      continue;
    }
    left += row.names.length;
    print(`${row.names.length === 0 ? 'OK   ' : 'LEFT '} ${row.label}${row.names.length > 0 ? `: ${row.names.join(', ')}` : ''}`);
  }
  print(left === 0
    ? 'Nothing from GateKeeper is left, except the state bucket and the SSM parameters (kept on purpose).'
    : `${left} GateKeeper resource(s) left. Run destroy again; if they stay, delete them in the AWS console.`);
  return left;
}

export async function destroy(options = {}, deps = {}) {
  const {
    awsCli = aws, tf = terraform, print = info, title = step,
    removeVars = () => rmSync(TFVARS_JSON, { force: true }), leftovers = gatekeeperLeftovers,
  } = deps;
  title('1/4 AWS keys');
  const account = getAccount(awsCli);
  title('2/4 terraform init');
  terraformInit(account, { tf });
  title('3/4 terraform destroy (keeps the state bucket and the SSM parameters)');
  tf(['-chdir=infra', 'destroy', '-input=false', ...(options.yes ? ['-auto-approve'] : [])], { inherit: true });
  removeVars();
  title('4/4 GateKeeper resources still in this account');
  const left = printLeftovers(leftovers(awsCli), print);
  print('Last step: Canvas > Learner Lab > End Lab.');
  return left;
}

await cli(import.meta.url, HELP, (options) => destroy(options));
