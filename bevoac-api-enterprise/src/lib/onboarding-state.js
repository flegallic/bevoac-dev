const crypto = require('crypto');
const { ValidationError } = require('./errors');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function signBase64Url(secret, encodedPayload) {
  return crypto.createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

function assertSecret(secret) {
  if (!secret || String(secret).trim().length < 32) {
    throw new ValidationError('ONBOARDING_STATE_SECRET must contain at least 32 characters.');
  }
}

function createSignedState(secret, payload) {
  assertSecret(secret);
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signBase64Url(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySignedState(secret, state) {
  assertSecret(secret);
  const raw = String(state || '').trim();
  if (!raw || raw.length > 4096 || !raw.includes('.')) {
    throw new ValidationError('Invalid onboarding state.');
  }
  const [encodedPayload, signature] = raw.split('.');
  if (!encodedPayload || !signature) throw new ValidationError('Invalid onboarding state.');

  const expected = signBase64Url(secret, encodedPayload);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new ValidationError('Invalid onboarding state signature.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (_) {
    throw new ValidationError('Invalid onboarding state payload.');
  }

  if (!payload || typeof payload !== 'object') throw new ValidationError('Invalid onboarding state payload.');
  if (!payload.sid || !payload.tid || !payload.exp || !payload.nonce) throw new ValidationError('Incomplete onboarding state payload.');
  if (Date.now() > Number(payload.exp)) throw new ValidationError('Expired onboarding state.');
  return payload;
}

module.exports = {
  sha256,
  createSignedState,
  verifySignedState
};
