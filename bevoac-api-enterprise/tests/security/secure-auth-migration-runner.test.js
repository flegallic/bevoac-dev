'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('secure authentication migration has no embedded transaction', () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      'migrations/optional/' +
        '202607160002_secure_api_key_auth_boundary.sql'
    ),
    'utf8'
  );

  assert.doesNotMatch(migration, /^\s*BEGIN\s*;/im);
  assert.doesNotMatch(migration, /^\s*COMMIT\s*;/im);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /session_user <> 'bevoac_api'/i);
  assert.doesNotMatch(migration, /app\.service_context/i);
});

test('secure authentication runner is guarded and transactional', () => {
  const runner = fs.readFileSync(
    path.join(root, 'scripts/apply-secure-api-key-auth.js'),
    'utf8'
  );

  assert.match(
    runner,
    /ALLOW_SECURE_API_KEY_AUTH_APPLY/
  );
  assert.match(
    runner,
    /202607160002_secure_api_key_auth_boundary_optional/
  );
  assert.match(
    runner,
    /current_user !== 'bevoacadmin'/
  );
  assert.match(runner, /client\.query\('BEGIN'\)/);
  assert.match(runner, /client\.query\('COMMIT'\)/);
  assert.match(runner, /schema_migrations/);
});

test('package exposes the dedicated secure authentication command', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );

  assert.equal(
    packageJson.scripts['migrate-db:secure-api-key-auth'],
    'node scripts/apply-secure-api-key-auth.js'
  );
});
