function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function createGatewayHandler(intake) {
  return async function handler(event) {
    if (event.routeKey !== 'POST /webhooks/github') {
      return jsonResponse(404, { error: 'not_found' });
    }

    if (typeof event.body !== 'string') {
      return jsonResponse(400, { error: 'missing_body' });
    }

    const headers = event.headers ?? {};
    const rawBody = Buffer.from(
      event.body,
      event.isBase64Encoded ? 'base64' : 'utf8',
    );

    const result = await intake({
      rawBody,
      signature: headers['x-hub-signature-256'],
      eventName: headers['x-github-event'],
      traceId: headers['x-github-delivery'],
    });

    return jsonResponse(result.statusCode, result.body);
  };
}
