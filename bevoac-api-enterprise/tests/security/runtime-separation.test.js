'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveRuntimeMode,
  runtimeSupportsPublicApi,
  runtimeSupportsAdminApi,
  runtimeRequiresServiceBus,
  isHttpRuntime
} = require('../../src/lib/runtime-mode');

const { getConfig } =
  require('../../src/config/env');

const MANAGED_ENV = [
  'NODE_ENV',
  'APP_RUNTIME_MODE',
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
  'PG_PASSWORD',
  'PG_SSL_MODE',
  'ALLOW_PG_SSL_REQUIRE_ROLLBACK',
  'OUTBOX_PUBLISHER_ENABLED',
  'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST',
  'SERVICEBUS_AUTH_MODE',
  'SERVICEBUS_FQ_NAMESPACE',
  'SERVICEBUS_CONNECTION_STRING',
  'SERVICEBUS_QUEUE_NAME',
  'ONBOARDING_STATE_SECRET',
  'API_PUBLIC_BASE_URL',
  'ONBOARDING_REDIRECT_URI',
  'ADMIN_AUTH_MODE',
  'ADMIN_API_SECRET',
  'ADMIN_OIDC_ISSUER',
  'ADMIN_OIDC_AUDIENCE',
  'ADMIN_OIDC_TENANT_ID',
  'APIM_BACKEND_BOUNDARY_REQUIRED',
  'APIM_BACKEND_SHARED_SECRET',
  'SWAGGER_ENABLED',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET'
];

function withEnvironment(values, fn) {
  const previous = new Map();

  for (const key of MANAGED_ENV) {
    previous.set(
      key,
      Object.prototype.hasOwnProperty.call(
        process.env,
        key
      )
        ? process.env[key]
        : undefined
    );

    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      process.env[key] = String(value);
    }
  }

  try {
    return fn();
  } finally {
    for (const key of MANAGED_ENV) {
      const value = previous.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function baseDatabaseEnvironment() {
  return {
    NODE_ENV: 'production',
    PG_HOST: 'postgres.example.test',
    PG_PORT: '5432',
    PG_DATABASE: 'postgres',
    PG_USER: 'runtime-role',
    PG_PASSWORD: 'runtime-password',
    PG_SSL_MODE: 'verify-full'
  };
}

test('runtime mode rejects unsupported values', () => {
  assert.equal(
    resolveRuntimeMode('public_api'),
    'public_api'
  );

  assert.throws(
    () => resolveRuntimeMode('unknown'),
    /Unsupported APP_RUNTIME_MODE/
  );
});

test('runtime capabilities are explicit', () => {
  assert.equal(
    runtimeSupportsPublicApi('public_api'),
    true
  );

  assert.equal(
    runtimeSupportsPublicApi('admin_api'),
    false
  );

  assert.equal(
    runtimeSupportsAdminApi('admin_api'),
    true
  );

  assert.equal(
    runtimeSupportsAdminApi('public_api'),
    false
  );

  assert.equal(isHttpRuntime('outbox'), false);
  assert.equal(isHttpRuntime('retention'), false);

  assert.equal(
    runtimeRequiresServiceBus(
      'public_api',
      {
        publisherEnabled: false,
        immediatePublishAfterRequest: false
      }
    ),
    false
  );

  assert.equal(
    runtimeRequiresServiceBus('outbox', {}),
    true
  );
});

test(
  'public API does not require admin or Service Bus configuration when outbox is dedicated and requires its APIM boundary',
  () => withEnvironment(
    {
      ...baseDatabaseEnvironment(),
      APP_RUNTIME_MODE: 'public_api',
      OUTBOX_PUBLISHER_ENABLED: 'false',
      OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST:
        'false',
      ONBOARDING_STATE_SECRET:
        '12345678901234567890123456789012',
      API_PUBLIC_BASE_URL:
        'https://api.example.test',
      APIM_BACKEND_BOUNDARY_REQUIRED: 'true',
      APIM_BACKEND_SHARED_SECRET:
        '0123456789abcdefghijklmnopqrstuvwxyz',
      MICROSOFT_CLIENT_ID:
        '00000000-0000-4000-8000-000000000001',
      MICROSOFT_CLIENT_SECRET:
        'not-a-real-microsoft-secret'
    },
    () => {
      const config = getConfig();

      assert.equal(
        config.runtimeMode,
        'public_api'
      );

      assert.equal(config.adminAuth, null);
      assert.equal(config.serviceBus, null);
      assert.equal(config.apimBackendBoundary.required, true);
      assert.equal(
        config.apimBackendBoundary.sharedSecret,
        '0123456789abcdefghijklmnopqrstuvwxyz'
      );

      assert.equal(
        config.onboarding.redirectUri,
        'https://api.example.test' +
        '/v1/onboarding/azure/callback'
      );
    }
  )
);

test(
  'admin API does not require onboarding or Service Bus configuration',
  () => withEnvironment(
    {
      ...baseDatabaseEnvironment(),
      APP_RUNTIME_MODE: 'admin_api',
      ADMIN_AUTH_MODE: 'oidc',
      ADMIN_OIDC_ISSUER:
        'https://login.example.test/tenant/v2.0',
      ADMIN_OIDC_AUDIENCE:
        'api://bevoac-admin',
      ADMIN_OIDC_TENANT_ID:
        '11111111-1111-4111-8111-111111111111'
    },
    () => {
      const config = getConfig();

      assert.equal(
        config.runtimeMode,
        'admin_api'
      );

      assert.equal(config.onboarding, null);
      assert.equal(config.serviceBus, null);
      assert.equal(config.adminAuth.mode, 'oidc');
    }
  )
);

test(
  'retention runtime requires only PostgreSQL configuration',
  () => withEnvironment(
    {
      ...baseDatabaseEnvironment(),
      APP_RUNTIME_MODE: 'retention'
    },
    () => {
      const config = getConfig();

      assert.equal(
        config.runtimeMode,
        'retention'
      );

      assert.equal(config.onboarding, null);
      assert.equal(config.adminAuth, null);
      assert.equal(config.serviceBus, null);
    }
  )
);

test(
  'outbox runtime requires Service Bus but not HTTP secrets',
  () => withEnvironment(
    {
      ...baseDatabaseEnvironment(),
      APP_RUNTIME_MODE: 'outbox',
      SERVICEBUS_AUTH_MODE:
        'managed_identity',
      SERVICEBUS_FQ_NAMESPACE:
        'bevoac.servicebus.windows.net',
      SERVICEBUS_QUEUE_NAME:
        'scan-jobs'
    },
    () => {
      const config = getConfig();

      assert.equal(
        config.runtimeMode,
        'outbox'
      );

      assert.equal(config.onboarding, null);
      assert.equal(config.adminAuth, null);

      assert.equal(
        config.serviceBus.authMode,
        'managed_identity'
      );
    }
  )
);
