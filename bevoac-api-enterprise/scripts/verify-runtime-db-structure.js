#!/usr/bin/env node
'use strict';

const { Client } = require('pg');
const {
  EXPECTED_GRANTS,
  EXPECTED_MIGRATIONS,
  EXPECTED_RLS_TABLES,
  RUNTIME_ROLES
} = require('./lib/enterprise-db-expectations');
const {
  classifyRuntimeRoleMemberships
} = require('./lib/runtime-role-memberships');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sslConfig() {
  const mode = String(process.env.PG_SSL_MODE || 'verify-full').trim();
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode !== 'require' };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

async function main() {
  const client = new Client({
    host: required('PG_HOST'),
    port: Number(process.env.PG_PORT || 5432),
    database: required('PG_DATABASE'),
    user: required('PG_USER'),
    password: required('PG_PASSWORD'),
    ssl: sslConfig(),
    application_name: 'bevoac-runtime-db-structure-verifier',
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000
  });

  await client.connect();
  try {
    const identity = await client.query(`
      SELECT current_database() AS database,
             session_user,
             current_user,
             current_setting('server_version') AS server_version
    `);
    const current = identity.rows[0];
    assert(current.session_user === 'bevoacadmin', 'Verifier must run as bevoacadmin.');

    const migrations = await client.query(`
      SELECT version
      FROM public.schema_migrations
      ORDER BY version
    `);
    const migrationSet = new Set(migrations.rows.map((row) => row.version));
    const expectedMigrationSet = new Set(EXPECTED_MIGRATIONS);
    assert(migrationSet.size === expectedMigrationSet.size,
      `Expected ${expectedMigrationSet.size} migrations, got ${migrationSet.size}`);
    assert(setDifference(expectedMigrationSet, migrationSet).length === 0,
      `Missing migrations: ${setDifference(expectedMigrationSet, migrationSet).join(', ')}`);
    assert(setDifference(migrationSet, expectedMigrationSet).length === 0,
      `Unexpected migrations: ${setDifference(migrationSet, expectedMigrationSet).join(', ')}`);

    const roles = await client.query(`
      SELECT rolname, rolcanlogin, rolinherit, rolsuper,
             rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname
    `, [RUNTIME_ROLES]);
    assert(roles.rowCount === RUNTIME_ROLES.length,
      `Expected ${RUNTIME_ROLES.length} runtime roles, got ${roles.rowCount}`);
    for (const role of roles.rows) {
      assert(role.rolcanlogin === true, `${role.rolname} must LOGIN`);
      assert(role.rolinherit === false, `${role.rolname} must NOINHERIT`);
      assert(role.rolsuper === false, `${role.rolname} must NOSUPERUSER`);
      assert(role.rolcreaterole === false, `${role.rolname} must NOCREATEROLE`);
      assert(role.rolcreatedb === false, `${role.rolname} must NOCREATEDB`);
      assert(role.rolreplication === false, `${role.rolname} must NOREPLICATION`);
      assert(role.rolbypassrls === false, `${role.rolname} must NOBYPASSRLS`);
    }

    const memberships = await client.query(`
      SELECT granted.rolname AS granted_role,
             member.rolname AS member_role,
             grantor.rolname AS grantor_role,
             grantor.rolsuper AS grantor_superuser,
             membership.admin_option,
             membership.inherit_option,
             membership.set_option
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE granted.rolname = ANY($1::text[])
         OR member.rolname = ANY($1::text[])
      ORDER BY granted.rolname, member.rolname, grantor.rolname
    `, [RUNTIME_ROLES]);
    const membershipBoundary = classifyRuntimeRoleMemberships(
      memberships.rows,
      RUNTIME_ROLES,
      current.session_user
    );
    assert(membershipBoundary.unsafe.length === 0,
      `Unexpected runtime role memberships: ${JSON.stringify(membershipBoundary.unsafe)}`);
    const administrativeRoles = new Set(
      membershipBoundary.safeAdministrative.map((row) => row.granted_role)
    );
    assert(administrativeRoles.size === membershipBoundary.safeAdministrative.length,
      'Duplicate administrative runtime role memberships detected');

    const rls = await client.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [EXPECTED_RLS_TABLES]);
    const rlsNames = new Set(rls.rows.map((row) => row.table_name));
    const expectedRlsNames = new Set(EXPECTED_RLS_TABLES);
    assert(rls.rowCount === EXPECTED_RLS_TABLES.length,
      `Expected ${EXPECTED_RLS_TABLES.length} protected tables, got ${rls.rowCount}`);
    assert(setDifference(expectedRlsNames, rlsNames).length === 0,
      `Missing protected tables: ${setDifference(expectedRlsNames, rlsNames).join(', ')}`);
    for (const table of rls.rows) {
      assert(table.enabled === true, `${table.table_name} must have RLS enabled`);
      assert(table.forced === true, `${table.table_name} must have FORCE RLS`);
    }

    const policyCount = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_policies
      WHERE schemaname = 'public'
    `);
    assert(policyCount.rows[0].count === 29,
      `Expected 29 policies, got ${policyCount.rows[0].count}`);

    const grants = await client.query(`
      SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee = ANY($1::text[])
      ORDER BY grantee, table_name, privilege_type
    `, [RUNTIME_ROLES]);
    const actualGrants = new Set(grants.rows.map((row) =>
      `${row.grantee}|${row.table_name}|${row.privilege_type}`));
    const expectedGrants = new Set(EXPECTED_GRANTS);
    const missingGrants = setDifference(expectedGrants, actualGrants);
    const unexpectedGrants = setDifference(actualGrants, expectedGrants);
    assert(actualGrants.size === 58, `Expected 58 grants, got ${actualGrants.size}`);
    assert(missingGrants.length === 0, `Missing grants: ${missingGrants.join(', ')}`);
    assert(unexpectedGrants.length === 0, `Unexpected grants: ${unexpectedGrants.join(', ')}`);

    const functions = await client.query(`
      SELECT p.proname,
             pg_get_userbyid(p.proowner) AS owner,
             p.prosecdef AS security_definer,
             p.proconfig AS configuration,
             has_function_privilege('bevoac_api', p.oid, 'EXECUTE') AS api_execute,
             has_function_privilege('bevoac_worker', p.oid, 'EXECUTE') AS worker_execute,
             has_function_privilege('bevoac_outbox', p.oid, 'EXECUTE') AS outbox_execute,
             has_function_privilege('bevoac_retention', p.oid, 'EXECUTE') AS retention_execute,
             has_function_privilege('bevoac_admin_api', p.oid, 'EXECUTE') AS admin_execute,
             has_function_privilege('bevoac_operator', p.oid, 'EXECUTE') AS operator_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('bevoac_authenticate_api_key', 'bevoac_current_tenant_id')
      ORDER BY p.proname
    `);
    assert(functions.rowCount === 2, `Expected two security functions, got ${functions.rowCount}`);
    const byName = Object.fromEntries(functions.rows.map((row) => [row.proname, row]));
    const auth = byName.bevoac_authenticate_api_key;
    assert(auth.owner === 'bevoacadmin', 'Authentication function owner mismatch');
    assert(auth.security_definer === true, 'Authentication function must be SECURITY DEFINER');
    assert(Array.isArray(auth.configuration) && auth.configuration.includes('search_path=pg_catalog'),
      'Authentication function search_path mismatch');
    assert(auth.api_execute === true, 'bevoac_api must execute authentication function');
    assert(auth.worker_execute === false && auth.outbox_execute === false &&
      auth.retention_execute === false && auth.admin_execute === false &&
      auth.operator_execute === false,
      'Authentication function has an unexpected runtime executor');

    const tenant = byName.bevoac_current_tenant_id;
    assert(tenant.owner === 'bevoacadmin', 'Tenant function owner mismatch');
    assert(tenant.security_definer === false, 'Tenant function must be SECURITY INVOKER');
    assert(Array.isArray(tenant.configuration) && tenant.configuration.includes('search_path=pg_catalog'),
      'Tenant function search_path mismatch');
    assert(tenant.api_execute === true && tenant.worker_execute === true,
      'API and worker must execute tenant function');
    assert(tenant.outbox_execute === false && tenant.retention_execute === false &&
      tenant.admin_execute === false && tenant.operator_execute === false,
      'Tenant function has an unexpected runtime executor');

    console.log(JSON.stringify({
      database: current.database,
      sessionUser: current.session_user,
      serverVersion: current.server_version,
      migrations: migrationSet.size,
      runtimeRoles: roles.rowCount,
      roleMemberships: memberships.rowCount,
      administrativeRoleMemberships: membershipBoundary.safeAdministrative.length,
      unsafeRoleMemberships: membershipBoundary.unsafe.length,
      rlsEnabledAndForced: rls.rowCount,
      policies: policyCount.rows[0].count,
      grants: actualGrants.size,
      status: 'ENTERPRISE_RUNTIME_DB_STRUCTURE_OK'
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
