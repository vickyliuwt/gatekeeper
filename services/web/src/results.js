// results lambda has 4 GET routes
// the page and the list and one job and one report
// read only with no secret and no writes
// so the open routes can not change anything
import { fail, html, json } from './http.js';
import { isJobId } from './validate.js';
import { maskReport } from './mask.js';

export const MAX_ATTEMPTS = 5;
const RECENT_LIMIT = 20;

// the small object the page polls
// verdict and counts stay null until DONE
// the worker could say success or failure like GitHub does
// the page only knows PASS FAIL INCOMPLETE so we map the words here
// a word we do not know counts as INCOMPLETE because not scanned is not safe
const VERDICT_WORDS = { pass: 'PASS', success: 'PASS', fail: 'FAIL', failure: 'FAIL', incomplete: 'INCOMPLETE', error: 'INCOMPLETE' };

export function normVerdict(verdict) {
  if (verdict === null || verdict === undefined || verdict === '') return null;
  return VERDICT_WORDS[String(verdict).toLowerCase()] ?? 'INCOMPLETE';
}

// a DONE job with no verdict is not a pass
// not scanned is not safe so it says INCOMPLETE
export function doneVerdict(verdict) {
  return normVerdict(verdict) ?? 'INCOMPLETE';
}

// counts can come as HIGH or high so we read both
export function normCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const read = (key) => {
    const n = Number(counts[key] ?? counts[key.toUpperCase()]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return { high: read('high'), medium: read('medium'), low: read('low') };
}

// the real worker leaves a job FAILED after the last try
// then SQS moves the message to the dead letter queue so no new try comes
// the worker never writes INCOMPLETE by itself
// so this lambda shows the job as DONE and INCOMPLETE like our job rules say
// storedPhase keeps what the job item really says
// no update for 20 min also counts as stopped
// one try waits at most 360 s in SQS so 20 min is more than 3 waits
export const STOP_AFTER_MS = 20 * 60 * 1000;
// list rows have no attempt or updatedAt in the index
// 5 tries end in about 30 min so the list waits 45 min after createdAt
export const LIST_STOP_AFTER_MS = 45 * 60 * 1000;

export function stopReason(job, nowMs = Date.now()) {
  if (!job || (job.phase !== 'FAILED' && job.phase !== 'RUNNING')) return null;
  if (job.phase === 'FAILED' && Number(job.attempt ?? 0) >= MAX_ATTEMPTS) return 'last_try';
  const at = Date.parse(job.updatedAt ?? job.createdAt ?? '');
  return Number.isFinite(at) && nowMs - at >= STOP_AFTER_MS ? 'no_update' : null;
}

export function listStop(item, nowMs = Date.now()) {
  if (!item || (item.phase !== 'FAILED' && item.phase !== 'RUNNING')) return null;
  const at = Date.parse(item.createdAt ?? '');
  return Number.isFinite(at) && nowMs - at >= LIST_STOP_AFTER_MS ? 'no_update' : null;
}

export function toStatus(job, nowMs = Date.now()) {
  const stopped = stopReason(job, nowMs);
  const done = job.phase === 'DONE' || stopped !== null;
  const status = {
    jobId: job.jobId,
    source: job.source,
    phase: done ? 'DONE' : job.phase,
    verdict: stopped ? 'INCOMPLETE' : (done ? doneVerdict(job.verdict) : null),
    counts: done && !stopped ? normCounts(job.counts) : null,
    attempt: job.attempt ?? 0,
    maxAttempts: MAX_ATTEMPTS,
    hasReport: done && !stopped && typeof job.reportKey === 'string',
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
  };
  if (stopped) {
    status.stopped = stopped;
    status.storedPhase = job.phase;
  }
  if (job.source === 'pr') {
    status.repo = job.repo ?? null;
    status.prNumber = job.prNumber ?? null;
    status.headSha = job.headSha ?? null;
  } else {
    status.filename = job.filename ?? null;
  }
  return status;
}

export function toListItem(item, nowMs = Date.now()) {
  const stopped = listStop(item, nowMs);
  const row = {
    jobId: item.jobId,
    repo: item.repo,
    prNumber: item.prNumber ?? null,
    headSha: item.headSha ?? null,
    phase: stopped ? 'DONE' : (item.phase ?? null),
    verdict: stopped ? 'INCOMPLETE' : (item.phase === 'DONE' ? doneVerdict(item.verdict) : normVerdict(item.verdict)),
    counts: stopped ? null : normCounts(item.counts),
    createdAt: item.createdAt ?? null,
  };
  if (stopped) row.stopped = stopped;
  return row;
}

// clock is only for tests
export function createResults({ store, blobs, allowedRepo, page, log, clock = () => Date.now() }) {
  if (!store || !blobs || !page || typeof log !== 'function') {
    throw new TypeError('createResults needs store, blobs, page and log');
  }

  async function showPage() {
    return html(200, page.html, page.csp);
  }

  async function listRecent() {
    const items = allowedRepo ? await store.listRecent(allowedRepo, RECENT_LIMIT) : [];
    log('read', { route: 'list', count: items.length });
    const now = clock();
    return json(200, { items: items.map((item) => toListItem(item, now)) });
  }

  async function readJob(request, route) {
    const jobId = request.params?.jobId;
    if (!isJobId(jobId)) {
      log('not_found', { route, reason: 'bad_id' });
      return { response: fail(404, 'not_found', 'No scan has this id.') };
    }
    const job = await store.get(jobId);
    if (!job) {
      log('not_found', { jobId, route });
      return { response: fail(404, 'not_found', 'No scan has this id. Pasted code is kept for one day.') };
    }
    return { job };
  }

  async function getStatus(request) {
    const { job, response } = await readJob(request, 'status');
    if (response) return response;
    log('read', { jobId: job.jobId, traceId: job.traceId, route: 'status', phase: job.phase });
    return json(200, toStatus(job, clock()));
  }

  async function getReport(request) {
    const { job, response } = await readJob(request, 'report');
    if (response) return response;
    const context = { jobId: job.jobId, traceId: job.traceId, route: 'report' };

    if (stopReason(job, clock())) {
      log('not_found', { ...context, reason: 'stopped' });
      return fail(404, 'not_found', 'This scan stopped before a report was saved.', job.traceId);
    }
    if (job.phase !== 'DONE') {
      return json(409, {
        error: 'not_ready',
        message: 'The scan is not finished yet.',
        phase: job.phase,
        traceId: job.traceId,
      });
    }
    if (typeof job.reportKey !== 'string') {
      log('not_found', { ...context, reason: 'no_report' });
      return fail(404, 'not_found', 'This scan ended without a report.', job.traceId);
    }

    const text = await blobs.getText(job.reportKey);
    if (text === null) {
      log('not_found', { ...context, reason: 'report_expired' });
      return fail(404, 'not_found', 'This report has expired.', job.traceId);
    }

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      log('error', { ...context, level: 'error', msg: 'bad_report_json' });
      return fail(500, 'bad_report', 'The saved report could not be read.', job.traceId);
    }

    log('read', context);
    const masked = maskReport(report);
    if ('verdict' in masked) masked.verdict = normVerdict(masked.verdict);
    if ('counts' in masked) masked.counts = normCounts(masked.counts);
    return json(200, masked);
  }

  return { showPage, listRecent, getStatus, getReport };
}

export function resultsRoutes(results) {
  return {
    'GET /': results.showPage,
    'GET /scans': results.listRecent,
    'GET /scans/{jobId}': results.getStatus,
    'GET /scans/{jobId}/report': results.getReport,
  };
}
