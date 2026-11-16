import fs from 'fs';
import { test } from 'node:test';
import assert from 'node:assert';
import { scanFile } from '../../sast/backend/scanner.js';
import { makeHostile } from '../scripts/make-hostile.js';

const TRUE_POSITIVES = 'sast/backend/test-vulnerable.js';
const CLEAN_FILE = 'worker/test/fixtures/normal-project.js';
const HOSTILE_FILE = 'worker/test/fixtures/hostile.js';

test('keeps all known true positives', () => {
  assert.strictEqual(scanFile(TRUE_POSITIVES).length, 36);
});

test('reports nothing on a clean business file', () => {
  assert.strictEqual(scanFile(CLEAN_FILE).length, 0);
});

test('scans a 32 KB hostile file in under 100 ms', () => {
  fs.writeFileSync(HOSTILE_FILE, makeHostile(32 * 1024));
  const t0 = performance.now();
  scanFile(HOSTILE_FILE);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});