#!/usr/bin/env node
'use strict';

const { Client } = require('pg');
const {
  classifyRuntimeRoleMemberships
} = require('../lib/runtime-role-memberships');

const host = process.env.CI_PG_HOST || '127.0.0.1';
const port = Number(process.env.CI_PG_PORT || 5432);
const database = process.env.CI_PG_DATABASE || 'bevoac_ci';

const passwords = Object.freeze({
  bevoacadmin:
    process.env.CI_PG_ADMIN_PASSWORD || 'bevoacadmin-ci-password',
  bevoac_api:
    process.env.CI_PG_API_PASSWORD || 'bevoac-api-ci-password',
  bevoac_worker:
    process.env.CI_PG_WORKER_PASSWORD || 'bevoac-worker-ci-password',
  bevoac_outbox:
    process.env.CI_PG_OUTBOX_PASSWORD || 'bevoac-outbox-ci-password',
  bevoac_retention:
    process.env.CI_PG_RETENTION_PASSWORD || 'bevoac-retention-ci-password',
  bevoac_admin_api:
    process.env.CI_PG_ADMIN_API_PASSWORD || 'bevoac-admin-api-ci-password',
  bevoac_operator:
    process.env.CI_PG_OPERATOR_PASSWORD || 'bevoac-operator-ci-password'
});

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const expectedGrants = new Set([
  'bevoac_admin_api|admin_audit_log|INSERT',
  'bevoac_admin_api|billing_monthly_snapshots|SELECT',
  'bevoac_admin_api|billing_monthly_snapshots|UPDATE',
  'bevoac_admin_api|billing_usage_ledger|SELECT',
  'bevoac_admin_api|tenants|SELECT',

  'bevoac_api|azure_onboarding_sessions|INSERT',
  'bevoac_api|azure_onboarding_sessions|SELECT',
  'bevoac_api|azure_onboarding_sessions|UPDATE',
  'bevoac_api|billing_monthly_snapshots|INSERT',
  'bevoac_api|billing_monthly_snapshots|SELECT',
  'bevoac_api|billing_monthly_snapshots|UPDATE',
  'bevoac_api|billing_usage_ledger|INSERT',
  'bevoac_api|billing_usage_ledger|SELECT',
  'bevoac_api|outbox_events|INSERT',
  'bevoac_api|outbox_events|SELECT',
  'bevoac_api|outbox_events|UPDATE',
  'bevoac_api|scan_request_idempotency|INSERT',
  'bevoac_api|scan_request_idempotency|SELECT',
  'bevoac_api|scan_results|SELECT',
  'bevoac_api|scans|INSERT',
  'bevoac_api|scans|SELECT',
  'bevoac_api|tenant_azure_integrations|INSERT',
  'bevoac_api|tenant_azure_integrations|SELECT',
  'bevoac_api|tenant_azure_integrations|UPDATE',
  'bevoac_api|tenant_azure_scopes|INSERT',
  'bevoac_api|tenant_azure_scopes|SELECT',
  'bevoac_api|tenant_azure_scopes|UPDATE',
  'bevoac_api|tenant_web_targets|SELECT',
  'bevoac_api|tenants|SELECT',

  'bevoac_operator|api_keys|INSERT',
  'bevoac_operator|tenant_azure_scopes|INSERT',
  'bevoac_operator|tenant_azure_scopes|SELECT',
  'bevoac_operator|tenant_azure_scopes|UPDATE',
  'bevoac_operator|tenant_web_targets|INSERT',
  'bevoac_operator|tenant_web_targets|SELECT',
  'bevoac_operator|tenant_web_targets|UPDATE',
  'bevoac_operator|tenants|INSERT',
  'bevoac_operator|tenants|SELECT',

  'bevoac_outbox|outbox_events|SELECT',
  'bevoac_outbox|outbox_events|UPDATE',

  'bevoac_retention|azure_onboarding_sessions|DELETE',
  'bevoac_retention|azure_onboarding_sessions|SELECT',
  'bevoac_retention|retention_audit_log|INSERT',
  'bevoac_retention|scan_request_idempotency|DELETE',
  'bevoac_retention|scan_request_idempotency|SELECT',
  'bevoac_retention|scans|DELETE',
  'bevoac_retention|scans|SELECT',
  'bevoac_retention|tenants|SELECT',

  'bevoac_worker|billing_usage_ledger|INSERT',
  'bevoac_worker|billing_usage_ledger|SELECT',
  'bevoac_worker|scan_attempts|INSERT',
  'bevoac_worker|scan_attempts|SELECT',
  'bevoac_worker|scan_attempts|UPDATE',
  'bevoac_worker|scan_results|INSERT',
  'bevoac_worker|scan_results|SELECT',
  'bevoac_worker|scan_results|UPDATE',
  'bevoac_worker|scans|SELECT',
  'bevoac_worker|scans|UPDATE'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function config(role) {
  return {
    host,
    port,
    database,
    user: role,
    password: passwords[role],
    ssl: false
  };
}

async function expectPermissionDenied(client, sql, parameters = []) {
  try {
    await client.query(sql, parameters);
  } catch (error) {
    if (error.code === '42501') return;
    throw error;
  }
  throw new Error(`Expected permission denial for SQL: ${sql}`);
}

async function verifyAdminState() {
  const client = new Client(config('bevoacadmin'));
  await client.connect();

  try {
    const summary = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.schema_migrations) AS migrations,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies,
        (
          SELECT count(*)::int
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND c.relrowsecurity
        ) AS rls_enabled,
        (
          SELECT count(*)::int
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND c.relforcerowsecurity
        ) AS rls_forced,
        1 AS boundary_version
    `);

    const row = summary.rows[0];
    assert(row.migrations === 8, `Expected 8 migrations, got ${row.migrations}`);
    assert(row.policies === 29, `Expected 29 policies, got ${row.policies}`);
    assert(row.rls_enabled === 15, `Expected 15 RLS tables, got ${row.rls_enabled}`);
    assert(row.rls_forced === 15, `Expected 15 forced RLS tables, got ${row.rls_forced}`);

    const runtimeRoles = [
      'bevoac_api', 'bevoac_worker', 'bevoac_outbox',
      'bevoac_retention', 'bevoac_admin_api', 'bevoac_operator'
    ];
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
    `, [runtimeRoles]);
    const membershipBoundary = classifyRuntimeRoleMemberships(
      memberships.rows,
      runtimeRoles,
      'bevoacadmin'
    );
    assert(membershipBoundary.safeAdministrative.length === 6,
      `Expected six PostgreSQL 16 administrative memberships, got ${membershipBoundary.safeAdministrative.length}`);
    assert(membershipBoundary.unsafe.length === 0,
      `Unexpected runtime role memberships: ${JSON.stringify(membershipBoundary.unsafe)}`);

    const roles = await client.query(`
      SELECT rolname, rolcanlogin, rolinherit, rolsuper,
             rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname IN (
        'bevoac_api', 'bevoac_worker', 'bevoac_outbox',
        'bevoac_retention', 'bevoac_admin_api', 'bevoac_operator'
      )
      ORDER BY rolname
    `);

    assert(roles.rowCount === 6, `Expected 6 runtime roles, got ${roles.rowCount}`);
    for (const role of roles.rows) {
      assert(role.rolcanlogin === true, `${role.rolname} must LOGIN`);
      assert(role.rolinherit === false, `${role.rolname} must NOINHERIT`);
      assert(role.rolsuper === false, `${role.rolname} must NOSUPERUSER`);
      assert(role.rolcreaterole === false, `${role.rolname} must NOCREATEROLE`);
      assert(role.rolcreatedb === false, `${role.rolname} must NOCREATEDB`);
      assert(role.rolreplication === false, `${role.rolname} must NOREPLICATION`);
      assert(role.rolbypassrls === false, `${role.rolname} must NOBYPASSRLS`);
    }

    const grants = await client.query(`
      SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN (
          'bevoac_api', 'bevoac_worker', 'bevoac_outbox',
          'bevoac_retention', 'bevoac_admin_api', 'bevoac_operator'
        )
      ORDER BY grantee, table_name, privilege_type
    `);

    const actual = new Set(
      grants.rows.map((grant) =>
        `${grant.grantee}|${grant.table_name}|${grant.privilege_type}`
      )
    );

    const missing = [...expectedGrants].filter((grant) => !actual.has(grant));
    const unexpected = [...actual].filter((grant) => !expectedGrants.has(grant));

    assert(actual.size === 58, `Expected 58 grants, got ${actual.size}`);
    assert(missing.length === 0, `Missing grants: ${missing.join(', ')}`);
    assert(unexpected.length === 0, `Unexpected grants: ${unexpected.join(', ')}`);

    const authBoundary = await client.query(`
      SELECT
        pg_get_userbyid(p.proowner) AS owner,
        p.prosecdef AS security_definer,
        p.proconfig AS configuration,
        has_function_privilege(
          'bevoac_api',
          'public.bevoac_authenticate_api_key(character varying)',
          'EXECUTE'
        ) AS api_execute,
        has_function_privilege(
          'bevoac_worker',
          'public.bevoac_authenticate_api_key(character varying)',
          'EXECUTE'
        ) AS worker_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'bevoac_authenticate_api_key'
    `);

    assert(authBoundary.rowCount === 1, 'Authentication function is missing');
    const auth = authBoundary.rows[0];
    assert(auth.owner === 'bevoacadmin', 'Authentication function owner mismatch');
    assert(auth.security_definer === true, 'Authentication function must be SECURITY DEFINER');
    assert(Array.isArray(auth.configuration) && auth.configuration.includes('search_path=pg_catalog'), 'Authentication function search_path mismatch');
    assert(auth.api_execute === true, 'bevoac_api must execute authentication function');
    assert(auth.worker_execute === false, 'bevoac_worker must not execute authentication function');
  } finally {
    await client.end();
  }
}

async function verifyApiRole() {
  const client = new Client(config('bevoac_api'));
  await client.connect();
  try {
    const empty = await client.query('SELECT count(*)::int AS count FROM public.scans');
    assert(empty.rows[0].count === 0, 'API must see zero scans without tenant context');
    await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [TENANT_A]);
    const visible = await client.query('SELECT tenant_id FROM public.scans ORDER BY id');
    assert(visible.rowCount === 2, `API should see two Tenant A scans, got ${visible.rowCount}`);
    assert(visible.rows.every((row) => row.tenant_id === TENANT_A), 'API saw another tenant');
    await expectPermissionDenied(client, 'SELECT count(*) FROM public.api_keys');
    await expectPermissionDenied(client, 'SET ROLE bevoacadmin');
  } finally {
    await client.end();
  }
}

async function verifyWorkerRole() {
  const client = new Client(config('bevoac_worker'));
  await client.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [TENANT_A]);
    const visible = await client.query('SELECT count(*)::int AS count FROM public.scans');
    assert(visible.rows[0].count === 2, 'Worker tenant visibility mismatch');
    await expectPermissionDenied(client, 'SELECT count(*) FROM public.tenants');
    await expectPermissionDenied(
      client,
      "SELECT count(*) FROM public.bevoac_authenticate_api_key($1::varchar)",
      ['not-a-real-hash']
    );
  } finally {
    await client.end();
  }
}

async function verifyGlobalRole(role, checks) {
  const client = new Client(config(role));
  await client.connect();
  try {
    for (const check of checks) await check(client);
  } finally {
    await client.end();
  }
}

async function main() {
  await verifyAdminState();
  await verifyApiRole();
  await verifyWorkerRole();

  await verifyGlobalRole('bevoac_outbox', [
    async (client) => {
      const result = await client.query('SELECT count(*)::int AS count FROM public.outbox_events');
      assert(result.rows[0].count === 2, 'Outbox global visibility mismatch');
      await expectPermissionDenied(client, "INSERT INTO public.outbox_events(id, aggregate_type, aggregate_id, tenant_id, event_type, payload) VALUES (gen_random_uuid(), 'scan', gen_random_uuid(), $1, 'forbidden', '{}'::jsonb)", [TENANT_A]);
    }
  ]);

  await verifyGlobalRole('bevoac_retention', [
    async (client) => {
      const result = await client.query('SELECT count(*)::int AS count FROM public.tenants');
      assert(result.rows[0].count === 2, 'Retention global visibility mismatch');
      await expectPermissionDenied(client, 'SELECT count(*) FROM public.outbox_events');
    }
  ]);

  await verifyGlobalRole('bevoac_admin_api', [
    async (client) => {
      const result = await client.query('SELECT count(*)::int AS count FROM public.billing_usage_ledger');
      assert(result.rows[0].count === 3, 'Admin API billing visibility mismatch');
      await expectPermissionDenied(client, 'SELECT count(*) FROM public.scans');
    }
  ]);

  await verifyGlobalRole('bevoac_operator', [
    async (client) => {
      const result = await client.query('SELECT count(*)::int AS count FROM public.tenants');
      assert(result.rows[0].count === 2, 'Operator tenant visibility mismatch');
      await expectPermissionDenied(client, 'SELECT count(*) FROM public.api_keys');
      await expectPermissionDenied(client, 'SELECT count(*) FROM public.scans');
    }
  ]);

  console.log('ENTERPRISE_DB_VERIFICATION_OK=true');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
