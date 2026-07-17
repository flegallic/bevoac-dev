const net = require('net');
const { ForbiddenError, ValidationError } = require('./errors');

function normalizeUuid(value, fieldName = 'uuid') {
  const raw = String(value || '').trim().toLowerCase();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(raw)) throw new ValidationError(`${fieldName} must be a valid UUID.`);
  return raw;
}
function normalizeHost(hostname) { return String(hostname || '').trim().toLowerCase().replace(/\.$/, ''); }
function isPrivateOrLocalHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254);
  }
  if (ipVersion === 6) return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  return false;
}
function normalizeHttpsTargetUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); } catch (_) { throw new ValidationError('azure.targetUrl must be a valid HTTPS URL.'); }
  if (parsed.protocol !== 'https:') throw new ValidationError('azure.targetUrl must use HTTPS.');
  parsed.hash = ''; parsed.username = ''; parsed.password = '';
  const host = normalizeHost(parsed.hostname);
  if (isPrivateOrLocalHost(host)) throw new ValidationError('azure.targetUrl cannot target localhost, private, link-local or internal hosts.');
  return { url: parsed.toString(), host };
}
async function resolveAuthorizedAzureTenant(client, { tenantId, microsoftTenantId = null }) {
  const normalizedTenant = microsoftTenantId ? normalizeUuid(microsoftTenantId, 'azure.microsoftTenantId') : null;
  const params = [tenantId]; let tenantFilter = '';
  if (normalizedTenant) { params.push(normalizedTenant); tenantFilter = `AND microsoft_tenant_id = $${params.length}::uuid`; }
  const result = await client.query(`SELECT DISTINCT microsoft_tenant_id FROM tenant_azure_scopes WHERE tenant_id = $1 ${tenantFilter} AND subscription_id IS NULL AND is_active = TRUE AND status IN ('CONSENTED','VERIFIED') ORDER BY microsoft_tenant_id`, params);
  if (result.rowCount < 1) throw new ForbiddenError('Azure onboarding is required before this scan can be started.', { remediation: 'Run the Microsoft admin-consent onboarding flow for this Bevoac tenant.' });
  if (result.rowCount > 1) throw new ValidationError('Multiple Microsoft tenants are onboarded. Provide azure.microsoftTenantId as a filter.');
  return { microsoftTenantId: String(result.rows[0].microsoft_tenant_id).toLowerCase() };
}
async function resolveAuthorizedAzureSubscriptions(client, { tenantId, microsoftTenantId = null, subscriptionIds = [] }) {
  const normalizedTenant = microsoftTenantId ? normalizeUuid(microsoftTenantId, 'azure.microsoftTenantId') : null;
  const normalizedSubscriptions = Array.isArray(subscriptionIds) ? subscriptionIds.map((item) => normalizeUuid(item, 'azure.subscriptionIds[]')) : [];
  if (new Set(normalizedSubscriptions).size !== normalizedSubscriptions.length) throw new ValidationError('azure.subscriptionIds cannot contain duplicates.');
  const params = [tenantId]; let tenantFilter = ''; let subscriptionFilter = '';
  if (normalizedTenant) { params.push(normalizedTenant); tenantFilter = `AND microsoft_tenant_id = $${params.length}::uuid`; }
  if (normalizedSubscriptions.length > 0) { params.push(normalizedSubscriptions); subscriptionFilter = `AND subscription_id = ANY($${params.length}::uuid[])`; }
  const result = await client.query(`SELECT microsoft_tenant_id, subscription_id, display_name FROM tenant_azure_scopes WHERE tenant_id = $1 ${tenantFilter} ${subscriptionFilter} AND subscription_id IS NOT NULL AND is_active = TRUE AND status = 'VERIFIED' ORDER BY microsoft_tenant_id, subscription_id`, params);
  if (result.rowCount < 1) throw new ForbiddenError('No verified Azure subscription is available for this Bevoac tenant.', { remediation: 'Complete Azure onboarding and RBAC verification before starting infra scans.' });
  const rows = result.rows.map((row) => ({ microsoftTenantId: String(row.microsoft_tenant_id).toLowerCase(), subscriptionId: String(row.subscription_id).toLowerCase(), displayName: row.display_name || null }));
  if (normalizedSubscriptions.length > 0) {
    const returned = new Set(rows.map((row) => row.subscriptionId));
    const missing = normalizedSubscriptions.filter((subscriptionId) => !returned.has(subscriptionId));
    if (missing.length > 0) throw new ForbiddenError('One or more requested Azure subscriptions are not verified for this Bevoac tenant.', { subscriptionIds: missing, remediation: 'Use only subscriptions returned by /v1/onboarding/azure/status or re-run /v1/onboarding/azure/verify.' });
  }
  const tenantIds = [...new Set(rows.map((row) => row.microsoftTenantId))];
  if (tenantIds.length > 1) throw new ValidationError('Multiple Microsoft tenants are onboarded. Provide azure.microsoftTenantId or azure.subscriptionIds as a filter.');
  return { microsoftTenantId: tenantIds[0], subscriptions: rows.map((row) => row.subscriptionId) };
}
async function ensureAuthorizedWebTarget(client, { tenantId, targetUrl }) {
  const normalized = normalizeHttpsTargetUrl(targetUrl);
  const result = await client.query(`SELECT id FROM tenant_web_targets WHERE tenant_id = $1 AND host = $2 AND is_active = TRUE LIMIT 1`, [tenantId, normalized.host]);
  if (result.rowCount !== 1) throw new ForbiddenError('Web target host is not registered for this Bevoac tenant.', { host: normalized.host, remediation: 'Register the customer web target before allowing scans.' });
  return normalized;
}
async function ensureAuthorizedAzureScope(client, { tenantId, microsoftTenantId, subscriptionId = null }) {
  const normalizedTenant = normalizeUuid(microsoftTenantId, 'azure.microsoftTenantId');
  const normalizedSubscription = subscriptionId ? normalizeUuid(subscriptionId, 'azure.subscriptionIds[]') : null;
  const result = await client.query(`SELECT id FROM tenant_azure_scopes WHERE tenant_id = $1 AND microsoft_tenant_id = $2::uuid AND ((subscription_id IS NULL AND $3::uuid IS NULL) OR subscription_id = $3::uuid) AND is_active = TRUE AND (($3::uuid IS NULL AND status IN ('CONSENTED','VERIFIED')) OR ($3::uuid IS NOT NULL AND status = 'VERIFIED')) LIMIT 1`, [tenantId, normalizedTenant, normalizedSubscription]);
  if (result.rowCount !== 1) throw new ForbiddenError('Azure tenant or subscription is not registered for this Bevoac tenant.', { microsoftTenantId: normalizedTenant, subscriptionId: normalizedSubscription });
  return { microsoftTenantId: normalizedTenant, subscriptionId: normalizedSubscription };
}
module.exports = { normalizeUuid, normalizeHost, normalizeHttpsTargetUrl, isPrivateOrLocalHost, ensureAuthorizedAzureScope, resolveAuthorizedAzureTenant, resolveAuthorizedAzureSubscriptions, ensureAuthorizedWebTarget };
