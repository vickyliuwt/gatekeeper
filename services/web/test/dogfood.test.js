// Dogfooding: our own page and Lambda code must pass our own gate (0 HIGH findings),
// using the course scanner that the worker runs on pull requests (sast/backend/scanner.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = join(WEB_DIR, '..', '..', 'sast', 'backend', 'scanner.js');

test('our page and Lambda code have no HIGH finding from the course scanner', {
  skip: existsSync(SCANNER) ? false : 'sast/backend/scanner.js not found',
  timeout: 20000,
}, async (t) => {
  const { scanCode } = await import(pathToFileURL(SCANNER).href);
  const files = ['src', 'public'].flatMap((dir) => readdirSync(join(WEB_DIR, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${dir}/${name}`));
  const findings = files.flatMap((file) => scanCode(readFileSync(join(WEB_DIR, file), 'utf8'), file));
  const count = (severity) => findings.filter((finding) => finding.severity === severity).length;
  t.diagnostic(`scanned ${files.length} files: HIGH ${count('HIGH')}, MEDIUM ${count('MEDIUM')}, LOW ${count('LOW')}`);
  assert.deepEqual(findings.filter((f) => f.severity === 'HIGH').map((f) => `${f.file}:${f.line} ${f.id}`), []);
});
