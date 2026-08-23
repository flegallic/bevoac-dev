'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../src/config/env');

const KEYS = [
  'NODE_ENV', 'PG_HOST', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
  'PG_SSL_MODE', 'ALLOW_PG_SSL_REQUIRE_ROLLBACK', 'SERVICEBUS_AUTH_MODE',
  'SERVICEBUS_FQ_NAMESPACE', 'SERVICEBUS_CONNECTION_STRING',
  'SERVICEBUS_QUEUE_NAME', 'ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK',
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'WEB_ALLOWED_SCHEMES'
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
    PG_HOST: 'postgres.example.test',
    PG_DATABASE: 'postgres',
    PG_USER: 'bevoac_worker',
    PG_PASSWORD: 'not-a-real-password',
    PG_SSL_MODE: 'verify-full',
    SERVICEBUS_AUTH_MODE: 'managed_identity',
    SERVICEBUS_FQ_NAMESPACE: 'bevoac.servicebus.windows.net',
    SERVICEBUS_QUEUE_NAME: 'scan-jobs',
    MICROSOFT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    MICROSOFT_CLIENT_SECRET: 'not-a-real-microsoft-secret',
    WEB_ALLOWED_SCHEMES: 'https:'
  };
}

test('worker production rejects PostgreSQL TLS without certificate verification', () => withEnv({
  ...baseProduction(),
  PG_SSL_MODE: 'require'
}, () => assert.throws(() => getConfig(), /certificate verification/)));

test('worker production requires Microsoft credentials', () => withEnv({
  ...baseProduction(),
  MICROSOFT_CLIENT_SECRET: ''
}, () => assert.throws(() => getConfig(), /MICROSOFT_CLIENT_SECRET/)));

test('worker production accepts only HTTPS web scan schemes', () => withEnv({
  ...baseProduction(),
  WEB_ALLOWED_SCHEMES: 'https:,http:'
}, () => assert.throws(() => getConfig(), /exactly https:/)));

test('worker production defaults to Managed Identity Service Bus auth', () => withEnv({
  ...baseProduction(),
  SERVICEBUS_AUTH_MODE: ''
}, () => assert.equal(getConfig().serviceBus.authMode, 'managed_identity')));
