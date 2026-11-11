import fs from 'fs';
import path from 'path';

const HEAD = 'console.log(';
// 14 bytes, hits all three SENSITIVE_DATA_LOG patterns in one pass
const UNIT = 'pwd ssn token ';

// Build a malicious input: it opens console.log(, packs the file with
// keywords the rule looks for, and never closes the paren.
export function makeHostile(bytes) {
  const n = Math.max(1, Math.floor((bytes - HEAD.length) / UNIT.length));
  return HEAD + UNIT.repeat(n);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kb = Number(process.argv[2]) || 32;
  const outDir = path.resolve('worker/test/fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  const content = makeHostile(kb * 1024);
  const out = path.join(outDir, 'hostile.js');
  fs.writeFileSync(out, content);
  console.log(`wrote ${out}: ${content.length} bytes`);
}