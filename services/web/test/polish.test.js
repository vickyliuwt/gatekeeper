// polish checks
// verdict words and log verbs and open file and focus and paused look
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

test('verdict summary never repeats the verdict title', () => {
  for (const v of ['PASS', 'FAIL', 'INCOMPLETE']) {
    const info = GK.verdictInfo(v);
    assert.ok(!info.summary.toLowerCase().includes(info.title.toLowerCase()), `${v} summary repeats its title`);
    assert.ok(info.summary.length > 20);
  }
  // the gate rule stays the same
  assert.match(GK.verdictInfo('FAIL').gate, /failure/);
  assert.match(GK.verdictInfo('INCOMPLETE').summary, /blocks/);
});

test('log text splits into a verb and the rest', () => {
  assert.deepEqual(GK.splitLogText('POST /scans → 202 · paste-1234'), { verb: 'POST', rest: '/scans → 202 · paste-1234' });
  assert.deepEqual(GK.splitLogText('GET /scans/{id} → DONE · FAIL'), { verb: 'GET', rest: '/scans/{id} → DONE · FAIL' });
  assert.deepEqual(GK.splitLogText('Stopped watching · the job keeps running on AWS'), { verb: null, rest: 'Stopped watching · the job keeps running on AWS' });
  assert.deepEqual(GK.splitLogText(undefined), { verb: null, rest: '' });
});

test('log lines put text in with textContent only, verb gets data-verb', () => {
  const add = app.slice(app.indexOf('function addLog('), app.indexOf('function scrollReportLog('));
  assert.match(add, /GK\.splitLogText\(text\)/);
  assert.match(add, /chip\.dataset\.verb = verb;/);
  assert.match(add, /body\.textContent = rest;/);
  assert.doesNotMatch(add, /innerHTML/);
  assert.match(css, /\.log-lines \.verb\[data-verb="POST"\]/);
});

test('local file names become names the API takes', () => {
  assert.equal(GK.safeFilename('app.js'), 'app.js');
  assert.equal(GK.safeFilename('my file.mjs'), 'my-file.mjs');
  assert.equal(GK.safeFilename('test-vulnerable (1).js'), 'test-vulnerable--1-.js');
  assert.equal(GK.safeFilename('.hidden.js'), 'hidden.js');
  assert.equal(GK.safeFilename('notes.txt'), null);
  assert.equal(GK.safeFilename(''), null);
  for (const name of ['a.js', 'my file.mjs', 'x (2).cjs']) assert.ok(GK.isFilename(GK.safeFilename(name)));
});

test('a picked file must be js, not empty, and 100 KB or less', () => {
  assert.equal(GK.fileProblem('app.js', 1200), null);
  assert.equal(GK.fileProblem('app.js', GK.MAX_CODE_BYTES), null);
  assert.match(GK.fileProblem('app.js', GK.MAX_CODE_BYTES + 1), /limit is 100 KB/);
  assert.match(GK.fileProblem('app.js', 0), /empty/);
  assert.match(GK.fileProblem('photo.png', 10), /\.js, \.mjs or \.cjs/);
});

test('open file reads locally: hidden file input, no upload words, sent only on scan', () => {
  assert.match(html, /<button type="button" class="bar-btn" id="open-file"[^>]*>[\s\S]*?Open \.js file<\/button>/);
  assert.match(html, /<input type="file" id="file-input" class="visually-hidden" accept="\.js,\.mjs,\.cjs" tabindex="-1" aria-hidden="true">/);
  assert.doesNotMatch(html, /\bupload\b/i);
  const open = app.slice(app.indexOf('async function openLocalFile('), app.indexOf('async function onSubmit('));
  assert.match(open, /GK\.fileProblem\(file\.name, file\.size\)/);
  assert.match(open, /await file\.text\(\)/);
  assert.match(open, /ui\.fileInput\.value = '';/);
  // reading a file never calls the network
  assert.doesNotMatch(open, /fetch\(|getJson\(/);
  assert.match(app, /ui\.openFile\.addEventListener\('click', \(\) => ui\.fileInput\.click\(\)\);/);
  assert.match(app, /ui\.fileInput\.addEventListener\('change', openLocalFile\);/);
});

test('when a scan ends, focus moves from Stop watching to View report', () => {
  const poll = app.slice(app.indexOf('async function poll('), app.indexOf('async function showResult('));
  assert.match(poll, /const stopHadFocus = doc\.activeElement === ui\.stopWatch;[\s\S]*render\(\);/);
  assert.match(poll, /await showResult\(status, current\);\s*if \(stopHadFocus && !ui\.viewReport\.hidden\) ui\.viewReport\.focus\(\);/);
});

test('a paused step has its own mark, not the not-started look', () => {
  assert.match(css, /\.step\[data-state="paused"\] \.step-dot \{[^}]*background: var\(--lavender-light\)/);
  assert.match(css, /\.step\[data-state="paused"\] \.step-dot::after \{[^}]*box-shadow: 5px 0 0 var\(--run\)/);
  assert.match(css, /\.node\[data-state="paused"\] \{/);
});

test('loopback check: every 127.x.x.x is local, look-alikes are not', () => {
  for (const h of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) assert.equal(GK.isLocalHost(h), true, h);
  for (const h of ['127.0.0.1.example.com', '1270.0.0.1', '128.0.0.1', 'abc.execute-api.us-east-1.amazonaws.com']) assert.equal(GK.isLocalHost(h), false, h);
});

test('time note is short and says where the number comes from', () => {
  assert.match(app, /'Server time from DynamoDB'/);
  assert.doesNotMatch(app, /createdAt → updatedAt in DynamoDB/);
});

test('long code scrolls inside the editor, the card does not grow', () => {
  assert.match(css, /\.gutter \{ contain: size;/);
  const open = app.slice(app.indexOf('async function openLocalFile('), app.indexOf('async function onSubmit('));
  assert.match(open, /ui\.code\.setSelectionRange\(0, 0\);/);
  assert.match(open, /ui\.code\.focus\(\{ preventScroll: true \}\);/);
});
