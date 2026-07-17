import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500']
  },
  scenarios: {
    tenant_a: { executor: 'constant-vus', vus: Number(__ENV.TENANT_A_VUS || 3), duration: __ENV.TEST_DURATION || '3m', exec: 'tenantA' },
    tenant_b: { executor: 'constant-vus', vus: Number(__ENV.TENANT_B_VUS || 3), duration: __ENV.TEST_DURATION || '3m', exec: 'tenantB' }
  }
};

const baseUrl = (__ENV.API_BASE_URL || '').replace(/\/$/, '');
const targetA = __ENV.BEVOAC_TARGET_URL_A || 'https://example.com';
const targetB = __ENV.BEVOAC_TARGET_URL_B || 'https://example.org';

function assertEnv(name) {
  if (!__ENV[name]) throw new Error(`Missing required environment variable: ${name}`);
}

function createWebScan(apiKey, targetUrl, tenantLabel) {
  assertEnv('API_BASE_URL');
  const idem = `k6-${tenantLabel}-${exec.scenario.iterationInTest}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify({
    cloudProvider: 'azure',
    scanProfile: 'web',
    modules: ['web'],
    azure: { targetUrl }
  });
  const res = http.post(`${baseUrl}/v1/scans`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Idempotency-Key': idem
    },
    tags: { tenant: tenantLabel, endpoint: 'create-scan' }
  });

  check(res, {
    [`${tenantLabel} create scan accepted or backpressured`]: (r) => [200, 201, 429].includes(r.status),
    [`${tenantLabel} no server error on create`]: (r) => r.status < 500
  });

  if ([200, 201].includes(res.status)) {
    const body = res.json();
    check(body, {
      [`${tenantLabel} scanId returned`]: (b) => typeof b.scanId === 'string' && b.scanId.length > 10,
      [`${tenantLabel} billing state is reserved`]: (b) => b.billingState === 'RESERVED' || b?.billing?.billingState === 'RESERVED'
    });
  }
  sleep(Number(__ENV.SLEEP_SECONDS || 1));
}

export function tenantA() {
  assertEnv('BEVOAC_API_KEY_A');
  createWebScan(__ENV.BEVOAC_API_KEY_A, targetA, 'tenant_a');
}

export function tenantB() {
  assertEnv('BEVOAC_API_KEY_B');
  createWebScan(__ENV.BEVOAC_API_KEY_B, targetB, 'tenant_b');
}
