#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const REQUIRED_APPROVAL = 'ALLOW_RUNTIME_ROLE_SYNC';
const ROLE_DEFINITIONS = Object.freeze([
  ['bevoac_api', 'PG_API_PASSWORD'],
  ['bevoac_worker', 'PG_WORKER_PASSWORD'],
  ['bevoac_outbox', 'PG_OUTBOX_PASSWORD'],
  ['bevoac_retention', 'PG_RETENTION_PASSWORD'],
  ['bevoac_admin_api', 'PG_ADMIN_API_PASSWORD'],
  ['bevoac_operator', 'PG_OPERATOR_PASSWORD']
]);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function roleSql(client, template, role, password) {
  const result = await client.query(
    'SELECT format($1::text, $2::text, $3::text) AS sql',
    [template, role, password]
  );
  return result.rows[0].sql;
}

async function main() {
  if (process.env[REQUIRED_APPROVAL] !== 'true') {
    throw new Error(
      `${REQUIRED_APPROVAL}=true is required. No role was modified.`
    );
  }

  const definitions = ROLE_DEFINITIONS.map(([role, variable]) => ({
    role,
    password: required(variable)
  }));
  const database = getDatabaseConfig();
  const client = new Client(database);

  await client.connect();
  try {
    const identity = await client.query(
      `SELECT session_user,
              rolsuper,
              rolcreaterole,
              rolbypassrls
       FROM pg_roles
       WHERE rolname = session_user`
    );
    if (identity.rowCount !== 1 || !identity.rows[0].rolcreaterole) {
      throw new Error(
        'The PostgreSQL administration login must have CREATEROLE.'
      );
    }

    await client.query('BEGIN');
    for (const definition of definitions) {
      const exists = await client.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [definition.role]
      );
      const template = exists.rowCount === 0
        ? 'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT NOREPLICATION NOBYPASSRLS'
        : 'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT NOREPLICATION NOBYPASSRLS';
      const sql = await roleSql(
        client,
        template,
        definition.role,
        definition.password
      );
      await client.query(sql);
    }
    await client.query('COMMIT');

    const validation = await client.query(
      `SELECT rolname, rolcanlogin, rolinherit, rolsuper,
              rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       FROM pg_roles
       WHERE rolname = ANY($1::text[])
       ORDER BY rolname`,
      [definitions.map((definition) => definition.role)]
    );
    if (validation.rowCount !== definitions.length) {
      throw new Error(
        `Expected ${definitions.length} runtime roles, got ${validation.rowCount}.`
      );
    }
    for (const role of validation.rows) {
      if (
        !role.rolcanlogin || role.rolinherit || role.rolsuper ||
        role.rolcreaterole || role.rolcreatedb || role.rolreplication ||
        role.rolbypassrls
      ) {
        throw new Error(`Runtime role is not hardened: ${role.rolname}`);
      }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log('RUNTIME_DATABASE_ROLES_SYNCHRONIZED=true');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  ROLE_DEFINITIONS,
  main
};
