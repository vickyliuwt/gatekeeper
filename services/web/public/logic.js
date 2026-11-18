// page helpers with no DOM here
// node tests load this file too
// the results lambda puts this file before the app file
// in the browser both run as one script
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
  const FILE_EXTENSION_ANY_CASE = /\.(?:js|mjs|cjs)$/i;
  const MAX_NAME_LENGTH = 100;
  const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  // the job says its own max and 5 is only the backup
  // a bad max like 0 or minus or text uses 5
  function maxTries(s) {
    const m = Number(s && s.maxAttempts);
    return Number.isFinite(m) && m >= 1 ? Math.floor(m) : MAX_ATTEMPTS;
  }

  // 2 of 5 but a job sent back from the dead letter queue is just 6
  // so the page never says 6 of 5
  // odd values from a bad answer count as 0 tries so the page never shows junk
  function tryOf(attempt, max) {
    const n = Number(attempt);
    const a = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    const m = maxTries({ maxAttempts: max });
    return a > m ? String(a) : `${a} of ${m}`;
  }

  // poll every 2 s for the first 20 s then every 5 s
  // one scan every 2 s from one page
  // a fast double click then never starts 2 scans and 2 lambdas at once
  const SCAN_GAP_MS = 2000;
  function scanWaitMs(lastSentAt, now, gap = SCAN_GAP_MS) {
    const last = Number(lastSentAt) || 0;
    if (last <= 0) return 0;
    const left = last + gap - Number(now);
    // a clock that went back never makes the wait longer than the gap
    return left > 0 ? Math.min(left, gap) : 0;
  }

  function pollDelayMs(elapsedMs) {
    return elapsedMs < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
  }

  function shouldKeepPolling(elapsedMs, phase) {
    return phase !== 'DONE' && elapsedMs < POLL_LIMIT_MS;
  }

  // all poll times in one 2 min window
  // tests want 30 or less
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
    // over the limit never rounds down to 100 KB
    if (bytes > MAX_CODE_BYTES) return `${(Math.ceil(kb * 10) / 10).toFixed(1)} KB`;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }

  function lineCount(text) {
    const value = String(text || '');
    return value === '' ? 0 : value.split('\n').length;
  }

  function statusLine(status) {
    const attempt = Number(status && status.attempt) || 0;
    const max = maxTries(status);
    switch (status && status.phase) {
      case 'QUEUED':
        // all tries used up so never say try 6 of 5
        if (attempt >= max) return `Try ${tryOf(attempt, max)} failed. That was the last try, so the job ends as INCOMPLETE.`;
        return attempt > 0 ? `Waiting for try ${attempt + 1} of ${max}.` : 'Waiting in line for a scanner.';
      case 'RUNNING':
        // a job sent back from the dead letter queue can go past the max so no try 6 of 5
        if (attempt > max) return `Scanning again, try ${attempt}.`;
        return attempt > 1 ? `Scanning, try ${attempt} of ${max}.` : 'Scanning your code.';
      case 'FAILED':
        // SQS sends the job again after its visibility timeout which is 360 s on AWS
        // the last try failed so no new try comes
        if (attempt >= max) return `Try ${tryOf(attempt, max)} failed. That was the last try, so the job ends as INCOMPLETE.`;
        return `Try ${tryOf(attempt, max)} failed. SQS gives the job back after the visibility timeout.`;
      case 'DONE':
        return 'Scan finished.';
      default:
        return 'Checking on the scan.';
    }
  }

  // one verdict has one tone and one title and one gate rule
  const VERDICTS = {
    PASS: {
      tone: 'pass', label: 'PASS', title: 'No high-risk problems',
      summary: 'A pull request with this code could merge. Medium and low findings are warnings only.',
      gate: 'Commit status: success. Merge allowed.',
    },
    FAIL: {
      tone: 'stop', label: 'FAIL', title: 'High-risk problems found',
      summary: 'A pull request with this code would be blocked until every high finding is fixed.',
      gate: 'Commit status: failure. Merge blocked until it is fixed.',
    },
    INCOMPLETE: {
      tone: 'hold', label: 'INCOMPLETE', title: 'Scan could not finish',
      summary: 'GateKeeper could not check everything, so it blocks the code instead of trusting it.',
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

  // high and High and HIGH all count as HIGH
  // an empty level is UNKNOWN and never turns into LOW
  function normSeverity(severity) {
    const key = String(severity == null ? '' : severity).trim().toUpperCase();
    return key || 'UNKNOWN';
  }

  function severityTone(severity) {
    const key = normSeverity(severity);
    if (key === 'HIGH') return 'high';
    if (key === 'MEDIUM') return 'medium';
    if (key === 'LOW') return 'low';
    return 'unknown';
  }

  function severityLabel(severity) {
    const key = normSeverity(severity);
    if (key === 'HIGH') return 'High';
    if (key === 'MEDIUM') return 'Medium';
    if (key === 'LOW') return 'Low';
    return key === 'UNKNOWN' ? 'Unknown' : key;
  }

  // HIGH first then file then line
  function sortFindings(list) {
    return (Array.isArray(list) ? list : [])
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ ...f, severity: normSeverity(f.severity) }))
      .sort((a, b) => ((SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
        || String(a.file || '').localeCompare(String(b.file || ''))
        || ((Number(a.line) || 0) - (Number(b.line) || 0)));
  }

  // count the loaded findings by severity
  function countBySeverity(list) {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const f of Array.isArray(list) ? list : []) {
      const key = severityTone(f && f.severity);
      // an unknown level is not counted as low
      if (key in counts) counts[key] += 1;
    }
    return counts;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  // donut parts from real counts only
  // c is the circle length
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

  // short time text like 42 s or 1 min 12 s
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  // server time from createdAt to updatedAt
  // both come from the job item
  function jobDurationMs(status) {
    if (!status || status.phase !== 'DONE') return null;
    const start = Date.parse(status.createdAt);
    const end = Date.parse(status.updatedAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
  }

  // facts for the Scan log
  // all from the job record
  function scanFacts(status) {
    const s = status || {};
    const attempt = Number(s.attempt) || 0;
    const ms = jobDurationMs(s);
    const result = s.phase ? (s.verdict ? `${s.phase} · ${s.verdict}` : String(s.phase)) : '—';
    return [
      ['Tries', attempt > 0 ? tryOf(attempt, maxTries(s)) : 'not started'],
      ['Time to result', ms === null ? '—' : formatDuration(ms)],
      ['Result', result],
    ];
  }

  // open by itself after a retry or INCOMPLETE
  function scanLogOpen(status) {
    const s = status || {};
    return Number(s.attempt) > 1 || s.verdict === 'INCOMPLETE';
  }

  function clockTime(ms) {
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // my laptop names
  // any 127 address is my laptop too
  const LOCAL_HOSTS = new Set(['localhost', '::1', '[::1]']);
  const LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

  // where the page runs
  // API Gateway region or my laptop
  function envLabel(hostname) {
    const host = String(hostname || '').toLowerCase();
    const aws = host.match(/^[a-z0-9]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
    if (aws) return { tone: 'aws', text: `AWS · API Gateway · ${aws[1]}` };
    if (LOCAL_HOSTS.has(host) || LOOPBACK.test(host)) return { tone: 'local', text: 'Local dev · memory stand-ins' };
    return { tone: 'other', text: host || 'unknown host' };
  }

  // local test buttons only on my laptop
  // same host list as envLabel
  function isLocalHost(hostname) {
    return envLabel(hostname).tone === 'local';
  }

  // one short log text for a status answer
  function statusSummary(status) {
    if (!status || !status.phase) return 'no answer';
    if (status.phase === 'DONE') return status.verdict ? `DONE · ${status.verdict}` : 'DONE';
    const attempt = Number(status.attempt) || 0;
    return attempt > 0 ? `${status.phase} · try ${tryOf(attempt, maxTries(status))}` : status.phase;
  }

  // split log text into verb and rest
  // so GET and POST get their own look
  function splitLogText(text) {
    const value = String(text || '');
    const m = value.match(/^(GET|POST) (.*)$/);
    return m ? { verb: m[1], rest: m[2] } : { verb: null, rest: value };
  }

  // turn a local file name into a name the API takes
  // or null
  // spaces and odd signs become a dash
  // an upper case JS ext becomes small js
  // a very long name gets cut to 100 and keeps its ext
  function safeFilename(name) {
    const raw = String(name || '').split(/[\\/]/).pop();
    const ext = raw.match(FILE_EXTENSION_ANY_CASE);
    if (!ext) return null;
    let stem = raw.slice(0, raw.length - ext[0].length)
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '');
    // a name with no plain letters or digits becomes snippet
    if (!/[A-Za-z0-9]/.test(stem)) stem = 'snippet';
    stem = stem.slice(0, MAX_NAME_LENGTH - ext[0].length);
    const cleaned = `${stem}${ext[0].toLowerCase()}`;
    return isFilename(cleaned) ? cleaned : null;
  }

  // why a picked file can not go in the box
  // null means ok
  // wrong type and a bad name get their own words
  function fileProblem(name, bytes) {
    if (!FILE_EXTENSION_ANY_CASE.test(String(name || ''))) return 'Pick a .js, .mjs or .cjs file.';
    if (!safeFilename(name)) return 'Rename the file like app.js, then open it again.';
    if (!Number.isFinite(bytes) || bytes <= 0) return 'This file is empty.';
    if (bytes > MAX_CODE_BYTES) return `This file is ${formatKB(bytes)}. The limit is 100 KB.`;
    return null;
  }

  // one round trip seen by this browser
  // like 84 ms or 2 s
  // a lambda cold start shows up here as a slow line
  function latencyText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  // a bad poll answer as short words for the log
  function pollProblem(code, hasBody) {
    // 0 means the request never got an answer
    if (!code) return 'no answer';
    if (code === 200) return hasBody ? '200 · no phase' : '200 · empty answer';
    if (code === 429) return '429 · slow down';
    return String(code);
  }

  // what the page says when it stops at 2 minutes
  // hadStatus means a poll gave a status
  // lastCode is the last bad http code and 0 means no answer
  // last is the last phase and try we saw
  // a job still in the queue never says scanning
  function stopNote(hadStatus, lastCode, last) {
    if (hadStatus) {
      const phase = last && last.phase;
      const attempt = Number(last && last.attempt) || 0;
      const max = maxTries(last);
      // the last try failed so the worker ends the job as INCOMPLETE
      if ((phase === 'QUEUED' || phase === 'FAILED') && attempt >= max) {
        return { text: `Try ${tryOf(attempt, max)} failed. That was the last try, so the worker ends this job as INCOMPLETE and it counts as blocked. Check again to see the final answer.`, say: 'The last try failed. This page stopped asking.' };
      }
      if ((phase === 'QUEUED' || phase === 'FAILED') && attempt > 0) {
        const next = `Waiting for try ${attempt + 1} of ${max}.`;
        return { text: `${next} SQS gives the job back after its visibility timeout, which can be longer than the 2 minutes this page waits. Check again later.`, say: `${next} This page stopped asking.` };
      }
      if (phase === 'QUEUED') {
        return { text: 'Still waiting in the SQS queue after 2 minutes. No worker has taken the job yet, so nothing was scanned. The job stays safe in the queue. Check again to keep waiting.', say: 'Still waiting in the SQS queue after 2 minutes. This page stopped asking.' };
      }
      return { text: 'Still scanning after 2 minutes. Check again to keep waiting.', say: 'Still scanning after 2 minutes. This page stopped asking.' };
    }
    if (Number.isFinite(lastCode) && lastCode > 0) {
      const what = lastCode === 200 ? 'an empty 200' : String(lastCode);
      return { text: `GateKeeper answered ${what} for 2 minutes, never a job status. Check again to try once more.`, say: `GateKeeper answered ${what} for 2 minutes. This page stopped asking.` };
    }
    return { text: 'No answer from GateKeeper for 2 minutes. Check again to try once more.', say: 'No answer from GateKeeper for 2 minutes. This page stopped asking.' };
  }

  // hint after 20 s in the queue on try 0
  // the time is what this browser saw
  // most of the time it means no worker runs yet
  function queueHint(status, elapsedMs) {
    const s = status || {};
    if (s.phase !== 'QUEUED' || (Number(s.attempt) || 0) > 0 || !(elapsedMs >= FAST_PHASE_MS)) return '';
    return 'No worker has taken this job yet. It is safe in the SQS queue and runs when a worker is free.';
  }

  // true when try 5 of 5 failed or the job is back in the queue after it
  // no new try comes after that
  function isLastTry(view) {
    const v = view || {};
    const max = maxTries(v);
    return (v.phase === 'FAILED' || v.phase === 'QUEUED') && (Number(v.attempt) || 0) >= max;
  }

  // AWS path card
  // a write path and a read path lit from the real phase
  // write path is POST scans then submit then SQS
  // then the worker then DynamoDB and S3
  // read path is the page asking for the status
  // then results reads the same job item and S3 report
  const WRITE_PATH = Object.freeze(['api', 'submit', 'queue', 'worker', 'store']);
  const READ_PATH = Object.freeze(['poll', 'results', 'read']);
  const PIPELINE = Object.freeze([...WRITE_PATH, ...READ_PATH]);
  const NODE_LABELS = Object.freeze({ idle: 'Waiting', active: 'Working', done: 'Done', retry: 'Retrying', hold: 'Incomplete', error: 'Stopped', live: 'Polling', paused: 'Paused' });
  // busy looks
  // when the page stops asking they turn into paused
  const BUSY = new Set(['active', 'live', 'retry']);

  // view has mode phase attempt verdict reportReady and paused
  // paused means the page stopped asking but the job may still run
  // mode is idle or sending or rejected or limited or tracking or lost
  function pipelineStates(view) {
    const v = view || {};
    const s = Object.fromEntries(PIPELINE.map((name) => [name, 'idle']));
    if (v.mode === 'sending') return { ...s, api: 'active', submit: 'active' };
    if (v.mode === 'limited') return { ...s, api: 'error' };
    if (v.mode === 'rejected') return { ...s, api: 'done', submit: 'error' };
    // lost means results answered but DynamoDB has no item for this ID
    if (v.mode === 'lost') return { ...s, poll: 'done', results: 'done', read: 'error' };
    if (v.mode !== 'tracking') return s;
    // reopened link with no answer yet so only the read path is known
    if (!v.phase) {
      for (const name of READ_PATH) s[name] = v.paused ? 'paused' : 'live';
      return s;
    }
    s.api = 'done';
    s.submit = 'done';
    s.poll = 'live';
    s.results = 'live';
    s.read = 'live';
    const attempt = Number(v.attempt) || 0;
    if (v.phase === 'RUNNING') {
      s.queue = 'done';
      s.worker = 'active';
    } else if (isLastTry(v)) {
      // no new try comes so it is not retrying any more
      s.queue = 'done';
      s.worker = 'hold';
    } else if (v.phase === 'FAILED') {
      s.queue = 'retry';
      s.worker = 'retry';
    } else if (v.phase === 'DONE') {
      s.queue = 'done';
      s.worker = v.verdict === 'INCOMPLETE' ? 'hold' : 'done';
      s.store = 'done';
      s.poll = 'done';
      // report read happens once after DONE
      s.results = v.reportReady ? 'done' : 'active';
      s.read = v.reportReady ? 'done' : 'active';
      // the job has a report but this page could not load it
      if (v.reportReady && v.reportFailed) s.read = 'error';
    } else {
      s.queue = attempt > 0 ? 'retry' : 'active';
      if (attempt > 0) s.worker = 'retry';
    }
    if (v.paused && v.phase !== 'DONE') {
      for (const name of PIPELINE) if (BUSY.has(s[name])) s[name] = 'paused';
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
    const max = maxTries(v);
    if (v.mode === 'sending') return 'Write path: API Gateway passes your code to gk-submit.';
    if (v.mode === 'limited') return 'API Gateway rate limit (429). Nothing was saved. Wait a few seconds.';
    if (v.mode === 'rejected') return 'gk-submit said no, so nothing was queued.';
    if (v.mode === 'lost') return 'Read path: no job has this ID. Pasted code is kept for 1 day.';
    if (v.mode !== 'tracking') return 'Start a scan to light up both paths from the real job phase.';
    if (v.paused && v.phase !== 'DONE') return 'This page stopped asking. The job may still run on AWS. Check again to look.';
    if (!v.phase) return 'Read path: asking gk-results for this job. No phase until the first answer.';
    if (isLastTry(v)) return `Try ${tryOf(attempt, max)} failed. That was the last try, so the job ends as INCOMPLETE.`;
    if (v.phase === 'RUNNING') return `gk-worker is scanning your code (try ${tryOf(Math.max(attempt, 1), max)}). The page keeps polling.`;
    if (v.phase === 'FAILED') return `Try ${tryOf(attempt, max)} failed. The job waits in SQS until the visibility timeout ends, then a worker tries again.`;
    if (v.phase === 'DONE') {
      if (v.verdict === 'INCOMPLETE') return 'Ended INCOMPLETE. Not scanned is not safe, so it counts as blocked.';
      if (v.reportReady && v.reportFailed) return 'Verdict saved in DynamoDB, but this page could not load the report from S3.';
      return v.reportReady ? 'Verdict from DynamoDB, masked report from S3, both read by gk-results. Done.' : 'Verdict saved in DynamoDB. gk-results is reading the report.';
    }
    return attempt > 0 ? `Back in SQS, waiting for try ${attempt + 1} of ${max}.` : 'Job saved in DynamoDB, waiting in SQS. The page polls gk-results.';
  }

  // chip text and tone for the current job
  function phaseChip(view) {
    const v = view || {};
    if (v.mode === 'sending') return { label: 'Sending', tone: 'run' };
    if (v.mode === 'limited') return { label: 'Rate limited', tone: 'hold' };
    if (v.mode === 'rejected') return { label: 'Not sent', tone: 'stop' };
    if (v.mode === 'lost') return { label: 'Not found', tone: 'hold' };
    if (v.mode !== 'tracking') return { label: 'Idle', tone: 'idle' };
    if (v.paused && v.phase !== 'DONE') return { label: 'Paused', tone: 'idle' };
    // no answer yet so say Checking and never a made up Queued
    if (!v.phase) return { label: 'Checking', tone: 'run' };
    if (v.phase === 'RUNNING') return { label: 'Scanning', tone: 'run' };
    if (isLastTry(v)) return { label: 'Last try', tone: 'hold' };
    if (v.phase === 'FAILED') return { label: 'Retrying', tone: 'hold' };
    if (v.phase === 'DONE') {
      const info = verdictInfo(v.verdict);
      return { label: info.label, tone: info.tone };
    }
    return (Number(v.attempt) || 0) > 0 ? { label: 'Retrying', tone: 'hold' } : { label: 'Queued', tone: 'run' };
  }

  // Scan Activity has 4 steps
  const STEPS = Object.freeze(['received', 'queued', 'scanning', 'report']);

  function lifecycle(view) {
    const v = view || {};
    const s = { received: 'todo', queued: 'todo', scanning: 'todo', report: 'todo' };
    if (v.mode !== 'tracking') return s;
    // no answer yet so every step stays todo
    if (!v.phase) return s;
    s.received = 'done';
    const attempt = Number(v.attempt) || 0;
    if (v.phase === 'RUNNING') {
      s.queued = 'done';
      s.scanning = 'active';
    } else if (isLastTry(v)) {
      s.queued = 'done';
      s.scanning = 'hold';
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
    if (v.paused && v.phase !== 'DONE') {
      for (const name of STEPS) if (BUSY.has(s[name])) s[name] = 'paused';
    }
    return s;
  }

  // how much the 3 counts can say
  // none means show dashes and never a fake 0
  // INCOMPLETE and no report means nothing checked
  // INCOMPLETE with a report means some files
  // unloaded means it was scanned but the report did not load here
  function countsState(status, hasReport) {
    const s = status || {};
    const jobCounts = Boolean(s.counts && typeof s.counts === 'object');
    if (s.verdict === 'INCOMPLETE') {
      if (hasReport) return 'partial';
      // no saved report means nothing was checked so never show a 0
      if (!s.hasReport) return 'none';
      // saved but not loaded here so the job counts still tell the truth
      return jobCounts ? 'partial' : 'unloaded';
    }
    if (hasReport || jobCounts) return 'full';
    // only a real PASS or FAIL was scanned
    return s.verdict === 'PASS' || s.verdict === 'FAIL' ? 'unloaded' : 'none';
  }

  // the findings number color
  // red when any HIGH and green only for PASS
  // INCOMPLETE skipped some files so it is never green
  function findingsTone(verdict, counts) {
    if (counts && Number(counts.high) > 0) return 'stop';
    return verdict === 'PASS' ? 'pass' : 'hold';
  }

  // what the report says when it has no findings
  // INCOMPLETE skipped some files so never say nothing to fix
  function noFindingsText(verdict) {
    return verdict === 'INCOMPLETE'
      ? 'No problems in the files that were scanned. Some files were not checked.'
      : 'Nothing to fix. The scanner found no problems.';
  }

  // the server keeps the first 500 findings
  // say so when some were cut
  function cappedNote(loaded, counts) {
    if (!counts) return '';
    const total = (Number(counts.high) || 0) + (Number(counts.medium) || 0) + (Number(counts.low) || 0);
    const n = Number(loaded) || 0;
    return total > n ? `Showing the first ${n} of ${total} findings. The counts above are the full totals.` : '';
  }

  // words when the report did not load
  // saved but not loaded is not the same as never saved
  // code is the http code of the report GET and 0 means no answer
  function reportMissingText(status, code) {
    const s = status || {};
    if (!s.hasReport) {
      return s.verdict === 'INCOMPLETE'
        ? 'No report was saved for this scan. Scan the code again to get one.'
        : 'This scan has no saved report. Scan the code again to get one.';
    }
    if (code === 404) return 'This report has expired. Pasted code is kept for 1 day, so scan it again.';
    return 'The full report could not be loaded. Click Load report again, or open the link later.';
  }

  // status line when a scan ends
  // code is the http code of the report GET
  function finishLine(status, loaded, code) {
    if (loaded) return 'Scan finished. The report is ready below.';
    const s = status || {};
    if (s.hasReport) return code === 404 ? 'Scan finished. The report has expired.' : 'Scan finished. The full report could not be loaded.';
    return s.verdict === 'INCOMPLETE' ? 'Scan finished as INCOMPLETE. No report was saved.' : 'Scan finished. No report was saved.';
  }

  // undo only makes sense when real code would be lost
  function undoNeeded(oldText, newText) {
    return String(oldText || '').trim() !== '' && String(oldText) !== String(newText || '');
  }

  // one skipped file as text
  // the worker can give a plain name or an object with path and reason
  function skippedText(file) {
    if (typeof file === 'string') return file;
    if (!file || typeof file !== 'object') return '';
    const path = typeof file.path === 'string' && file.path ? file.path : 'a file';
    const reason = String(file.reason || '').replace(/_/g, ' ').trim();
    return reason ? `${path}: ${reason}` : path;
  }

  // the counts to show
  // job record first then the report counts then a count of the findings
  function pickCounts(status, report) {
    const isCounts = (c) => Boolean(c && typeof c === 'object');
    if (isCounts(status && status.counts)) return status.counts;
    if (isCounts(report && report.counts)) return report.counts;
    if (report && Array.isArray(report.findings)) return countBySeverity(report.findings);
    return { high: 0, medium: 0, low: 0 };
  }

  // words for one PR row and the latest PR card
  // a job in the queue is waiting so it never says scanning
  function listChip(item) {
    const v = item || {};
    if (v.phase === 'DONE') {
      const info = verdictInfo(v.verdict);
      return { label: info.label, tone: info.tone };
    }
    if (v.phase === 'QUEUED') return { label: 'QUEUED', tone: 'run' };
    if (v.phase === 'RUNNING') return { label: 'SCANNING', tone: 'run' };
    if (v.phase === 'FAILED') return { label: 'RETRYING', tone: 'hold' };
    return { label: 'CHECKING', tone: 'idle' };
  }

  // what a PR row says when it has no counts to show
  // empty means show the count pills
  function listCountsWord(item) {
    const v = item || {};
    if (v.counts && typeof v.counts === 'object') return '';
    if (v.phase !== 'DONE') return 'not yet';
    return v.verdict === 'INCOMPLETE' ? 'not checked' : 'no counts';
  }

  // a real status answer always has a phase word
  function isStatusBody(body) {
    return Boolean(body) && typeof body === 'object' && !Array.isArray(body)
      && typeof body.phase === 'string' && body.phase !== '';
  }

  // words for a job link that is not a scan id
  // no job in the link means nothing to say
  function linkProblem(value) {
    if (value === null || value === undefined || value === '') return null;
    if (isJobId(value)) return null;
    return 'This is not a GateKeeper scan link. Paste code above to start a new scan.';
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
    SCAN_GAP_MS,
    scanWaitMs,
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
    scanFacts,
    scanLogOpen,
    clockTime,
    envLabel,
    isLocalHost,
    statusSummary,
    splitLogText,
    safeFilename,
    fileProblem,
    latencyText,
    pollProblem,
    normSeverity,
    stopNote,
    queueHint,
    pipelineStates,
    nodeLabel,
    pipelineCaption,
    phaseChip,
    lifecycle,
    countsState,
    findingsTone,
    noFindingsText,
    cappedNote,
    reportMissingText,
    finishLine,
    undoNeeded,
    isLastTry,
    maxTries,
    tryOf,
    skippedText,
    pickCounts,
    listChip,
    listCountsWord,
    isStatusBody,
    linkProblem,
  });
})(globalThis);
