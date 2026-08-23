const { randomUUID } = require('crypto');
const { NotFoundError, ConflictError, IdempotencyConflictError, ValidationError } = require('../lib/errors');
const { ensureAuthorizedWebTarget, resolveAuthorizedAzureTenant, resolveAuthorizedAzureSubscriptions } = require('../lib/target-authorization');
const { buildResultSummary, loadResultForScan, jsonByteLength } = require('./result-store');
const { OutboxService } = require('./outbox-service');
const { SCAN_MESSAGE_VERSION } = require('../lib/scan-message-version');
const { summarizeFindings, collectFindings, emptySeveritySummary } = require('../lib/findings-collector');
const { withTenantSession, withTenantTransaction } = require('../lib/db-context');
const { sha256Canonical } = require('../lib/canonical-json');
const { MODULE_BY_NAME } = require('../lib/module-catalog');

function summarizeSeverities(result) {
  if (!result) return emptySeveritySummary();
  const prebuilt = result?.bySeverity || result?.severitySummary?.bySeverity;
  if (prebuilt && typeof prebuilt === 'object') {
    const summary = emptySeveritySummary();
    for (const severity of Object.keys(summary)) summary[severity] = Number(prebuilt[severity] || 0);
    return summary;
  }
  return summarizeFindings(collectFindings(result)).bySeverity;
}

function resolveIdempotency(input) {
  if (input && String(input).trim() !== '') {
    const key = String(input).trim();
    if (key.length > 255) {
      throw new ValidationError('Idempotency-Key must not exceed 255 characters.');
    }
    if (/\s|[\x00-\x1f\x7f]/u.test(key)) {
      throw new ValidationError('Idempotency-Key must not contain whitespace or control characters.');
    }
    return { key, source: 'client_supplied' };
  }
  return { key: randomUUID(), source: 'server_generated' };
}

function normalizeFingerprintRequest({ cloudProvider, scanProfile, modules, azure }) {
  return {
    cloudProvider: String(cloudProvider || '').trim().toLowerCase(),
    scanProfile: String(scanProfile || '').trim().toLowerCase(),
    modules: [...new Set(Array.isArray(modules) ? modules.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [])].sort(),
    azure: {
      targetUrl: azure?.targetUrl ? String(azure.targetUrl) : null,
      microsoftTenantId: azure?.microsoftTenantId ? String(azure.microsoftTenantId).toLowerCase() : null,
      subscriptions: [...new Set(Array.isArray(azure?.subscriptions) ? azure.subscriptions.map((item) => String(item).toLowerCase()) : [])].sort()
    }
  };
}

function buildRequestFingerprint(input) {
  return sha256Canonical(normalizeFingerprintRequest(input));
}

function buildStoredRequestFingerprint(row) {
  return buildRequestFingerprint({
    cloudProvider: row.cloud_provider,
    scanProfile: row.scan_profile,
    modules: Array.isArray(row.modules) ? row.modules : [],
    azure: {
      targetUrl: row.target_url || null,
      microsoftTenantId: row.microsoft_tenant_id || null,
      subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : []
    }
  });
}

function assertIdempotencyFingerprint(expected, actual, idempotencyKey) {
  if (expected !== actual) {
    throw new IdempotencyConflictError(
      'The Idempotency-Key has already been used for a different scan request.',
      { idempotencyKey }
    );
  }
}

function existingScanResponse(row) {
  return {
    scanId: row.scan_id,
    status: row.status,
    reused: true,
    idempotencyKey: row.idempotency_key,
    idempotencyKeySource: row.idempotency_key_source,
    createdAt: row.created_at,
    billing: {
      billingUnits: row.billing_units,
      isQuotaIncluded: row.is_quota_included,
      quotaMonth: row.quota_month,
      resourceLimit: row.resource_limit,
      billingState: row.billing_state
    },
    azure: {
      targetUrl: row.target_url || null,
      microsoftTenantId: row.microsoft_tenant_id || null,
      subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : []
    }
  };
}

function buildScanRequestedMessage({ scanId, tenantId, cloudProvider, scanProfile, modules, azure, billing, requestId }) {
  return {
    version: SCAN_MESSAGE_VERSION,
    scanId,
    tenantId,
    cloudProvider,
    scanProfile,
    modules,
    azure: {
      targetUrl: azure?.targetUrl || null,
      microsoftTenantId: azure?.microsoftTenantId || null,
      subscriptions: Array.isArray(azure?.subscriptions) ? azure.subscriptions : []
    },
    limits: {
      planCode: billing?.planCode || null,
      billingUnits: billing?.billingUnits || 1,
      quotaMonth: billing?.quotaMonth || null,
      resourceLimit: billing?.resourceLimit ?? null
    },
    requestedAt: new Date().toISOString(),
    requestId: requestId || scanId
  };
}

class ScanService {
  constructor(pg, billingService, config = {}) {
    this.pg = pg;
    this.billingService = billingService;
    this.config = config;
    this.outboxService = new OutboxService(pg, null, config);
  }

  async authorizeCustomerTargets(client, { tenantId, modules, azure }) {
    const normalizedAzure = { ...(azure || {}) };
    const requestedModules = Array.isArray(modules) ? modules : [];
    if (requestedModules.includes('web') && normalizedAzure.targetUrl) {
      const target = await ensureAuthorizedWebTarget(client, { tenantId, targetUrl: normalizedAzure.targetUrl });
      normalizedAzure.targetUrl = target.url;
    }
    const requestedDescriptors = requestedModules.map((moduleName) => {
      const descriptor = MODULE_BY_NAME.get(moduleName);
      if (!descriptor) throw new Error(`Module catalog entry not found for ${moduleName}.`);
      return descriptor;
    });
    const needsAzureTenant = requestedDescriptors.some((descriptor) => ['tenant', 'subscription'].includes(descriptor.scope));
    const needsAzureSubscriptions = requestedDescriptors.some((descriptor) => descriptor.scope === 'subscription');
    if (needsAzureSubscriptions) {
      const resolved = await resolveAuthorizedAzureSubscriptions(client, { tenantId, microsoftTenantId: normalizedAzure.microsoftTenantId || null, subscriptionIds: normalizedAzure.subscriptions || [] });
      normalizedAzure.microsoftTenantId = resolved.microsoftTenantId;
      normalizedAzure.subscriptions = resolved.subscriptions;
    } else if (needsAzureTenant) {
      const resolved = await resolveAuthorizedAzureTenant(client, { tenantId, microsoftTenantId: normalizedAzure.microsoftTenantId || null });
      normalizedAzure.microsoftTenantId = resolved.microsoftTenantId;
      normalizedAzure.subscriptions = [];
    }
    return normalizedAzure;
  }

  resolveBillingUnitsForAuthorizedScan(scanProfile, authorizedAzure) {
    if (scanProfile === 'infra' || scanProfile === 'full') return Math.max(1, Array.isArray(authorizedAzure?.subscriptions) ? authorizedAzure.subscriptions.length : 1);
    return 1;
  }

  async createScanRequest({ tenantId, cloudProvider, scanProfile, modules, azure, idempotencyKey, requestId }) {
    const idem = resolveIdempotency(idempotencyKey);
    let requestFingerprint = null;

    const selectExisting = async (client) => client.query(
      `
      SELECT s.id AS scan_id, s.status, s.cloud_provider, s.scan_profile, s.modules,
             s.target_url, s.microsoft_tenant_id, s.subscriptions,
             s.billing_units, s.is_quota_included, s.quota_month, s.resource_limit,
             s.billing_state, i.idempotency_key,
             COALESCE(i.idempotency_key_source, 'client_supplied') AS idempotency_key_source,
             i.request_fingerprint, s.created_at
      FROM scan_request_idempotency i
      INNER JOIN scans s ON s.id = i.scan_id AND s.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.idempotency_key = $2
      LIMIT 1
      `,
      [tenantId, idem.key]
    );

    try {
      return await withTenantTransaction(this.pg, tenantId, async (client) => {
        const authorizedAzure = await this.authorizeCustomerTargets(client, { tenantId, modules, azure });
        requestFingerprint = buildRequestFingerprint({ cloudProvider, scanProfile, modules, azure: authorizedAzure });

        const existing = await selectExisting(client);
        if (existing.rowCount === 1) {
          const row = existing.rows[0];
          const storedFingerprint = row.request_fingerprint || buildStoredRequestFingerprint(row);
          assertIdempotencyFingerprint(storedFingerprint, requestFingerprint, idem.key);
          return existingScanResponse(row);
        }

        const effectiveBillingUnits = this.resolveBillingUnitsForAuthorizedScan(scanProfile, authorizedAzure);
        const authorization = await this.billingService.authorizeScan(client, {
          tenantId,
          billingUnits: effectiveBillingUnits,
          cloudProvider,
          scanProfile,
          modules,
          metadata: {
            targetUrl: authorizedAzure.targetUrl || null,
            microsoftTenantId: authorizedAzure.microsoftTenantId || null,
            subscriptions: authorizedAzure.subscriptions || []
          }
        });

        const scanId = randomUUID();
        await client.query(
          `
          INSERT INTO scans (
            id, tenant_id, cloud_provider, scan_profile, modules, target_url,
            microsoft_tenant_id, subscriptions, billing_units, is_quota_included,
            quota_month, resource_limit, status, billing_state, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11::date, $12, 'PENDING', 'RESERVED', NOW(), NOW())
          `,
          [scanId, tenantId, cloudProvider, scanProfile, JSON.stringify(modules), authorizedAzure.targetUrl || null, authorizedAzure.microsoftTenantId || null, JSON.stringify(authorizedAzure.subscriptions || []), effectiveBillingUnits, authorization.billing.isQuotaIncluded, authorization.billing.quotaMonth, authorization.plan.resourceLimit]
        );

        await this.billingService.recordLedgerEvent(client, {
          tenantId,
          scanId,
          eventType: 'scan_reserved',
          planCodeSnapshot: authorization.tenant.plan_code,
          quotaMonth: authorization.billing.quotaMonth,
          billingUnits: effectiveBillingUnits,
          unitPriceEurHt: authorization.billing.isQuotaIncluded ? 0 : authorization.plan.unitPriceEur,
          amountEurHt: authorization.billing.estimatedCostEur,
          cloudProvider,
          scanProfile,
          modules,
          metadata: {
            targetUrl: authorizedAzure.targetUrl || null,
            microsoftTenantId: authorizedAzure.microsoftTenantId || null,
            subscriptions: authorizedAzure.subscriptions || [],
            resourceLimit: authorization.plan.resourceLimit,
            activeScanLimit: authorization.billing.activeScanLimit,
            billingState: 'RESERVED'
          }
        });

        await this.billingService.upsertSnapshot(client, tenantId, authorization.billing.quotaMonth);
        await client.query(
          `INSERT INTO scan_request_idempotency (
             tenant_id, idempotency_key, idempotency_key_source, request_fingerprint, scan_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [tenantId, idem.key, idem.source, requestFingerprint, scanId]
        );

        const message = buildScanRequestedMessage({ scanId, tenantId, cloudProvider, scanProfile, modules, azure: authorizedAzure, billing: authorization.billing, requestId });
        await this.outboxService.enqueueScanRequested(client, { scanId, tenantId, message });
        return {
          scanId,
          reused: false,
          idempotencyKey: idem.key,
          idempotencyKeySource: idem.source,
          billing: { ...authorization.billing, billingState: 'RESERVED' },
          azure: authorizedAzure,
          createdAt: message.requestedAt
        };
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw error;

      if (error?.code === '23505') {
        // PostgreSQL constraint names can differ across historical baselines.
        // Resolve a concurrent idempotency race by looking up the canonical
        // tenant/key pair instead of trusting one generated constraint name.
        const existing = await withTenantSession(this.pg, tenantId, selectExisting);
        if (existing.rowCount === 1) {
          if (!requestFingerprint) {
            throw error;
          }
          const row = existing.rows[0];
          const storedFingerprint = row.request_fingerprint || buildStoredRequestFingerprint(row);
          assertIdempotencyFingerprint(storedFingerprint, requestFingerprint, idem.key);
          return existingScanResponse(row);
        }
      }

      if (error?.code === '23505' && error?.constraint === 'uq_outbox_event_aggregate') {
        throw new ConflictError(
          'The scan outbox event already exists.',
          { idempotencyKey: idem.key },
          'OUTBOX_EVENT_CONFLICT'
        );
      }

      throw error;
    }
  }

  async listTenantScans(tenantId, limit, offset) {
    return withTenantSession(this.pg, tenantId, async (client) => {
      const result = await client.query(
        `SELECT s.id, s.status, s.billing_state, s.cloud_provider, s.scan_profile, s.created_at, s.completed_at,
                s.billing_units, s.is_quota_included, s.quota_month, s.resource_count, s.resource_limit,
                r.result_summary, r.result_size_bytes
         FROM scans s
         LEFT JOIN scan_results r ON r.scan_id = s.id AND r.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1
         ORDER BY s.created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
      );
      return result.rows;
    });
  }

  async getScanByIdAndTenant(scanId, tenantId, { includeResult = false } = {}) {
    return withTenantSession(this.pg, tenantId, async (client) => {
      const result = await client.query(
        `
        SELECT s.id, s.tenant_id, s.cloud_provider, s.scan_profile, s.modules,
               s.target_url, s.microsoft_tenant_id, s.subscriptions,
               s.billing_units, s.is_quota_included, s.quota_month, s.billing_state,
               s.resource_count, s.resource_limit,
               t.plan_code, s.status, s.result, s.error_message, s.error_code, s.error_correlation_id,
               s.created_at, s.updated_at, s.completed_at,
               r.result_summary, r.result_size_bytes, r.result_sha256, r.created_at AS result_created_at
        FROM scans s
        INNER JOIN tenants t ON t.id = s.tenant_id
        LEFT JOIN scan_results r ON r.scan_id = s.id AND r.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
        LIMIT 1
        `,
        [scanId, tenantId]
      );
      const row = result.rows[0] || null;
      if (!row) return null;
      row.full_result = includeResult ? await loadResultForScan(client, scanId, tenantId) : null;
      return row;
    });
  }

  async getScanPdfPayload(scanId, tenantId) {
    const scan = await this.getScanByIdAndTenant(scanId, tenantId, { includeResult: true });
    if (!scan) throw new NotFoundError('Scan not found.');
    return scan;
  }

  async getScanRawResult(scanId, tenantId) {
    const scan = await this.getScanByIdAndTenant(scanId, tenantId, { includeResult: true });
    if (!scan) throw new NotFoundError('Scan not found.');
    return scan;
  }

  async listCurrentMonthScanDetails(tenantId) {
    const quotaMonth = this.billingService.getCurrentQuotaMonth();
    const overview = await this.billingService.getTenantBillingOverview(tenantId);
    return withTenantSession(this.pg, tenantId, async (client) => {
      const result = await client.query(
        `SELECT s.id, s.status, s.billing_state, s.cloud_provider, s.scan_profile, s.modules, s.target_url,
                s.microsoft_tenant_id, s.subscriptions, s.billing_units, s.is_quota_included,
                s.quota_month, s.resource_count, s.resource_limit, s.result, s.error_message, s.error_code, s.error_correlation_id,
                s.created_at, s.updated_at, s.completed_at, r.result_summary, r.result_size_bytes
         FROM scans s
         LEFT JOIN scan_results r ON r.scan_id = s.id AND r.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1 AND s.quota_month = $2::date
         ORDER BY s.created_at DESC`,
        [tenantId, quotaMonth]
      );
      const scans = result.rows.map((row) => {
        let parsedSummary = row.result_summary || null;
        if (!parsedSummary && row.result) {
          try { parsedSummary = buildResultSummary(typeof row.result === 'string' ? JSON.parse(row.result) : row.result); } catch (_) {}
        }
        return {
          scanId: row.id,
          status: row.status,
          billingState: row.billing_state || null,
          cloudProvider: row.cloud_provider,
          scanProfile: row.scan_profile,
          modules: row.modules,
          target: { targetUrl: row.target_url, microsoftTenantId: row.microsoft_tenant_id, subscriptions: row.subscriptions },
          billing: { billingUnits: Number(row.billing_units || 0), isQuotaIncluded: row.is_quota_included, quotaMonth: row.quota_month, billingState: row.billing_state || null },
          limits: { resourceCount: row.resource_count, resourceLimit: row.resource_limit },
          resultSizeBytes: row.result_size_bytes || (row.result ? jsonByteLength(row.result) : null),
          severitySummary: summarizeSeverities(parsedSummary),
          errorCode: row.error_code || null,
          errorCorrelationId: row.error_correlation_id || null,
          errorMessage: row.error_message,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          completedAt: row.completed_at
        };
      });
      return { tenantId, quotaMonth, overview, totalScans: scans.length, scans };
    });
  }
}

module.exports = {
  ScanService,
  summarizeSeverities,
  resolveIdempotency,
  buildScanRequestedMessage,
  normalizeFingerprintRequest,
  buildRequestFingerprint,
  buildStoredRequestFingerprint,
  assertIdempotencyFingerprint
};
