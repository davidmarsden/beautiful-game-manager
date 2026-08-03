import { createHmac, timingSafeEqual } from 'node:crypto';

const PURPOSE = 'scheduled-world-turn-background';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const text = (value) => String(value || '').trim();

function signatureFor(secret, timestamp) {
  return createHmac('sha256', secret)
    .update(`${PURPOSE}:${timestamp}`)
    .digest('hex');
}

export function createInternalSchedulerHeaders(secret, now = Date.now()) {
  const key = text(secret);
  if (!key) throw new Error('Internal scheduler authentication requires a secret');
  const timestamp = String(Number(now));
  return {
    'x-tbg-scheduler-timestamp': timestamp,
    'x-tbg-scheduler-signature': signatureFor(key, timestamp)
  };
}

export function verifyInternalSchedulerRequest(request, secret, now = Date.now()) {
  const key = text(secret);
  if (!key || !request) return false;

  const timestamp = text(request.headers.get('x-tbg-scheduler-timestamp'));
  const supplied = text(request.headers.get('x-tbg-scheduler-signature'));
  const timestampNumber = Number(timestamp);
  if (!timestamp || !supplied || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Number(now) - timestampNumber) > MAX_CLOCK_SKEW_MS) return false;

  const expected = signatureFor(key, timestamp);
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}
