'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PREFLIGHT_MODULES,
  WORKER_REGISTRY_MODULES
} = require('../src/lib/module-catalog');
const {
  INFRA_MODULES,
  hasInfraModules
} = require('../src/lib/resource-preflight');
let MODULE_REGISTRY = null;
let registryLoadError = null;
try {
  ({ MODULE_REGISTRY } = require('../scanners/azure/azureInfra'));
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  registryLoadError = error;
}

const expected = [
  'exposure_map',
  'diagnostic_coverage',
  'encryption_coverage',
  'azure_rbac_exposure',
  'private_link_coverage',
  'policy_compliance'
];

test('preflight includes all extended Azure modules', () => {
  for (const name of expected) {
    assert.ok(PREFLIGHT_MODULES.includes(name), name);
    assert.ok(INFRA_MODULES.has(name), name);
    assert.equal(hasInfraModules([name]), true, name);
  }
});

test('worker registry and catalog stay identical', {
  skip: registryLoadError
    ? 'Azure SDK dependencies are not installed in this local static environment.'
    : false
}, () => {
  assert.deepEqual(
    Object.keys(MODULE_REGISTRY).sort(),
    [...WORKER_REGISTRY_MODULES].sort()
  );
});

test('Entra B2B remains a tenant module and is excluded from resource preflight', () => {
  assert.equal(PREFLIGHT_MODULES.includes('entra_b2b'), false);
  assert.equal(INFRA_MODULES.has('entra_b2b'), false);
  assert.equal(hasInfraModules(['entra_b2b']), false);
  assert.equal(WORKER_REGISTRY_MODULES.includes('entra_b2b'), true);
});
