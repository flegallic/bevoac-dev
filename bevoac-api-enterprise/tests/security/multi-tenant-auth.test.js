const test = require('node:test');
const assert = require('node:assert/strict');
const { hashApiKey } = require('../../src/lib/security');
const { normalizeHttpsTargetUrl, isPrivateOrLocalHost } = require('../../src/lib/target-authorization');
const { ScanService } = require('../../src/services/scan-service');

class FakeClient {
  constructor() { this.calls = []; }
  async query(sql, params) { this.calls.push({ sql, params }); return { rowCount: 0, rows: [] }; }
  release() {}
}
class FakePool { constructor(client) { this.client = client; } async connect() { return this.client; } }

test('API key hashing normalizes Bearer prefix and whitespace', () => {
  assert.equal(hashApiKey('Bearer secret-123'), hashApiKey(' secret-123 '));
});

test('web target normalization rejects localhost and private IPs', () => {
  assert.throws(() => normalizeHttpsTargetUrl('https://localhost'), /cannot target/);
  assert.throws(() => normalizeHttpsTargetUrl('https://10.0.0.1'), /cannot target/);
  assert.equal(isPrivateOrLocalHost('example.com'), false);
});

test('scan lookup is always scoped by scanId and tenantId', async () => {
  const client = new FakeClient();
  const service = new ScanService(new FakePool(client), {}, {});
  const scanId = '11111111-1111-4111-8111-111111111111';
  const tenantId = '22222222-2222-4222-8222-222222222222';
  await service.getScanByIdAndTenant(scanId, tenantId, { includeResult: false });
  assert.equal(client.calls.length, 4);

  // 1. La transaction démarre avant de poser le contexte tenant local.
  assert.match(client.calls[0].sql, /^BEGIN$/);

  // 2. Le contexte RLS du tenant est transaction-local.
  assert.match(
    client.calls[1].sql,
    /set_config\('app\.current_tenant_id'/
  );
  assert.deepEqual(client.calls[1].params, [tenantId, true]);

  // 3. La requête métier reste obligatoirement filtrée
  // par scanId et tenantId.
  assert.match(
    client.calls[2].sql,
    /WHERE s\.id = \$1 AND s\.tenant_id = \$2/
  );
  assert.deepEqual(client.calls[2].params, [scanId, tenantId]);

  // 4. COMMIT efface automatiquement la valeur SET LOCAL.
  assert.match(client.calls[3].sql, /^COMMIT$/);
});
