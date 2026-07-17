const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { withRetry } = require('./retry');

const INFRA_MODULES = new Set(['storage', 'vms', 'nsg', 'keyvault', 'logs', 'db', 'governance', 'appservices', 'finops', 'entra_b2b', 'tags']);
function hasInfraModules(modules) { return Array.isArray(modules) && modules.some((item) => INFRA_MODULES.has(item)); }
async function countAzureResources({ credential, subscriptions, logger }) {
  const subscriptionIds = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : [];
  if (subscriptionIds.length === 0) return { total: 0, bySubscription: [] };
  const client = new ResourceGraphClient(credential);
  const response = await withRetry(
    () => client.resources({
      subscriptions: subscriptionIds,
      query: 'Resources | summarize resourceCount=count() by subscriptionId | order by subscriptionId asc',
      options: { resultFormat: 'objectArray' }
    }),
    { label: 'azure.resourceGraph.countResources', retries: 3, logger }
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  const bySubscription = subscriptionIds.map((subscriptionId) => {
    const row = rows.find((item) => String(item.subscriptionId || '').toLowerCase() === String(subscriptionId).toLowerCase());
    return { subscriptionId, resourceCount: Number(row?.resourceCount || 0) };
  });
  const total = bySubscription.reduce((sum, item) => sum + item.resourceCount, 0);
  logger?.info?.({ total, bySubscription }, 'Azure resource preflight completed.');
  return { total, bySubscription };
}
module.exports = { hasInfraModules, countAzureResources };
