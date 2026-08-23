'use strict';

const { BillingService } = require('../services/billing-service');
const { NotFoundError } = require('../lib/errors');

const UUID_SCHEMA = Object.freeze({
  type: 'string',
  format: 'uuid'
});

const BILLING_MONTH_SCHEMA = Object.freeze({
  type: 'string',
  pattern: '^(?:20|21)[0-9]{2}-(?:0[1-9]|1[0-2])-01$'
});

const OPTIONAL_MONTH_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    month: BILLING_MONTH_SCHEMA
  }
});

const REQUIRED_MONTH_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['month'],
  properties: {
    month: BILLING_MONTH_SCHEMA
  }
});

const TENANT_LEDGER_PARAMS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['tenantId'],
  properties: {
    tenantId: UUID_SCHEMA
  }
});

function adminActor(request) {
  const actor = request.adminActor || {};
  return actor.username || actor.subject || request.ip || 'admin';
}

module.exports = async function adminBillingRoutes(fastify) {
  const billingService = new BillingService(fastify.pg, fastify.config);

  fastify.get('/admin/billing/overview', {
    schema: {
      summary: 'Admin billing overview by month',
      tags: ['admin-billing'],
      querystring: OPTIONAL_MONTH_QUERY_SCHEMA
    },
    preHandler: [fastify.authenticateAdmin]
  }, async function overviewHandler(request) {
    return billingService.getAdminBillingOverview(request.query?.month || null);
  });

  fastify.get('/admin/billing/tenants/:tenantId/ledger', {
    schema: {
      summary: 'Admin tenant billing ledger by month',
      tags: ['admin-billing'],
      params: TENANT_LEDGER_PARAMS_SCHEMA,
      querystring: OPTIONAL_MONTH_QUERY_SCHEMA
    },
    preHandler: [fastify.authenticateAdmin]
  }, async function ledgerHandler(request) {
    const ledger = await billingService.getTenantLedger(
      request.params.tenantId,
      request.query?.month || null
    );
    if (!ledger) throw new NotFoundError('Tenant not found.');
    return ledger;
  });

  fastify.post('/admin/billing/close-month', {
    schema: {
      summary: 'Close a completed billing month',
      tags: ['admin-billing'],
      querystring: REQUIRED_MONTH_QUERY_SCHEMA,
      body: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 0
      }
    },
    preHandler: [fastify.authenticateAdmin]
  }, async function closeMonthHandler(request) {
    return billingService.closeBillingMonth(
      request.query.month,
      adminActor(request)
    );
  });
};

module.exports.UUID_SCHEMA = UUID_SCHEMA;
module.exports.BILLING_MONTH_SCHEMA = BILLING_MONTH_SCHEMA;
module.exports.OPTIONAL_MONTH_QUERY_SCHEMA = OPTIONAL_MONTH_QUERY_SCHEMA;
module.exports.REQUIRED_MONTH_QUERY_SCHEMA = REQUIRED_MONTH_QUERY_SCHEMA;
module.exports.TENANT_LEDGER_PARAMS_SCHEMA = TENANT_LEDGER_PARAMS_SCHEMA;
