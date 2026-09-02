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

  assert.match(outbox, /identity_ids\s*=\s*concat\([\s\S]{0,160}\[azurerm_user_assigned_identity\.outbox\.id\]/);
  assert.match(outbox, /retain_legacy_containerapp_rollback_compatibility\s*\?\s*\[azurerm_user_assigned_identity\.api\.id\]\s*:\s*\[\]/);
  assert.match(outbox, /registry\s*\{[\s\S]{0,160}identity\s*=\s*azurerm_user_assigned_identity\.outbox\.id/);
  assert.match(outbox, /PG_USER[\s\S]{0,80}bevoac_outbox/);
  assert.match(outbox, /pg-outbox-password/);

  assert.match(retention, /identity_ids\s*=\s*concat\([\s\S]{0,160}\[azurerm_user_assigned_identity\.retention\.id\]/);
  assert.match(retention, /retain_legacy_containerapp_rollback_compatibility\s*\?\s*\[azurerm_user_assigned_identity\.api\.id\]\s*:\s*\[\]/);
  assert.match(retention, /registry\s*\{[\s\S]{0,160}identity\s*=\s*azurerm_user_assigned_identity\.retention\.id/);
  assert.match(retention, /PG_USER[\s\S]{0,80}bevoac_retention/);
  assert.match(retention, /pg-retention-password/);

  assert.match(admin, /APP_RUNTIME_MODE[\s\S]{0,80}admin_api/);
  assert.match(admin, /PG_USER[\s\S]{0,80}bevoac_admin_api/);

  for (const [name, source] of Object.entries({ apps, outbox, retention, admin })) {
    assert.doesNotMatch(source, /PG_USER[\s\S]{0,80}pg_admin_username/, name);
  }
});

test('worker scaling uses Service Bus Managed Identity and no SAS runtime binding', () => {
  const apps = read('bevoac-iac-enterprise/container-apps.tf');
  const data = read('bevoac-iac-enterprise/data-platform.tf');
  const variables = read('bevoac-iac-enterprise/variables-v6-1-3.tf');

  assert.match(apps, /custom_rule_type\s*=\s*"azure-servicebus"/);
  assert.match(apps, /identity_id\s*=\s*azurerm_user_assigned_identity\.worker\.id/);
  assert.match(apps, /namespace\s*=\s*azurerm_servicebus_namespace\.sb\.name/);
  assert.match(apps, /queueName\s*=\s*azurerm_servicebus_queue\.scan_jobs\.name/);
  assert.doesNotMatch(apps, /name\s*=\s*"SERVICEBUS_CONNECTION_STRING"/);
  assert.doesNotMatch(apps, /trigger_parameter\s*=\s*"connection"/);
  assert.match(
    apps,
    /retain_legacy_containerapp_rollback_compatibility\s*&&\s*var\.retain_legacy_servicebus_connection_secret[\s\S]{0,220}name\s*=\s*"servicebus-connection-string"/,
  );

  assert.match(data, /local_auth_enabled\s*=\s*var\.service_bus_local_auth_enabled/);
  assert.match(data, /retain_legacy_servicebus_connection_secret/);
  assert.match(variables, /variable "service_bus_local_auth_enabled"/);
  assert.match(variables, /variable "retain_legacy_servicebus_connection_secret"/);
  assert.match(variables, /variable "retain_legacy_containerapp_rollback_compatibility"/);
});

test('network and Service Bus hardening are explicit staged release profiles', () => {
  const migration = read('bevoac-iac-enterprise/release/v6.1.3-workload-migration.tfvars.example');
  const finalize = read('bevoac-iac-enterprise/release/v6.1.3-security-finalize.tfvars.example');
  const main = read('bevoac-iac-enterprise/main.tf');

  assert.match(migration, /service_bus_local_auth_enabled\s*=\s*true/);
  assert.match(migration, /retain_legacy_servicebus_connection_secret\s*=\s*true/);
  assert.match(migration, /retain_legacy_containerapp_rollback_compatibility\s*=\s*true/);

  assert.match(finalize, /service_bus_local_auth_enabled\s*=\s*false/);
  assert.match(finalize, /retain_legacy_servicebus_connection_secret\s*=\s*false/);
  assert.match(finalize, /retain_legacy_containerapp_rollback_compatibility\s*=\s*false/);
  assert.match(finalize, /enable_private_endpoints\s*=\s*true/);
  assert.match(finalize, /enable_postgres_public_access\s*=\s*false/);
  assert.match(finalize, /key_vault_public_network_access_enabled\s*=\s*false/);
  assert.match(finalize, /key_vault_network_bypass\s*=\s*"None"/);
  assert.match(finalize, /key_vault_network_default_action\s*=\s*"Deny"/);
  assert.match(finalize, /key_vault_ip_rules\s*=\s*\[\]/);
  assert.match(finalize, /key_vault_virtual_network_subnet_ids\s*=\s*\[\]/);

  assert.match(main, /public_network_access_enabled\s*=\s*var\.key_vault_public_network_access_enabled/);
  assert.match(main, /bypass\s*=\s*var\.key_vault_network_bypass/);
  assert.match(main, /default_action\s*=\s*var\.key_vault_network_default_action/);
  assert.match(main, /ip_rules\s*=\s*local\.key_vault_ip_rules_effective/);
  assert.match(main, /virtual_network_subnet_ids\s*=\s*var\.key_vault_virtual_network_subnet_ids/);
});

test('API revision suffix is emitted only for a distinct candidate', () => {
  const apps = read('bevoac-iac-enterprise/container-apps.tf');

  assert.match(
    apps,
    /api_candidate_revision_requested\s*=\s*\([\s\S]{0,180}var\.api_revision_suffix\s*!=\s*""[\s\S]{0,180}var\.api_revision_suffix\s*!=\s*var\.api_stable_revision_suffix[\s\S]{0,80}\)/,
  );
  assert.match(
    apps,
    /for_each\s*=\s*var\.api_stable_revision_suffix\s*!=\s*""\s*&&\s*local\.api_candidate_revision_requested\s*\?\s*\[1\]\s*:\s*\[\]/,
  );
  assert.match(
    apps,
    /revision_suffix\s*=\s*local\.api_candidate_revision_requested\s*\?\s*var\.api_revision_suffix\s*:\s*null/,
  );
});

test('monitoring alert cardinality is known before Action Group creation', () => {
  const monitoring = read('bevoac-iac-enterprise/monitoring-v620.tf');
  const metrics = read('bevoac-iac-enterprise/monitor-alerts.tf');
  const outputs = read('bevoac-iac-enterprise/outputs.tf');

  assert.match(
    monitoring,
    /monitoring_notification_channel_configured\s*=\s*\([\s\S]{0,220}trimspace\(var\.monitor_action_group_id\)\s*!=\s*""[\s\S]{0,220}trimspace\(var\.monitor_notification_email\)\s*!=\s*""[\s\S]{0,80}\)/,
  );

  assert.equal(
    [...monitoring.matchAll(/var\.enable_baseline_activity_alerts\s*&&\s*local\.monitoring_notification_channel_configured\s*\?\s*1\s*:\s*0/g)].length,
    3,
  );
  assert.equal(
    [...metrics.matchAll(/local\.monitoring_notification_channel_configured\s*\?\s*1\s*:\s*0/g)].length,
    5,
  );
  assert.equal(
    [...monitoring.matchAll(/action_group_id\s*=\s*local\.monitor_action_group_id_effective/g)].length,
    3,
  );
  assert.equal(
    [...metrics.matchAll(/action_group_id\s*=\s*local\.monitor_action_group_id_effective/g)].length,
    5,
  );

  assert.doesNotMatch(
    monitoring,
    /count\s*=.*local\.monitor_action_group_id_effective\s*!=\s*""/,
  );
  assert.doesNotMatch(
    metrics,
    /count\s*=.*local\.monitor_action_group_id_effective\s*!=\s*""/,
  );
  assert.match(
    outputs,
    /output\s+"monitor_action_group_id"\s*\{[\s\S]{0,220}value\s*=\s*local\.monitor_action_group_id_effective/,
  );
});
