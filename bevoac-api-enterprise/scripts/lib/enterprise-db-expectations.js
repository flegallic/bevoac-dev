'use strict';

const RUNTIME_ROLES = Object.freeze([
  'bevoac_api',
  'bevoac_worker',
  'bevoac_outbox',
  'bevoac_retention',
  'bevoac_admin_api',
  'bevoac_operator'
]);

const EXPECTED_MIGRATIONS = Object.freeze([
  '202605150001_outbox_idempotency_billing',
  '202605150002_retention_indexes',
  '202605310001_scan_execution_storage',
  '202606010001_tenant_isolation_guardrails',
  '202607090001_enterprise_hardening_baseline',
  '202607160001_retention_audit_operational_indexes',
  '202607160002_secure_api_key_auth_boundary_optional',
  '202607170001_runtime_role_rls_boundary_optional',
  '202608030001_v620_request_integrity_worker_resilience'
]);

const EXPECTED_RLS_TABLES = Object.freeze([
  'admin_audit_log',
  'api_keys',
  'azure_onboarding_sessions',
  'billing_monthly_snapshots',
  'billing_usage_ledger',
  'outbox_events',
  'retention_audit_log',
  'scan_attempts',
  'scan_request_idempotency',
  'scan_results',
  'scans',
  'tenant_azure_integrations',
  'tenant_azure_scopes',
  'tenant_web_targets',
  'tenants'
]);

const EXPECTED_GRANTS = Object.freeze([
  'bevoac_admin_api|admin_audit_log|INSERT',
  'bevoac_admin_api|billing_monthly_snapshots|SELECT',
  'bevoac_admin_api|billing_monthly_snapshots|UPDATE',
  'bevoac_admin_api|billing_usage_ledger|SELECT',
  'bevoac_admin_api|tenants|SELECT',
  'bevoac_api|azure_onboarding_sessions|INSERT',
  'bevoac_api|azure_onboarding_sessions|SELECT',
  'bevoac_api|azure_onboarding_sessions|UPDATE',
  'bevoac_api|billing_monthly_snapshots|INSERT',
  'bevoac_api|billing_monthly_snapshots|SELECT',
  'bevoac_api|billing_monthly_snapshots|UPDATE',
  'bevoac_api|billing_usage_ledger|INSERT',
  'bevoac_api|billing_usage_ledger|SELECT',
  'bevoac_api|outbox_events|INSERT',
  'bevoac_api|outbox_events|SELECT',
  'bevoac_api|outbox_events|UPDATE',
  'bevoac_api|scan_request_idempotency|INSERT',
  'bevoac_api|scan_request_idempotency|SELECT',
  'bevoac_api|scan_results|SELECT',
  'bevoac_api|scans|INSERT',
  'bevoac_api|scans|SELECT',
  'bevoac_api|tenant_azure_integrations|INSERT',
  'bevoac_api|tenant_azure_integrations|SELECT',
  'bevoac_api|tenant_azure_integrations|UPDATE',
  'bevoac_api|tenant_azure_scopes|INSERT',
  'bevoac_api|tenant_azure_scopes|SELECT',
  'bevoac_api|tenant_azure_scopes|UPDATE',
  'bevoac_api|tenant_web_targets|SELECT',
  'bevoac_api|tenants|SELECT',
  'bevoac_operator|api_keys|INSERT',
  'bevoac_operator|tenant_azure_scopes|INSERT',
  'bevoac_operator|tenant_azure_scopes|SELECT',
  'bevoac_operator|tenant_azure_scopes|UPDATE',
  'bevoac_operator|tenant_web_targets|INSERT',
  'bevoac_operator|tenant_web_targets|SELECT',
  'bevoac_operator|tenant_web_targets|UPDATE',
  'bevoac_operator|tenants|INSERT',
  'bevoac_operator|tenants|SELECT',
  'bevoac_outbox|outbox_events|SELECT',
  'bevoac_outbox|outbox_events|UPDATE',
  'bevoac_retention|azure_onboarding_sessions|DELETE',
  'bevoac_retention|azure_onboarding_sessions|SELECT',
  'bevoac_retention|retention_audit_log|INSERT',
  'bevoac_retention|scan_request_idempotency|DELETE',
  'bevoac_retention|scan_request_idempotency|SELECT',
  'bevoac_retention|scans|DELETE',
  'bevoac_retention|scans|SELECT',
  'bevoac_retention|tenants|SELECT',
  'bevoac_worker|billing_usage_ledger|INSERT',
  'bevoac_worker|billing_usage_ledger|SELECT',
  'bevoac_worker|scan_attempts|INSERT',
  'bevoac_worker|scan_attempts|SELECT',
  'bevoac_worker|scan_attempts|UPDATE',
  'bevoac_worker|scan_results|INSERT',
  'bevoac_worker|scan_results|SELECT',
  'bevoac_worker|scan_results|UPDATE',
  'bevoac_worker|scans|SELECT',
  'bevoac_worker|scans|UPDATE'
]);

module.exports = {
  EXPECTED_GRANTS,
  EXPECTED_MIGRATIONS,
  EXPECTED_RLS_TABLES,
  RUNTIME_ROLES
};
