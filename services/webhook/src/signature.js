import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(rawBody, signature, secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret is not configured');
  }

  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('rawBody must be a Buffer');
  }

  if (
    typeof signature !== 'string' ||
    !/^sha256=[0-9a-fA-F]{64}$/.test(signature)
  ) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest();

  const received = Buffer.from(signature.slice(7), 'hex');

  return timingSafeEqual(expected, received);
}
