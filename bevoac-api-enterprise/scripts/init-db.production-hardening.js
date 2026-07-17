if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const crypto = require('crypto');
const { getDatabaseConfig } = require('../src/config/env');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      ALTER TABLE scans ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS processing_attempt_id UUID;
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS result_size_bytes INTEGER;
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS result_sha256 VARCHAR(64);

      CREATE TABLE IF NOT EXISTS scan_results (
        scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        result_json JSONB,
        result_gzip_base64 TEXT,
        compression VARCHAR(30) NOT NULL DEFAULT 'none',
        result_size_bytes INTEGER NOT NULL,
        result_sha256 VARCHAR(64) NOT NULL,
        result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_scan_result_compression CHECK (compression IN ('none','gzip_base64')),
        CONSTRAINT valid_scan_result_payload CHECK ((compression = 'none' AND result_json IS NOT NULL) OR (compression = 'gzip_base64' AND result_gzip_base64 IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS scan_attempts (
        attempt_id UUID PRIMARY KEY,
        scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        worker_name VARCHAR(255),
        servicebus_message_id VARCHAR(255),
        servicebus_delivery_count INTEGER,
        status VARCHAR(30) NOT NULL DEFAULT 'STARTED',
        error_message TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        CONSTRAINT valid_scan_attempt_status CHECK (status IN ('STARTED','COMPLETED','FAILED','SKIPPED'))
      );

      CREATE TABLE IF NOT EXISTS retention_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action VARCHAR(120) NOT NULL,
        affected_rows INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_scans_tenant_status_created ON scans (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scans_quota_status ON scans (tenant_id, quota_month, status);
      CREATE INDEX IF NOT EXISTS idx_scan_results_tenant_updated ON scan_results (tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scan_results_summary_gin ON scan_results USING GIN (result_summary);
      CREATE INDEX IF NOT EXISTS idx_scan_attempts_scan_started ON scan_attempts (scan_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_idempotency_created ON scan_request_idempotency (created_at);
      CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_expires ON azure_onboarding_sessions (expires_at, status);
    `);

    const legacy = await client.query('SELECT id, tenant_id, result FROM scans WHERE result IS NOT NULL AND id NOT IN (SELECT scan_id FROM scan_results)');
    for (const row of legacy.rows) {
      const json = typeof row.result === 'string' ? row.result : JSON.stringify(row.result);
      let summary = {};
      try {
        const result = JSON.parse(json);
        const findings = [];
        if (Array.isArray(result?.webSecurity?.findings)) findings.push(...result.webSecurity.findings);
        if (Array.isArray(result?.microsoft_entra?.findings)) findings.push(...result.microsoft_entra.findings);
        if (Array.isArray(result?.azure_infrastructure?.findings)) findings.push(...result.azure_infrastructure.findings);
        const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, UNKNOWN: 0 };
        for (const finding of findings) {
          const severity = String(finding?.severity || 'UNKNOWN').toUpperCase();
          bySeverity[Object.prototype.hasOwnProperty.call(bySeverity, severity) ? severity : 'UNKNOWN'] += 1;
        }
        summary = { findingCount: findings.length, bySeverity, migratedFromLegacyScansResult: true, migratedAt: new Date().toISOString() };
      } catch (_) {
        summary = { migratedFromLegacyScansResult: true, parseError: true, migratedAt: new Date().toISOString() };
      }
      await client.query(
        `INSERT INTO scan_results (scan_id, tenant_id, result_json, compression, result_size_bytes, result_sha256, result_summary, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 'none', $4, $5, $6::jsonb, NOW(), NOW())
         ON CONFLICT (scan_id) DO NOTHING`,
        [row.id, row.tenant_id, json, Buffer.byteLength(json, 'utf8'), sha256(json), JSON.stringify(summary)]
      );
    }
    await client.query('COMMIT');
    console.log('Production hardening schema initialized successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
