'use strict';

const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(apiRoot, '..');
const workerRoot = path.join(repositoryRoot, 'bevoac-worker-enterprise');

const apiContracts = {
  request: path.join(apiRoot, 'contracts', 'scan-request.schema.json'),
  version: path.join(apiRoot, 'contracts', 'scan-message-version.json'),
  modules: path.join(apiRoot, 'contracts', 'module-catalog.json')
};

const workerContracts = {
  request: path.join(workerRoot, 'contracts', 'scan-request.schema.json'),
  version: path.join(workerRoot, 'contracts', 'scan-message-version.json'),
  modules: path.join(workerRoot, 'contracts', 'module-catalog.json')
};

function requireFile(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} missing: ${file}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizedJson(file) {
  return JSON.stringify(readJson(file));
}

function assertSame(label, files) {
  const contents = files.map(normalizedJson);

  if (new Set(contents).size !== 1) {
    throw new Error(`${label} mismatch: ${files.join(', ')}`);
  }
}

requireFile(apiContracts.request, 'API scan request contract');
requireFile(apiContracts.version, 'API scan message version');
requireFile(apiContracts.modules, 'API module catalog');

const apiSchema = readJson(apiContracts.request);
const apiVersionDocument = readJson(apiContracts.version);
const apiVersion = apiVersionDocument.scanMessageVersion;
const schemaVersion = apiSchema.properties?.version?.const;

if (!apiVersion) {
  throw new Error('scanMessageVersion is missing from the API version contract.');
}

if (schemaVersion !== apiVersion) {
  throw new Error(
    `API schema version (${schemaVersion}) does not match scanMessageVersion (${apiVersion}).`
  );
}

if (process.argv.includes('--api-only')) {
  console.log('API contract consistency passed (API-only image mode).');
  process.exit(0);
}

requireFile(workerContracts.request, 'Worker scan request contract');
requireFile(workerContracts.version, 'Worker scan message version');
requireFile(workerContracts.modules, 'Worker module catalog');

assertSame(
  'scan-request.schema.json',
  [apiContracts.request, workerContracts.request]
);

assertSame(
  'scan-message-version.json',
  [apiContracts.version, workerContracts.version]
);

assertSame(
  'module-catalog.json',
  [apiContracts.modules, workerContracts.modules]
);

const moduleCatalog = readJson(apiContracts.modules);
const schemaModules = apiSchema.properties?.modules?.items?.enum || [];
const catalogModules = (moduleCatalog.modules || []).map((entry) => entry.name);
if (JSON.stringify([...schemaModules].sort()) !== JSON.stringify([...catalogModules].sort())) {
  throw new Error('scan request module enum does not match module-catalog.json');
}

console.log('API and worker contracts are synchronized.');
