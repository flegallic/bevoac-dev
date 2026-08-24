'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_STATUS,
  PROVIDER_CONTRACT_VERSION,
  assertProviderRuntimeEnabled
} = require('../src/providers/provider-registry');

test('provider registry is explicit and fail-closed', () => {
  assert.match(PROVIDER_CONTRACT_VERSION, /^2026-/);
  assert.equal(PROVIDER_STATUS.azure.runtimeEnabled, true);
  assert.equal(PROVIDER_STATUS.aws.runtimeEnabled, false);
  assert.equal(PROVIDER_STATUS.gcp.runtimeEnabled, false);
  assert.doesNotThrow(() => assertProviderRuntimeEnabled('azure'));
  assert.throws(
    () => assertProviderRuntimeEnabled('aws'),
    /not runtime-enabled/i
  );
  assert.throws(
    () => assertProviderRuntimeEnabled('gcp'),
    /not runtime-enabled/i
  );
  assert.throws(
    () => assertProviderRuntimeEnabled('unknown'),
    /unsupported cloud provider/i
  );
});

test('future multi-cloud contract declares Azure, AWS and GCP without enabling them', () => {
  const contract = require('../contracts/scan-request.v2.multicloud.schema.json');
  assert.deepEqual(
    contract.properties.cloudProvider.enum,
    ['azure', 'aws', 'gcp']
  );
  assert.equal(PROVIDER_STATUS.aws.runtimeEnabled, false);
  assert.equal(PROVIDER_STATUS.gcp.runtimeEnabled, false);
});
