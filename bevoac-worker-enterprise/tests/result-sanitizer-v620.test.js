'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeCustomerResult,
  sanitizeString
} = require('../src/lib/result-sanitizer');
const { saveResult } = require('../src/services/scan-store');

test('customer result sanitizer removes secrets and URL query values', () => {
  const input = {
    error: 'request failed at https://example.test/path?token=abc&customer=42#fragment token=abc',
    authorization: 'Bearer super-secret',
    nested: {
      clientSecret: 'secret-value',
      resourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg'
    }
  };

  const output = sanitizeCustomerResult(input);
  assert.equal(output.authorization, '[REDACTED]');
  assert.equal(output.nested.clientSecret, '[REDACTED]');
  assert.match(output.error, /https:\/\/example\.test\/path/);
  assert.doesNotMatch(output.error, /customer=42|abc|fragment/);
  assert.match(output.nested.resourceId, /11111111-1111-4111-8111-111111111111/);
});

test('sanitizer removes stack and response internals', () => {
  const output = sanitizeCustomerResult({
    message: 'safe',
    stack: 'private stack',
    response: { headers: { authorization: 'secret' } }
  });
  assert.deepEqual(output, { message: 'safe' });
});

test('string sanitizer redacts credential-shaped fields', () => {
  const output = sanitizeString('password=my-pass https://host.test/a?sig=123');
  assert.doesNotMatch(output, /my-pass|123/);
  assert.match(output, /password=\[REDACTED\]/i);
});


test('scan result JSON and summary are built from the same sanitized object', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      return { rowCount: 1, rows: [] };
    }
  };

  await saveResult(client, {
    scanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    result: {
      error: { message: 'token=super-secret', authorization: 'Bearer secret' },
      findings: []
    },
    maxResultBytes: 100000,
    compressionThresholdBytes: 100000
  });

  const insert = calls.find((call) => call.text.includes('INSERT INTO scan_results'));
  const storedJson = JSON.parse(insert.values[2]);
  const storedSummary = JSON.parse(insert.values[5]);
  assert.equal(storedJson.error.authorization, '[REDACTED]');
  assert.doesNotMatch(storedJson.error.message, /super-secret/);
  assert.equal(storedSummary.error.authorization, '[REDACTED]');
  assert.doesNotMatch(storedSummary.error.message, /super-secret/);
});

// --- B-10 regression: shared references are not cycles ----------------------

const { coverageKpi, riskCountKpi, buildScanScorecard } = require('../src/lib/kpi-engine');

function buildSharedReferenceResult() {
  const limitations = ['Coverage limited to the sampled subscription.'];
  const tls = coverageKpi({ kpiId: 'web.tls', label: 'TLS', domain: 'web', compliant: 1, total: 2, evidenceSource: 'headers', limitations });
  const admins = riskCountKpi({ kpiId: 'entra.admins', label: 'Admins', domain: 'identity', count: 3, evidenceSource: 'graph', limitations });
  const finding = { severity: 'HIGH', title: 'Missing HSTS', status: 'FAILED', resourceId: 'https://example.test/' };
  const result = {
    webSecurity: { kpis: [tls], findings: [finding] },
    microsoft_entra: { kpis: [admins], findings: [finding] }
  };
  result.kpiScorecard = buildScanScorecard(result);
  return { result, tls, admins, limitations };
}

test('shared threshold and limitations references are preserved, not flagged as circular', () => {
  const { result, tls, admins, limitations } = buildSharedReferenceResult();
  assert.equal(result.kpiScorecard.kpis[0].threshold, tls.threshold);
  assert.equal(result.kpiScorecard.kpis[1].limitations, admins.limitations);
  assert.equal(tls.limitations, limitations);

  const output = sanitizeCustomerResult(result);
  const json = JSON.stringify(output);
  assert.doesNotMatch(json, /CIRCULAR_REFERENCE/);
  assert.deepEqual(output.kpiScorecard.kpis[0].threshold, { warningBelow: 90, criticalBelow: 70 });
  assert.deepEqual(output.kpiScorecard.kpis[1].threshold, { warningAt: 1, criticalAt: 10 });
  assert.deepEqual(output.kpiScorecard.kpis[0].limitations, limitations);
  assert.deepEqual(output.webSecurity.kpis[0].threshold, output.kpiScorecard.kpis[0].threshold);
});

test('true cycles are still replaced by the circular placeholder', () => {
  const node = { name: 'root', child: { name: 'child' } };
  node.child.parent = node;
  node.self = node;
  const list = [1];
  list.push(list);
  node.list = list;

  const output = sanitizeCustomerResult(node);
  assert.equal(output.self, '[CIRCULAR_REFERENCE]');
  assert.equal(output.child.parent, '[CIRCULAR_REFERENCE]');
  assert.equal(output.list[1], '[CIRCULAR_REFERENCE]');
  assert.equal(output.child.name, 'child');
});

test('a shared object first met near the depth limit is fully sanitized on a shallower path', () => {
  const shared = { inner: { leaf: 'value' } };
  let deep = shared;
  for (let i = 0; i < 31; i += 1) deep = { next: deep };
  const root = { deep, shortcut: shared, again: shared };

  const output = sanitizeCustomerResult(root);
  assert.deepEqual(output.shortcut, { inner: { leaf: 'value' } });
  assert.deepEqual(output.again, { inner: { leaf: 'value' } });
  assert.doesNotMatch(JSON.stringify(output.shortcut), /MAX_DEPTH_REACHED|CIRCULAR_REFERENCE/);
});

test('saveResult persists a scorecard without circular placeholders in JSON and summary', async () => {
  const { result } = buildSharedReferenceResult();
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      return { rowCount: 1, rows: [] };
    }
  };

  await saveResult(client, {
    scanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    result,
    maxResultBytes: 1000000,
    compressionThresholdBytes: 1000000
  });

  const insert = calls.find((call) => call.text.includes('INSERT INTO scan_results'));
  const storedJson = JSON.parse(insert.values[2]);
  const storedSummary = JSON.parse(insert.values[5]);
  assert.doesNotMatch(insert.values[2], /CIRCULAR_REFERENCE/);
  assert.doesNotMatch(insert.values[5], /CIRCULAR_REFERENCE/);
  assert.deepEqual(storedJson.kpiScorecard.kpis[0].threshold, { warningBelow: 90, criticalBelow: 70 });
  assert.deepEqual(storedSummary.kpiScorecard.kpis[1].threshold, { warningAt: 1, criticalAt: 10 });
  assert.equal(storedSummary.findingCount, 1);
});
