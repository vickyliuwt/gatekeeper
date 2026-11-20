// the routes table on the page must match Terraform
// if someone changes a rate limit in infra this test says the page is wrong
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../src/page.js';
import '../public/logic.js';

const INFRA = join(PUBLIC_DIR, '..', '..', '..', 'infra');
const WEB_OUT = join(INFRA, 'modules', 'web', 'outputs.tf');
const INTAKE = join(INFRA, 'webhook-route.tf');
const QUEUES = join(INFRA, 'modules', 'core', 'queues.tf');
const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
const hasInfra = existsSync(WEB_OUT) && existsSync(INTAKE) && existsSync(QUEUES);

// reads the limit text from the row with this data route
function pageLimit(route) {
  const row = html.match(new RegExp(`<tr[^>]*data-route="${route.replace(/[{}/]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</tr>`));
  assert.ok(row, `no row for ${route}`);
  const cell = row[1].match(/data-label="Limit">([^<]+)</);
  assert.ok(cell, `no Limit cell for ${route}`);
  return cell[1].trim();
}

test('the page lists exactly 6 routes: 5 for this page, 1 for GitHub', () => {
  assert.equal((html.match(/<tr[^>]*data-route="/g) || []).length, 6);
});

test('rate limits on the page match infra/ (Terraform)', { skip: !hasInfra && 'infra/ not here' }, () => {
  const web = readFileSync(WEB_OUT, 'utf8');
  const submit = web.match(/route\.submit\.route_key,\s*rate_limit\s*=\s*(\d+),\s*burst_limit\s*=\s*(\d+)/);
  assert.ok(submit, 'submit limit not found in outputs.tf');
  const rate = web.match(/rate_limit\s*=\s*name == "status" \? (\d+) : (\d+)/);
  // burst can be one number for every results route or status and the rest
  const both = web.match(/burst_limit\s*=\s*name == "status" \? (\d+) : (\d+)/);
  const one = web.match(/burst_limit\s*=\s*(\d+)\s*\n\s*\}\]/);
  const burst = both || (one && [one[0], one[1], one[1]]);
  assert.ok(rate && burst, 'results limits not found in outputs.tf');
  const intake = readFileSync(INTAKE, 'utf8');
  const hookRate = intake.match(/rate_limit\s*=\s*(\d+)/);
  const hookBurst = intake.match(/burst_limit\s*=\s*(\d+)/);
  assert.ok(hookRate && hookBurst, 'webhook limits not found');

  assert.equal(pageLimit('POST /scans'), `${submit[1]}/s, burst ${submit[2]}`);
  assert.equal(pageLimit('GET /scans/{jobId}'), `${rate[1]}/s, burst ${burst[1]}`);
  for (const route of ['GET /scans/{jobId}/report', 'GET /scans', 'GET /']) {
    assert.equal(pageLimit(route), `${rate[2]}/s, burst ${burst[2]}`, route);
  }
  assert.equal(pageLimit('POST /webhooks/github'), `${hookRate[1]}/s, burst ${hookBurst[1]}`);
});

test('retry words match the queue: 360 s timeout, 5 tries', { skip: !hasInfra && 'infra/ not here' }, () => {
  const queues = readFileSync(QUEUES, 'utf8');
  const timeout = queues.match(/visibility_timeout_seconds\s*=\s*(\d+)/);
  const tries = queues.match(/maxReceiveCount\s*=\s*(\d+)/);
  assert.ok(timeout && tries);
  assert.match(html, new RegExp(`${timeout[1]} s visibility timeout`));
  assert.equal(Number(tries[1]), globalThis.GK.MAX_ATTEMPTS);
});
