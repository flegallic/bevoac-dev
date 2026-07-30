'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('IaC wires each workload to its dedicated PostgreSQL role and identity', () => {
  const apps = read('bevoac-iac-enterprise/container-apps.tf');
  const outbox = read('bevoac-iac-enterprise/outbox-publisher.tf');
  const retention = read('bevoac-iac-enterprise/retention-job.tf');
  const admin = read('bevoac-iac-enterprise/admin-api.tf');

  assert.match(apps, /APP_RUNTIME_MODE[\s\S]{0,80}public_api/);
  assert.match(apps, /PG_USER[\s\S]{0,80}bevoac_api/);
  assert.match(apps, /pg-api-password/);
  assert.match(apps, /PG_USER[\s\S]{0,80}bevoac_worker/);
  assert.match(apps, /pg-worker-password/);

  assert.match(outbox, /identity_ids\s*=\s*\[azurerm_user_assigned_identity\.outbox\.id\]/);
  assert.match(outbox, /PG_USER[\s\S]{0,80}bevoac_outbox/);
  assert.match(outbox, /pg-outbox-password/);

  assert.match(retention, /identity_ids\s*=\s*\[azurerm_user_assigned_identity\.retention\.id\]/);
  assert.match(retention, /PG_USER[\s\S]{0,80}bevoac_retention/);
  assert.match(retention, /pg-retention-password/);

  assert.match(admin, /APP_RUNTIME_MODE[\s\S]{0,80}admin_api/);
  assert.match(admin, /PG_USER[\s\S]{0,80}bevoac_admin_api/);

  for (const [name, source] of Object.entries({ apps, outbox, retention, admin })) {
    assert.doesNotMatch(source, /PG_USER[\s\S]{0,80}pg_admin_username/, name);
  }
});


test('worker scaling uses Service Bus Managed Identity and no SAS secret', () => {
  const apps = read('bevoac-iac-enterprise/container-apps.tf');
  const data = read('bevoac-iac-enterprise/data-platform.tf');
  const variables = read('bevoac-iac-enterprise/variables-v6-1-3.tf');

  assert.match(apps, /custom_rule_type\s*=\s*"azure-servicebus"/);
  assert.match(apps, /identity_id\s*=\s*azurerm_user_assigned_identity\.worker\.id/);
  assert.match(apps, /namespace\s*=\s*azurerm_servicebus_namespace\.sb\.name/);
  assert.match(apps, /queueName\s*=\s*azurerm_servicebus_queue\.scan_jobs\.name/);
  assert.doesNotMatch(apps, /servicebus-connection-string/);
  assert.doesNotMatch(apps, /trigger_parameter\s*=\s*"connection"/);

  assert.match(data, /local_auth_enabled\s*=\s*var\.service_bus_local_auth_enabled/);
  assert.match(data, /retain_legacy_servicebus_connection_secret/);
  assert.match(variables, /variable "service_bus_local_auth_enabled"/);
  assert.match(variables, /variable "retain_legacy_servicebus_connection_secret"/);
});

test('network and Service Bus hardening are explicit staged release profiles', () => {
  const migration = read('bevoac-iac-enterprise/release/v6.1.3-workload-migration.tfvars.example');
  const finalize = read('bevoac-iac-enterprise/release/v6.1.3-security-finalize.tfvars.example');
  const main = read('bevoac-iac-enterprise/main.tf');

  assert.match(migration, /service_bus_local_auth_enabled\s*=\s*true/);
  assert.match(migration, /retain_legacy_servicebus_connection_secret\s*=\s*true/);
  assert.match(finalize, /service_bus_local_auth_enabled\s*=\s*false/);
  assert.match(finalize, /retain_legacy_servicebus_connection_secret\s*=\s*false/);
  assert.match(finalize, /enable_private_endpoints\s*=\s*true/);
  assert.match(finalize, /enable_postgres_public_access\s*=\s*false/);
  assert.match(main, /default_action\s*=\s*var\.enable_private_endpoints \? "Deny" : "Allow"/);
});
