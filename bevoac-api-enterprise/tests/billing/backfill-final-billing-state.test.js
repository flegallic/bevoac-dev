'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  finalStateForScanStatus,
  amountForScan
} = require('../../scripts/backfill-final-billing-state');

test('backfill script defaults to safe dry-run mode', () => {
  const opts = parseArgs([]);
  assert.equal(opts.apply, false);
  assert.equal(opts.includeFailed, false);
  assert.equal(opts.limit, 100);
});

test('backfill script requires explicit apply flag for mutation mode', () => {
  const opts = parseArgs(['--apply', '--before', '2026-06-01', '--limit', '10']);
  assert.equal(opts.apply, true);
  assert.equal(opts.limit, 10);
  assert.match(opts.before, /^2026-06-01T/);
});

test('DONE scans map from RESERVED to CONSUMED', () => {
  assert.deepEqual(finalStateForScanStatus('DONE'), {
    billingState: 'CONSUMED',
    eventType: 'scan_consumed',
    reason: 'historical_done_reserved'
  });
});

test('FAILED scans are ignored unless includeFailed is explicit', () => {
  assert.equal(finalStateForScanStatus('FAILED'), null);
  assert.deepEqual(finalStateForScanStatus('FAILED', true), {
    billingState: 'REFUNDED',
    eventType: 'scan_refunded',
    reason: 'historical_failed_reserved'
  });
});

test('amountForScan keeps included scans at zero cost', () => {
  assert.deepEqual(amountForScan({ is_quota_included: true, billing_units: 3 }, { unitPriceEur: 0.10 }), {
    unitPrice: 0,
    amount: 0
  });
});

test('amountForScan computes payg amount from units and plan price', () => {
  assert.deepEqual(amountForScan({ is_quota_included: false, billing_units: 3 }, { unitPriceEur: 0.10 }), {
    unitPrice: 0.10,
    amount: 0.30
  });
});
