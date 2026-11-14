// API Gateway HTTP API event (payload 2.0) -> plain request -> route
// never sends a stack trace back
import { fail } from './http.js';

export function toRequest(event) {
  const headers = {};
  for (const [name, value] of Object.entries(event?.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  let body = '';
  if (typeof event?.body === 'string') {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  }

  return {
    routeKey: event?.routeKey ?? '',
    method: event?.requestContext?.http?.method ?? '',
    path: event?.rawPath ?? '',
    headers,
    query: event?.queryStringParameters ?? {},
    params: event?.pathParameters ?? {},
    body,
    requestId: event?.requestContext?.requestId ?? '',
  };
}

export function createGatewayHandler(routes, { log }) {
  return async function handler(event) {
    const route = routes[event?.routeKey];
    if (typeof route !== 'function') {
      return fail(404, 'not_found', 'No such route.');
    }
    try {
      return await route(toRequest(event));
    } catch (error) {
      log('error', {
        level: 'error',
        msg: 'unhandled_error',
        route: event.routeKey,
        errorType: error?.name ?? 'Error',
      });
      return fail(500, 'internal_error', 'Something went wrong on our side. Try again.');
    }
  };
}
