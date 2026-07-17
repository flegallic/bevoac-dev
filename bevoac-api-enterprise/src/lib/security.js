const crypto = require('crypto');
function hashApiKey(rawKey) {
  const normalized = String(rawKey || '').replace(/^Bearer\s+/i, '').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
function generateApiKey() { return `biv_live_${crypto.randomBytes(32).toString('hex')}`; }
function secureCompare(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
module.exports = { hashApiKey, generateApiKey, secureCompare };
