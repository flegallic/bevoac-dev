'use strict';

const { withRetry } = require('./retry');
const { PREFLIGHT_MODULES } = require('./module-catalog');
const { throwIfAborted, azureAbortOptions } = require('./abort');
const { createResourceGraphRestClient } = require('./resource-graph-rest-client');

const INFRA_MODULES = new Set(PREFLIGHT_MODULES);

function hasInfraModules(modules) {
  return Array.isArray(modules) && modules.some((item) => INFRA_MODULES.has(String(item || '').toLowerCase()));
}

async function countAzureResources({ credential, subscriptions, logger, client: injectedClient = null, signal = null }) {
  throwIfAborted(signal, 'Azure resource preflight');
  const subscriptionIds = Array.isArray(subscriptions) ? [...new Set(subscriptions.filter(Boolean))] : [];
  if (subscriptionIds.length === 0) return { total: 0, bySubscription: [] };
  const client = injectedClient || createResourceGraphRestClient(credential);
  const response = await withRetry(
    ({ signal: retrySignal }) => client.resources({
      subscriptions: subscriptionIds,
      query: 'Resources | summarize resourceCount=count() by subscriptionId | order by subscriptionId asc',
      options: { resultFormat: 'objectArray' }
    }, azureAbortOptions(retrySignal)),
    { label: 'azure.resourceGraph.countResources', retries: 3, logger, signal }
  );
  throwIfAborted(signal, 'Azure resource preflight');
  const rows = Array.isArray(response.data) ? response.data : [];
  const bySubscription = subscriptionIds.map((subscriptionId) => {
    const row = rows.find((item) => String(item.subscriptionId || '').toLowerCase() === String(subscriptionId).toLowerCase());
    return { subscriptionId, resourceCount: Number(row?.resourceCount || 0) };
  });
  const total = bySubscription.reduce((sum, item) => sum + item.resourceCount, 0);
  logger?.info?.({ total, bySubscription }, 'Azure resource preflight completed.');
  return { total, bySubscription };
}

module.exports = { INFRA_MODULES, hasInfraModules, countAzureResources };
