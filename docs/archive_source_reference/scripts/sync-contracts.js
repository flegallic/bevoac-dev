#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const rootVersionPath = path.join(repoRoot, 'contracts', 'scan-message-version.json');
const versionDoc = JSON.parse(fs.readFileSync(rootVersionPath, 'utf8'));

if (!versionDoc.scanMessageVersion || typeof versionDoc.scanMessageVersion !== 'string') {
  throw new Error('contracts/scan-message-version.json must contain a non-empty scanMessageVersion string.');
}

const targets = [
  path.join(repoRoot, 'bevoac-api-enterprise', 'contracts', 'scan-message-version.json'),
  path.join(repoRoot, 'bevoac-worker-enterprise', 'contracts', 'scan-message-version.json')
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(versionDoc, null, 2)}\n`);
  console.log(`Synced ${path.relative(repoRoot, target)} -> ${versionDoc.scanMessageVersion}`);
}

const workerSchemaPath = path.join(repoRoot, 'bevoac-worker-enterprise', 'contracts', 'scan-request.schema.json');
if (fs.existsSync(workerSchemaPath)) {
  const schema = JSON.parse(fs.readFileSync(workerSchemaPath, 'utf8'));
  schema.properties = schema.properties || {};
  schema.properties.version = {
    type: 'string',
    const: versionDoc.scanMessageVersion
  };
  fs.writeFileSync(workerSchemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`Updated worker schema version -> ${versionDoc.scanMessageVersion}`);
}
