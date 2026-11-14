// page layout + scope guards for the console
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../src/page.js';
import '../public/logic.js';

const { GK } = globalThis;
const read = (name) => readFileSync(join(PUBLIC_DIR, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('style.css');
const logic = read('logic.js');

test('AWS path boxes and activity steps match logic.js, in order', () => {
  assert.deepEqual([...html.matchAll(/data-node="([a-z]+)"/g)].map((m) => m[1]), [...GK.PIPELINE]);
  assert.deepEqual([...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]), [...GK.STEPS]);
  assert.deepEqual([...html.matchAll(/data-step-time="([a-z]+)"/g)].map((m) => m[1]), [...GK.STEPS]);
});

test('the AWS path card shows a write path and a separate read path', () => {
  assert.deepEqual([...html.matchAll(/data-path="([a-z]+)"/g)].map((m) => m[1]), ['write', 'read']);
  const write = html.slice(html.indexOf('data-path="write"'), html.indexOf('data-path="read"'));
  const readPart = html.slice(html.indexOf('data-path="read"'), html.indexOf('class="foot"'));
  for (const n of GK.WRITE_PATH) assert.match(write, new RegExp(`data-node="${n}"`));
  for (const n of GK.READ_PATH) assert.match(readPart, new RegExp(`data-node="${n}"`));
  assert.match(write, /POST \/scans/);
  assert.match(readPart, /GET \/scans\/\{id\}/);
  assert.match(readPart, /id="read-polls"/);
});

test('every sidebar link points to a real section', () => {
  const targets = [...html.matchAll(/data-nav="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['overview', 'scan', 'pipeline', 'report', 'checks', 'architecture']);
  for (const id of targets) {
    assert.match(html, new RegExp(`href="#${id}" data-nav="${id}"`));
    assert.match(html, new RegExp(`<(section|div)[^>]*id="${id}"`), `no section #${id}`);
  }
});

test('every id app.js looks up exists in index.html', () => {
  const ids = [...app.matchAll(/byId\('([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 60);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
});

test('every icon app.js or index.html uses has a symbol in the sprite', () => {
  const symbols = new Set([...html.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]));
  const used = [...app.matchAll(/icon\('([a-z-]+)'\)/g), ...html.matchAll(/href="#i-([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const name of used) assert.ok(symbols.has(name), `missing symbol i-${name}`);
});

test('scope guard: no upload, sign-in, fake totals, uptime or progress percent on the page', () => {
  const text = html.replace(/<symbol[\s\S]*?<\/symbol>/g, '').replace(/<svg class="art"[\s\S]*?<\/svg>/, '');
  assert.doesNotMatch(text, /\bupload\b|\.zip\b|sign in|log in|connect github|uptime|success rate|total scans|healthy|operational/i);
  assert.doesNotMatch(text, /\d+\s?%/);
  assert.doesNotMatch(app, /Math\.random/);
});

test('Learner Lab words stay honest: shared LabRole, read only by code', () => {
  assert.match(html, /LabRole/);
  assert.match(html, /CloudFront is blocked/);
  assert.doesNotMatch(html, /cannot write/i);
  assert.match(html, /CS6620 Cloud Computing/);
});

test('safety guard: no outside resources, no HTML writes, same-origin calls only', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(css, /url\(|@import/);
  assert.doesNotMatch(html, /\sstyle="|\son[a-z]+="/i);
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  // fetch: our own path only. getJson gets its path from the callers
  for (const call of app.matchAll(/fetch\(\s*([^,)]+)/g)) assert.match(call[1], /^(?:[`'"]\/|path$)/, `fetch must use our own path: ${call[1]}`);
  for (const call of app.matchAll(/getJson\(\s*([^,)]+)/g)) if (call[1] !== 'path') assert.match(call[1], /^[`'"]\//, `getJson must use our own path: ${call[1]}`);
});

test('every filter and the 3 severity rows exist', () => {
  assert.deepEqual([...html.matchAll(/data-filter="([A-Za-z]+)"/g)].map((m) => m[1]), ['all', 'HIGH', 'MEDIUM', 'LOW']);
  assert.deepEqual([...html.matchAll(/data-sev="([a-z]+)"/g)].map((m) => m[1]), ['high', 'medium', 'low']);
});

test('reduced motion is respected and the page has one h1', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('the access code box is a password field with a show button, and it is never saved', () => {
  assert.match(html, /<input id="access"[^>]*type="password"/);
  assert.match(html, /id="toggle-access"[^>]*aria-pressed="false"/);
  assert.match(app, /function hideAccess\(\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*access/i);
  assert.doesNotMatch(app, /searchParams\.set\([^)]*access/i);
});

test('hero tags sit in the button row, so the first screen stays short', () => {
  const cta = html.slice(html.indexOf('class="hero-cta"'), html.indexOf('class="hero-art"'));
  assert.match(cta, /class="tags"/);
});

test('the page uses product names, not team part letters', () => {
  assert.doesNotMatch(html, /Part [ABC]\b/);
  assert.match(html, /Webhook intake \+ Scan worker/);
  assert.equal((html.match(/Paste and Scan · this page/g) || []).length, 2);
});

test('examples use demo-risk.js and demo-clean.js', () => {
  assert.match(app, /loadSample\('sample-risky', 'demo-risk\.js'\)/);
  assert.match(app, /loadSample\('sample-clean', 'demo-clean\.js'\)/);
  assert.match(html, /\/\/ demo-risk\.js: /);
  assert.match(html, /\/\/ demo-clean\.js: /);
  assert.doesNotMatch(html + app, /cart\.js|'demo\.js'/);
});

test('stop watching is honest and check again keeps the log', () => {
  assert.match(html, /<button type="button" class="btn btn-quiet btn-sm" id="stop-watch" hidden>[\s\S]*?Stop watching<\/button>/);
  assert.match(app, /stopWatch: byId\('stop-watch'\)/);
  assert.match(app, /Stopped watching · the job keeps running on AWS/);
  assert.match(app, /startTracking\(lastJobId, \{ fromLink: true, keepLog: true, traceId \}\)/);
  assert.doesNotMatch(html + app, /Cancel|Stop scan/);
  assert.match(css, /\[data-state="paused"\]/);
});

test('the report has a scan log seen by this browser', () => {
  assert.match(html, /<details class="scan-log" id="scan-log">/);
  assert.match(html, /Seen by this browser/);
  assert.match(html, /id="scan-facts"/);
  assert.match(html, /<ol class="log-lines" id="report-log">/);
  const at = html.indexOf('id="scan-log"');
  assert.ok(html.indexOf('id="report-body"') < at);
  assert.ok(at < html.indexOf('class="share"'));
});

test('review fixes: honest, accessible, no double scan', () => {
  assert.match(app, /event\.preventDefault\(\);\s*if \(ui\.scan\.disabled\) return undefined;/);
  assert.match(app, /Scan finished: \$\{info\.label\}, not scanned\./);
  assert.match(app, /openedDone: fromLink/);
  assert.equal((html.match(/<span class="node-tile" aria-hidden="true"/g) || []).length, 8);
  assert.equal((html.match(/<span class="node-tile"/g) || []).length, 8);
  assert.match(html, /<kbd[^>]*aria-hidden="true"/);
  assert.match(app, /GET \/scans\/\{id\} → no answer/);
  assert.match(app, /No answer from GateKeeper for 2 minutes/);
  assert.doesNotMatch(app, /The scan queue is busy/);
  assert.doesNotMatch(css + html + app + logic, /\bv8\d\b/);
  assert.doesNotMatch(html, /<p class="sev-note">/);
  assert.match(html, /<dd class="sev-note">blocks the merge<\/dd>/);
  assert.doesNotMatch(css, /#A09290|#B2A4A0/i);
  assert.match(app, /ui\.scanLog\.addEventListener\('toggle'/);
  assert.match(css, /\.sev-row\[data-sev="high"\]\.has dd\[id\]/);
  assert.doesNotMatch(css, /\.has dd \{/);
});

test('the folded scan log has an arrow like the finding cards', () => {
  const start = html.indexOf('<summary class="scan-log-head">');
  const head = html.slice(start, html.indexOf('</summary>', start));
  assert.match(head, /<svg class="ico chev" aria-hidden="true"><use href="#i-chevron"\/><\/svg>/);
  // text reads "Scan log Seen by this browser", not glued together
  assert.match(head, /Scan log<\/span> <span class="scan-log-note">/);
  assert.match(css, /\.scan-log\[open\][^{]*\.chev[^{]*\{[^}]*rotate\(180deg\)/);
});

test('stop watching and check again keep focus and say what happened', () => {
  const pause = app.slice(app.indexOf('function pauseWatching('), app.indexOf('function startTracking('));
  // Stop watching goes away in render(), so check focus before it runs
  assert.match(pause, /const hadFocus = doc\.activeElement === ui\.stopWatch;[\s\S]*render\(\);/);
  assert.match(pause, /ui\.checkAgain\.hidden = false;[\s\S]*if \(byUser \|\| hadFocus\) ui\.checkAgain\.focus\(\);/);
  // log line and the spoken line only when the user pressed the button
  assert.match(pause, /if \(byUser\) \{[^}]*addLog\('Stopped watching[^}]*announce\('Stopped watching\. The job may still run on AWS\.'\);[^}]*\}/);
  const again = app.slice(app.indexOf("ui.checkAgain.addEventListener('click'"), app.indexOf("ui.stopWatch.addEventListener('click'"));
  assert.match(again, /startTracking\([^;]*\);\s*[\s\S]*if \(!ui\.stopWatch\.hidden\) ui\.stopWatch\.focus\(\);/);
  assert.match(again, /startTracking\([^;]*\);[\s\S]*announce\('Watching this scan again\.'\);/);
  // GET /scans/{id} has no trace id, so check again keeps the one shown
  assert.match(again, /ui\.traceId\.textContent/);
});

test('step times only for a scan this page sent, never after a reopen', () => {
  // after Check again or a link, the start time is unknown: show no +time
  assert.match(app, /tracking\.seen\[name\] = tracking\.openedDone \|\| tracking\.fromLink \? null : elapsed;/);
});

test('one busy list for the paused look, used by the path and the steps', () => {
  assert.match(logic, /const BUSY = new Set\(\['active', 'live', 'retry'\]\);/);
  assert.equal((logic.match(/BUSY\.has\(s\[name\]\)/g) || []).length, 2);
  assert.doesNotMatch(logic, /\['active', 'live', 'retry'\]\.includes/);
});

test('check again keeps the log, and the 2 minute stop is not a user stop', () => {
  assert.match(app, /if \(!keepLog\) resetLog\(\);/);
  const twoMin = app.slice(app.indexOf('if (!GK.shouldKeepPolling('), app.indexOf('current.timer = win.setTimeout'));
  assert.match(twoMin, /pauseWatching\(false\);/);
  assert.doesNotMatch(twoMin, /pauseWatching\(true\)/);
});

test('local test buttons are hidden and load the marker code', () => {
  assert.match(html, /<div class="segmented local-tests" id="local-tests" role="group" aria-label="Local tests" hidden>/);
  assert.match(html, /<span class="local-label" aria-hidden="true">Local tests<\/span>/);
  assert.match(html, /<button type="button" id="load-retry">Retry<\/button>/);
  assert.match(html, /<button type="button" id="load-incomplete">Incomplete<\/button>/);
  assert.match(html, /<button type="button" id="load-slow">Slow 2 min<\/button>/);
  assert.match(html, /<template id="sample-retry">\/\/ demo-retry\.js: [^\n]*\n\/\/ SIMULATE_RETRY\n/);
  assert.match(html, /<template id="sample-incomplete">\/\/ demo-incomplete\.js: [^\n]*\n\/\/ SIMULATE_INCOMPLETE\n/);
  assert.match(html, /<template id="sample-slow">\/\/ demo-slow\.js: [^\n]*\n\/\/ SIMULATE_SLOW\n/);
  // .segmented sets display: inline-flex, so hidden needs this rule to win
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(app, /localTests\.hidden = !GK\.isLocalHost\(win\.location\.hostname\)/);
  // only one line may show or hide the row, so it can never show on AWS
  assert.equal((app.match(/localTests\.hidden/g) || []).length, 1);
  assert.match(app, /loadSample\('sample-retry', 'demo-retry\.js'\)/);
  assert.match(app, /loadSample\('sample-incomplete', 'demo-incomplete\.js'\)/);
  assert.match(app, /loadSample\('sample-slow', 'demo-slow\.js'\)/);
});
