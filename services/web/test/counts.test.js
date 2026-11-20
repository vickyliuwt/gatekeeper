// honest counts and calm done marks and phone editor bar
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../src/page.js';
import '../public/logic.js';

const { GK } = globalThis;
const read = (name) => readFileSync(join(PUBLIC_DIR, name), 'utf8');
const html = read('index.html');
const css = read('style.css');
const app = read('app.js');

test('INCOMPLETE with no report counts as nothing checked', () => {
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE', counts: { high: 0, medium: 0, low: 0 } }, false), 'none');
  assert.equal(GK.countsState({ verdict: 'INCOMPLETE' }, true), 'partial');
});

test('PASS and FAIL count in full when counts or a report exist', () => {
  assert.equal(GK.countsState({ verdict: 'FAIL', counts: { high: 1, medium: 2, low: 0 } }, false), 'full');
  assert.equal(GK.countsState({ verdict: 'PASS' }, true), 'full');
  // no counts and no report
  // nothing to show so dashes
  // scanned but the report did not load is not the same as not checked
  assert.equal(GK.countsState({ verdict: 'FAIL' }, false), 'unloaded');
  assert.equal(GK.countsState(null, false), 'none');
});

test('cut report says how many findings it shows', () => {
  assert.equal(GK.cappedNote(500, { high: 600, medium: 12, low: 0 }),
    'Showing the first 500 of 612 findings. The counts above are the full totals.');
  assert.equal(GK.cappedNote(3, { high: 1, medium: 2, low: 0 }), '');
  assert.equal(GK.cappedNote(0, null), '');
});

test('the page shows a dash, never 0, when nothing was checked', () => {
  assert.match(app, /GK\.countsState\(status, hasReport\)/);
  assert.match(app, /ui\.countHigh\.textContent = scanned \? values\.high : '—'/);
  assert.match(app, /'not checked'/);
  assert.match(html, /<dl class="sev-list" id="sev-list" data-state="full">/);
  assert.match(css, /\.sev-list\[data-state="none"\] dd \{/);
});

test('filter chips hide when there is nothing to filter', () => {
  assert.match(app, /ui\.filters\.hidden = findings\.length === 0;/);
  assert.match(html, /<p class="quiet cap-note" id="findings-cap" hidden><\/p>/);
});

test('done steps and boxes are cocoa, not PASS green', () => {
  assert.match(css, /--done: #6E5A61;/);
  assert.match(css, /\.step\[data-state="done"\] \.step-dot \{ background: var\(--done\)/);
  assert.match(css, /\.node\[data-state="done"\] \.node-tile \{ background: var\(--done-bg\)/);
  assert.doesNotMatch(css, /\.step\[data-state="done"\][^{]*\{[^}]*var\(--pass\)/);
  assert.doesNotMatch(css, /\.node\[data-state="done"\][^{]*\{[^}]*var\(--pass\)/);
});

test('editor bar wraps instead of overlap, and phones hide the Ctrl hint', () => {
  assert.match(css, /\.editor-bar \{ flex-wrap: wrap; row-gap: 6px; \}/);
  assert.match(css, /\.file-field \{ flex: 1 1 calc\(15ch \+ 32px\); max-width: calc\(19ch \+ 40px\); \}/);
  assert.match(css, /\(hover: none\) and \(pointer: coarse\) \{\s*\.btn-scan kbd \{ display: none; \}/);
});

test('the scanning step talks about a retry only as a maybe', () => {
  assert.match(html, /If a try fails, SQS gives the job out again\./);
  assert.doesNotMatch(html, /A failed try comes back from SQS/);
});

test('the findings number is green only for PASS', () => {
  assert.equal(GK.findingsTone('PASS', { high: 0, medium: 2, low: 1 }), 'pass');
  // INCOMPLETE skipped some files so 0 HIGH is not a pass
  assert.equal(GK.findingsTone('INCOMPLETE', { high: 0, medium: 0, low: 0 }), 'hold');
  assert.equal(GK.findingsTone('INCOMPLETE', { high: 2, medium: 0, low: 0 }), 'stop');
  assert.equal(GK.findingsTone('FAIL', { high: 1, medium: 2, low: 0 }), 'stop');
  assert.equal(GK.findingsTone('FAIL', { high: 0, medium: 0, low: 0 }), 'hold');
  assert.equal(GK.findingsTone(null, { high: 0, medium: 0, low: 0 }), 'hold');
  assert.match(app, /ui\.statFindings\.dataset\.tone = GK\.findingsTone\(status\.verdict, counts\);/);
});

test('INCOMPLETE with no findings never says nothing to fix', () => {
  assert.match(GK.noFindingsText('PASS'), /Nothing to fix/);
  const partial = GK.noFindingsText('INCOMPLETE');
  assert.doesNotMatch(partial, /Nothing to fix/);
  assert.match(partial, /not checked/);
  assert.match(app, /ui\.findingsEmpty\.textContent = GK\.noFindingsText\(lastVerdict\);/);
});

test('live log times say they are seen in this browser', () => {
  assert.match(html, /<p class="log-title">[^<]*seen in this browser<\/p>/);
});
