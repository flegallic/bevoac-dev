'use strict';

const crypto = require('crypto');
const { ValidationError } = require('./errors');

const STATE_VERSION = 'v2';
const STATE_AAD = Buffer.from('bevoac-onboarding-state-v2', 'utf8');

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex');
}

function assertSecret(secret) {
  if (!secret || String(secret).trim().length < 32) {
    throw new ValidationError(
      'ONBOARDING_STATE_SECRET must contain at least 32 characters.'
    );
  }
}

function deriveEncryptionKey(secret) {
  assertSecret(secret);
  return crypto
    .createHash('sha256')
    .update(String(secret), 'utf8')
    .digest();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid onboarding state payload.');
  }
  if (!payload.sid || !payload.tid || !payload.exp || !payload.nonce) {
    throw new ValidationError('Incomplete onboarding state payload.');
  }
  if (!Number.isFinite(Number(payload.exp))) {
    throw new ValidationError('Invalid onboarding state expiration.');
  }
  if (Date.now() > Number(payload.exp)) {
    throw new ValidationError('Expired onboarding state.');
  }
  return payload;
}

function createSignedState(secret, payload) {
  const key = deriveEncryptionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(STATE_AAD);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    STATE_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url')
  ].join('.');
}

function verifyEncryptedState(secret, raw) {
  const [version, ivPart, ciphertextPart, tagPart, extra] = raw.split('.');
  if (
    version !== STATE_VERSION ||
    !ivPart ||
    !ciphertextPart ||
    !tagPart ||
    extra
  ) {
    throw new ValidationError('Invalid onboarding state.');
  }

  try {
    const key = deriveEncryptionKey(secret);
    const iv = Buffer.from(ivPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');

    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('invalid encrypted state lengths');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(STATE_AAD);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');

    return validatePayload(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid onboarding state.');
  }
}

// Transitional verifier for onboarding sessions created before V6.2.0.
function verifyLegacySignedState(secret, raw) {
  assertSecret(secret);
  const parts = raw.split('.');
  if (parts.length !== 2) {
    throw new ValidationError('Invalid onboarding state.');
  }

  const [encodedPayload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload, 'utf8')
    .digest('base64url');

  const receivedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new ValidationError('Invalid onboarding state signature.');
  }

  try {
    return validatePayload(
      JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      )
    );
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid onboarding state payload.');
  }
}

function verifySignedState(secret, state) {
  const raw = String(state || '').trim();
  if (!raw || raw.length > 4096) {
    throw new ValidationError('Invalid onboarding state.');
  }

  if (raw.startsWith(`${STATE_VERSION}.`)) {
    return verifyEncryptedState(secret, raw);
  }

  return verifyLegacySignedState(secret, raw);
}

module.exports = {
  STATE_VERSION,
  sha256,
  createSignedState,
  verifySignedState,
  verifyEncryptedState,
  verifyLegacySignedState
};
