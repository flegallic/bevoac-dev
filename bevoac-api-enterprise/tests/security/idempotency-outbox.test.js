const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveIdempotency, buildScanRequestedMessage } = require('../../src/services/scan-service');
const { SCAN_MESSAGE_VERSION } = require('../../src/lib/scan-message-version');

test('server generates idempotency key when caller does not provide one', () => {
  const idem = resolveIdempotency(null);
  assert.equal(idem.source, 'server_generated');
  assert.match(idem.key, /^[0-9a-f-]{36}$/i);
});

test('client supplied idempotency key is preserved and bounded', () => {
  const idem = resolveIdempotency('demo-key');
  assert.equal(idem.source, 'client_supplied');
  assert.equal(idem.key, 'demo-key');
});

test('scan requested message uses shared active contract version', () => {
  const message = buildScanRequestedMessage({
    scanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    cloudProvider: 'azure',
    scanProfile: 'web',
    modules: ['web'],
    azure: { targetUrl: 'https://example.com', microsoftTenantId: null, subscriptions: [] },
    billing: { planCode: 'standard', billingUnits: 1, quotaMonth: '2026-05-01', resourceLimit: 500 },
    requestId: 'req-1'
  });
  assert.equal(message.version, SCAN_MESSAGE_VERSION);
  assert.equal(message.version, '2026-06-01-kpi-modules-v6');
  assert.deepEqual(message.modules, ['web']);
});
