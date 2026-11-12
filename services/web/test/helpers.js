// Shared helpers for the tests. node --test also runs this file, and it simply has no tests.
export function idSequence() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

export function captureLog() {
  const lines = [];
  const log = (stage, fields = {}) => {
    lines.push({ stage, ...fields });
  };
  return { log, lines };
}

export function postRequest({ accessCode = 'demo-1234', body = { code: 'const x = 1;\n' }, contentType = 'application/json' } = {}) {
  const headers = { 'content-type': contentType };
  if (accessCode !== null) headers['x-demo-code'] = accessCode;
  return {
    routeKey: 'POST /scans',
    headers,
    params: {},
    query: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
