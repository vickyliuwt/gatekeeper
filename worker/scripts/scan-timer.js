import { scanFile } from '../../sast/backend/scanner.js';

const file = process.argv[2];
const runs = Number(process.argv[3]) || 1;

if (!file) {
  console.error('usage: node worker/scripts/scan-timer.js <file> [runs]');
  process.exit(1);
}

const times = [];
let findings = 0;

for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  findings = scanFile(file).length;
  times.push(performance.now() - t0);
}

const avg = times.reduce((a, b) => a + b, 0) / times.length;
const min = Math.min(...times);
const max = Math.max(...times);

console.log(`${file}`);
console.log(`  findings: ${findings}`);
console.log(`  time: avg ${avg.toFixed(1)} ms  (min ${min.toFixed(1)}, max ${max.toFixed(1)}, ${runs} run${runs > 1 ? 's' : ''})`);