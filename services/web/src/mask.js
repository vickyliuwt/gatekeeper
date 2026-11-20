// masking rules because the page is public
// rule 1 for a hardcoded secret
// each quoted text keeps the first 4 chars and the rest turns into stars
// 4 chars or less all turn into stars
// empty quotes stay empty
// rule 2
// other findings on the same file and line are masked the same way
// the course scanner copies the whole line into evidence
// rule 3
// known token shapes are masked in every finding
// like Stripe keys and GitHub tokens and the fine grained GitHub ones
// and AWS key ids AKIA plus the temp ASIA ones Learner Lab gives us
// and AWS session tokens
// rule 4
// a served report keeps only the fields in the two allow lists below
// quote not closed because the scanner cuts lines at 100 chars
// so mask to the end
// masking twice gives the same text
// so the worker and the results lambda can both do it
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\])*)(\1|$)/g;
const TOKEN_SHAPES = [
  /sk_(?:live|test)_[A-Za-z0-9]{6,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{12,}/g,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /(?:IQoJb3JpZ2lu|FwoGZXIvYXdz)[A-Za-z0-9+/=]{20,}/g,
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

// old helper kept for tests
// the text rule for one secret finding
export function maskEvidenceText(text, { quoted = false } = {}) {
  return quoted ? maskSecretText(text) : maskTokens(text);
}

export const MAX_FINDINGS = 500;
// real numbers from the worker like the scan time
export const NUMBER_FIELDS = Object.freeze(['sourceBytes', 'scanMs', 'elapsedMs']);

// public page so a report leaves the results lambda with these fields only
// anything else a worker adds gets dropped
// like raw output or file text or debug data
export const REPORT_FIELDS = Object.freeze([
  'jobId', 'source', 'repo', 'prNumber', 'headSha', 'scannerVersion', 'scannedAt',
  'verdict', 'counts', 'scannedFiles', 'skippedFiles',
  'sourceBytes', 'scanMs', 'elapsedMs',
]);
// the 9 fields the course scanner gives for one finding
export const FINDING_FIELDS = Object.freeze(['id', 'name', 'severity', 'description', 'message', 'file', 'line', 'column', 'evidence']);

function pick(source, fields) {
  const out = {};
  for (const key of fields) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

// the scanner server calls the list vulnerabilities
// that shape is shown and masked the same way as findings
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
  const out = { ...pick(report, REPORT_FIELDS), findings: maskFindings(findings) };
  // the worker numbers stay only when they are real numbers 0 or more
  for (const key of NUMBER_FIELDS) {
    if (key in out && !(typeof out[key] === 'number' && Number.isFinite(out[key]) && out[key] >= 0)) delete out[key];
  }
  if ('scannedFiles' in out) {
    const files = cleanScanned(out.scannedFiles);
    if (files === null) delete out.scannedFiles;
    else out.scannedFiles = files;
  }
  return out;
}

// the real worker gives a number of files
// an older worker gives a list of file names
// names are masked too and the list is cut at the same 500
export function cleanScanned(value) {
  if (Array.isArray(value)) return value.filter((name) => typeof name === 'string').slice(0, MAX_FINDINGS).map((name) => maskTokens(name));
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return null;
}
