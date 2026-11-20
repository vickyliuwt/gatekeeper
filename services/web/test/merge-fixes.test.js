// more fixes for the last try words and the counts
// plus skipped files and the Copy link button
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/logic.js';

const { GK } = globalThis;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../public/app.js');
const html = read('../public/index.html');

test('the last failed try never says try 6 of 5', () => {
  for (const phase of ['FAILED', 'QUEUED']) {
    const line = GK.statusLine({ phase, attempt: 5, maxAttempts: 5 });
    assert.match(line, /Try 5 of 5 failed/);
    assert.match(line, /last try/);
    assert.doesNotMatch(line, /try 6/i);
    assert.doesNotMatch(line, /gives the job back/);
    const note = GK.stopNote(true, null, { phase, attempt: 5 });
    assert.match(note.text, /Try 5 of 5 failed/);
    assert.match(note.text, /INCOMPLETE/);
    assert.match(note.text, /Check again/);
    assert.doesNotMatch(note.text, /try 6/i);
    const view = { mode: 'tracking', phase, attempt: 5 };
    assert.match(GK.pipelineCaption(view), /last try/);
    assert.deepEqual(GK.phaseChip(view), { label: 'Last try', tone: 'hold' });
    assert.equal(GK.pipelineStates(view).worker, 'hold');
    assert.equal(GK.lifecycle(view).scanning, 'hold');
  }
});

test('an early failed try still says SQS gives it back', () => {
  assert.match(GK.statusLine({ phase: 'FAILED', attempt: 2, maxAttempts: 5 }), /gives the job back/);
  assert.match(GK.pipelineCaption({ mode: 'tracking', phase: 'FAILED', attempt: 2 }), /visibility timeout/);
  assert.equal(GK.phaseChip({ mode: 'tracking', phase: 'FAILED', attempt: 2 }).label, 'Retrying');
  assert.equal(GK.pipelineStates({ mode: 'tracking', phase: 'FAILED', attempt: 2 }).worker, 'retry');
  assert.equal(GK.isLastTry({ phase: 'RUNNING', attempt: 5 }), false);
  assert.match(GK.stopNote(true, null, { phase: 'QUEUED', attempt: 2 }).text, /try 3 of 5/);
  assert.match(GK.stopNote(true, null, { phase: 'RUNNING', attempt: 1 }).text, /^Still scanning after 2 minutes/);
});

test('counts rule for every verdict', () => {
  const counts = { high: 0, medium: 2, low: 1 };
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: true, counts }, false), 'partial');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: true }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: false, counts }, false), 'none');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', hasReport: true }, true), 'partial');
  assert.equal(GK.countsState({ verdict: 'PASS' }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'FAIL', hasReport: true }, false), 'unloaded');
  assert.equal(GK.countsState({ verdict: 'PASS', counts }, false), 'full');
  assert.equal(GK.countsState({ verdict: 'WEIRD' }, false), 'none');
  assert.equal(GK.countsState({}, false), 'none');
});

test('counts come from the job then the report then the findings', () => {
  const report = { counts: { high: 9, medium: 0, low: 0 }, findings: [{ severity: 'LOW' }] };
  assert.deepEqual(GK.pickCounts({ counts: { high: 1, medium: 2, low: 3 } }, report), { high: 1, medium: 2, low: 3 });
  assert.deepEqual(GK.pickCounts({}, report), { high: 9, medium: 0, low: 0 });
  assert.deepEqual(GK.pickCounts({}, { findings: [{ severity: 'HIGH' }, { severity: 'LOW' }] }), { high: 1, medium: 0, low: 1 });
  assert.deepEqual(GK.pickCounts({}, null), { high: 0, medium: 0, low: 0 });
});

test('skipped files work as names or as objects', () => {
  assert.equal(GK.skippedText('big.js'), 'big.js');
  assert.equal(GK.skippedText({ path: 'a/b.js', reason: 'too_large' }), 'a/b.js: too large');
  assert.equal(GK.skippedText({ path: 'c.js' }), 'c.js');
  assert.equal(GK.skippedText({ reason: 'timeout' }), 'a file: timeout');
  assert.equal(GK.skippedText(null), '');
  assert.equal(GK.skippedText(42), '');
});

test('the page uses the new helpers and Copy link goes back to its words', () => {
  assert.match(app, /GK\.pickCounts\(status, report\)/);
  assert.match(app, /GK\.skippedText\(file\)/);
  assert.match(app, /copyLinkTimer = win\.setTimeout\(\(\) => setButtonText\(ui\.copyLink, 'Copy link'\), 1600\)/);
  assert.match(app, /reportFailed: Boolean\(status\.hasReport\) && !report/);
  assert.doesNotMatch(app, /\$\{file\.path\}/);
});

test('a report that did not load shows Stopped on the AWS path', () => {
  const view = { mode: 'tracking', phase: 'DONE', verdict: 'FAIL', attempt: 1, reportReady: true, reportFailed: true };
  assert.equal(GK.pipelineStates(view).read, 'error');
  assert.equal(GK.pipelineStates(view).results, 'done');
  assert.match(GK.pipelineCaption(view), /could not load the report/);
  assert.equal(GK.pipelineStates({ ...view, reportFailed: false }).read, 'done');
  assert.match(GK.pipelineCaption({ ...view, verdict: 'INCOMPLETE' }), /INCOMPLETE/);
});

test('undo has its own icon and only shows when real code would be lost', () => {
  assert.match(html, /<symbol id="i-undo" viewBox="0 0 24 24">/);
  assert.match(html, /id="undo-code"/);
  assert.match(html, /<use href="#i-undo"\/>/);
  assert.equal(GK.undoNeeded('', 'x'), false);
  assert.equal(GK.undoNeeded('   \n', 'x'), false);
  assert.equal(GK.undoNeeded('const a = 1', 'const a = 1'), false);
  assert.equal(GK.undoNeeded('const a = 1', ''), true);
  assert.match(app, /keepForUndo\('', 'Clear'\)/);
  assert.match(app, /ui\.undoCode\.addEventListener\('click', undoReplace\)/);
});

test('a name with no letters opens as snippet and a wrong type is refused', () => {
  assert.equal(GK.safeFilename('@@@.js'), 'snippet.js');
  assert.equal(GK.fileProblem('@@@.js', 10), null);
  assert.match(GK.fileProblem('photo.png', 10), /\.js, \.mjs or \.cjs/);
  assert.equal(GK.safeFilename('C:\\Users\\me\\Main.JS'), 'Main.js');
  assert.equal(GK.safeFilename('src/app.mjs'), 'app.mjs');
});

test('queue hint shows after 20 s on try 0 only', () => {
  assert.equal(GK.queueHint({ phase: 'QUEUED', attempt: 0 }, 19999), '');
  assert.match(GK.queueHint({ phase: 'QUEUED', attempt: 0 }, 20000), /No worker has taken this job yet/);
  assert.equal(GK.queueHint({ phase: 'QUEUED', attempt: 1 }, 60000), '');
  assert.equal(GK.queueHint({ phase: 'RUNNING', attempt: 1 }, 60000), '');
  assert.equal(GK.queueHint(null, 60000), '');
  assert.match(app, /hint \|\| GK\.statusLine\(status\)/);
});

test('report words use hasReport from the job and the http code', () => {
  const saved = { verdict: 'INCOMPLETE', hasReport: true };
  assert.match(GK.reportMissingText(saved, 500), /could not be loaded/);
  assert.match(GK.reportMissingText(saved, 500), /Load report again/);
  assert.doesNotMatch(GK.reportMissingText(saved, 500), /No report was saved/);
  assert.match(GK.reportMissingText({ verdict: 'PASS', hasReport: true }, 404), /expired/);
  assert.match(GK.reportMissingText({ verdict: 'INCOMPLETE', hasReport: false }, null), /No report was saved/);
  assert.match(GK.finishLine({ verdict: 'PASS', hasReport: true }, true), /report is ready/);
  assert.match(GK.finishLine({ verdict: 'INCOMPLETE', hasReport: false }, false), /No report was saved/);
  assert.match(GK.finishLine({ verdict: 'INCOMPLETE', hasReport: true }, false), /could not be loaded/);
  assert.match(app, /GK\.finishLine\(status, Boolean\(report\), got\.code\)/);
});
