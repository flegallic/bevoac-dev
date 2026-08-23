'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../../src/config/env');

const KEYS = [
  'NODE_ENV', 'APP_RUNTIME_MODE', 'PG_HOST', 'PG_DATABASE', 'PG_USER',
  'PG_PASSWORD', 'PG_SSL_MODE', 'ALLOW_PG_SSL_REQUIRE_ROLLBACK', 'OUTBOX_PUBLISHER_ENABLED',
  'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST', 'ONBOARDING_STATE_SECRET',
  'API_PUBLIC_BASE_URL', 'APIM_BACKEND_BOUNDARY_REQUIRED',
  'APIM_BACKEND_SHARED_SECRET', 'SERVICEBUS_AUTH_MODE',
  'SERVICEBUS_CONNECTION_STRING', 'SERVICEBUS_QUEUE_NAME',
  'ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK', 'ADMIN_AUTH_MODE',
  'ADMIN_OIDC_ISSUER', 'ADMIN_OIDC_AUDIENCE', 'ADMIN_OIDC_TENANT_ID',
  'ALLOWED_ORIGINS', 'ONBOARDING_FRONTEND_SUCCESS_URL',
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'
];

function withEnv(values, fn) {
  const previous = new Map(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function baseProduction() {
  return {
    NODE_ENV: 'production',
    APP_RUNTIME_MODE: 'public_api',
    PG_HOST: 'postgres.example.test',
    PG_DATABASE: 'postgres',
    PG_USER: 'bevoac_api',
    PG_PASSWORD: 'not-a-real-password',
    PG_SSL_MODE: 'verify-full',
    OUTBOX_PUBLISHER_ENABLED: 'false',
    OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST: 'false',
    ONBOARDING_STATE_SECRET: '12345678901234567890123456789012',
    API_PUBLIC_BASE_URL: 'https://api.example.test',
    APIM_BACKEND_BOUNDARY_REQUIRED: 'true',
    APIM_BACKEND_SHARED_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789',
    MICROSOFT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    MICROSOFT_CLIENT_SECRET: 'not-a-real-microsoft-secret'
  };
}

test('production rejects disabled PostgreSQL TLS', () => withEnv({
  ...baseProduction(),
  PG_SSL_MODE: 'disable'
}, () => assert.throws(() => getConfig(), /forbidden in production/)));


test('production rejects PostgreSQL TLS without certificate verification', () => withEnv({
  ...baseProduction(),
  PG_SSL_MODE: 'require'
}, () => assert.throws(() => getConfig(), /certificate verification/)));

test('production allows temporary PostgreSQL require mode only through explicit rollback opt-in', () => withEnv({
  ...baseProduction(),
  PG_SSL_MODE: 'require',
  ALLOW_PG_SSL_REQUIRE_ROLLBACK: 'true'
}, () => assert.equal(getConfig().postgres.ssl.rejectUnauthorized, false)));

test('production rejects short APIM backend boundary secrets', () => withEnv({
  ...baseProduction(),
  APIM_BACKEND_SHARED_SECRET: 'too-short'
}, () => assert.throws(() => getConfig(), /at least 32 characters/)));

test('production rejects short onboarding state secrets', () => withEnv({
  ...baseProduction(),
  ONBOARDING_STATE_SECRET: 'too-short'
}, () => assert.throws(() => getConfig(), /at least 32 characters/)));

test('production public API requires Microsoft client credentials at startup', () => withEnv({
  ...baseProduction(),
  MICROSOFT_CLIENT_SECRET: ''
}, () => assert.throws(() => getConfig(), /MICROSOFT_CLIENT_SECRET/)));

test('production public API requires the APIM backend boundary secret', () => withEnv({
  ...baseProduction(),
  APIM_BACKEND_SHARED_SECRET: ''
}, () => assert.throws(() => getConfig(), /APIM_BACKEND_SHARED_SECRET/)));

test('production Service Bus connection string requires explicit rollback opt-in', () => withEnv({
  ...baseProduction(),
  OUTBOX_PUBLISHER_ENABLED: 'true',
  SERVICEBUS_AUTH_MODE: 'connection_string',
  SERVICEBUS_CONNECTION_STRING: 'Endpoint=sb://example/',
  SERVICEBUS_QUEUE_NAME: 'scan-jobs'
}, () => assert.throws(() => getConfig(), /ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK/)));


test('production forbids a combined public and admin runtime', () => withEnv({
  ...baseProduction(),
  APP_RUNTIME_MODE: 'combined',
  ADMIN_AUTH_MODE: 'oidc',
  ADMIN_OIDC_ISSUER: 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0',
  ADMIN_OIDC_AUDIENCE: 'api://bevoac-admin',
  ADMIN_OIDC_TENANT_ID: '11111111-1111-4111-8111-111111111111'
}, () => assert.throws(() => getConfig(), /combined is forbidden in production/)));

test('production admin API requires a dedicated OIDC tenant', () => withEnv({
  ...baseProduction(),
  APP_RUNTIME_MODE: 'admin_api',
  ADMIN_AUTH_MODE: 'oidc',
  ADMIN_OIDC_ISSUER: 'https://login.microsoftonline.com/organizations/v2.0',
  ADMIN_OIDC_AUDIENCE: 'api://bevoac-admin',
  ADMIN_OIDC_TENANT_ID: ''
}, () => assert.throws(() => getConfig(), /ADMIN_OIDC_TENANT_ID/)));


test('production onboarding success URL must be on the explicit HTTPS origin allowlist', () => withEnv({
  ...baseProduction(),
  ONBOARDING_FRONTEND_SUCCESS_URL: 'https://portal.example.test/success',
  ALLOWED_ORIGINS: ''
}, () => assert.throws(() => getConfig(), /not present in ALLOWED_ORIGINS/)));

test('production rejects non-HTTPS allowed origins', () => withEnv({
  ...baseProduction(),
  ALLOWED_ORIGINS: 'http://portal.example.test'
}, () => assert.throws(() => getConfig(), /must use HTTPS/)));
