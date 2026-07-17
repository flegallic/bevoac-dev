const { randomUUID } = require('crypto');
const { NotFoundError, ConflictError } = require('../lib/errors');
const { ensureAuthorizedWebTarget, resolveAuthorizedAzureTenant, resolveAuthorizedAzureSubscriptions } = require('../lib/target-authorization');
const { buildResultSummary, loadResultForScan, jsonByteLength } = require('./result-store');
const { OutboxService } = require('./outbox-service');
const { SCAN_MESSAGE_VERSION } = require('../lib/scan-message-version');
const { summarizeFindings, collectFindings, emptySeveritySummary } = require('../lib/findings-collector');
const { withTenantSession, withTenantTransaction } = require('../lib/db-context');

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
  if (input && String(input).trim() !== '') return { key: String(input).trim().slice(0, 255), source: 'client_supplied' };
  return { key: randomUUID(), source: 'server_generated' };
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
    const tenantScopedIdentityModules = new Set(['entra', 'entra_b2b', 'identity_admin_posture']);
    const subscriptionScopedModules = new Set([
      'storage', 'vms', 'nsg', 'keyvault', 'logs', 'db', 'governance', 'appservices', 'finops', 'tags',
      'exposure_map', 'diagnostic_coverage', 'encryption_coverage', 'azure_rbac_exposure', 'private_link_coverage', 'policy_compliance'
    ]);
    const needsAzureTenant = requestedModules.some((moduleName) => tenantScopedIdentityModules.has(moduleName) || subscriptionScopedModules.has(moduleName));
    const needsAzureSubscriptions = requestedModules.some((moduleName) => subscriptionScopedModules.has(moduleName));
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
    try {
      return await withTenantTransaction(this.pg, tenantId, async (client) => {
        const existing = await client.query(
          `
          SELECT s.id AS scan_id, s.status, s.target_url, s.microsoft_tenant_id, s.subscriptions,
                 s.billing_units, s.is_quota_included, s.quota_month, s.resource_limit,
                 s.billing_state, i.idempotency_key, COALESCE(i.idempotency_key_source, 'client_supplied') AS idempotency_key_source,
                 s.created_at
          FROM scan_request_idempotency i
          INNER JOIN scans s ON s.id = i.scan_id AND s.tenant_id = i.tenant_id
          WHERE i.tenant_id = $1 AND i.idempotency_key = $2
          LIMIT 1
          `,
          [tenantId, idem.key]
        );
        if (existing.rowCount === 1) {
          const row = existing.rows[0];
          return {
            scanId: row.scan_id,
            status: row.status,
            reused: true,
            idempotencyKey: row.idempotency_key,
            idempotencyKeySource: row.idempotency_key_source,
            createdAt: row.created_at,
            billing: { billingUnits: row.billing_units, isQuotaIncluded: row.is_quota_included, quotaMonth: row.quota_month, resourceLimit: row.resource_limit, billingState: row.billing_state },
            azure: { targetUrl: row.target_url || null, microsoftTenantId: row.microsoft_tenant_id || null, subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : [] }
          };
        }

        const authorizedAzure = await this.authorizeCustomerTargets(client, { tenantId, modules, azure });
        const effectiveBillingUnits = this.resolveBillingUnitsForAuthorizedScan(scanProfile, authorizedAzure);
        const authorization = await this.billingService.authorizeScan(client, {
          tenantId,
          billingUnits: effectiveBillingUnits,
          cloudProvider,
          scanProfile,
          modules,
          metadata: { targetUrl: authorizedAzure.targetUrl || null, microsoftTenantId: authorizedAzure.microsoftTenantId || null, subscriptions: authorizedAzure.subscriptions || [] }
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
          metadata: { targetUrl: authorizedAzure.targetUrl || null, microsoftTenantId: authorizedAzure.microsoftTenantId || null, subscriptions: authorizedAzure.subscriptions || [], resourceLimit: authorization.plan.resourceLimit, activeScanLimit: authorization.billing.activeScanLimit, billingState: 'RESERVED' }
        });

        await this.billingService.upsertSnapshot(client, tenantId, authorization.billing.quotaMonth);
        await client.query(
          `INSERT INTO scan_request_idempotency (tenant_id, idempotency_key, idempotency_key_source, scan_id, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [tenantId, idem.key, idem.source, scanId]
        );

        const message = buildScanRequestedMessage({ scanId, tenantId, cloudProvider, scanProfile, modules, azure: authorizedAzure, billing: authorization.billing, requestId });
        await this.outboxService.enqueueScanRequested(client, { scanId, tenantId, message });
        return { scanId, reused: false, idempotencyKey: idem.key, idempotencyKeySource: idem.source, billing: { ...authorization.billing, billingState: 'RESERVED' }, azure: authorizedAzure, createdAt: message.requestedAt };
      });
    } catch (error) {
      if (error.code === '23505') throw new ConflictError('Duplicate idempotency key or outbox event for this tenant.', { idempotencyKey: idem.key });
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
               t.plan_code, s.status, s.result, s.error_message,
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
                s.quota_month, s.resource_count, s.resource_limit, s.result, s.error_message,
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

module.exports = { ScanService, summarizeSeverities, resolveIdempotency, buildScanRequestedMessage };
