'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProvider,
  assertRuntimeProvider
} = require('../../src/lib/cloud-provider-contract');

test('Azure remains the only runtime-enabled cloud provider', () => {
  const azure = getProvider('azure');
  const aws = getProvider('aws');

  assert.equal(azure.runtimeEnabled, true);
  assert.equal(aws.runtimeEnabled, false);
  assert.doesNotThrow(() => assertRuntimeProvider('azure'));
  assert.throws(
    () => assertRuntimeProvider('aws'),
    /not runtime-enabled/i
  );
});

test('unknown providers fail closed', () => {
  assert.equal(getProvider('unknown-cloud'), null);
  assert.throws(
    () => assertRuntimeProvider('unknown-cloud'),
    /unsupported cloudProvider/i
  );
});
