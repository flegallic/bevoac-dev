#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch (_) {} }
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function setService(client) {
  await client.query(`SELECT set_config('app.service_context','bevoac_admin_service', true), set_config('app.current_tenant_id','', true)`);
}
async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant_id',$1, true), set_config('app.service_context','', true)`, [tenantId]);
}

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const scanA = randomUUID();
  const scanB = randomUUID();
  try {
    await client.query('BEGIN');
    await setService(client);
    const rls = await client.query(`SELECT table_name, rls_enabled, force_rls, policy_count FROM bevoac_rls_status WHERE table_name IN ('scans','scan_results','billing_usage_ledger')`);
    if (rls.rowCount < 3 || rls.rows.some((row) => !row.rls_enabled || !row.force_rls || Number(row.policy_count) < 1)) {
      throw new Error(`RLS status is not enterprise-ready: ${JSON.stringify(rls.rows)}`);
    }
    await client.query(`INSERT INTO tenants(id, company_name, plan_code, is_active) VALUES ($1,'Isolation A','standard',TRUE),($2,'Isolation B','standard',TRUE)`, [tenantA, tenantB]);
    await client.query(`INSERT INTO scans(id, tenant_id, cloud_provider, scan_profile, modules, quota_month, status, billing_state) VALUES ($1,$2,'azure','web','["web"]'::jsonb, date_trunc('month', now())::date, 'DONE', 'CONSUMED'), ($3,$4,'azure','web','["web"]'::jsonb, date_trunc('month', now())::date, 'DONE', 'CONSUMED')`, [scanA, tenantA, scanB, tenantB]);
    await setTenant(client, tenantA);
    const visible = await client.query(`SELECT id, tenant_id FROM scans ORDER BY tenant_id`);
    if (visible.rowCount !== 1 || String(visible.rows[0].tenant_id) !== tenantA) {
      throw new Error(`Tenant isolation failed. Expected only tenant A, got: ${JSON.stringify(visible.rows)}`);
    }
    await client.query('ROLLBACK');
    console.log('Enterprise tenant isolation check passed: cross-tenant reads are denied under tenant context.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
