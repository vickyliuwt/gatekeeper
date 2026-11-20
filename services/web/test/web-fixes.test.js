// fixes for the scan page
// honest report words and queue words
// file names and undo and focus
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/logic.js';

const { GK } = globalThis;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../public/app.js');
const html = read('../public/index.html');
const css = read('../public/style.css');

test('upper case .JS opens and becomes .js', () => {
  assert.equal(GK.safeFilename('Main.JS'), 'Main.js');
  assert.equal(GK.safeFilename('APP.MJS'), 'APP.mjs');
  assert.equal(GK.safeFilename('Tool.Cjs'), 'Tool.cjs');
  assert.equal(GK.fileProblem('Main.JS', 120), null);
});

test('a very long name gets cut to 100 and keeps its ext', () => {
  const name = `${'a'.repeat(150)}.js`;
  const safe = GK.safeFilename(name);
  assert.equal(safe.length, 100);
  assert.ok(safe.endsWith('.js'));
  assert.ok(GK.isFilename(safe));
  assert.equal(GK.fileProblem(name, 50), null);
});

test('a name with no letters becomes snippet and a wrong type is refused', () => {
  assert.equal(GK.safeFilename('@@@.js'), 'snippet.js');
  assert.equal(GK.safeFilename('---.MJS'), 'snippet.mjs');
  assert.equal(GK.fileProblem('@@@.js', 10), null);
  assert.match(GK.fileProblem('photo.png', 10), /\.js, \.mjs or \.cjs/);
  assert.equal(GK.safeFilename('notes.txt'), null);
  // spaces become a dash like before
  assert.equal(GK.safeFilename('my file.js'), 'my-file.js');
});

test('after 20 s in the queue on try 0 the page says no worker took it', () => {
  assert.equal(GK.queueHint({ phase: 'QUEUED', attempt: 0 }, 19999), '');
  assert.match(GK.queueHint({ phase: 'QUEUED', attempt: 0 }, 20000), /No worker has taken this job yet/);
  assert.match(GK.queueHint({ phase: 'QUEUED', attempt: 0 }, 60000), /SQS queue/);
  // a retry wait and a running job are not the same story
  assert.equal(GK.queueHint({ phase: 'QUEUED', attempt: 1 }, 60000), '');
  assert.equal(GK.queueHint({ phase: 'RUNNING', attempt: 1 }, 60000), '');
  assert.equal(GK.queueHint(null, 60000), '');
  assert.match(app, /const hint = GK\.queueHint\(status, elapsed\);/);
  assert.match(app, /if \(hint && !current\.hintSaid\)/);
});

test('2 minute stop says queue when no worker took the job', () => {
  const queued = GK.stopNote(true, null, { phase: 'QUEUED', attempt: 0 });
  assert.match(queued.text, /SQS queue/);
  assert.match(queued.text, /No worker has taken the job yet/);
  assert.match(queued.text, /nothing was scanned/);
  assert.doesNotMatch(queued.text, /scanning/i);
  assert.match(queued.say, /SQS queue/);
  const retry = GK.stopNote(true, null, { phase: 'FAILED', attempt: 1 });
  assert.match(retry.text, /try 2 of 5/);
  assert.match(retry.text, /visibility timeout/);
  assert.doesNotMatch(retry.text, /Still scanning/);
  const back = GK.stopNote(true, null, { phase: 'QUEUED', attempt: 2 });
  assert.match(back.text, /try 3 of 5/);
  assert.match(GK.stopNote(true, null, { phase: 'RUNNING', attempt: 1 }).text, /^Still scanning after 2 minutes/);
  for (const n of [queued, retry, back]) assert.match(n.text, /Check again/);
  assert.match(app, /GK\.stopNote\(Boolean\(current\.lastKey\), current\.lastCode, current\.lastStatus\)/);
});

test('scanned but not loaded is not the same as not checked', () => {
  assert.equal(GK.countsState({ verdict: 'PASS' }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'FAIL', hasReport: true }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: true }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: false }, false), 'none');
  assert.equal(GK.countsState({ verdict: 'PASS', counts: { high: 0, medium: 1, low: 0 } }, false), 'full');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: true }, true), 'partial');
  assert.match(app, /countState === 'unloaded' \? 'not loaded' : 'not checked'/);
  assert.match(css, /\.sev-list\[data-state="unloaded"\] dd/);
  assert.match(css, /\.sev-list\[data-state="unloaded"\] \.sev-dot/);
});

test('report words use hasReport from the job and the http code', () => {
  const saved = { verdict: 'INCOMPLETE', hasReport: true };
  assert.match(GK.reportMissingText(saved, 500), /could not be loaded/);
  assert.match(GK.reportMissingText(saved, 500), /Load report again/);
  assert.match(GK.reportMissingText(saved, 0), /could not be loaded/);
  assert.doesNotMatch(GK.reportMissingText(saved, 500), /No report was saved/);
  assert.match(GK.reportMissingText({ verdict: 'PASS', hasReport: true }, 404), /expired/);
  assert.match(GK.reportMissingText({ verdict: 'INCOMPLETE', hasReport: false }, null), /No report was saved/);
  assert.match(GK.finishLine({ verdict: 'PASS', hasReport: true }, true), /report is ready/);
  assert.match(GK.finishLine({ verdict: 'INCOMPLETE', hasReport: false }, false), /No report was saved/);
  assert.match(GK.finishLine({ verdict: 'INCOMPLETE', hasReport: true }, false, 500), /could not be loaded/);
  assert.match(GK.finishLine({ verdict: 'FAIL', hasReport: true }, false, 404), /expired/);
  assert.match(app, /GK\.reportMissingText\(/);
  assert.match(app, /GK\.finishLine\(status, Boolean\(report\), got\.code\)/);
});

test('the AWS path shows a red read when the report did not load', () => {
  const failed = GK.pipelineStates({ mode: 'tracking', phase: 'DONE', verdict: 'FAIL', reportReady: true, reportFailed: true });
  assert.equal(failed.read, 'error');
  assert.equal(failed.store, 'done');
  const fine = GK.pipelineStates({ mode: 'tracking', phase: 'DONE', verdict: 'FAIL', reportReady: true });
  assert.equal(fine.read, 'done');
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'DONE', verdict: 'FAIL', reportReady: true, reportFailed: true }), /could not load the report/);
  assert.match(app, /reportFailed: Boolean\(status\.hasReport\) && !report/);
  assert.match(app, /reportFailed: false/);
});

test('a failed report GET can be loaded again', () => {
  assert.match(html, /<button type="button" class="btn btn-quiet btn-sm reload-report" id="reload-report" hidden>/);
  assert.match(app, /ui\.reloadReport\.addEventListener\('click'/);
  assert.match(app, /ui\.reloadReport\.hidden = !\(status\.hasReport && !report && got\.code !== 404\)/);
});

test('undo only shows when real code would be lost', () => {
  assert.equal(GK.undoNeeded('const a = 1;', ''), true);
  assert.equal(GK.undoNeeded('const a = 1;', 'const b = 2;'), true);
  assert.equal(GK.undoNeeded('   \n  ', ''), false);
  assert.equal(GK.undoNeeded('', 'x'), false);
  assert.equal(GK.undoNeeded('same', 'same'), false);
});

test('Clear, Open .js file and the examples can be undone', () => {
  assert.match(html, /<button type="button" class="bar-btn" id="undo-code" hidden aria-label="Undo"/);
  assert.match(html, /<symbol id="i-undo" viewBox="0 0 24 24">/);
  assert.match(html, /<use href="#i-undo"\/><\/svg>Undo<\/button>/);
  assert.match(app, /keepForUndo\('', 'Clear'\)/);
  assert.match(app, /keepForUndo\(text, 'Open \.js file'\)/);
  assert.match(app, /keepForUndo\(next, 'the example'\)/);
  assert.match(app, /ui\.undoCode\.addEventListener\('click', undoReplace\)/);
  // typing or a new scan makes the old copy stale
  assert.match(app, /hideAccess\(\);\s*\/\/[^\n]*\n\s*dropUndo\(\);/);
  // the undo button never keeps focus when it goes away
  assert.match(app, /if \(doc\.activeElement === ui\.undoCode\) ui\.code\.focus\(\{ preventScroll: true \}\);/);
});

test('focus never falls to the page body', () => {
  // the Run button stays focusable while sending
  assert.doesNotMatch(app, /ui\.scan\.disabled = true/);
  assert.match(app, /setSending\(true\)/);
  assert.match(css, /\.btn-primary\[aria-disabled="true"\]/);
  // a 404 hides Stop watching so focus goes to the message
  assert.match(app, /if \(hadFocus\) ui\.problemText\.focus\(\)/);
  assert.match(html, /<p id="problem-text" tabindex="-1"><\/p>/);
  assert.match(html, /<h3 id="findings-title" tabindex="-1">Findings<\/h3>/);
});

test('an old report answer can not draw over a new scan', () => {
  assert.match(app, /const myRun = runId;/);
  assert.match(app, /if \(myRun !== runId\) return;/);
  // its log line can not land in the new scan log either
  assert.match(app, /async function fetchReport\(status, run\)/);
  assert.match(app, /if \(run !== runId\) return \{ report: null, code: null \};/);
  assert.match(app, /await fetchReport\(status, myRun\)/);
});
