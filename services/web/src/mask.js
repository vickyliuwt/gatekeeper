// masking rules (the page is public):
//   1. HARDCODED_SECRET: each quoted text keeps first 4 chars, rest -> ****
//      4 chars or less -> ****. empty quotes stay empty
//   2. other findings on the same file + line are masked the same way
//      (the course scanner copies the whole line into evidence)
//   3. known token shapes (sk_live_, ghp_, AKIA...) are masked in every finding
//   4. a served report keeps only REPORT_FIELDS and FINDING_FIELDS (allow-list)
//   quote not closed (scanner cuts lines at 100 chars) -> masked to the end
// masking twice = same text, so the worker and gk-results can both do it
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

// old helper, kept for tests: the text rule for one secret finding
export function maskEvidenceText(text, { quoted = false } = {}) {
  return quoted ? maskSecretText(text) : maskTokens(text);
}

export const MAX_FINDINGS = 500;

// public page: a report leaves gk-results with these fields only
// anything else a worker adds (raw output, file text, debug data) gets dropped
export const REPORT_FIELDS = Object.freeze([
  'jobId', 'source', 'repo', 'prNumber', 'headSha', 'scannerVersion', 'scannedAt',
  'verdict', 'counts', 'scannedFiles', 'skippedFiles',
]);
// the 9 fields the course scanner's scanCode() gives for one finding
export const FINDING_FIELDS = Object.freeze(['id', 'name', 'severity', 'description', 'message', 'file', 'line', 'column', 'evidence']);

function pick(source, fields) {
  const out = {};
  for (const key of fields) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

// the scanner's own HTTP server calls the list "vulnerabilities"
// that shape is shown and masked the same way as "findings"
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
