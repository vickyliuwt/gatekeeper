// gk-submit: POST /scans (README.md, "API"). Saves pasted code and queues one paste job.
// Order of work: check the access code, check the input, save code to S3, create the job, queue it.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, json } from './http.js';
import { MAX_BODY_BYTES, MAX_CODE_BYTES, byteLength, normalizeFilename } from './validate.js';

const PASTE_TTL_SECONDS = 24 * 60 * 60;

function digest(text) {
  return createHash('sha256').update(String(text), 'utf8').digest();
}

// Compares in constant time. Both sides are hashed first, so the lengths always match.
export function accessCodeMatches(given, expected) {
  if (typeof expected !== 'string' || expected.length === 0) {
    throw new Error('The access code is not configured');
  }
  if (typeof given !== 'string' || given.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function createSubmit({
  getAccessCode,
  blobs,
  store,
  queue,
  log,
  clock = () => new Date(),
  newId = randomUUID,
}) {
  if (typeof getAccessCode !== 'function' || !blobs || !store || !queue || typeof log !== 'function') {
    throw new TypeError('createSubmit needs getAccessCode, blobs, store, queue and log');
  }

  return async function submit(request) {
    const traceId = newId();
    const headers = request.headers ?? {};
    const rawBody = typeof request.body === 'string' ? request.body : '';

    log('received', { traceId, bytes: byteLength(rawBody) });

    if (!accessCodeMatches(headers['x-demo-code'], await getAccessCode())) {
      log('rejected', { traceId, reason: 'bad_demo_code' });
      return fail(401, 'bad_demo_code', 'The access code is missing or wrong.', traceId);
    }

    const contentType = String(headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return fail(415, 'unsupported_media_type', 'Send the body as application/json.', traceId);
    }
    if (byteLength(rawBody) > MAX_BODY_BYTES) {
      return fail(413, 'too_large', 'Pasted code must be 100 KB or less.', traceId);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return fail(400, 'invalid_json', 'The body is not valid JSON.', traceId);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail(400, 'invalid_json', 'The body must be a JSON object.', traceId);
    }

    const { code } = payload;
    if (typeof code !== 'string' || code.trim() === '') {
      return fail(400, 'missing_code', 'Paste some code to scan.', traceId);
    }
    if (byteLength(code) > MAX_CODE_BYTES) {
      return fail(413, 'too_large', 'Pasted code must be 100 KB or less.', traceId);
    }

    const filename = normalizeFilename(payload.filename);
    if (filename === null) {
      return fail(
        400,
        'bad_filename',
        'Use a file name like app.js: letters, digits, dot, dash or underscore, ending in .js, .mjs or .cjs.',
        traceId,
      );
    }

    const now = clock();
    const jobId = `paste-${newId()}`;
    const pastedKey = `pasted/${jobId}.js`;
    const timestamp = now.toISOString();
    const job = {
      jobId,
      source: 'paste',
      filename,
      pastedKey,
      phase: 'QUEUED',
      attempt: 0,
      traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: Math.floor(now.getTime() / 1000) + PASTE_TTL_SECONDS,
    };
    const context = { jobId, traceId };

    try {
      await blobs.put(pastedKey, code, 'text/plain; charset=utf-8');
      await store.create(job);
      log('job_created', context);
    } catch (error) {
      log('error', { ...context, level: 'error', msg: 'save_failed', errorType: error?.name ?? 'Error' });
      return fail(503, 'storage_unavailable', 'The code could not be saved. Try again in a moment.', traceId);
    }

    try {
      await queue.send({ jobId, traceId });
    } catch (error) {
      log('error', { ...context, level: 'error', msg: 'enqueue_failed', errorType: error?.name ?? 'Error' });
      return fail(503, 'queue_unavailable', 'The scan queue is busy. Try again in a moment.', traceId);
    }

    log('enqueued', context);
    return json(202, { jobId, traceId, statusUrl: `/scans/${jobId}` });
  };
}
