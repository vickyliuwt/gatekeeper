// local server for my laptop, no AWS needed
// real page + real submit/results code. DynamoDB, S3, SQS + worker are in memory
//   cd services/web
//   npm run dev   then open http://127.0.0.1:9300 (access code demo-1234)
// test words to put in the pasted code:
//   SIMULATE_RETRY       try 1 fails, try 2 passes (the page shows "try 2 of 5")
//   SIMULATE_SLOW        stays RUNNING 3 min, so the page stops polling at 2 min
//   SIMULATE_INCOMPLETE  ends INCOMPLETE with no report
//   SIMULATE_503         POST /scans answers 503 queue_unavailable
import express from 'express';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from './log.js';
import { maskReport } from './mask.js';
import { createMemoryBlobs, createMemoryQueue, createMemoryStore } from './memory.js';
import { loadPage } from './page.js';
import { createResults, resultsRoutes } from './results.js';
import { createSubmit } from './submit.js';
// true when node started this file
// windows may give the same path in other letter case,
// so compare real paths (ignore case), then file names
function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const self = fileURLToPath(metaUrl);
  try {
    if (same(realpathSync(self), realpathSync(process.argv[1]))) return true;
  } catch { /* fall through to the file-name check */ }
  return same(basename(self), basename(process.argv[1]));
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCANNER_PATH = join(REPO_ROOT, 'sast', 'backend', 'scanner.js');
const FIXTURES_DIR = join(HERE, '..', 'test', 'fixtures');
const RISKY_WORDS = /password|secret|api[_-]?key|token/i;

// use the real course scanner if the repo has it, so local reports look real
async function loadScanner() {
  if (!existsSync(SCANNER_PATH)) return null;
  try {
    const scanner = await import(pathToFileURL(SCANNER_PATH).href);
    return typeof scanner.scanCode === 'function' ? scanner.scanCode : null;
  } catch {
    return null;
  }
}

function fallbackScan(code, filename) {
  return code.split('\n').flatMap((text, index) => (RISKY_WORDS.test(text) && /['"]/.test(text)
    ? [{
      id: 'HARDCODED_SECRET',
      name: 'Hardcoded Secret',
      severity: 'HIGH',
      description: 'Possible hardcoded secret (local fallback rule)',
      message: 'Hardcoded secret detected. Move secrets to environment variables.',
      file: filename,
      line: index + 1,
      column: 1,
      evidence: text.trim().slice(0, 100),
    }]
    : []));
}

function countBySeverity(findings) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    const key = String(finding.severity).toLowerCase();
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

function readFixture(name) {
  const path = join(FIXTURES_DIR, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// 3 done PR scans (2 FAIL, 1 PASS) so the recent list is not empty
async function seedPrScans({ store, blobs, allowedRepo }) {
  const base = readFixture('report.pr.example.json') ?? { findings: [], scannedFiles: [], skippedFiles: [] };
  for (let i = 0; i < 3; i += 1) {
    const headSha = randomBytes(20).toString('hex');
    const jobId = `pr-7812-${headSha}`;
    const findings = i === 1 ? base.findings.filter((f) => f.severity !== 'HIGH') : base.findings;
    const counts = countBySeverity(findings);
    const verdict = counts.high > 0 ? 'FAIL' : 'PASS';
    const createdAt = new Date(Date.now() - (i + 1) * 7 * 60 * 1000).toISOString();
    const reportKey = `reports/${jobId}.json`;
    const report = { ...base, jobId, repo: allowedRepo, prNumber: 12 + i, headSha, verdict, counts, findings, scannedAt: createdAt };
    await blobs.put(reportKey, JSON.stringify(report), 'application/json');
    await store.put({
      jobId,
      source: 'pr',
      repo: allowedRepo,
      prNumber: 12 + i,
      headSha,
      phase: 'DONE',
      verdict,
      counts,
      attempt: 1,
      reportKey,
      traceId: randomUUID(),
      createdAt,
      updatedAt: createdAt,
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
  }
}

// fake worker in memory (plays Part B): QUEUED -> RUNNING -> DONE
function startLocalWorker({ store, blobs, queue, scanCode, speed, log }) {
  let stopped = false;
  const wait = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms / speed).unref();
  });
  const now = () => new Date().toISOString();

  async function run({ jobId, traceId }) {
    const job = await store.get(jobId);
    if (!job || job.phase === 'DONE') return;
    const code = (await blobs.getText(job.pastedKey)) ?? '';

    await wait(800);
    const claimed = await store.update(jobId, { phase: 'RUNNING', attempt: job.attempt + 1, leaseOwner: 'local-worker', updatedAt: now() });
    log('claimed', { jobId, traceId, msg: `try ${claimed.attempt}` });

    await wait(code.includes('SIMULATE_SLOW') ? 180000 : 1700);
    if (stopped) return;

    if (code.includes('SIMULATE_RETRY') && claimed.attempt === 1) {
      await store.update(jobId, { phase: 'FAILED', lastError: 'LOCAL_RETRY first try fails on purpose', updatedAt: now() });
      log('retry', { jobId, traceId, msg: 'try 1 failed on purpose; the message comes back soon' });
      wait(8000).then(() => queue.messages.push({ jobId, traceId }));
      return;
    }
    if (code.includes('SIMULATE_INCOMPLETE')) {
      await store.update(jobId, {
        phase: 'DONE', verdict: 'INCOMPLETE', counts: { high: 0, medium: 0, low: 0 }, lastError: 'LOCAL_INCOMPLETE on purpose', updatedAt: now(),
      });
      log('final_error', { jobId, traceId, msg: 'INCOMPLETE on purpose' });
      return;
    }

    const findings = scanCode ? scanCode(code, job.filename) : fallbackScan(code, job.filename);
    const counts = countBySeverity(findings);
    const report = maskReport({
      jobId,
      source: 'paste',
      scannerVersion: scanCode ? 'course scanner (local run)' : 'local fallback rule',
      scannedAt: now(),
      verdict: counts.high > 0 ? 'FAIL' : 'PASS',
      counts,
      scannedFiles: [job.filename],
      skippedFiles: [],
      findings,
    });
    const reportKey = `reports/${jobId}.json`;
    await blobs.put(reportKey, JSON.stringify(report), 'application/json');
    await store.update(jobId, { phase: 'DONE', verdict: report.verdict, counts, reportKey, updatedAt: now() });
    log('done', { jobId, traceId, msg: report.verdict });
  }

  const tick = setInterval(() => {
    for (let message = queue.take(); message; message = queue.take()) {
      run(message).catch((error) => log('error', { level: 'error', msg: 'local_worker_failed', errorType: error?.name }));
    }
  }, 200);
  tick.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(tick);
    },
  };
}

// like the API Gateway limit on POST /scans: burst 5, then 1 per second
function createRateLimiter({ burst, perSecond }) {
  let tokens = burst;
  let last = Date.now();
  return function limit(req, res, next) {
    const current = Date.now();
    tokens = Math.min(burst, tokens + ((current - last) / 1000) * perSecond);
    last = current;
    if (tokens < 1) {
      res.status(429).type('application/json').send(JSON.stringify({ message: 'Too Many Requests' }));
      return;
    }
    tokens -= 1;
    next();
  };
}

export async function createLocalApp({
  accessCode = 'demo-1234',
  allowedRepo = 'vickyliuwt/gatekeeper-demo',
  speed = 1,
  quiet = false,
  routeLimits = false,
} = {}) {
  const write = quiet ? () => {} : (line) => process.stdout.write(`${line}\n`);
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  const queue = createMemoryQueue({
    async beforeSend({ jobId }) {
      const job = await store.get(jobId);
      const code = job ? await blobs.getText(job.pastedKey) : '';
      if (code && code.includes('SIMULATE_503')) {
        const error = new Error('Simulated queue outage');
        error.name = 'SimulatedQueueError';
        throw error;
      }
    },
  });

  const submit = createSubmit({ getAccessCode: async () => accessCode, blobs, store, queue, log: createLogger('submit', write) });
  const results = createResults({ store, blobs, allowedRepo, page: loadPage(), log: createLogger('results', write) });
  const routes = resultsRoutes(results);
  await seedPrScans({ store, blobs, allowedRepo });
  const scanCode = await loadScanner();
  const worker = startLocalWorker({ store, blobs, queue, scanCode, speed, log: createLogger('local-worker', write) });

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const run = (routeKey, handler) => async (req, res, next) => {
    try {
      const response = await handler({
        routeKey,
        method: req.method,
        path: req.path,
        headers: req.headers,
        query: req.query,
        params: req.params,
        body: typeof req.body === 'string' ? req.body : '',
        requestId: randomUUID(),
      });
      res.status(response.statusCode).set(response.headers).send(response.body);
    } catch (error) {
      next(error);
    }
  };

  // same per-route limits as API Gateway. off in unit tests, on for npm run dev
  const limit = (burst, perSecond) => (routeLimits ? createRateLimiter({ burst, perSecond }) : (req, res, next) => next());
  app.get('/', limit(10, 5), run('GET /', routes['GET /']));
  app.post('/scans', createRateLimiter({ burst: 5, perSecond: 1 }), express.text({ type: () => true, limit: '1mb' }), run('POST /scans', submit));
  app.get('/scans', limit(10, 5), run('GET /scans', routes['GET /scans']));
  app.get('/scans/:jobId', limit(20, 10), run('GET /scans/{jobId}', routes['GET /scans/{jobId}']));
  app.get('/scans/:jobId/report', limit(10, 5), run('GET /scans/{jobId}/report', routes['GET /scans/{jobId}/report']));
  app.use((req, res) => {
    res.status(404).type('application/json').send(JSON.stringify({ message: 'Not Found' }));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') {
      return res.status(413).type('application/json').send(JSON.stringify({ error: 'too_large', message: 'Pasted code must be 100 KB or less.' }));
    }
    write(JSON.stringify({ svc: 'local', stage: 'error', msg: String(error?.message ?? error) }));
    return res.status(500).type('application/json').send(JSON.stringify({ error: 'internal_error', message: 'Local server error.' }));
  });

  return { app, store, blobs, queue, scannerLoaded: Boolean(scanCode), stop: () => worker.stop() };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 9300);
  const accessCode = process.env.LOCAL_ACCESS_CODE || 'demo-1234';
  const { app, scannerLoaded } = await createLocalApp({ accessCode, routeLimits: true });
  app.listen(port, '127.0.0.1', () => {
    process.stdout.write(`GateKeeper local page: http://127.0.0.1:${port}  (access code ${accessCode}, ${scannerLoaded ? 'course scanner' : 'fallback rule'})\n`);
  });
}
