// Self-scan (dogfooding): runs the course scanner (sast/backend/scanner.js) on Part C's own code,
// the same scanner the worker runs on pull requests. Prints every finding; exit code 1 on any HIGH.
//   From services/web:  npm run self-scan            or   node scripts/self-scan.js --out self-scan.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { out: { type: 'string' } } });
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = join(WEB_DIR, '..', '..', 'sast', 'backend', 'scanner.js');
if (!existsSync(SCANNER)) {
  console.error('sast/backend/scanner.js not found. Run this inside the gatekeeper repo.');
  process.exit(2);
}
const { scanCode } = await import(pathToFileURL(SCANNER).href);

const files = ['src', 'public'].flatMap((dir) => readdirSync(join(WEB_DIR, dir))
  .filter((name) => /\.(?:js|mjs|cjs)$/.test(name))
  .map((name) => `${dir}/${name}`));
const findings = files.flatMap((file) => scanCode(readFileSync(join(WEB_DIR, file), 'utf8'), file));
const count = (severity) => findings.filter((f) => f.severity === severity).length;

for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.id.padEnd(20)} ${f.file}:${f.line}  ${f.description}`);
const summary = { scannedAt: new Date().toISOString(), files: files.length, high: count('HIGH'), medium: count('MEDIUM'), low: count('LOW') };
console.log(`\nscanned ${summary.files} files: HIGH ${summary.high}, MEDIUM ${summary.medium}, LOW ${summary.low}`);
if (opt.out) writeFileSync(opt.out, `${JSON.stringify({ summary, findings }, null, 2)}\n`);
console.log(summary.high === 0 ? 'PASS: no HIGH finding in our own code.' : 'FAIL: fix every HIGH above before you open a PR.');
process.exit(summary.high === 0 ? 0 : 1);
