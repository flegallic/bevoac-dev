'use strict';

const { throwIfAborted, azureAbortOptions } = require('./abort');
const { createResourceGraphRestClient } = require('./resource-graph-rest-client');


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

function getSkipToken(response) {
  return response?.$skipToken || response?.skipToken || response?.skip_token || response?.data?.$skipToken || response?.data?.skipToken || response?.data?.skip_token || null;
}

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function resourceGraphDefaults() {
  return {
    pageSize: boundedInteger(process.env.AZURE_RESOURCE_GRAPH_PAGE_SIZE || process.env.RESOURCE_GRAPH_PAGE_SIZE, 1000, { min: 1, max: 1000 }),
    maxRows: boundedInteger(process.env.AZURE_RESOURCE_GRAPH_MAX_ROWS || process.env.RESOURCE_GRAPH_MAX_ROWS, 100000, { min: 1, max: 1000000 }),
    maxPages: boundedInteger(process.env.AZURE_RESOURCE_GRAPH_MAX_PAGES || process.env.RESOURCE_GRAPH_MAX_PAGES, 250, { min: 1, max: 1000 })
  };
}

async function runResourceGraphQueryDetailed(credential, subscriptions, query, options = {}) {
  if (!credential) throw new Error('Resource Graph query requires an Azure credential.');
  const subscriptionList = Array.isArray(subscriptions) ? [...new Set(subscriptions.filter(Boolean))] : [];
  if (subscriptionList.length === 0) throw new Error('Resource Graph query requires at least one subscription.');
  if (!String(query || '').trim()) throw new Error('Resource Graph query must not be empty.');

  const defaults = resourceGraphDefaults();
  const pageSize = boundedInteger(options.pageSize ?? options.top, defaults.pageSize, { min: 1, max: 1000 });
  const maxRows = boundedInteger(options.maxRows, defaults.maxRows, { min: 1, max: 1000000 });
  const maxPages = boundedInteger(options.maxPages, defaults.maxPages, { min: 1, max: 1000 });
  const client = options.client || createResourceGraphRestClient(credential);
  const signal = options.signal || null;

  const rows = [];
  const seenTokens = new Set();
  let skipToken = options.skipToken || null;
  let pagesProcessed = 0;
  let truncated = false;
  let truncationReason = null;

  while (true) {
    throwIfAborted(signal, 'Azure Resource Graph query');
    if (pagesProcessed >= maxPages) {
      truncated = true;
      truncationReason = 'MAX_PAGES_REACHED';
      break;
    }

    const remaining = maxRows - rows.length;
    if (remaining <= 0) {
      truncated = true;
      truncationReason = 'MAX_ROWS_REACHED';
      break;
    }

    const response = await client.resources({
      subscriptions: subscriptionList,
      query,
      options: {
        resultFormat: 'objectArray',
        top: Math.min(pageSize, remaining),
        ...(skipToken ? { skipToken } : {})
      }
    }, azureAbortOptions(signal));

    throwIfAborted(signal, 'Azure Resource Graph query');

    pagesProcessed += 1;
    const pageRows = normalizeRows(response);
    if (pageRows.length > remaining) {
      rows.push(...pageRows.slice(0, remaining));
      truncated = true;
      truncationReason = 'MAX_ROWS_REACHED';
      break;
    }
    rows.push(...pageRows);

    const nextToken = getSkipToken(response);
    if (!nextToken) break;

    if (seenTokens.has(nextToken) || nextToken === skipToken) {
      const error = new Error('Resource Graph returned a repeated skip token.');
      error.code = 'RESOURCE_GRAPH_REPEATED_SKIP_TOKEN';
      throw error;
    }

    seenTokens.add(nextToken);
    skipToken = nextToken;

    if (rows.length >= maxRows) {
      truncated = true;
      truncationReason = 'MAX_ROWS_REACHED';
      break;
    }
  }

  const metadata = Object.freeze({
    pagesProcessed,
    rowsReturned: rows.length,
    pageSize,
    maxRows,
    maxPages,
    truncated,
    truncationReason,
    subscriptionsCount: subscriptionList.length
  });

  return { rows, metadata };
}

async function runResourceGraphQuery(credential, subscriptions, query, options = {}) {
  const { rows, metadata } = await runResourceGraphQueryDetailed(credential, subscriptions, query, options);
  Object.defineProperty(rows, 'resourceGraphMetadata', {
    value: metadata,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return rows;
}

function getResourceGraphMetadata(rows) {
  return Array.isArray(rows) && rows.resourceGraphMetadata ? rows.resourceGraphMetadata : null;
}

function summarizeRows(rows, predicate) {
  const all = Array.isArray(rows) ? rows : [];
  return all.filter(predicate).length;
}

module.exports = {
  runResourceGraphQuery,
  runResourceGraphQueryDetailed,
  getResourceGraphMetadata,
  normalizeRows,
  summarizeRows,
  resourceGraphDefaults,
};
