import { verifySignature } from './signature.js';
import { classifyEvent } from './event.js';
import { buildPrJob } from './job.js';

export function createIntake({
  secret,
  allowedRepo,
  createJobIfAbsent,
  enqueue,
  clock = () => new Date(),
}) {
  // Check configuration before accepting requests.
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret is not configured');
  }
  classifyEvent('configuration-check', {}, allowedRepo);

  if (
    typeof createJobIfAbsent !== 'function' ||
    typeof enqueue !== 'function'
  ) {
    throw new TypeError('Storage and queue functions are required');
  }

  return async function intake({ rawBody, signature, eventName, traceId }) {
    if (!verifySignature(rawBody, signature, secret)) {
      return { statusCode: 401, body: { error: 'invalid_signature' } };
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { statusCode: 400, body: { error: 'invalid_json' } };
    }

    const decision = classifyEvent(eventName, payload, allowedRepo);

    if (decision.kind === 'ping') {
      return { statusCode: 200, body: { message: 'pong' } };
    }

    if (decision.kind === 'ignored') {
      return {
        statusCode: 200,
        body: { message: 'ignored', reason: decision.reason },
      };
    }

    if (decision.kind === 'forbidden' || decision.kind === 'invalid') {
      return {
        statusCode: decision.kind === 'forbidden' ? 403 : 400,
        body: { error: decision.reason },
      };
    }

    // A clock failure is a server error, not an invalid client payload.
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('Invalid server clock');
    }

    let job;
    try {
      job = buildPrJob(payload, traceId, now);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return { statusCode: 400, body: { error: 'invalid_pr_payload' } };
    }

    try {
      await createJobIfAbsent(job);
      await enqueue({ jobId: job.jobId, traceId: job.traceId });
    } catch {
      return {
        statusCode: 503,
        body: { error: 'intake_unavailable', jobId: job.jobId },
      };
    }

    return { statusCode: 202, body: { jobId: job.jobId } };
  };
}
