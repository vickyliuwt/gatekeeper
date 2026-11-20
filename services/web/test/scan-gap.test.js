// one scan every 2 s from one page
// a fast double click or ctrl enter never sends 2 scans
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/logic.js';

const { GK } = globalThis;
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('the gap is 2 s and a page that never sent waits 0', () => {
  assert.equal(GK.SCAN_GAP_MS, 2000);
  assert.equal(GK.scanWaitMs(0, 5000), 0);
  assert.equal(GK.scanWaitMs(undefined, 5000), 0);
});

test('a second press inside the gap waits the rest of the gap', () => {
  assert.equal(GK.scanWaitMs(10000, 10500), 1500);
  assert.equal(GK.scanWaitMs(10000, 11999), 1);
  assert.equal(GK.scanWaitMs(10000, 12000), 0);
  assert.equal(GK.scanWaitMs(10000, 20000), 0);
});

test('a clock that went back never waits longer than the gap', () => {
  assert.equal(GK.scanWaitMs(10000, 1000), 2000);
});

test('submit checks the gap right after the sending check and saves the send time', () => {
  const at = app.indexOf('if (sending) return undefined;');
  const gap = app.indexOf('GK.scanWaitMs(lastSentAt, Date.now())');
  assert.ok(at > 0 && gap > at && gap - at < 200);
  assert.match(app, /const sentAt = Date\.now\(\);\n\s*lastSentAt = sentAt;/);
  assert.match(app, /Scan pressed again too soon/);
});
