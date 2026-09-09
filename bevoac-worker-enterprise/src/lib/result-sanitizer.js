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

function sanitizeScalar(value) {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return '[BINARY_REDACTED]';
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

// Cycle detection is path-based: a container is a cycle only when it is one of
// its own ancestors. Shared references (the same object reachable from several
// paths, e.g. a KPI threshold reused by the scorecard) are legitimate JSON and
// are sanitized once, then reused through a memo keyed by the depth at which the
// clone was produced (a clone built deeper may have been depth-truncated).
function sanitizeNode(value, depth, state) {
  const scalar = sanitizeScalar(value);
  if (scalar !== undefined) return scalar;
  if (typeof value !== 'object') return sanitizeString(value);
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH_REACHED]';
  if (state.ancestors.has(value)) return '[CIRCULAR_REFERENCE]';

  const cached = state.clones.get(value);
  if (cached && cached.depth <= depth) return cached.output;

  state.ancestors.add(value);
  let output;
  try {
    if (Array.isArray(value)) {
      output = value.map((item) => sanitizeNode(item, depth + 1, state));
    } else {
      output = {};
      for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(key)) {
          output[key] = '[REDACTED]';
          continue;
        }
        if (key === 'stack' || key === 'request' || key === 'response') {
          continue;
        }
        output[key] = sanitizeNode(item, depth + 1, state);
      }
    }
  } finally {
    state.ancestors.delete(value);
  }
  state.clones.set(value, { depth, output });
  return output;
}

function sanitizeCustomerResult(value, { depth = 0 } = {}) {
  return sanitizeNode(value, depth, { ancestors: new WeakSet(), clones: new WeakMap() });
}

module.exports = {
  SENSITIVE_KEY,
  sanitizeString,
  sanitizeCustomerResult,
  sanitizeUrl
};
