'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(apiRoot, 'scripts', 'sync-runtime-db-roles.js');
const packagePath = path.join(apiRoot, 'package.json');

const source = fs.readFileSync(scriptPath, 'utf8');

test('runtime role synchronization is explicitly guarded', () => {
  assert.match(source, /ALLOW_RUNTIME_ROLE_SYNC/);
  assert.match(source, /No role was modified/);
});

test('runtime roles are forced to least-privilege attributes', () => {
  assert.match(source, /NOSUPERUSER/);
  assert.match(source, /NOCREATEROLE/);
  assert.match(source, /NOCREATEDB/);
  assert.match(source, /NOINHERIT/);
  assert.match(source, /NOREPLICATION/);
  assert.match(source, /NOBYPASSRLS/);
  assert.doesNotMatch(source, /app\.service_context/);
});

test('package exposes the guarded runtime role command', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(
    pkg.scripts['sync-db:runtime-roles'],
    'node scripts/sync-runtime-db-roles.js'
  );
});
