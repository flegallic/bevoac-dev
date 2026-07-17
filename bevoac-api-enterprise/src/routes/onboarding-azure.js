const { AzureOnboardingService } = require('../services/azure-onboarding-service');
const { ValidationError } = require('../lib/errors');

module.exports = async function onboardingAzureRoutes(fastify) {
  const service = new AzureOnboardingService(fastify.pg, fastify.config, fastify.log);

  fastify.post('/onboarding/azure/start', {
    schema: { summary: 'Start Microsoft admin consent onboarding', tags: ['onboarding'] },
    preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('onboarding:write')]
  }, async function handler(request) {
    return service.startOnboarding({
      tenantId: request.tenantId,
      apiKeyId: request.apiKeyId,
      request
    });
  });

  fastify.get('/onboarding/azure/status', {
    schema: { summary: 'Get Azure onboarding status', tags: ['onboarding'] },
    preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('onboarding:read')]
  }, async function handler(request) {
    return service.getStatus(request.tenantId);
  });

  fastify.post('/onboarding/azure/verify', {
    schema: { summary: 'Re-check Azure RBAC and refresh subscriptions', tags: ['onboarding'] },
    preHandler: [fastify.authenticateApiKey, fastify.requireApiScope('onboarding:write')]
  }, async function handler(request) {
    const microsoftTenantId = request.body?.microsoftTenantId;
    if (!microsoftTenantId) throw new ValidationError('microsoftTenantId is required.');
    return service.reverifyTenant({ tenantId: request.tenantId, microsoftTenantId });
  });

  fastify.get('/onboarding/azure/callback', {
    schema: { summary: 'Microsoft admin consent callback', tags: ['onboarding'] }
  }, async function handler(request, reply) {
    const redirectUrl = await service.handleCallback(request.query || {});
    if (!redirectUrl || typeof redirectUrl !== 'string') {
      throw new ValidationError('Invalid onboarding callback redirect URL.');
    }
    return reply.code(302).redirect(redirectUrl);
  });
};
