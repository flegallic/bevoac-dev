'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('legacy partial schema launchers are blocked and not exposed by npm', () => {
  const packageJson = JSON.parse(read('package.json'));
  const scripts = packageJson.scripts || {};

  for (const name of [
    'init-db:prod-hardening',
    'migrate-db:enterprise-hardening',
    'migrate-db:rls',
    'migrate-db:enterprise-rls'
  ]) {
    assert.equal(Object.hasOwn(scripts, name), false, `${name} must not be exposed`);
  }

  for (const file of [
    'scripts/init-db.production-hardening.js',
    'scripts/apply-enterprise-hardening-migration.js',
    'scripts/apply-rls-migration.js',
    'scripts/apply-enterprise-rls.js'
  ]) {
    const source = read(file);
    assert.match(source, /BLOCKED:/);
    assert.match(source, /process\.exitCode\s*=\s*1/);
  }
});

test('check:rls resolves to the exact runtime database verifier', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(
    packageJson.scripts['check:rls'],
    'node scripts/verify-runtime-db-structure.js'
  );
});
