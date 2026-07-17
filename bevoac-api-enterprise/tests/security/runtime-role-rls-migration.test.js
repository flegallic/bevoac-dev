'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    'utf8'
  );
}

test(
  'billing tenant lookup relies on advisory locking without FOR UPDATE',
  () => {
    const source = read(
      'src/services/billing-service.js'
    );

    assert.match(
      source,
      /pg_advisory_xact_lock/
    );

    assert.doesNotMatch(
      source,
      /getTenantContext\([^)]*forUpdate:\s*true/
    );
  }
);

test(
  'runtime RLS migration binds policies to PostgreSQL login identity',
  () => {
    const migration = read(
      'migrations/optional/' +
      '202607170001_runtime_role_rls_boundary.sql'
    );

    assert.match(
      migration,
      /session_user = 'bevoac_api'/
    );

    assert.match(
      migration,
      /session_user = 'bevoac_worker'/
    );

    assert.match(
      migration,
      /bevoac_current_tenant_id/
    );

    assert.doesNotMatch(
      migration,
      /app\.service_context/i
    );

    assert.doesNotMatch(
      migration,
      /^\s*BEGIN\s*;/im
    );

    assert.doesNotMatch(
      migration,
      /^\s*COMMIT\s*;/im
    );
  }
);

test(
  'runtime RLS migration forces all protected tables and avoids GRANT ALL',
  () => {
    const migration = read(
      'migrations/optional/' +
      '202607170001_runtime_role_rls_boundary.sql'
    );

    assert.equal(
      (
        migration.match(
          /FORCE ROW LEVEL SECURITY/g
        ) || []
      ).length,
      15
    );

    assert.equal(
      (
        migration.match(
          /CREATE POLICY/g
        ) || []
      ).length,
      29
    );

    assert.doesNotMatch(
      migration,
      /\bGRANT\s+ALL\b/i
    );

    assert.doesNotMatch(
      migration,
      /GRANT[^;]*api_keys[^;]*bevoac_api/is
    );
  }
);

test(
  'runtime RLS runner is guarded and verifies exact privileges',
  () => {
    const runner = read(
      'scripts/apply-runtime-role-rls.js'
    );

    assert.match(
      runner,
      /ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY/
    );

    assert.match(
      runner,
      /EXPECTED_PRIVILEGES/
    );

    assert.match(
      runner,
      /EXPECTED_POLICY_COUNT/
    );

    assert.match(
      runner,
      /202607170001_runtime_role_rls_boundary_optional/
    );

    assert.doesNotMatch(
      runner,
      /202607090002_enterprise_rls_runtime_roles\.sql/
    );
  }
);

test(
  'legacy mutable-service-context RLS launchers are blocked',
  () => {
    const legacyEnterprise = read(
      'scripts/apply-enterprise-rls.js'
    );

    const legacyRls = read(
      'scripts/apply-rls-migration.js'
    );

    for (const source of [
      legacyEnterprise,
      legacyRls
    ]) {
      assert.match(source, /BLOCKED/);
      assert.match(
        source,
        /must never be applied/
      );

      assert.doesNotMatch(
        source,
        /client\.query\(/i
      );
    }
  }
);
