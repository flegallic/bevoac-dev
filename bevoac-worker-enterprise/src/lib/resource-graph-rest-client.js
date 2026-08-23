'use strict';

const { randomUUID } = require('node:crypto');
const { throwIfAborted, azureAbortOptions } = require('./abort');

const RESOURCE_GRAPH_ENDPOINT = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01';
const RESOURCE_MANAGER_SCOPE = 'https://management.azure.com/.default';
const RESULT_FORMATS = new Set(['objectArray', 'table']);
const AUTHORIZATION_SCOPE_FILTERS = new Set([
  'AtScopeAndBelow',
  'AtScopeAndAbove',
  'AtScopeExact',
  'AtScopeAboveAndBelow'
]);

function boundedInteger(value, label, { min, max }) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error(`${label} must be an integer between ${min} and ${max}.`);
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  return parsed;
}

function optionalString(value, label, maxLength = 65536) {
  if (value === undefined || value === null) return undefined;
  const parsed = String(value);
  if (!parsed || parsed.length > maxLength) {
    const error = new Error(`${label} must be a non-empty string no longer than ${maxLength} characters.`);
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  return parsed;
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    const error = new Error('Resource Graph options must be an object.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }

  const allowed = new Set([
    'top', '$top',
    'skip', '$skip',
    'skipToken', '$skipToken',
    'resultFormat',
    'allowPartialScopes',
    'authorizationScopeFilter'
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      const error = new Error(`Unsupported Resource Graph option: ${key}.`);
      error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
      throw error;
    }
  }

  const top = boundedInteger(options.top ?? options.$top, 'Resource Graph top', { min: 1, max: 1000 });
  const skip = boundedInteger(options.skip ?? options.$skip, 'Resource Graph skip', { min: 0, max: 2147483647 });
  const skipToken = optionalString(options.skipToken ?? options.$skipToken, 'Resource Graph skip token');
  const resultFormat = options.resultFormat === undefined ? undefined : String(options.resultFormat);
  if (resultFormat !== undefined && !RESULT_FORMATS.has(resultFormat)) {
    const error = new Error('Resource Graph resultFormat must be objectArray or table.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  if (options.allowPartialScopes !== undefined && typeof options.allowPartialScopes !== 'boolean') {
    const error = new Error('Resource Graph allowPartialScopes must be a boolean.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  const authorizationScopeFilter = options.authorizationScopeFilter === undefined
    ? undefined
    : String(options.authorizationScopeFilter);
  if (authorizationScopeFilter !== undefined && !AUTHORIZATION_SCOPE_FILTERS.has(authorizationScopeFilter)) {
    const error = new Error('Resource Graph authorizationScopeFilter is invalid.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }

  return {
    ...(top !== undefined ? { $top: top } : {}),
    ...(skip !== undefined ? { $skip: skip } : {}),
    ...(skipToken !== undefined ? { $skipToken: skipToken } : {}),
    ...(resultFormat !== undefined ? { resultFormat } : {}),
    ...(options.allowPartialScopes !== undefined ? { allowPartialScopes: options.allowPartialScopes } : {}),
    ...(authorizationScopeFilter !== undefined ? { authorizationScopeFilter } : {})
  };
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    const error = new Error('Resource Graph request must be an object.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  const query = String(request.query || '').trim();
  if (!query || query.length > 65536) {
    const error = new Error('Resource Graph query must be non-empty and no longer than 65536 characters.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }

  const subscriptions = Array.isArray(request.subscriptions)
    ? [...new Set(request.subscriptions.map(String).map((value) => value.trim()).filter(Boolean))]
    : undefined;
  const managementGroups = Array.isArray(request.managementGroups)
    ? [...new Set(request.managementGroups.map(String).map((value) => value.trim()).filter(Boolean))]
    : undefined;

  if (request.subscriptions !== undefined && (!subscriptions || subscriptions.length === 0)) {
    const error = new Error('Resource Graph subscriptions must contain at least one identifier.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  const subscriptionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (subscriptions?.some((subscriptionId) => !subscriptionPattern.test(subscriptionId))) {
    const error = new Error('Resource Graph subscription identifiers must be UUIDs.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  if (request.managementGroups !== undefined && (!managementGroups || managementGroups.length === 0)) {
    const error = new Error('Resource Graph managementGroups must contain at least one identifier.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }
  if (request.facets !== undefined && !Array.isArray(request.facets)) {
    const error = new Error('Resource Graph facets must be an array.');
    error.code = 'RESOURCE_GRAPH_INVALID_REQUEST';
    throw error;
  }

  const normalizedOptions = normalizeOptions(request.options || {});
  return {
    query,
    ...(subscriptions ? { subscriptions } : {}),
    ...(managementGroups ? { managementGroups } : {}),
    ...(request.facets ? { facets: request.facets } : {}),
    ...(Object.keys(normalizedOptions).length > 0 ? { options: normalizedOptions } : {})
  };
}

function safeServiceCode(value) {
  return String(value || 'RESOURCE_GRAPH_HTTP_ERROR')
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, '_')
    .slice(0, 120) || 'RESOURCE_GRAPH_HTTP_ERROR';
}

async function readErrorPayload(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) {
    return null;
  }
}

function createResourceGraphRestClient(credential, options = {}) {
  if (!credential || typeof credential.getToken !== 'function') {
    throw new Error('Resource Graph REST client requires an Azure TokenCredential.');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Resource Graph REST client requires a fetch implementation.');
  }
  const endpoint = RESOURCE_GRAPH_ENDPOINT;

  return Object.freeze({
    async resources(request, requestOptions = {}) {
      const signal = requestOptions?.abortSignal || requestOptions?.signal || null;
      throwIfAborted(signal, 'Azure Resource Graph request');
      const body = normalizeRequest(request);
      const accessToken = await credential.getToken(RESOURCE_MANAGER_SCOPE, azureAbortOptions(signal));
      throwIfAborted(signal, 'Azure Resource Graph request');
      if (!accessToken?.token || typeof accessToken.token !== 'string') {
        const error = new Error('Azure credential did not return a Resource Manager access token.');
        error.code = 'RESOURCE_GRAPH_AUTH_TOKEN_MISSING';
        error.statusCode = 401;
        throw error;
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken.token}`,
          'content-type': 'application/json',
          'x-ms-client-request-id': randomUUID()
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {})
      });
      throwIfAborted(signal, 'Azure Resource Graph request');

      if (!response || typeof response.status !== 'number') {
        const error = new Error('Azure Resource Graph returned an invalid HTTP response.');
        error.code = 'RESOURCE_GRAPH_INVALID_RESPONSE';
        throw error;
      }

      if (!response.ok) {
        const payload = await readErrorPayload(response);
        const error = new Error(`Azure Resource Graph request failed with HTTP ${response.status}.`);
        error.code = safeServiceCode(payload?.error?.code);
        error.statusCode = response.status;
        error.status = response.status;
        error.response = { status: response.status, headers: response.headers };
        throw error;
      }

      let payload;
      try {
        payload = await response.json();
      } catch (cause) {
        const error = new Error('Azure Resource Graph returned a non-JSON success response.', { cause });
        error.code = 'RESOURCE_GRAPH_INVALID_RESPONSE';
        error.statusCode = response.status;
        throw error;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const error = new Error('Azure Resource Graph returned an invalid JSON response.');
        error.code = 'RESOURCE_GRAPH_INVALID_RESPONSE';
        error.statusCode = response.status;
        throw error;
      }
      return payload;
    }
  });
}

module.exports = {
  RESOURCE_GRAPH_ENDPOINT,
  RESOURCE_MANAGER_SCOPE,
  createResourceGraphRestClient,
  normalizeRequest,
  normalizeOptions
};
