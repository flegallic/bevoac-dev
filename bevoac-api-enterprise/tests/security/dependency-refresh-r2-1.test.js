'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const packageJson = require(path.join(root, 'package.json'));
const swaggerSource = fs.readFileSync(path.join(root, 'src', 'plugins', 'swagger.js'), 'utf8');
const runtimeDepsSource = fs.readFileSync(path.join(root, 'scripts', 'runtime-deps-check.js'), 'utf8');

test('R2.1 removes Swagger UI and its static-file runtime surface', () => {
  assert.equal(packageJson.bevoacReleaseRevision, 'R2.1');
  assert.equal(packageJson.dependencies['@fastify/swagger-ui'], undefined);
  assert.equal(swaggerSource.includes("require('@fastify/swagger-ui')"), false);
  assert.equal(runtimeDepsSource.includes("'@fastify/swagger-ui'"), false);
  assert.match(swaggerSource, /\/docs\/openapi\.json/);
});

test('R2.1 pins the targeted API transitive security fixes', () => {
  assert.equal(packageJson.overrides['find-my-way'], '9.7.0');
  assert.equal(packageJson.overrides['fast-xml-parser'], '5.10.1');
  assert.equal(packageJson.overrides.ajv['fast-uri'], '3.1.5');
  assert.equal(packageJson.overrides['@fastify/ajv-compiler']['fast-uri'], '3.1.5');
  assert.equal(packageJson.overrides['json-schema-resolver']['fast-uri'], '3.1.5');
  assert.equal(packageJson.overrides['fast-json-stringify']['fast-uri'], '4.1.2');
});
