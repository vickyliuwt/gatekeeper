// Masking rule (README.md, "Masking"):
//   1. In a HARDCODED_SECRET finding, every quoted text keeps its first 4 characters and the rest
//      becomes ****. A text of 4 characters or less becomes ****. Empty quotes stay as they are.
//   2. A finding on the same file and line as a HARDCODED_SECRET finding is masked the same way,
//      because the course scanner copies the WHOLE line into evidence.
//   3. Known token shapes (sk_live_, ghp_, AKIA...) are masked in every finding.
//   4. A served report keeps only the fields in REPORT_FIELDS and FINDING_FIELDS (an allow-list).
//   An unclosed quote (the scanner cuts long lines at 100 characters) is masked to the end.
// Masking twice gives the same text, so the worker and gk-results can both apply it.
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\])*)(\1|$)/g;
const TOKEN_SHAPES = [
  /sk_(?:live|test)_[A-Za-z0-9]{6,}/g,
  /gh[pousr]_[A-Za-z0-9]{12,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

export function keepFour(value) {
  if (typeof value !== 'string' || value.length <= 4) return '****';
  return `${value.slice(0, 4)}****`;
}

export function maskTokens(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, (token) => keepFour(token));
  return out;
}

export function maskSecretText(text) {
  if (typeof text !== 'string') return text;
  const quoted = text.replace(QUOTED, (whole, quote, inner, end) => (inner.length === 0 ? whole : `${quote}${keepFour(inner)}${end}`));
  return maskTokens(quoted);
}

const lineKey = (finding) => `${finding?.file ?? ''}#${finding?.line ?? ''}`;

export function secretLinesOf(findings) {
  return new Set((Array.isArray(findings) ? findings : []).filter((f) => f?.id === 'HARDCODED_SECRET').map(lineKey));
}

export function maskFinding(finding, secretLines = new Set()) {
  if (!finding || typeof finding !== 'object') return finding;
  const secret = finding.id === 'HARDCODED_SECRET' || secretLines.has(lineKey(finding));
  const evidence = secret ? maskSecretText(finding.evidence) : maskTokens(finding.evidence);
  return evidence === finding.evidence ? finding : { ...finding, evidence };
}

export function maskFindings(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const secretLines = secretLinesOf(list);
  return list.map((f) => maskFinding(f, secretLines));
}

// Kept for older callers and tests: the text rule for one secret finding.
export function maskEvidenceText(text, { quoted = false } = {}) {
  return quoted ? maskSecretText(text) : maskTokens(text);
}

export const MAX_FINDINGS = 500;

// The page is public, so a report leaves gk-results with these fields only. Anything else a worker
// might add (raw scanner output, file contents, debug data) is dropped instead of passed through.
export const REPORT_FIELDS = Object.freeze([
  'jobId', 'source', 'repo', 'prNumber', 'headSha', 'scannerVersion', 'scannedAt',
  'verdict', 'counts', 'scannedFiles', 'skippedFiles',
]);
// Exactly what the course scanner's scanCode() returns for one finding.
export const FINDING_FIELDS = Object.freeze(['id', 'name', 'severity', 'description', 'message', 'file', 'line', 'column', 'evidence']);

function pick(source, fields) {
  const out = {};
  for (const key of fields) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

// The course scanner's own HTTP server calls the list "vulnerabilities". A report saved in that shape
// is shown the same way, and masked the same way, as one that uses "findings".
export function reportFindings(report) {
  if (Array.isArray(report?.findings)) return report.findings;
  if (Array.isArray(report?.vulnerabilities)) return report.vulnerabilities;
  return [];
}

export function maskReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return { findings: [] };
  const findings = reportFindings(report)
    .slice(0, MAX_FINDINGS)
    .filter((f) => f && typeof f === 'object' && !Array.isArray(f))
    .map((f) => pick(f, FINDING_FIELDS));
  return { ...pick(report, REPORT_FIELDS), findings: maskFindings(findings) };
}
