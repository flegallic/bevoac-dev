'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const runnerPath = path.join(root, 'scripts', 'verify-runtime-db-structure.js');
const expectationsPath = path.join(root, 'scripts', 'lib', 'enterprise-db-expectations.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runner = fs.readFileSync(runnerPath, 'utf8');
const expectations = require(expectationsPath);

test('runtime database verifier is read-only and wired to npm', () => {
  assert.equal(
    packageJson.scripts['check-db:runtime-boundary'],
    'node scripts/verify-runtime-db-structure.js'
  );
  assert.doesNotMatch(
    runner,
    /client\.query\(\s*[`'\"]\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/i
  );
  assert.match(runner, /Verifier must run as bevoacadmin/);
  assert.match(runner, /ENTERPRISE_RUNTIME_DB_STRUCTURE_OK/);
  assert.match(runner, /classifyRuntimeRoleMemberships/);
  assert.match(runner, /unsafeRoleMemberships/);
});

test('runtime database expectations match the validated enterprise boundary', () => {
  assert.equal(expectations.EXPECTED_MIGRATIONS.length, 8);
  assert.equal(expectations.RUNTIME_ROLES.length, 6);
  assert.equal(expectations.EXPECTED_RLS_TABLES.length, 15);
  assert.equal(expectations.EXPECTED_GRANTS.length, 58);
  assert.equal(new Set(expectations.EXPECTED_GRANTS).size, 58);
});
