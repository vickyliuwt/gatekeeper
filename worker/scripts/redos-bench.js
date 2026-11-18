import { makeHostile } from './make-hostile.js';

// The three SENSITIVE_DATA_LOG patterns, as they stand in scanner.js.
// Update these two blocks together with scanner.js when measuring the fix.
const RULES = [
  { name: 'password', regex: /console\.(log|info|debug|warn|error)\s*\([^)\n]{0,200}(?:password|passwd|pwd)[^)\n]{0,200}\)/gi },
  { name: 'token',    regex: /console\.(log|info|debug|warn|error)\s*\([^)\n]{0,200}(?:token|secret|apikey|api_key)[^)\n]{0,200}\)/gi },
  { name: 'pii',      regex: /console\.(log|info|debug|warn|error)\s*\([^)\n]{0,200}(?:creditcard|credit_card|ssn|social_security)[^)\n]{0,200}\)/gi }
];

const SIZES = [4, 8, 16, 32, 64, 128];

console.log('size      password      token        pii        total');
console.log('--------------------------------------------------------');

for (const kb of SIZES) {
  const input = makeHostile(kb * 1024);
  const times = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    const t0 = performance.now();
    re.exec(input);
    times.push(performance.now() - t0);
  }

  const total = times.reduce((a, b) => a + b, 0);
  const fmt = n => n.toFixed(1).padStart(10);
  console.log(`${String(kb).padStart(4)} KB ${times.map(fmt).join(' ')} ${fmt(total)} ms`);
}