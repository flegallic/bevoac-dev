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
const { getDatabaseConfig } = require('../src/config/env');

const MIGRATION_VERSION =
  '202607160002_secure_api_key_auth_boundary_optional';

const MIGRATION_NAME =
  '202607160002_secure_api_key_auth_boundary.sql';

async function main() {
  if (
    String(
      process.env.ALLOW_SECURE_API_KEY_AUTH_APPLY || ''
    ).toLowerCase() !== 'true'
  ) {
    throw new Error(
      'Refusing to apply the secure API-key authentication boundary. ' +
      'Set ALLOW_SECURE_API_KEY_AUTH_APPLY=true after validation.'
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
    application_name: 'bevoac-secure-api-key-auth-migration'
  });

  await client.connect();

  try {
    const administrator = await client.query(
      `
      SELECT
        current_user,
        rolcreaterole,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
      `
    );

    if (
      administrator.rowCount !== 1 ||
      administrator.rows[0].current_user !== 'bevoacadmin'
    ) {
      throw new Error(
        'This migration must be executed with bevoacadmin.'
      );
    }

    const runtimeRole = await client.query(
      `
      SELECT
        rolcanlogin,
        rolsuper,
        rolcreaterole,
        rolcreatedb,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = 'bevoac_api'
      `
    );

    if (runtimeRole.rowCount !== 1) {
      throw new Error(
        'Required PostgreSQL role bevoac_api does not exist.'
      );
    }

    const role = runtimeRole.rows[0];

    if (
      role.rolcanlogin !== true ||
      role.rolsuper !== false ||
      role.rolcreaterole !== false ||
      role.rolcreatedb !== false ||
      role.rolbypassrls !== false
    ) {
      throw new Error(
        'PostgreSQL role bevoac_api does not have the expected restrictions.'
      );
    }

    await client.query(
      `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(120) PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
      `
    );

    const alreadyApplied = await client.query(
      `
      SELECT version
      FROM schema_migrations
      WHERE version = $1
      `,
      [MIGRATION_VERSION]
    );

    if (alreadyApplied.rowCount === 1) {
      console.log(
        `[SKIP] ${MIGRATION_NAME}: migration already recorded.`
      );
      return;
    }

    const migrationPath = path.join(
      __dirname,
      '..',
      'migrations',
      'optional',
      MIGRATION_NAME
    );

    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.query('BEGIN');

    try {
      await client.query(sql);

      await client.query(
        `
        INSERT INTO schema_migrations (
          version,
          name
        )
        VALUES ($1, $2)
        `,
        [MIGRATION_VERSION, MIGRATION_NAME]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }

    const verification = await client.query(
      `
      SELECT
        p.prosecdef AS security_definer,
        pg_get_userbyid(p.proowner) AS function_owner,
        has_function_privilege(
          'bevoac_api',
          p.oid,
          'EXECUTE'
        ) AS api_can_execute,
        has_function_privilege(
          'bevoac_worker',
          p.oid,
          'EXECUTE'
        ) AS worker_can_execute,
        has_function_privilege(
          'bevoac_admin_api',
          p.oid,
          'EXECUTE'
        ) AS admin_api_can_execute,
        NOT EXISTS (
          SELECT 1
          FROM aclexplode(p.proacl)
          WHERE grantee = 0
            AND privilege_type = 'EXECUTE'
        ) AS public_execute_revoked
      FROM pg_proc AS p
      INNER JOIN pg_namespace AS n
        ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'bevoac_authenticate_api_key'
        AND pg_get_function_identity_arguments(p.oid) =
          'p_key_hash character varying'
      `
    );

    if (verification.rowCount !== 1) {
      throw new Error(
        'The authentication function could not be verified.'
      );
    }

    const result = verification.rows[0];

    if (
      result.security_definer !== true ||
      result.function_owner !== 'bevoacadmin' ||
      result.api_can_execute !== true ||
      result.worker_can_execute !== false ||
      result.admin_api_can_execute !== false ||
      result.public_execute_revoked !== true
    ) {
      throw new Error(
        `Unexpected function permissions: ${JSON.stringify(result)}`
      );
    }

    console.log(
      'Secure API-key authentication boundary applied and verified.'
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
