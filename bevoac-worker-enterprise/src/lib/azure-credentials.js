const { ClientSecretCredential } = require('@azure/identity');

function buildCrossTenantCredential(config, targetTenantId) {
  if (!targetTenantId) return null;
  if (!config.microsoftClientId || !config.microsoftClientSecret) {
    throw new Error('Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET for cross-tenant audit.');
  }
  return new ClientSecretCredential(targetTenantId, config.microsoftClientId, config.microsoftClientSecret);
}

module.exports = { buildCrossTenantCredential };
