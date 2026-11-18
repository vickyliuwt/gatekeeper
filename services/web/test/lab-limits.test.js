// the lab safety parts in Terraform stay in place
// Learner Lab switches an account off when too many Lambdas run at once
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const main = read('../../../infra/modules/web/main.tf');
const vars = read('../../../infra/modules/web/variables.tf');
const dash = read('../../../infra/modules/web/dashboard.tf');
const root = read('../../../infra/web.tf');

test('the cap is off by default so a normal deploy never breaks', () => {
  assert.match(vars, /variable "cap_lambdas" \{[\s\S]*?default\s*=\s*false/);
  assert.match(root, /variable "cap_web_lambdas" \{[\s\S]*?default\s*=\s*false/);
  assert.match(root, /cap_lambdas\s*=\s*var\.cap_web_lambdas/);
});

test('with the cap on gk-submit gets 1 and gk-results gets 2', () => {
  assert.match(main, /resource "aws_lambda_function" "submit"[\s\S]*?reserved_concurrent_executions = var\.cap_lambdas \? 1 : -1/);
  assert.match(main, /resource "aws_lambda_function" "results"[\s\S]*?reserved_concurrent_executions = var\.cap_lambdas \? 2 : -1/);
});

test('an alarm warns at 5 Lambdas at once for the whole account', () => {
  const alarm = main.slice(main.indexOf('"lambda_concurrency"'));
  assert.match(alarm, /alarm_name\s*=\s*"gk-lambda-concurrency"/);
  assert.match(alarm, /metric_name\s*=\s*"ConcurrentExecutions"/);
  assert.match(alarm, /threshold\s*=\s*5\b/);
  assert.match(alarm, /statistic\s*=\s*"Maximum"/);
  assert.doesNotMatch(alarm.split('\n}')[0], /dimensions/);
});

test('the dashboard shows the whole account line and no flood words', () => {
  assert.match(dash, /"AWS\/Lambda", "ConcurrentExecutions"/);
  assert.match(dash, /value = 10/);
  assert.doesNotMatch(dash, /flood/i);
});
