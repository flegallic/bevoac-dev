'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('R2.2 PostgreSQL enterprise gate uses the non-production local CI profile', () => {
  const gate = read('scripts/ci/postgres-enterprise-gate.sh');
  assert.match(gate, /PG_SSL_MODE="disable" NODE_ENV="test"/);
  assert.doesNotMatch(gate, /PG_SSL_MODE="disable" NODE_ENV="production"/);
});

test('R2.2 local PostgreSQL runner preserves Docker Desktop paths and isolates anonymous public pulls', () => {
  const runner = read('scripts/qualification/postgres16-local.sh');
  assert.match(runner, /ORIGINAL_PATH/);
  assert.match(runner, /Applications\/Docker\.app\/Contents\/Resources\/bin/);
  assert.match(runner, /anonymous-isolated-config/);
  assert.match(runner, /DOCKER_CONFIG=.*TEMP_DOCKER_CONFIG/);
  assert.match(runner, /POSTGRESQL_PRODUCTION_CONNECTION=none/);
  assert.match(runner, /POSTGRES16_QUALIFICATION_OK=true/);
});
