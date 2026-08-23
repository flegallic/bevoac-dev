'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BILLING_MONTH_SCHEMA,
  OPTIONAL_MONTH_QUERY_SCHEMA,
  REQUIRED_MONTH_QUERY_SCHEMA,
  TENANT_LEDGER_PARAMS_SCHEMA
} = require('../../src/routes/admin-billing');
const { BillingService } = require('../../src/services/billing-service');
const { ValidationError } = require('../../src/lib/errors');

test('admin billing schemas reject unknown parameters and require UUID tenant IDs', () => {
  assert.equal(OPTIONAL_MONTH_QUERY_SCHEMA.additionalProperties, false);
  assert.equal(REQUIRED_MONTH_QUERY_SCHEMA.additionalProperties, false);
  assert.deepEqual(REQUIRED_MONTH_QUERY_SCHEMA.required, ['month']);
  assert.equal(TENANT_LEDGER_PARAMS_SCHEMA.additionalProperties, false);
  assert.equal(TENANT_LEDGER_PARAMS_SCHEMA.properties.tenantId.format, 'uuid');
  assert.match('2026-08-01', new RegExp(BILLING_MONTH_SCHEMA.pattern));
  assert.doesNotMatch('2026-08-03', new RegExp(BILLING_MONTH_SCHEMA.pattern));
});

test('billing service accepts only normalized month boundaries', () => {
  const service = new BillingService(null, {});
  assert.equal(service.normalizeQuotaMonth('2026-08-01'), '2026-08-01');
  assert.throws(
    () => service.normalizeQuotaMonth('2026-08-03'),
    (error) => error instanceof ValidationError && error.statusCode === 400
  );
  assert.throws(
    () => service.normalizeQuotaMonth('not-a-month'),
    /YYYY-MM-01/
  );
});

test('month close is fail-closed for a missing or current/future month', () => {
  const service = new BillingService(null, {});
  assert.throws(
    () => service.normalizeQuotaMonth(null, { required: true, completedOnly: true }),
    /required/
  );
  const current = service.getCurrentQuotaMonth();
  assert.throws(
    () => service.normalizeQuotaMonth(current, { required: true, completedOnly: true }),
    /completed billing month/
  );
});
