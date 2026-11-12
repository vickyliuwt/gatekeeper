// Response helpers. Every reply carries safe headers (README.md, "API").
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

export function json(statusCode, body) {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

// The common error body: { error, message, traceId }. Never a stack trace.
export function fail(statusCode, error, message, traceId) {
  const body = { error, message };
  if (traceId) body.traceId = traceId;
  return json(statusCode, body);
}

export function html(statusCode, body, contentSecurityPolicy) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy': contentSecurityPolicy,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      // Modern browsers ignore X-XSS-Protection (the CSP above is the real defense), but the
      // course pentest tool (pentest/backend/tester.js) expects exactly this value.
      'x-xss-protection': '1; mode=block',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    },
    body,
  };
}
