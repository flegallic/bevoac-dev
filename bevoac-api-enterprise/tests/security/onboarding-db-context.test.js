'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AzureOnboardingService
} = require(
  '../../src/services/azure-onboarding-service'
);

class FakeClient {
  constructor() {
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({
      sql,
      params
    });

    return {
      rowCount: 1,
      rows: []
    };
  }

  release() {}
}

class FakePool {
  constructor(client) {
    this.client = client;
  }

  async connect() {
    return this.client;
  }
}

function onboardingConfig() {
  return {
    microsoft: {
      clientId:
        '11111111-1111-4111-8111-111111111111',
      clientSecret: 'secret',
      adminConsentScope:
        'https://graph.microsoft.com/.default'
    },
    onboarding: {
      redirectUri:
        'https://api.example.test/v1/onboarding/azure/callback',
      allowInferredRedirectUri: false,
      stateTtlMinutes: 20,
      stateSecret:
        '12345678901234567890123456789012',
      frontendSuccessUrl:
        'https://portal.example.test/success',
      azureRequestTimeoutMs: 15000
    }
  };
}

test(
  'onboarding start positions and clears tenant context',
  async () => {
    const client = new FakeClient();
    const service =
      new AzureOnboardingService(
        new FakePool(client),
        onboardingConfig(),
        console
      );

    const tenantId =
      '22222222-2222-4222-8222-222222222222';

    const apiKeyId =
      '33333333-3333-4333-8333-333333333333';

    const result =
      await service.startOnboarding({
        tenantId,
        apiKeyId,
        request: {
          headers: {}
        }
      });

    assert.equal(
      typeof result.authorizationUrl,
      'string'
    );

    assert.equal(client.calls.length, 3);

    assert.match(
      client.calls[0].sql,
      /app\.current_tenant_id/
    );

    assert.deepEqual(
      client.calls[0].params,
      [tenantId, false]
    );

    assert.match(
      client.calls[1].sql,
      /INSERT INTO azure_onboarding_sessions/
    );

    assert.match(
      client.calls[2].sql,
      /set_config\('app\.current_tenant_id', '', false\)/
    );
  }
);

test(
  'onboarding service has no unmanaged pool connection',
  () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../src/services/azure-onboarding-service.js'
      ),
      'utf8'
    );

    assert.doesNotMatch(
      source,
      /this\.pg\.connect\s*\(/
    );

    assert.match(
      source,
      /withTenantSession/
    );

    assert.match(
      source,
      /withTenantTransaction/
    );

    assert.doesNotMatch(
      source,
      /withServiceSession/
    );

    assert.doesNotMatch(
      source,
      /withServiceTransaction/
    );
  }
);

test(
  'signed callback tenant controls the database transaction',
  () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../src/services/azure-onboarding-service.js'
      ),
      'utf8'
    );

    assert.match(
      source,
      /withTenantTransaction\(\s*this\.pg,\s*payload\.tid/
    );

    assert.match(
      source,
      /verifySignedState/
    );

    assert.match(
      source,
      /WHERE id = \$1[\s\S]*AND tenant_id = \$2[\s\S]*AND state_hash = \$3/
    );
  }
);
