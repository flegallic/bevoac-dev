'use strict';

const { ResourceGraphClient } = require('@azure/arm-resourcegraph');

function normalizeRows(response) {
  if (!response) return [];
  if (Array.isArray(response.data)) return response.data;
  if (response.data && Array.isArray(response.data.rows) && Array.isArray(response.data.columns)) {
    const columns = response.data.columns.map((col) => col.name || col);
    return response.data.rows.map((row) => Object.fromEntries(row.map((value, index) => [columns[index], value])));
  }
  if (Array.isArray(response.rows) && Array.isArray(response.columns)) {
    const columns = response.columns.map((col) => col.name || col);
    return response.rows.map((row) => Object.fromEntries(row.map((value, index) => [columns[index], value])));
  }
  if (Array.isArray(response.value)) return response.value;
  return [];
}

async function runResourceGraphQuery(credential, subscriptions, query, options = {}) {
  if (!credential) throw new Error('Resource Graph query requires an Azure credential.');
  const subscriptionList = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : [];
  if (subscriptionList.length === 0) throw new Error('Resource Graph query requires at least one subscription.');
  const client = new ResourceGraphClient(credential);
  const request = {
    subscriptions: subscriptionList,
    query,
    options: {
      resultFormat: 'objectArray',
      top: options.top || 1000,
      skipToken: options.skipToken
    }
  };
  const response = await client.resources(request);
  return normalizeRows(response);
}

function summarizeRows(rows, predicate) {
  const all = Array.isArray(rows) ? rows : [];
  return all.filter(predicate).length;
}

module.exports = { runResourceGraphQuery, normalizeRows, summarizeRows };
