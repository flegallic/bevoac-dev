'use strict';

const { createHash } = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  if (value === undefined) return null;
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Canonical(value) {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

module.exports = { canonicalize, stableStringify, sha256Canonical };
