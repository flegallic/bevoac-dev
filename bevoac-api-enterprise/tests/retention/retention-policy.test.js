'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planRetentionDays, retentionCaseSql } = require('../../scripts/retention-sweep');

test('plan based retention defaults match V6.1.1 commercial policy', () => {
  const days = planRetentionDays({}, { retention: { scanResultRetentionDays: 180 } });
  assert.equal(days.standard, 90);
  assert.equal(days.business, 180);
  assert.equal(days.payg, 180);
  assert.equal(days.free, 30);
});

test('plan based retention can be overridden with environment variables', () => {
  const days = planRetentionDays({
    SCAN_RESULT_RETENTION_DAYS_STANDARD: '91',
    SCAN_RESULT_RETENTION_DAYS_BUSINESS: '181',
    SCAN_RESULT_RETENTION_DAYS_PAYG: '182',
    SCAN_RESULT_RETENTION_DAYS_FREE: '31'
  }, { retention: { scanResultRetentionDays: 180 } });
  assert.deepEqual(days, { free: 31, standard: 91, business: 181, payg: 182, fallback: 180 });
});

test('retention SQL case covers standard business and payg plans', () => {
  const sql = retentionCaseSql('t');
  assert.match(sql, /standard/);
  assert.match(sql, /business/);
  assert.match(sql, /payg/);
});
