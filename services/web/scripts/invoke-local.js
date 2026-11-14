// local container test: sends sample API Gateway events to the web image
//   9003 = gk-results, 9004 = gk-submit (emulator uses 8080 inside)
//   repo root:     docker compose --profile web up --build -d
//   services/web:  node scripts/invoke-local.js         no AWS needed
//                  node scripts/invoke-local.js --aws   + the AWS checks
//   repo root:     docker compose --profile web down
// prints status codes only, never a response body
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// true when node started this file (windows: compare real paths, ignore case)
function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const self = fileURLToPath(metaUrl);
  try {
    if (same(realpathSync(self), realpathSync(process.argv[1]))) return true;
  } catch { /* fall through to the file-name check */ }
  return same(basename(self), basename(process.argv[1]));
}

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EVENTS_DIR = join(WEB_DIR, 'test', 'fixtures', 'events');
const INVOKE_PATH = '/2015-03-31/functions/function/invocations';
const WRONG_CODE = 'not-the-real-access-code';

export function loadEvent(name, eventsDir = EVENTS_DIR) {
  return JSON.parse(readFileSync(join(eventsDir, name), 'utf8'));
}

function withRoute(event, routeKey, rawPath, pathParameters) {
  const copy = structuredClone(event);
  copy.routeKey = routeKey;
  copy.rawPath = rawPath;
  copy.requestContext = { ...copy.requestContext, routeKey, http: { ...copy.requestContext?.http, path: rawPath } };
  if (pathParameters) copy.pathParameters = pathParameters;
  else delete copy.pathParameters;
  return copy;
}

function withHeader(event, name, value) {
  const copy = structuredClone(event);
  copy.headers = { ...copy.headers, [name]: value };
  return copy;
}

export function bodyOf(answer) {
  try {
    return JSON.parse(answer?.body ?? '');
  } catch {
    return {};
  }
}

const header = (answer, name) => String(answer?.headers?.[name] ?? '');

export function buildCases({ aws = false, eventsDir = EVENTS_DIR } = {}) {
  const page = loadEvent('apigw-get-page.json', eventsDir);
  const post = withHeader(loadEvent('apigw-post-scans.json', eventsDir), 'x-demo-code', WRONG_CODE);
  const cases = [
    {
      name: 'GET / serves the page with a hash-based CSP',
      target: 'results',
      event: page,
      expect: (a) => a.statusCode === 200 && header(a, 'content-type').startsWith('text/html')
        && header(a, 'content-security-policy').includes("script-src 'sha256-"),
    },
    {
      name: 'an unknown route answers 404',
      target: 'results',
      event: withRoute(page, 'GET /nope', '/nope'),
      expect: (a) => a.statusCode === 404,
    },
    {
      name: 'a bad job id answers 404 before any AWS call',
      target: 'results',
      event: withRoute(page, 'GET /scans/{jobId}', '/scans/not-a-job', { jobId: 'not-a-job' }),
      expect: (a) => a.statusCode === 404 && bodyOf(a).error === 'not_found',
    },
  ];
  if (aws) {
    cases.push(
      {
        name: 'GET /scans reads the jobs table',
        target: 'results',
        event: loadEvent('apigw-get-list.json', eventsDir),
        expect: (a) => a.statusCode === 200 && Array.isArray(bodyOf(a).items),
      },
      {
        name: 'POST /scans with a wrong access code answers 401 (the SSM read works)',
        target: 'submit',
        event: post,
        expect: (a) => a.statusCode === 401 && bodyOf(a).error === 'bad_demo_code',
      },
    );
  } else {
    cases.push({
      name: 'POST /scans answers a JSON error body (500 is normal without AWS keys)',
      target: 'submit',
      event: post,
      expect: (a) => Number.isInteger(a.statusCode) && typeof bodyOf(a).error === 'string',
    });
  }
  return cases;
}

export async function invoke(baseUrl, event, timeoutMs = 30000) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${INVOKE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.json();
}

export async function runChecks({ resultsUrl, submitUrl, aws = false, eventsDir = EVENTS_DIR, print = () => {} }) {
  const urls = { results: resultsUrl, submit: submitUrl };
  const outcomes = [];
  for (const c of buildCases({ aws, eventsDir })) {
    let ok = false;
    let detail;
    try {
      const answer = await invoke(urls[c.target], c.event);
      ok = Boolean(c.expect(answer));
      detail = `status ${answer?.statusCode}`;
    } catch (error) {
      detail = `no answer (${error?.name ?? 'Error'}): is the container running? docker compose --profile web up --build -d`;
    }
    outcomes.push({ name: c.name, target: c.target, ok, detail });
    print(`${ok ? 'PASS' : 'FAIL'}  [${c.target}] ${c.name}  ${detail}`);
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  return { passed: outcomes.length - failed, failed, outcomes };
}

if (isMainModule(import.meta.url)) {
  const { values: opt } = parseArgs({
    options: {
      aws: { type: 'boolean', default: false },
      results: { type: 'string', default: 'http://localhost:9003' },
      submit: { type: 'string', default: 'http://localhost:9004' },
    },
  });
  const summary = await runChecks({ resultsUrl: opt.results, submitUrl: opt.submit, aws: opt.aws, print: console.log });
  console.log(`\ninvoke-local: ${summary.passed} passed, ${summary.failed} failed${opt.aws ? ' (with AWS)' : ' (no AWS)'}`);
  process.exit(summary.failed === 0 ? 0 : 1);
}
