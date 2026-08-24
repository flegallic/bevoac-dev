'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const apiCatalog = require('../../contracts/module-catalog.json');
const workerCatalog = require('../../../bevoac-worker-enterprise/contracts/module-catalog.json');
const scanSchema = require('../../contracts/scan-request.schema.json');

const expectedPreflight = [
  'exposure_map',
  'diagnostic_coverage',
  'encryption_coverage',
  'azure_rbac_exposure',
  'private_link_coverage',
  'policy_compliance'
];

test('API and worker module catalogs are byte-equivalent JSON documents', () => {
  assert.deepEqual(apiCatalog, workerCatalog);
});

test('all extended Azure modules are included in resource preflight', () => {
  const preflight = new Set(
    apiCatalog.modules
      .filter((entry) => entry.resourcePreflight)
      .map((entry) => entry.name)
  );
  for (const name of expectedPreflight) assert.ok(preflight.has(name), name);
});

test('scan message schema enum matches the catalog', () => {
  const schemaNames = new Set(scanSchema.properties.modules.items.enum);
  const catalogNames = new Set(apiCatalog.modules.map((entry) => entry.name));
  assert.deepEqual(schemaNames, catalogNames);
});

test('Entra B2B is tenant-scoped and does not trigger subscription resource preflight', () => {
  const descriptor = apiCatalog.modules.find((entry) => entry.name === 'entra_b2b');
  assert.ok(descriptor);
  assert.equal(descriptor.scope, 'tenant');
  assert.equal(descriptor.resourcePreflight, false);
  assert.equal(descriptor.workerRegistry, true);
});
