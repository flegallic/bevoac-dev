'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CREATE_SCAN_SCHEMA,
  SCAN_ID_PARAMS_SCHEMA,
  EMPTY_QUERY_SCHEMA
} = require('../../src/routes/scans');
const {
  EMPTY_OBJECT_SCHEMA: HEALTH_EMPTY_QUERY_SCHEMA
} = require('../../src/routes/health');

 test('create scan schema is fail-closed', () => {
  assert.equal(CREATE_SCAN_SCHEMA.body.additionalProperties, false);
  assert.deepEqual(CREATE_SCAN_SCHEMA.body.required, ['cloudProvider', 'scanProfile']);
  assert.equal(CREATE_SCAN_SCHEMA.body.properties.cloudProvider.enum[0], 'azure');
  assert.equal(CREATE_SCAN_SCHEMA.headers.properties['idempotency-key'].maxLength, 255);
  assert.equal(CREATE_SCAN_SCHEMA.querystring, EMPTY_QUERY_SCHEMA);
});

test('scan ID parameter requires a UUID', () => {
  assert.equal(SCAN_ID_PARAMS_SCHEMA.additionalProperties, false);
  assert.equal(SCAN_ID_PARAMS_SCHEMA.properties.scanId.format, 'uuid');
});


test('routes without query parameters use an explicit empty query schema', () => {
  assert.equal(EMPTY_QUERY_SCHEMA.additionalProperties, false);
  assert.equal(EMPTY_QUERY_SCHEMA.maxProperties, 0);
});


test('health probes reject unknown query parameters', () => {
  assert.equal(HEALTH_EMPTY_QUERY_SCHEMA.additionalProperties, false);
  assert.equal(HEALTH_EMPTY_QUERY_SCHEMA.maxProperties, 0);
});
