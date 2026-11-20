// the Refresh button on Recent PR Checks
// one list call at a time and a 3 s gap between clicks
// so fast clicks never start many lambdas at once in Learner Lab
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/logic.js';

const { GK } = globalThis;
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const part = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const load = part('async function loadRecent()', 'function onRefresh()');
const refresh = part('function onRefresh()', 'function openFromList(');

test('the list gap is 3 s and a page that never asked waits 0', () => {
  assert.equal(GK.LIST_GAP_MS, 3000);
  assert.equal(GK.listWaitMs(0, 5000), 0);
  assert.equal(GK.listWaitMs(10000, 11000), 2000);
  assert.equal(GK.listWaitMs(10000, 13000), 0);
  // a clock that went back never waits longer than the gap
  assert.equal(GK.listWaitMs(10000, 1000), 3000);
});

test('a list call that is already running stops a second one', () => {
  assert.match(app, /let listing = false;/);
  assert.match(load, /if \(listing\) \{\n\s*listAgain = true;\n\s*return;\n\s*\}\n\s*listing = true;/);
  assert.match(load, /ui\.refreshRecent\.setAttribute\('aria-disabled', 'true'\);/);
  assert.match(load, /finally \{\n\s*listing = false;\n\s*wakeRefresh\(\);/);
});

test('a scan that ends while the list loads gets one more list call and no more', () => {
  assert.match(load, /if \(listAgain\) \{\n\s*listAgain = false;\n\s*loadRecent\(\);\n\s*\}/);
});

test('Refresh checks the running call and the 3 s gap first', () => {
  assert.match(refresh, /if \(listing\) \{/);
  assert.match(refresh, /GK\.listWaitMs\(lastListAt, Date\.now\(\)\)/);
  assert.match(refresh, /One list request at a time/);
});

test('the button calls the guard and never the list call itself', () => {
  assert.match(app, /ui\.refreshRecent\.addEventListener\('click', onRefresh\);/);
  assert.doesNotMatch(app, /ui\.refreshRecent\.addEventListener\('click', loadRecent\)/);
});

test('the button wakes up only after the gap and only when no call runs', () => {
  const wake = part('function wakeRefresh()', 'async function loadRecent()');
  assert.match(wake, /listTimer = win\.setTimeout\(wakeRefresh, wait\);/);
  assert.match(wake, /if \(!listing\) ui\.refreshRecent\.setAttribute\('aria-disabled', 'false'\);/);
});
