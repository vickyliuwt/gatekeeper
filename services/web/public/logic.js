// Pure helpers for the Paste and Scan page. No DOM here, so the Node tests load this file too.
// gk-results inlines this file before app.js; in the browser both run as one script.
(function attachGateKeeperHelpers(root) {
  'use strict';

  const FAST_POLL_MS = 2000;
  const SLOW_POLL_MS = 5000;
  const FAST_PHASE_MS = 20000;
  const POLL_LIMIT_MS = 120000;
  const MAX_CODE_BYTES = 100 * 1024;
  const JOB_ID = /^(?:pr-[1-9][0-9]{0,19}-[0-9a-f]{40}|paste-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
  const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const FILE_EXTENSION = /\.(?:js|mjs|cjs)$/;
  const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

  // Every 2 s for the first 20 s, then every 5 s (README.md, "Polling").
  function pollDelayMs(elapsedMs) {
    return elapsedMs < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
  }

  function shouldKeepPolling(elapsedMs, phase) {
    return phase !== 'DONE' && elapsedMs < POLL_LIMIT_MS;
  }

  // When each poll happens in one 2-minute window. The tests check there are 30 or fewer.
  function pollTimes() {
    const times = [];
    for (let at = 0; at < POLL_LIMIT_MS; at += pollDelayMs(at)) times.push(at);
    return times;
  }

  function isJobId(value) {
    return typeof value === 'string' && JOB_ID.test(value);
  }

  function isFilename(value) {
    return typeof value === 'string' && FILE_NAME.test(value) && FILE_EXTENSION.test(value);
  }

  function isRepoName(value) {
    return typeof value === 'string' && REPO_NAME.test(value);
  }

  function codeBytes(text) {
    return new TextEncoder().encode(String(text)).length;
  }

  function formatKB(bytes) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }

  function statusLine(status) {
    const attempt = Number(status && status.attempt) || 0;
    const max = Number(status && status.maxAttempts) || 5;
    switch (status && status.phase) {
      case 'QUEUED':
        return attempt > 0 ? `Waiting for try ${attempt + 1} of ${max}.` : 'Waiting in line for a scanner.';
      case 'RUNNING':
        return attempt > 1 ? `Scanning, try ${attempt} of ${max}.` : 'Scanning your code.';
      case 'FAILED':
        return `Try ${attempt} of ${max} failed. GateKeeper tries again in a few minutes.`;
      case 'DONE':
        return 'Scan finished.';
      default:
        return 'Checking on the scan.';
    }
  }

  const VERDICTS = {
    PASS: { tone: 'pass', label: 'PASS', summary: 'No high-risk problems. A pull request with this code could merge.' },
    FAIL: { tone: 'stop', label: 'FAIL', summary: 'High-risk problems found. A pull request with this code would be blocked.' },
    INCOMPLETE: { tone: 'hold', label: 'INCOMPLETE', summary: 'The scan could not check everything. GateKeeper blocks unchecked code instead of trusting it.' },
  };

  function verdictInfo(verdict) {
    return VERDICTS[verdict] || { tone: 'hold', label: 'UNKNOWN', summary: 'GateKeeper returned a result this page does not know.' };
  }

  function shortSha(sha) {
    return typeof sha === 'string' ? sha.slice(0, 7) : '';
  }

  function countsLine(counts) {
    const c = counts || {};
    return `${c.high || 0} high, ${c.medium || 0} medium, ${c.low || 0} low`;
  }

  function timeAgo(iso, nowMs) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return '';
    const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  function severityTone(severity) {
    if (severity === 'HIGH') return 'high';
    if (severity === 'MEDIUM') return 'medium';
    return 'low';
  }

  function severityLabel(severity) {
    if (severity === 'HIGH') return 'High';
    if (severity === 'MEDIUM') return 'Medium';
    if (severity === 'LOW') return 'Low';
    return String(severity || 'Unknown');
  }

  root.GK = Object.freeze({
    FAST_POLL_MS,
    SLOW_POLL_MS,
    FAST_PHASE_MS,
    POLL_LIMIT_MS,
    MAX_CODE_BYTES,
    pollDelayMs,
    shouldKeepPolling,
    pollTimes,
    isJobId,
    isFilename,
    isRepoName,
    codeBytes,
    formatKB,
    statusLine,
    verdictInfo,
    shortSha,
    countsLine,
    timeAgo,
    severityTone,
    severityLabel,
  });
})(globalThis);
