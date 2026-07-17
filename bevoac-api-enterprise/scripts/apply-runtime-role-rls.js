#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  getDatabaseConfig
} = require('../src/config/env');

const MIGRATION_VERSION =
  '202607170001_runtime_role_rls_boundary_optional';

const MIGRATION_NAME =
  '202607170001_runtime_role_rls_boundary.sql';

const RUNTIME_ROLES = [
  'bevoac_api',
  'bevoac_worker',
  'bevoac_outbox',
  'bevoac_retention',
  'bevoac_admin_api',
  'bevoac_operator'
];

const RLS_TABLES = [
  'tenants',
  'api_keys',
  'azure_onboarding_sessions',
  'tenant_azure_integrations',
  'tenant_azure_scopes',
  'tenant_web_targets',
  'scans',
  'scan_results',
  'scan_attempts',
  'scan_request_idempotency',
  'billing_usage_ledger',
  'billing_monthly_snapshots',
  'outbox_events',
  'retention_audit_log',
  'admin_audit_log'
];

const EXPECTED_POLICY_COUNT = 29;

const EXPECTED_PRIVILEGES =
  [
  "bevoac_admin_api|admin_audit_log|INSERT",
  "bevoac_admin_api|billing_monthly_snapshots|SELECT",
  "bevoac_admin_api|billing_monthly_snapshots|UPDATE",
  "bevoac_admin_api|billing_usage_ledger|SELECT",
  "bevoac_admin_api|tenants|SELECT",
  "bevoac_api|azure_onboarding_sessions|INSERT",
  "bevoac_api|azure_onboarding_sessions|SELECT",
  "bevoac_api|azure_onboarding_sessions|UPDATE",
  "bevoac_api|billing_monthly_snapshots|INSERT",
  "bevoac_api|billing_monthly_snapshots|SELECT",
  "bevoac_api|billing_monthly_snapshots|UPDATE",
  "bevoac_api|billing_usage_ledger|INSERT",
  "bevoac_api|billing_usage_ledger|SELECT",
  "bevoac_api|outbox_events|INSERT",
  "bevoac_api|outbox_events|SELECT",
  "bevoac_api|outbox_events|UPDATE",
  "bevoac_api|scan_request_idempotency|INSERT",
  "bevoac_api|scan_request_idempotency|SELECT",
  "bevoac_api|scan_results|SELECT",
  "bevoac_api|scans|INSERT",
  "bevoac_api|scans|SELECT",
  "bevoac_api|tenant_azure_integrations|INSERT",
  "bevoac_api|tenant_azure_integrations|SELECT",
  "bevoac_api|tenant_azure_integrations|UPDATE",
  "bevoac_api|tenant_azure_scopes|INSERT",
  "bevoac_api|tenant_azure_scopes|SELECT",
  "bevoac_api|tenant_azure_scopes|UPDATE",
  "bevoac_api|tenant_web_targets|SELECT",
  "bevoac_api|tenants|SELECT",
  "bevoac_operator|api_keys|INSERT",
  "bevoac_operator|tenant_azure_scopes|INSERT",
  "bevoac_operator|tenant_azure_scopes|SELECT",
  "bevoac_operator|tenant_azure_scopes|UPDATE",
  "bevoac_operator|tenant_web_targets|INSERT",
  "bevoac_operator|tenant_web_targets|SELECT",
  "bevoac_operator|tenant_web_targets|UPDATE",
  "bevoac_operator|tenants|INSERT",
  "bevoac_operator|tenants|SELECT",
  "bevoac_outbox|outbox_events|SELECT",
  "bevoac_outbox|outbox_events|UPDATE",
  "bevoac_retention|azure_onboarding_sessions|DELETE",
  "bevoac_retention|azure_onboarding_sessions|SELECT",
  "bevoac_retention|retention_audit_log|INSERT",
  "bevoac_retention|scan_request_idempotency|DELETE",
  "bevoac_retention|scan_request_idempotency|SELECT",
  "bevoac_retention|scans|DELETE",
  "bevoac_retention|scans|SELECT",
  "bevoac_retention|tenants|SELECT",
  "bevoac_worker|billing_usage_ledger|INSERT",
  "bevoac_worker|billing_usage_ledger|SELECT",
  "bevoac_worker|scan_attempts|INSERT",
  "bevoac_worker|scan_attempts|SELECT",
  "bevoac_worker|scan_attempts|UPDATE",
  "bevoac_worker|scan_results|INSERT",
  "bevoac_worker|scan_results|SELECT",
  "bevoac_worker|scan_results|UPDATE",
  "bevoac_worker|scans|SELECT",
  "bevoac_worker|scans|UPDATE"
];

function sorted(values) {
  return [...values].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sorted(left)) ===
    JSON.stringify(sorted(right));
}

async function main() {
  if (
    String(
      process.env
        .ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY ||
      ''
    ).toLowerCase() !== 'true'
  ) {
    throw new Error(
      'Refusing to apply runtime role RLS. ' +
      'Set ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY=true ' +
      'after validating the migration.'
    );
  }

  const db = getDatabaseConfig();

  const client = new Client({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    application_name:
      'bevoac-runtime-role-rls-migration'
  });

  await client.connect();

  try {
    const administrator = await client.query(
      `
      SELECT current_user
      `
    );

    if (
      administrator.rows[0]?.current_user !==
      'bevoacadmin'
    ) {
      throw new Error(
        'This migration must be executed ' +
        'with bevoacadmin.'
      );
    }

    const unsafeMigration = await client.query(
      `
      SELECT version
      FROM public.schema_migrations
      WHERE version IN (
        '202606150001_rls_tenant_policies_optional',
        '202607090002_enterprise_rls_runtime_roles_optional'
      )
      `
    );

    if (unsafeMigration.rowCount > 0) {
      throw new Error(
        'A legacy mutable-service-context RLS ' +
        'migration is already recorded.'
      );
    }

    const authenticationBoundary =
      await client.query(
        `
        SELECT version
        FROM public.schema_migrations
        WHERE version =
          '202607160002_secure_api_key_auth_boundary_optional'
        `
      );

    if (authenticationBoundary.rowCount !== 1) {
      throw new Error(
        'The secure API-key authentication ' +
        'boundary must be applied first.'
      );
    }

    const alreadyApplied = await client.query(
      `
      SELECT version
      FROM public.schema_migrations
      WHERE version = $1
      `,
      [MIGRATION_VERSION]
    );

    if (alreadyApplied.rowCount === 1) {
      console.log(
        `[SKIP] ${MIGRATION_NAME}: ` +
        'migration already recorded.'
      );
    } else {
      const migrationPath = path.join(
        __dirname,
        '..',
        'migrations',
        'optional',
        MIGRATION_NAME
      );

      const sql = fs.readFileSync(
        migrationPath,
        'utf8'
      );

      if (/app\.service_context/i.test(sql)) {
        throw new Error(
          'Migration unexpectedly references ' +
          'app.service_context.'
        );
      }

      await client.query('BEGIN');

      try {
        await client.query(
          "SET LOCAL lock_timeout = '10s'"
        );

        await client.query(
          "SET LOCAL statement_timeout = '180s'"
        );

        await client.query(sql);

        await client.query(
          `
          INSERT INTO public.schema_migrations (
            version,
            name
          )
          VALUES ($1, $2)
          `,
          [
            MIGRATION_VERSION,
            MIGRATION_NAME
          ]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client
          .query('ROLLBACK')
          .catch(() => {});

        throw error;
      }
    }

    const rls = await client.query(
      `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
      FROM pg_class AS c
      INNER JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
      `,
      [RLS_TABLES]
    );

    if (
      rls.rowCount !== RLS_TABLES.length ||
      rls.rows.some(
        (row) =>
          row.rls_enabled !== true ||
          row.rls_forced !== true
      )
    ) {
      throw new Error(
        `Unexpected RLS status: ${
          JSON.stringify(rls.rows)
        }`
      );
    }

    const policies = await client.query(
      `
      SELECT
        tablename,
        policyname,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      `,
      [RLS_TABLES]
    );

    if (
      policies.rowCount !==
      EXPECTED_POLICY_COUNT
    ) {
      throw new Error(
        `Expected ${EXPECTED_POLICY_COUNT} ` +
        `policies, found ${policies.rowCount}.`
      );
    }

    const unsafePolicy = policies.rows.find(
      (row) =>
        /app\.service_context/i.test(
          `${row.qual || ''} ${
            row.with_check || ''
          }`
        )
    );

    if (unsafePolicy) {
      throw new Error(
        `Unsafe policy detected: ${
          unsafePolicy.policyname
        }`
      );
    }

    const privileges = await client.query(
      `
      SELECT
        grantee,
        table_name,
        privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee = ANY($1::text[])
      ORDER BY
        grantee,
        table_name,
        privilege_type
      `,
      [RUNTIME_ROLES]
    );

    const actualPrivileges =
      privileges.rows.map(
        (row) =>
          `${row.grantee}|` +
          `${row.table_name}|` +
          `${row.privilege_type}`
      );

    if (
      !sameValues(
        actualPrivileges,
        EXPECTED_PRIVILEGES
      )
    ) {
      throw new Error(
        'Runtime table privilege matrix differs ' +
        'from the expected least-privilege matrix.\n' +
        `Expected: ${
          JSON.stringify(
            sorted(EXPECTED_PRIVILEGES)
          )
        }\n` +
        `Actual: ${
          JSON.stringify(
            sorted(actualPrivileges)
          )
        }`
      );
    }

    const functions = await client.query(
      `
      SELECT
        role_name,
        function_name,
        can_execute
      FROM (
        SELECT
          r.rolname AS role_name,
          'bevoac_current_tenant_id' AS function_name,
          has_function_privilege(
            r.rolname,
            'public.bevoac_current_tenant_id()',
            'EXECUTE'
          ) AS can_execute
        FROM pg_roles AS r
        WHERE r.rolname = ANY($1::text[])

        UNION ALL

        SELECT
          r.rolname AS role_name,
          'bevoac_authenticate_api_key' AS function_name,
          has_function_privilege(
            r.rolname,
            'public.bevoac_authenticate_api_key(character varying)',
            'EXECUTE'
          ) AS can_execute
        FROM pg_roles AS r
        WHERE r.rolname = ANY($1::text[])
      ) AS permissions
      ORDER BY function_name, role_name
      `,
      [RUNTIME_ROLES]
    );

    for (const row of functions.rows) {
      const expected =
        row.function_name ===
          'bevoac_current_tenant_id'
          ? [
              'bevoac_api',
              'bevoac_worker'
            ].includes(row.role_name)
          : row.role_name ===
              'bevoac_api';

      if (row.can_execute !== expected) {
        throw new Error(
          'Unexpected function privilege: ' +
          JSON.stringify(row)
        );
      }
    }

    console.log(
      'Enterprise runtime role RLS boundary ' +
      'applied and verified.'
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
