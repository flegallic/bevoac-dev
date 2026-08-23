'use strict';

const SENSITIVE_KEY = /(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|connection[_-]?string|api[_-]?key|private[_-]?key|sas[_-]?token|signature)/i;
const MAX_DEPTH = 32;
const MAX_STRING_LENGTH = 20000;

function sanitizeUrl(raw) {
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function sanitizeString(value) {
  let output = String(value || '');

  output = output.replace(
    /(authorization|proxy-authorization|bearer|token|secret|password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|sig|signature)\s*[:=]\s*([^\s,;&]+)/gi,
    '$1=[REDACTED]'
  );

  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;]+$/)?.[0] || '';
    const clean = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${sanitizeUrl(clean)}${trailing}`;
  });

  return output.slice(0, MAX_STRING_LENGTH);
}

function sanitizeCustomerResult(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return '[BINARY_REDACTED]';
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH_REACHED]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR_REFERENCE]';
    seen.add(value);
    return value.map((item) => sanitizeCustomerResult(item, {
      depth: depth + 1,
      seen
    }));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR_REFERENCE]';
    seen.add(value);
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      if (key === 'stack' || key === 'request' || key === 'response') {
        continue;
      }
      output[key] = sanitizeCustomerResult(item, {
        depth: depth + 1,
        seen
      });
    }
    return output;
  }

  return sanitizeString(value);
}

module.exports = {
  SENSITIVE_KEY,
  sanitizeString,
  sanitizeCustomerResult,
  sanitizeUrl
};
