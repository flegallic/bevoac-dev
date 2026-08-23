'use strict';

const { BillingService } = require('../services/billing-service');
const { ScanService } = require('../services/scan-service');
const {
  ValidationError,
  NotFoundError
} = require('../lib/errors');
const {
  normalizeModules,
  validateAzurePayload,
  ALLOWED_MODULES
} = require('../lib/scan-contract');
const {
  assertRuntimeProvider
} = require('../lib/cloud-provider-contract');
const {
  assertPdfInputWithinLimit,
  withTimeout
} = require('../services/result-store');

const UUID_SCHEMA = {
  type: 'string',
  format: 'uuid'
};

const SCAN_ID_PARAMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scanId'],
  properties: {
    scanId: UUID_SCHEMA
  }
};

const EMPTY_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  maxProperties: 0
});

const CREATE_SCAN_SCHEMA = {
  summary: 'Create a scan request',
  tags: ['scans'],
  security: [{ BevoacApiKey: [] }],
  querystring: EMPTY_QUERY_SCHEMA,
  headers: {
    type: 'object',
    properties: {
      'idempotency-key': {
        type: 'string',
        minLength: 1,
        maxLength: 255,
        pattern: '^[^\\s\\x00-\\x1f\\x7f]+$'
      }
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['cloudProvider', 'scanProfile'],
    properties: {
      cloudProvider: {
        type: 'string',
        enum: ['azure']
      },
      scanProfile: {
        type: 'string',
        enum: ['web', 'entra', 'infra', 'full']
      },
      modules: {
        type: 'array',
        minItems: 1,
        maxItems: ALLOWED_MODULES.length,
        uniqueItems: true,
        items: {
          type: 'string',
          enum: [...ALLOWED_MODULES]
        }
      },
      azure: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetUrl: {
            type: 'string',
            format: 'uri',
            maxLength: 2048
          },
          microsoftTenantId: UUID_SCHEMA,
          subscriptionIds: {
            type: 'array',
            maxItems: 1000,
            uniqueItems: true,
            items: UUID_SCHEMA
          },
          subscriptions: {
            type: 'array',
            maxItems: 1000,
            uniqueItems: true,
            items: UUID_SCHEMA
          }
        }
      }
    }
  }
};

function scanResponse(scan, { includeResult = false } = {}) {
  return {
    scanId: scan.id,
    cloudProvider: scan.cloud_provider,
    scanProfile: scan.scan_profile,
    modules: scan.modules,
    target: {
      targetUrl: scan.target_url,
      microsoftTenantId: scan.microsoft_tenant_id,
      subscriptions: scan.subscriptions
    },
    billingState: scan.billing_state || null,
    billing: {
      planCode: scan.plan_code,
      billingUnits: scan.billing_units,
      isQuotaIncluded: scan.is_quota_included,
      quotaMonth: scan.quota_month,
      billingState: scan.billing_state || null
    },
    limits: {
      resourceCount: scan.resource_count,
      resourceLimit: scan.resource_limit
    },
    status: scan.status,
    errorCode: scan.error_code || null,
    errorCorrelationId: scan.error_correlation_id || null,
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
  const billingService = new BillingService(
    fastify.pg,
    fastify.config
  );
  const scanService = new ScanService(
    fastify.pg,
    billingService,
    fastify.config
  );

  fastify.post('/scans', {
    schema: CREATE_SCAN_SCHEMA,
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('scan:create')
    ]
  }, async function createScanHandler(request, reply) {
    const body = request.body;
    const { cloudProvider, scanProfile, modules } = body;

    assertRuntimeProvider(cloudProvider);

    const normalizedModules = normalizeModules(scanProfile, modules);
    const azure = validateAzurePayload(
      scanProfile,
      body.azure,
      normalizedModules
    );

    const headerValue = request.headers['idempotency-key'];
    const idempotencyKey = headerValue
      ? String(headerValue)
      : null;

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
    if (
      !created.reused &&
      outboxConfig.immediatePublishAfterRequest !== false &&
      fastify.outboxPublisher
    ) {
      fastify.outboxPublisher
        .publishPending({ limit: 1 })
        .catch((error) => {
          request.log.error(
            {
              err: error,
              scanId: created.scanId,
              correlationId: request.id
            },
            'Immediate outbox publish failed; background retry will continue.'
          );
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
      correlationId: request.id,
      message: created.reused
        ? 'Idempotent replay. Existing scan returned.'
        : 'Scan accepted through the transactional outbox. Retrieve status and results with the scan endpoints.'
    });
  });

  fastify.get('/scans', {
    schema: {
      summary: 'List tenant scans',
      tags: ['scans'],
      security: [{ BevoacApiKey: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10
          },
          offset: {
            type: 'integer',
            minimum: 0,
            maximum: 1000000,
            default: 0
          }
        }
      }
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('scan:read')
    ]
  }, async function listScansHandler(request) {
    const limit = Number(request.query?.limit ?? 10);
    const offset = Number(request.query?.offset ?? 0);
    const scans = await scanService.listTenantScans(
      request.tenantId,
      limit,
      offset
    );

    return scans.map((scan) => ({
      scanId: scan.id,
      status: scan.status,
      billingState: scan.billing_state || null,
      cloudProvider: scan.cloud_provider,
      scanProfile: scan.scan_profile,
      billing: {
        billingUnits: scan.billing_units,
        isQuotaIncluded: scan.is_quota_included,
        quotaMonth: scan.quota_month,
        billingState: scan.billing_state || null
      },
      limits: {
        resourceCount: scan.resource_count,
        resourceLimit: scan.resource_limit
      },
      resultSummary: scan.result_summary || null,
      resultSizeBytes: scan.result_size_bytes || null,
      createdAt: scan.created_at,
      completedAt: scan.completed_at
    }));
  });

  fastify.get('/scans/:scanId', {
    schema: {
      summary: 'Get scan status and metadata',
      tags: ['scans'],
      security: [{ BevoacApiKey: [] }],
      params: SCAN_ID_PARAMS_SCHEMA,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeResult: {
            type: 'boolean',
            default: false
          }
        }
      }
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('scan:read')
    ]
  }, async function getScanHandler(request) {
    const includeResult = request.query?.includeResult === true;
    if (includeResult) {
      await fastify.requireApiScope('scan:result:read')(request);
    }

    const scan = await scanService.getScanByIdAndTenant(
      request.params.scanId,
      request.tenantId,
      { includeResult }
    );
    if (!scan) throw new NotFoundError('Scan not found.');
    return scanResponse(scan, { includeResult });
  });

  fastify.get('/scans/:scanId/result', {
    schema: {
      summary: 'Get full scan JSON result explicitly',
      tags: ['scans'],
      security: [{ BevoacApiKey: [] }],
      params: SCAN_ID_PARAMS_SCHEMA,
      querystring: EMPTY_QUERY_SCHEMA
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('scan:result:read')
    ]
  }, async function getResultHandler(request) {
    const scan = await scanService.getScanRawResult(
      request.params.scanId,
      request.tenantId
    );
    if (!scan) throw new NotFoundError('Scan not found.');
    if (!scan.full_result) {
      throw new NotFoundError('Scan result not found.');
    }

    return {
      scanId: scan.id,
      status: scan.status,
      resultSizeBytes: scan.result_size_bytes || null,
      resultSha256: scan.result_sha256 || null,
      resultSummary: scan.result_summary || null,
      result: scan.full_result
    };
  });

  fastify.get('/scans/:scanId/pdf', {
    schema: {
      summary: 'Generate bounded PDF audit report for one scan',
      tags: ['scans'],
      security: [{ BevoacApiKey: [] }],
      params: SCAN_ID_PARAMS_SCHEMA,
      querystring: EMPTY_QUERY_SCHEMA
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('scan:pdf:read')
    ]
  }, async function getPdfHandler(request, reply) {
    const scan = await scanService.getScanPdfPayload(
      request.params.scanId,
      request.tenantId
    );
    if (!scan) throw new NotFoundError('Scan not found.');
    if (!['DONE', 'FAILED'].includes(scan.status)) {
      throw new ValidationError(
        `Cannot generate PDF while scan status is ${scan.status}.`
      );
    }
    if (!scan.full_result) {
      throw new ValidationError(
        'No scan result is available for this scan.'
      );
    }

    await assertPdfInputWithinLimit(
      scan.full_result,
      fastify.config.pdf.maxInputBytes
    );

    const {
      generateExecutiveSummaryBuffer
    } = require('../services/pdf-generator');

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
      pdfLimits: {
        maxFindings: fastify.config.pdf.maxFindings,
        maxEvidenceItems: fastify.config.pdf.maxEvidenceItems
      },
      billing: {
        planCode: scan.plan_code,
        billingUnits: scan.billing_units,
        isQuotaIncluded: scan.is_quota_included,
        quotaMonth: scan.quota_month,
        billingState: scan.billing_state || null
      },
      target: {
        targetUrl: scan.target_url || null,
        microsoftTenantId: scan.microsoft_tenant_id || null,
        subscriptions: Array.isArray(scan.subscriptions)
          ? scan.subscriptions
          : []
      },
      microsoftTenantId: scan.microsoft_tenant_id || null,
      subscriptions: Array.isArray(scan.subscriptions)
        ? scan.subscriptions
        : [],
      webSecurity: scan.full_result.webSecurity || null,
      microsoft_entra: scan.full_result.microsoft_entra || null,
      azure_infrastructure:
        scan.full_result.azure_infrastructure || null,
      identity_admin_posture:
        scan.full_result.identity_admin_posture || null,
      kpiScorecard: scan.full_result.kpiScorecard || null,
      resourcePreflight: scan.full_result.resourcePreflight || null
    };

    const pdfBuffer = await withTimeout(
      generateExecutiveSummaryBuffer(pdfPayload),
      fastify.config.pdf.timeoutMs,
      'PDF generation timed out. Use JSON output or retry later.'
    );

    return reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="bevoac-audit-report-${scan.id}.pdf"`
      )
      .send(pdfBuffer);
  });

  fastify.get('/billing/overview', {
    schema: {
      summary: 'Get tenant billing overview',
      tags: ['billing'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('billing:read')
    ]
  }, async function billingOverviewHandler(request) {
    const overview = await billingService.getTenantBillingOverview(
      request.tenantId
    );
    if (!overview) throw new NotFoundError('Tenant not found.');
    return overview;
  });

  fastify.get('/billing/current-month/scans', {
    schema: {
      summary: 'List detailed current-month scan usage',
      tags: ['billing'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('billing:read')
    ]
  }, async function billingScansHandler(request) {
    return scanService.listCurrentMonthScanDetails(request.tenantId);
  });
};

module.exports.CREATE_SCAN_SCHEMA = CREATE_SCAN_SCHEMA;
module.exports.SCAN_ID_PARAMS_SCHEMA = SCAN_ID_PARAMS_SCHEMA;
module.exports.EMPTY_QUERY_SCHEMA = EMPTY_QUERY_SCHEMA;
module.exports.scanResponse = scanResponse;
