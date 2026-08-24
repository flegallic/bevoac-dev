'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const packageJson = require(path.join(root, 'package.json'));
const runtimeDeps = fs.readFileSync(path.join(root, 'scripts', 'runtime-deps-check.js'), 'utf8');
const resourceGraphSource = fs.readFileSync(path.join(root, 'src', 'lib', 'resource-graph-rest-client.js'), 'utf8');

function packageNames(lock) {
  return new Set(Object.keys(lock.packages || {})
    .filter((key) => key.startsWith('node_modules/'))
    .map((key) => {
      const marker = 'node_modules/';
      return key.slice(key.lastIndexOf(marker) + marker.length);
    }));
}

test('R2.1 removes the deprecated Resource Graph SDK and uses the authenticated ARM REST adapter', () => {
  assert.equal(packageJson.bevoacReleaseRevision, 'R2.1');
  assert.equal(packageJson.bevoacResourceGraphTransport, 'arm-rest-2024-04-01');
  assert.equal(packageJson.dependencies['@azure/arm-resourcegraph'], undefined);
  assert.equal(runtimeDeps.includes("'@azure/arm-resourcegraph'"), false);
  assert.match(resourceGraphSource, /Microsoft\.ResourceGraph\/resources\?api-version=2024-04-01/);
  assert.match(resourceGraphSource, /https:\/\/management\.azure\.com\/\.default/);
});

test('R2.1 worker lock excludes the deprecated ms-rest Resource Graph chain', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const names = packageNames(lock);
  for (const forbidden of [
    '@azure/arm-resourcegraph',
    '@azure/ms-rest-azure-js',
    '@azure/ms-rest-js',
    'uuid'
  ]) {
    assert.equal(names.has(forbidden), false, `forbidden lock package: ${forbidden}`);
  }
});

test('R2.1 pins worker URI and XML transitive security fixes', () => {
  assert.equal(packageJson.overrides.ajv['fast-uri'], '3.1.5');
  assert.equal(packageJson.overrides['fast-xml-parser'], '5.10.1');
});
