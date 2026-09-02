'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(`DEPENDENCY_SECURITY_GATE_ERROR=${message}`);
  process.exitCode = 1;
}

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function assertAtLeast(label, version, minimum) {
  const actual = parseVersion(version);
  const expected = parseVersion(minimum);
  if (!actual || !expected || compare(actual, expected) < 0) {
    fail(`${label}:${version || 'missing'}<${minimum}`);
  }
}

function loadJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function lockPackageName(key) {
  if (!key.startsWith('node_modules/')) return null;
  const marker = 'node_modules/';
  return key.slice(key.lastIndexOf(marker) + marker.length);
}

function packageVersions(lock) {
  const result = new Map();
  for (const [key, value] of Object.entries(lock.packages || {})) {
    const name = lockPackageName(key);
    if (!name || !value?.version) continue;
    if (!result.has(name)) result.set(name, []);
    result.get(name).push(value.version);
  }
  return result;
}

function assertNoPackage(versions, name, scope) {
  if (versions.has(name)) fail(`${scope}:forbidden-package:${name}`);
}

function checkFastUri(versions, scope) {
  for (const version of versions.get('fast-uri') || []) {
    const parsed = parseVersion(version);
    if (!parsed) {
      fail(`${scope}:fast-uri-unparseable:${version}`);
      continue;
    }
    if (parsed[0] === 3) assertAtLeast(`${scope}:fast-uri`, version, '3.1.6');
    else if (parsed[0] === 4) assertAtLeast(`${scope}:fast-uri`, version, '4.1.3');
    else fail(`${scope}:fast-uri-unapproved-major:${version}`);
  }
}

function assertRootLockSync(packageJson, lock, scope) {
  const rootRecord = lock.packages?.[''];
  if (!rootRecord) return fail(`${scope}:missing-root-lock-record`);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'engines']) {
    const expected = JSON.stringify(packageJson[field] || {});
    const actual = JSON.stringify(rootRecord[field] || {});
    if (expected !== actual) fail(`${scope}:root-lock-${field}-mismatch`);
  }
}

const apiPackage = loadJson('bevoac-api-enterprise/package.json');
const apiLock = loadJson('bevoac-api-enterprise/package-lock.json');
const workerPackage = loadJson('bevoac-worker-enterprise/package.json');
const workerLock = loadJson('bevoac-worker-enterprise/package-lock.json');
const apiVersions = packageVersions(apiLock);
const workerVersions = packageVersions(workerLock);

assertRootLockSync(apiPackage, apiLock, 'api');
assertRootLockSync(workerPackage, workerLock, 'worker');

if (apiPackage.dependencies?.['@fastify/swagger-ui']) fail('api:swagger-ui-direct-dependency-present');
assertNoPackage(apiVersions, '@fastify/swagger-ui', 'api');
assertNoPackage(apiVersions, '@fastify/static', 'api');
for (const version of apiVersions.get('brace-expansion') || []) assertAtLeast('api:brace-expansion', version, '5.0.9');
for (const version of apiVersions.get('fast-xml-parser') || []) assertAtLeast('api:fast-xml-parser', version, '5.10.1');
for (const version of apiVersions.get('find-my-way') || []) assertAtLeast('api:find-my-way', version, '9.7.0');
const apiFastifyVersions = apiVersions.get('fastify') || [];
if (apiPackage.dependencies?.fastify !== '5.12.1') fail('api:fastify-direct-pin-mismatch');
if (apiFastifyVersions.length !== 1) fail(`api:fastify-version-count:${apiFastifyVersions.length}`);
for (const version of apiFastifyVersions) assertAtLeast('api:fastify', version, '5.12.1');
checkFastUri(apiVersions, 'api');

if (workerPackage.dependencies?.['@azure/arm-resourcegraph']) fail('worker:arm-resourcegraph-direct-dependency-present');
if (workerPackage.bevoacResourceGraphTransport !== 'arm-rest-2024-04-01') {
  fail('worker:resource-graph-transport-not-arm-rest-2024-04-01');
}
for (const forbidden of ['@azure/arm-resourcegraph', '@azure/ms-rest-azure-js', '@azure/ms-rest-js', 'uuid']) {
  assertNoPackage(workerVersions, forbidden, 'worker');
}
for (const version of workerVersions.get('fast-xml-parser') || []) assertAtLeast('worker:fast-xml-parser', version, '5.10.1');
checkFastUri(workerVersions, 'worker');

for (const [scope, packageJson] of [['api', apiPackage], ['worker', workerPackage]]) {
  if (/npm sbom/.test(packageJson.scripts?.sbom || '')) fail(`${scope}:native-npm-sbom-gate-present`);
  if (!/generate-cyclonedx-from-lock/.test(packageJson.scripts?.sbom || '')) fail(`${scope}:lockfile-sbom-script-missing`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`API_LOCK_PACKAGES=${Object.keys(apiLock.packages || {}).length}`);
console.log(`WORKER_LOCK_PACKAGES=${Object.keys(workerLock.packages || {}).length}`);
console.log('WORKER_RESOURCE_GRAPH_TRANSPORT=arm-rest-2024-04-01');
console.log('DEPENDENCY_SECURITY_GATE_OK=true');
