// page helpers, no DOM here. node tests load this file too
// gk-results puts this file before app.js. in the browser both run as one script
(function attachGateKeeperHelpers(root) {
  'use strict';

  const FAST_POLL_MS = 2000;
  const SLOW_POLL_MS = 5000;
  const FAST_PHASE_MS = 20000;
  const POLL_LIMIT_MS = 120000;
  const MAX_CODE_BYTES = 100 * 1024;
  const MAX_ATTEMPTS = 5;
  const JOB_ID = /^(?:pr-[1-9][0-9]{0,19}-[0-9a-f]{40}|paste-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
  const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const FILE_EXTENSION = /\.(?:js|mjs|cjs)$/;
  const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  // poll: every 2 s for the first 20 s, then every 5 s
  function pollDelayMs(elapsedMs) {
    return elapsedMs < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
  }

  function shouldKeepPolling(elapsedMs, phase) {
    return phase !== 'DONE' && elapsedMs < POLL_LIMIT_MS;
  }

  // all poll times in one 2 min window. tests: 30 or less
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

  function lineCount(text) {
    const value = String(text || '');
    return value === '' ? 0 : value.split('\n').length;
  }

  function statusLine(status) {
    const attempt = Number(status && status.attempt) || 0;
    const max = Number(status && status.maxAttempts) || MAX_ATTEMPTS;
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

  // one verdict = one tone, one title, one gate rule
  const VERDICTS = {
    PASS: {
      tone: 'pass', label: 'PASS', title: 'No high-risk problems',
      summary: 'No high-risk problems. A pull request with this code could merge.',
      gate: 'Commit status: success. Merge allowed.',
    },
    FAIL: {
      tone: 'stop', label: 'FAIL', title: 'High-risk problems found',
      summary: 'High-risk problems found. A pull request with this code would be blocked.',
      gate: 'Commit status: failure. Merge blocked until it is fixed.',
    },
    INCOMPLETE: {
      tone: 'hold', label: 'INCOMPLETE', title: 'Scan could not finish',
      summary: 'The scan could not check everything. GateKeeper blocks unchecked code instead of trusting it.',
      gate: 'Commit status: error. Merge blocked: not scanned is not safe.',
    },
  };

  function verdictInfo(verdict) {
    return VERDICTS[verdict] || {
      tone: 'hold', label: 'UNKNOWN', title: 'Unknown result',
      summary: 'GateKeeper returned a result this page does not know.', gate: 'Treat it as blocked.',
    };
  }

  function shortSha(sha) {
    return typeof sha === 'string' ? sha.slice(0, 7) : '';
  }

  function shortJobId(id) {
    if (typeof id !== 'string') return '';
    return id.length > 18 ? `${id.slice(0, 14)}…` : id;
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

  // HIGH first, then file, then line
  function sortFindings(list) {
    return (Array.isArray(list) ? list : [])
      .filter((f) => f && typeof f === 'object')
      .slice()
      .sort((a, b) => ((SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
        || String(a.file || '').localeCompare(String(b.file || ''))
        || ((Number(a.line) || 0) - (Number(b.line) || 0)));
  }

  // count the loaded findings by severity
  function countBySeverity(list) {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const f of Array.isArray(list) ? list : []) {
      const key = severityTone(f && f.severity);
      counts[key] += 1;
    }
    return counts;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  // donut parts from real counts only. c = circle length
  function donutParts(counts, c) {
    const items = [['high', Number(counts && counts.high) || 0], ['medium', Number(counts && counts.medium) || 0], ['low', Number(counts && counts.low) || 0]];
    const total = items.reduce((sum, [, n]) => sum + n, 0);
    if (total === 0) return { total, parts: [] };
    const used = items.filter(([, n]) => n > 0);
    const gap = used.length > 1 ? 3 : 0;
    let offset = 0;
    const parts = used.map(([key, n]) => {
      const len = (n / total) * c;
      const part = { key, dash: `${round2(Math.max(len - gap, 0.5))} ${round2(c - Math.max(len - gap, 0.5))}`, offset: offset === 0 ? 0 : round2(-offset) };
      offset += len;
      return part;
    });
    return { total, parts };
  }

  // 5.9 s / 42 s / 1 min 12 s
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  // server time: createdAt -> updatedAt, both from the job item
  function jobDurationMs(status) {
    if (!status || status.phase !== 'DONE') return null;
    const start = Date.parse(status.createdAt);
    const end = Date.parse(status.updatedAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
  }

  function clockTime(ms) {
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // where the page runs: API Gateway region, or my laptop
  function envLabel(hostname) {
    const host = String(hostname || '').toLowerCase();
    const aws = host.match(/^[a-z0-9]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
    if (aws) return { tone: 'aws', text: `AWS · API Gateway · ${aws[1]}` };
    if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) return { tone: 'local', text: 'Local dev · memory stand-ins' };
    return { tone: 'other', text: host || 'unknown host' };
  }

  // one short log text for a status answer
  function statusSummary(status) {
    if (!status || !status.phase) return 'no answer';
    if (status.phase === 'DONE') return status.verdict ? `DONE · ${status.verdict}` : 'DONE';
    const attempt = Number(status.attempt) || 0;
    return attempt > 0 ? `${status.phase} · try ${attempt} of ${Number(status.maxAttempts) || MAX_ATTEMPTS}` : status.phase;
  }

  // ---- AWS path card: a write path and a read path, lit from the real phase ----
  // write: POST /scans -> gk-submit -> SQS -> gk-worker -> DynamoDB + S3
  // read: page polls GET /scans/{id} -> gk-results -> same job item + S3 report
  const WRITE_PATH = Object.freeze(['api', 'submit', 'queue', 'worker', 'store']);
  const READ_PATH = Object.freeze(['poll', 'results', 'read']);
  const PIPELINE = Object.freeze([...WRITE_PATH, ...READ_PATH]);
  const NODE_LABELS = Object.freeze({ idle: 'Waiting', active: 'Working', done: 'Done', retry: 'Retrying', hold: 'Incomplete', error: 'Stopped', live: 'Polling' });

  // view: { mode, phase, attempt, verdict, reportReady }
  // mode: idle | sending | rejected | limited | tracking | lost
  function pipelineStates(view) {
    const v = view || {};
    const s = Object.fromEntries(PIPELINE.map((name) => [name, 'idle']));
    if (v.mode === 'sending') return { ...s, api: 'active', submit: 'active' };
    if (v.mode === 'limited') return { ...s, api: 'error' };
    if (v.mode === 'rejected') return { ...s, api: 'done', submit: 'error' };
    // lost: gk-results answered, but DynamoDB has no item for this ID
    if (v.mode === 'lost') return { ...s, poll: 'done', results: 'done', read: 'error' };
    if (v.mode !== 'tracking') return s;
    s.api = 'done';
    s.submit = 'done';
    s.poll = 'live';
    s.results = 'live';
    s.read = 'live';
    const attempt = Number(v.attempt) || 0;
    if (v.phase === 'RUNNING') {
      s.queue = 'done';
      s.worker = 'active';
    } else if (v.phase === 'FAILED') {
      s.queue = 'retry';
      s.worker = 'retry';
    } else if (v.phase === 'DONE') {
      s.queue = 'done';
      s.worker = v.verdict === 'INCOMPLETE' ? 'hold' : 'done';
      s.store = 'done';
      s.poll = 'done';
      // report read happens once, after DONE
      s.results = v.reportReady ? 'done' : 'active';
      s.read = v.reportReady ? 'done' : 'active';
    } else {
      s.queue = attempt > 0 ? 'retry' : 'active';
      if (attempt > 0) s.worker = 'retry';
    }
    return s;
  }

  function nodeLabel(state) {
    return NODE_LABELS[state] || NODE_LABELS.idle;
  }

  // one plain line under the card title
  function pipelineCaption(view) {
    const v = view || {};
    const attempt = Number(v.attempt) || 0;
    if (v.mode === 'sending') return 'Write path: API Gateway passes your code to gk-submit.';
    if (v.mode === 'limited') return 'API Gateway rate limit (429). Nothing was saved. Wait a few seconds.';
    if (v.mode === 'rejected') return 'gk-submit said no, so nothing was queued.';
    if (v.mode === 'lost') return 'Read path: no job has this ID. Pasted code is kept for 1 day.';
    if (v.mode !== 'tracking') return 'Start a scan to light up both paths from the real job phase.';
    if (v.phase === 'RUNNING') return `gk-worker is scanning your code (try ${Math.max(attempt, 1)} of ${MAX_ATTEMPTS}). The page keeps polling.`;
    if (v.phase === 'FAILED') return `Try ${attempt} of ${MAX_ATTEMPTS} failed. SQS gives the job out again later.`;
    if (v.phase === 'DONE') {
      if (v.verdict === 'INCOMPLETE') return 'Ended INCOMPLETE. Not scanned is not safe, so it counts as blocked.';
      return v.reportReady ? 'Verdict from DynamoDB, masked report from S3, both read by gk-results. Done.' : 'Verdict saved in DynamoDB. gk-results is reading the report.';
    }
    return attempt > 0 ? `Back in SQS, waiting for try ${attempt + 1} of ${MAX_ATTEMPTS}.` : 'Job saved in DynamoDB, waiting in SQS. The page polls gk-results.';
  }

  // chip text + tone for the current job
  function phaseChip(view) {
    const v = view || {};
    if (v.mode === 'sending') return { label: 'Sending', tone: 'run' };
    if (v.mode === 'limited') return { label: 'Rate limited', tone: 'hold' };
    if (v.mode === 'rejected') return { label: 'Not sent', tone: 'stop' };
    if (v.mode === 'lost') return { label: 'Not found', tone: 'hold' };
    if (v.mode !== 'tracking') return { label: 'Idle', tone: 'idle' };
    if (v.phase === 'RUNNING') return { label: 'Scanning', tone: 'run' };
    if (v.phase === 'FAILED') return { label: 'Retrying', tone: 'hold' };
    if (v.phase === 'DONE') {
      const info = verdictInfo(v.verdict);
      return { label: info.label, tone: info.tone };
    }
    return (Number(v.attempt) || 0) > 0 ? { label: 'Retrying', tone: 'hold' } : { label: 'Queued', tone: 'run' };
  }

  // ---- Scan Activity: 4 steps ----
  const STEPS = Object.freeze(['received', 'queued', 'scanning', 'report']);

  function lifecycle(view) {
    const v = view || {};
    const s = { received: 'todo', queued: 'todo', scanning: 'todo', report: 'todo' };
    if (v.mode !== 'tracking') return s;
    s.received = 'done';
    const attempt = Number(v.attempt) || 0;
    if (v.phase === 'RUNNING') {
      s.queued = 'done';
      s.scanning = 'active';
    } else if (v.phase === 'FAILED') {
      s.queued = 'done';
      s.scanning = 'retry';
    } else if (v.phase === 'DONE') {
      s.queued = 'done';
      s.scanning = v.verdict === 'INCOMPLETE' ? 'hold' : 'done';
      if (!v.reportReady) s.report = 'active';
      else s.report = v.hasReport ? 'done' : 'hold';
    } else {
      s.queued = 'active';
      if (attempt > 0) s.scanning = 'retry';
    }
    return s;
  }

  root.GK = Object.freeze({
    FAST_POLL_MS,
    SLOW_POLL_MS,
    FAST_PHASE_MS,
    POLL_LIMIT_MS,
    MAX_CODE_BYTES,
    MAX_ATTEMPTS,
    WRITE_PATH,
    READ_PATH,
    PIPELINE,
    STEPS,
    pollDelayMs,
    shouldKeepPolling,
    pollTimes,
    isJobId,
    isFilename,
    isRepoName,
    codeBytes,
    formatKB,
    lineCount,
    statusLine,
    verdictInfo,
    shortSha,
    shortJobId,
    countsLine,
    timeAgo,
    severityTone,
    severityLabel,
    sortFindings,
    countBySeverity,
    donutParts,
    formatDuration,
    jobDurationMs,
    clockTime,
    envLabel,
    statusSummary,
    pipelineStates,
    nodeLabel,
    pipelineCaption,
    phaseChip,
    lifecycle,
  });
})(globalThis);
