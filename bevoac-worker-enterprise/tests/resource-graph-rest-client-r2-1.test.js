'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOURCE_GRAPH_ENDPOINT,
  RESOURCE_MANAGER_SCOPE,
  createResourceGraphRestClient,
  normalizeRequest
} = require('../src/lib/resource-graph-rest-client');

function response({ status = 200, payload = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'retry-after': '1' }),
    async json() { return payload; }
  };
}

test('Resource Graph REST client maps SDK-shaped pagination options to the ARM REST contract', async () => {
  const tokenCalls = [];
  const fetchCalls = [];
  const credential = {
    async getToken(scope, options) {
      tokenCalls.push({ scope, options });
      return { token: 'test-access-token', expiresOnTimestamp: Date.now() + 60000 };
    }
  };
  const client = createResourceGraphRestClient(credential, {
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return response({ status: 200, payload: { data: [{ id: 'one' }], $skipToken: 'next-page' } });
    }
  });
  const abortController = new AbortController();

  const result = await client.resources({
    subscriptions: ['11111111-1111-4111-8111-111111111111'],
    query: 'Resources | project id',
    options: { resultFormat: 'objectArray', top: 1000, skipToken: 'current-page' }
  }, { abortSignal: abortController.signal });

  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].scope, RESOURCE_MANAGER_SCOPE);
  assert.equal(tokenCalls[0].options.abortSignal, abortController.signal);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, RESOURCE_GRAPH_ENDPOINT);
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.signal, abortController.signal);
  assert.equal(fetchCalls[0].options.headers.authorization, 'Bearer test-access-token');
  assert.match(fetchCalls[0].options.headers['x-ms-client-request-id'], /^[0-9a-f-]{36}$/i);
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    subscriptions: ['11111111-1111-4111-8111-111111111111'],
    query: 'Resources | project id',
    options: { $top: 1000, $skipToken: 'current-page', resultFormat: 'objectArray' }
  });
  assert.equal(result.$skipToken, 'next-page');
});

test('Resource Graph REST client exposes retry classification data without leaking service payloads', async () => {
  const credential = { async getToken() { return { token: 'secret-token' }; } };
  const client = createResourceGraphRestClient(credential, {
    fetchImpl: async () => response({
      status: 429,
      payload: { error: { code: 'TooManyRequests', message: 'secret=must-not-leak token=must-not-leak' } }
    })
  });

  await assert.rejects(
    client.resources({ subscriptions: ['11111111-1111-4111-8111-111111111111'], query: 'Resources' }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.code, 'TOOMANYREQUESTS');
      assert.equal(error.message, 'Azure Resource Graph request failed with HTTP 429.');
      assert.equal(error.message.includes('must-not-leak'), false);
      assert.equal(error.message.includes('secret-token'), false);
      assert.equal(error.response.headers.get('retry-after'), '1');
      return true;
    }
  );
});

test('Resource Graph REST client fails closed on unsupported request options', () => {
  assert.throws(
    () => normalizeRequest({ query: 'Resources', subscriptions: ['11111111-1111-4111-8111-111111111111'], options: { arbitraryEndpoint: true } }),
    (error) => error.code === 'RESOURCE_GRAPH_INVALID_REQUEST'
  );
});

test('Resource Graph REST client fails closed when the credential returns no token', async () => {
  const client = createResourceGraphRestClient({ async getToken() { return null; } }, {
    fetchImpl: async () => { throw new Error('fetch must not execute'); }
  });
  await assert.rejects(
    client.resources({ query: 'Resources', subscriptions: ['11111111-1111-4111-8111-111111111111'] }),
    (error) => error.code === 'RESOURCE_GRAPH_AUTH_TOKEN_MISSING' && error.statusCode === 401
  );
});
