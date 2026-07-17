const { normalizeModules, validateAzurePayload } = require('../lib/scan-contract');
const { ValidationError, NotFoundError } = require('../lib/errors');
const { assertRuntimeProvider } = require('../lib/cloud-provider-contract');
const { ScanService } = require('../services/scan-service');
const { BillingService } = require('../services/billing-service');
const { assertPdfInputWithinLimit, withTimeout } = require('../services/result-store');

function scanResponse(scan, { includeResult = false } = {}) {
  return {
    scanId: scan.id,
    cloudProvider: scan.cloud_provider,
    scanProfile: scan.scan_profile,
    modules: scan.modules,
    target: { targetUrl: scan.target_url, microsoftTenantId: scan.microsoft_tenant_id, subscriptions: scan.subscriptions },
    billingState: scan.billing_state || null,
    billing: { planCode: scan.plan_code, billingUnits: scan.billing_units, isQuotaIncluded: scan.is_quota_included, quotaMonth: scan.quota_month, billingState: scan.billing_state || null },
    limits: { resourceCount: scan.resource_count, resourceLimit: scan.resource_limit },
    status: scan.status,
    errorMessage: scan.error_message,
    resultSummary: scan.result_summary || null,
    resultSizeBytes: scan.result_size_bytes || null,
    resultSha256: scan.result_sha256 || null,
    createdAt: scan.created_at,
    updatedAt: scan.updated_at,
    completedAt: scan.completed_at,
    result: includeResult ? scan.full_result : undefined
  };
}

module.exports = async function scanRoutes(fastify) {
  const billingService = new BillingService(fastify.pg, fastify.config);
  const scanService = new ScanService(fastify.pg, billingService, fastify.config);

  fastify.post('/scans', { schema: { summary: 'Create a scan request', tags: ['scans'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('scan:create')] }, async function handler(request, reply) {
    const body = request.body;
    if (!body || typeof body !== 'object') throw new ValidationError('Request body must be a JSON object.');
    if (body.tenantId || body.customerId) throw new ValidationError('tenantId/customerId must not be supplied by the caller. Tenant identity is derived from the API key.');
    const { cloudProvider, scanProfile, modules } = body;
    assertRuntimeProvider(cloudProvider);
    if (!['web', 'entra', 'infra', 'full'].includes(scanProfile)) throw new ValidationError('scanProfile must be one of: web, entra, infra, full.');

    const normalizedModules = normalizeModules(scanProfile, modules);
    const azure = validateAzurePayload(scanProfile, body.azure, normalizedModules);
    const idempotencyKey = request.headers['idempotency-key'] ? String(request.headers['idempotency-key']).slice(0, 255) : null;

    const created = await scanService.createScanRequest({
      tenantId: request.tenantId,
      cloudProvider,
      scanProfile,
      modules: normalizedModules,
      azure,
      idempotencyKey,
      requestId: request.id
    });

    const outboxConfig = fastify.config.outbox || {};
    if (!created.reused && outboxConfig.immediatePublishAfterRequest !== false && fastify.outboxPublisher) {
      fastify.outboxPublisher.publishPending({ limit: 1 }).catch((error) => {
        request.log.error({ err: error, scanId: created.scanId }, 'Immediate outbox publish failed; background retry will continue.');
      });
    }

    return reply.code(created.reused ? 200 : 201).send({
      scanId: created.scanId,
      status: created.status || 'PENDING',
      billingState: created.billing?.billingState || null,
      cloudProvider,
      scanProfile,
      modules: normalizedModules,
      billing: created.billing,
      idempotencyKey: created.idempotencyKey,
      idempotencyKeySource: created.idempotencyKeySource,
      idempotentReplay: created.reused,
      createdAt: created.createdAt || new Date().toISOString(),
      message: created.reused ? 'Idempotent replay. Existing scan returned.' : 'Scan job accepted and persisted through transactional outbox. Use GET /v1/scans/{scanId} to retrieve status and GET /v1/scans/{scanId}/result for the full JSON result.'
    });
  });

  fastify.get('/scans', { schema: { summary: 'List tenant scans', tags: ['scans'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('scan:read')] }, async function handler(request) {
    const limit = Math.min(Math.max(Number(request.query?.limit || 10), 1), 100);
    const offset = Math.max(Number(request.query?.offset || 0), 0);
    const scans = await scanService.listTenantScans(request.tenantId, limit, offset);
    return scans.map((scan) => ({
      scanId: scan.id,
      status: scan.status,
      billingState: scan.billing_state || null,
      cloudProvider: scan.cloud_provider,
      scanProfile: scan.scan_profile,
      billing: { billingUnits: scan.billing_units, isQuotaIncluded: scan.is_quota_included, quotaMonth: scan.quota_month, billingState: scan.billing_state || null },
      limits: { resourceCount: scan.resource_count, resourceLimit: scan.resource_limit },
      resultSummary: scan.result_summary || null,
      resultSizeBytes: scan.result_size_bytes || null,
      createdAt: scan.created_at,
      completedAt: scan.completed_at
    }));
  });

  fastify.get('/scans/:scanId', { schema: { summary: 'Get scan status and metadata', tags: ['scans'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('scan:read')] }, async function handler(request) {
    const includeResult = String(request.query?.includeResult || 'false').toLowerCase() === 'true';
    if (includeResult) await fastify.requireApiScope('scan:result:read')(request);
    const scan = await scanService.getScanByIdAndTenant(request.params.scanId, request.tenantId, { includeResult });
    if (!scan) throw new NotFoundError('Scan not found.');
    return scanResponse(scan, { includeResult });
  });

  fastify.get('/scans/:scanId/result', { schema: { summary: 'Get full scan JSON result explicitly', tags: ['scans'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('scan:result:read')] }, async function handler(request) {
    const scan = await scanService.getScanRawResult(request.params.scanId, request.tenantId);
    if (!scan) throw new NotFoundError('Scan not found.');
    if (!scan.full_result) throw new NotFoundError('Scan result not found.');
    return {
      scanId: scan.id,
      status: scan.status,
      resultSizeBytes: scan.result_size_bytes || null,
      resultSha256: scan.result_sha256 || null,
      resultSummary: scan.result_summary || null,
      result: scan.full_result
    };
  });

  fastify.get('/scans/:scanId/pdf', { schema: { summary: 'Generate bounded PDF audit report for one scan', tags: ['scans'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('scan:pdf:read')] }, async function handler(request, reply) {
    const scan = await scanService.getScanPdfPayload(request.params.scanId, request.tenantId);
    if (!scan) throw new NotFoundError('Scan not found.');
    if (!['DONE', 'FAILED'].includes(scan.status)) throw new ValidationError(`Cannot generate PDF while scan status is ${scan.status}.`);
    if (!scan.full_result) throw new ValidationError('No scan result is available for this scan.');
    await assertPdfInputWithinLimit(scan.full_result, fastify.config.pdf.maxInputBytes);
    const { generateExecutiveSummaryBuffer } = require('../services/pdf-generator');
    const pdfPayload = {
      scanId: scan.id,
      tenantId: scan.tenant_id,
      cloudProvider: scan.cloud_provider,
      scanProfile: scan.scan_profile,
      modules: scan.modules,
      completedAt: scan.completed_at,
      resourceCount: scan.resource_count,
      resourceLimit: scan.resource_limit,
      planCode: scan.plan_code,
      pdfLimits: { maxFindings: fastify.config.pdf.maxFindings, maxEvidenceItems: fastify.config.pdf.maxEvidenceItems },
      billing: { planCode: scan.plan_code, billingUnits: scan.billing_units, isQuotaIncluded: scan.is_quota_included, quotaMonth: scan.quota_month, billingState: scan.billing_state || null },
      target: { targetUrl: scan.target_url || null, microsoftTenantId: scan.microsoft_tenant_id || null, subscriptions: Array.isArray(scan.subscriptions) ? scan.subscriptions : [] },
      microsoftTenantId: scan.microsoft_tenant_id || null,
      subscriptions: Array.isArray(scan.subscriptions) ? scan.subscriptions : [],
      webSecurity: scan.full_result.webSecurity || null,
      microsoft_entra: scan.full_result.microsoft_entra || null,
      azure_infrastructure: scan.full_result.azure_infrastructure || null,
      identity_admin_posture: scan.full_result.identity_admin_posture || null,
      kpiScorecard: scan.full_result.kpiScorecard || null,
      resourcePreflight: scan.full_result.resourcePreflight || null
    };
    const pdfBuffer = await withTimeout(generateExecutiveSummaryBuffer(pdfPayload), fastify.config.pdf.timeoutMs, 'PDF generation timed out. Use JSON output or retry later.');
    return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="bevoac-enterprise-audit-report-${scan.id}.pdf"`).send(pdfBuffer);
  });

  fastify.get('/billing/overview', { schema: { summary: 'Get tenant billing overview', tags: ['billing'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('billing:read')] }, async function handler(request) {
    const overview = await billingService.getTenantBillingOverview(request.tenantId);
    if (!overview) throw new NotFoundError('Tenant not found.');
    return overview;
  });

  fastify.get('/billing/current-month/scans', { schema: { summary: 'List detailed current-month scan usage', tags: ['billing'] }, preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('billing:read')] }, async function handler(request) {
    return scanService.listCurrentMonthScanDetails(request.tenantId);
  });
};
