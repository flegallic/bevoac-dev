const { BillingService } = require('../services/billing-service');
const { NotFoundError } = require('../lib/errors');

function adminActor(request) {
  const actor = request.adminActor || {};
  return actor.username || actor.subject || request.ip || 'admin';
}

module.exports = async function adminBillingRoutes(fastify) {
  const billingService = new BillingService(fastify.pg, fastify.config);

  fastify.get('/admin/billing/overview', { schema: { summary: 'Admin billing overview by month', tags: ['admin-billing'] }, preHandler: [fastify.authenticateAdmin] }, async function handler(request) {
    return billingService.getAdminBillingOverview(request.query?.month || null);
  });

  fastify.get('/admin/billing/tenants/:tenantId/ledger', { schema: { summary: 'Admin tenant billing ledger by month', tags: ['admin-billing'] }, preHandler: [fastify.authenticateAdmin] }, async function handler(request) {
    const ledger = await billingService.getTenantLedger(request.params.tenantId, request.query?.month || null);
    if (!ledger) throw new NotFoundError('Tenant not found.');
    return ledger;
  });

  fastify.post('/admin/billing/close-month', { schema: { summary: 'Close a billing month', tags: ['admin-billing'] }, preHandler: [fastify.authenticateAdmin] }, async function handler(request) {
    return billingService.closeBillingMonth(request.query?.month || null, adminActor(request));
  });
};
