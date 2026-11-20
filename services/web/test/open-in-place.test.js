// Open in Recent PR Checks shows the scan on the same page
// no full reload so it costs one status call and one report call
// and a paste scan never asks for the PR list again
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/logic.js';

const { GK } = globalThis;
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const part = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const sha = 'a'.repeat(40);

test('only a plain left click opens in place', () => {
  assert.equal(GK.isPlainClick({ button: 0 }), true);
  assert.equal(GK.isPlainClick({}), true);
  assert.equal(GK.isPlainClick({ button: 1 }), false);
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) {
    assert.equal(GK.isPlainClick({ button: 0, [key]: true }), false, key);
  }
  assert.equal(GK.isPlainClick(null), true);
});

test('the job id comes only from a real job link', () => {
  assert.equal(GK.jobFromSearch(`?job=pr-7812-${sha}`), `pr-7812-${sha}`);
  assert.equal(GK.jobFromSearch('?job=pr-1-xyz'), null);
  assert.equal(GK.jobFromSearch('?other=1'), null);
  assert.equal(GK.jobFromSearch(''), null);
  assert.equal(GK.jobFromSearch(undefined), null);
});

test('Open in the list uses pushState and the same tracking as a link', () => {
  const open = part('function openFromList(', 'function reduceMotion()');
  assert.match(open, /GK\.isPlainClick\(event\)/);
  assert.match(open, /GK\.jobFromSearch\(link\.search\)/);
  // a bad link keeps its normal job and only a real one is caught
  assert.ok(open.indexOf('if (!jobId) return;') < open.indexOf('event.preventDefault();'));
  assert.match(open, /win\.history\.pushState\(\{ job: jobId \}, '', url\);/);
  assert.match(open, /startTracking\(jobId, \{ fromLink: true, fromList: true \}\);/);
  assert.doesNotMatch(open, /location\.(assign|href\s*=|reload)/);
  assert.match(app, /ui\.recentBody\.addEventListener\('click', openFromList\);/);
});

test('the same scan open again only scrolls and asks AWS nothing', () => {
  const open = part('function openFromList(', 'function reduceMotion()');
  assert.match(open, /const alreadyHere = jobId === lastJobId && \(tracking \|\| view\.phase === 'DONE'\);/);
  assert.match(open, /if \(!alreadyHere\) \{/);
});

test('Back and Forward follow the address', () => {
  const back = part('function onHistory()', '// page frame with the env pill');
  assert.match(app, /win\.addEventListener\('popstate', onHistory\);/);
  assert.match(back, /GK\.jobFromSearch\(win\.location\.search\)/);
  assert.match(back, /showIdle\(\);/);
  const idle = part('function showIdle()', 'function onHistory()');
  for (const step of ['stopTracking();', 'runId += 1;', 'hideReport();', 'showActivity(ui.empty);', "view = { mode: 'idle' };"]) {
    assert.ok(idle.includes(step), step);
  }
});

test('the list is asked again only for a PR job that moved while we watched', () => {
  assert.match(app, /if \(status\.source === 'pr' && current\.sawNotDone\) loadRecent\(\);/);
  assert.match(app, /if \(status\.phase !== 'DONE'\) current\.sawNotDone = true;/);
  assert.doesNotMatch(part('async function showResult(', 'function renderTime('), /\n\s*loadRecent\(\);\n/);
});

test('the Open link still has a real address for a new tab', () => {
  assert.match(app, /link\.href = `\?job=\$\{jobId\}`;/);
});
