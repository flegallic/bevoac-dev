\set ON_ERROR_STOP on

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.tenants (
  id,
  company_name,
  external_customer_ref,
  plan_code,
  is_active
)
VALUES
(
  '11111111-1111-4111-8111-111111111111',
  'RLS Fixture Tenant A',
  'RLS-TENANT-A',
  'business',
  true
),
(
  '22222222-2222-4222-8222-222222222222',
  'RLS Fixture Tenant B',
  'RLS-TENANT-B',
  'standard',
  true
);

INSERT INTO public.api_keys (
  id,
  tenant_id,
  key_hash,
  label,
  is_active,
  scopes
)
VALUES
(
  'a1111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'RLS fixture key A',
  true,
  '[
    "scan:create",
    "scan:read",
    "scan:result:read",
    "billing:read",
    "onboarding:read",
    "onboarding:write"
  ]'::jsonb
),
(
  'a2222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  repeat('b', 64),
  'RLS fixture key B',
  true,
  '[
    "scan:create",
    "scan:read",
    "scan:result:read",
    "billing:read",
    "onboarding:read",
    "onboarding:write"
  ]'::jsonb
);

INSERT INTO public.tenant_azure_integrations (
  id,
  tenant_id,
  microsoft_tenant_id,
  consent_status,
  consented_at,
  last_verified_at,
  subscription_count,
  metadata
)
VALUES
(
  '61111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  'ACTIVE',
  now(),
  now(),
  1,
  '{"fixture":"rls","tenant":"A"}'::jsonb
),
(
  '62222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'd2222222-2222-4222-8222-222222222222',
  'ACTIVE',
  now(),
  now(),
  1,
  '{"fixture":"rls","tenant":"B"}'::jsonb
);

INSERT INTO public.tenant_azure_scopes (
  id,
  tenant_id,
  microsoft_tenant_id,
  subscription_id,
  display_name,
  is_active,
  source,
  status,
  verified_at,
  metadata
)
VALUES
(
  '71111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111111',
  'RLS fixture scope A',
  true,
  'manual_admin_verified',
  'VERIFIED',
  now(),
  '{"fixture":"rls","tenant":"A"}'::jsonb
),
(
  '72222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'd2222222-2222-4222-8222-222222222222',
  'e2222222-2222-4222-8222-222222222222',
  'RLS fixture scope B',
  true,
  'manual_admin_verified',
  'VERIFIED',
  now(),
  '{"fixture":"rls","tenant":"B"}'::jsonb
);

INSERT INTO public.tenant_web_targets (
  id,
  tenant_id,
  host,
  is_active
)
VALUES
(
  '81111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'tenant-a.rls.local.invalid',
  true
),
(
  '82222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'tenant-b.rls.local.invalid',
  true
);

INSERT INTO public.scans (
  id,
  tenant_id,
  cloud_provider,
  scan_profile,
  modules,
  target_url,
  subscriptions,
  billing_units,
  is_quota_included,
  quota_month,
  resource_count,
  resource_limit,
  status,
  completed_at,
  billing_state,
  billing_state_updated_at
)
VALUES
(
  '31111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'azure',
  'web',
  '["webSecurity"]'::jsonb,
  'https://tenant-a.rls.local.invalid',
  '[]'::jsonb,
  1,
  true,
  DATE '2026-07-01',
  10,
  100,
  'DONE',
  now(),
  'CONSUMED',
  now()
),
(
  '32222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'azure',
  'web',
  '["webSecurity"]'::jsonb,
  'https://tenant-b.rls.local.invalid',
  '[]'::jsonb,
  1,
  true,
  DATE '2026-07-01',
  20,
  100,
  'DONE',
  now(),
  'CONSUMED',
  now()
);

INSERT INTO public.scan_results (
  scan_id,
  tenant_id,
  result_json,
  compression,
  result_size_bytes,
  result_sha256,
  result_summary
)
VALUES
(
  '31111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"fixture":"rls","tenant":"A","findings":[]}'::jsonb,
  'none',
  44,
  repeat('1', 64),
  '{"fixture":"rls","tenant":"A","findingCount":0}'::jsonb
),
(
  '32222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  '{"fixture":"rls","tenant":"B","findings":[]}'::jsonb,
  'none',
  44,
  repeat('2', 64),
  '{"fixture":"rls","tenant":"B","findingCount":0}'::jsonb
);

INSERT INTO public.scan_attempts (
  attempt_id,
  scan_id,
  tenant_id,
  worker_name,
  servicebus_message_id,
  servicebus_delivery_count,
  status,
  metadata,
  completed_at
)
VALUES
(
  '51111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'rls-fixture-worker-a',
  'rls-fixture-message-a',
  1,
  'COMPLETED',
  '{"fixture":"rls","tenant":"A"}'::jsonb,
  now()
),
(
  '52222222-2222-4222-8222-222222222222',
  '32222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'rls-fixture-worker-b',
  'rls-fixture-message-b',
  1,
  'COMPLETED',
  '{"fixture":"rls","tenant":"B"}'::jsonb,
  now()
);

INSERT INTO public.scan_request_idempotency (
  tenant_id,
  idempotency_key,
  scan_id,
  idempotency_key_source
)
VALUES
(
  '11111111-1111-4111-8111-111111111111',
  'rls-fixture-idempotency-a',
  '31111111-1111-4111-8111-111111111111',
  'client_supplied'
),
(
  '22222222-2222-4222-8222-222222222222',
  'rls-fixture-idempotency-b',
  '32222222-2222-4222-8222-222222222222',
  'client_supplied'
);

INSERT INTO public.billing_monthly_snapshots (
  id,
  tenant_id,
  quota_month,
  plan_code_snapshot,
  quota_limit,
  resource_limit,
  included_units_used,
  payg_units_used,
  snapshot_status,
  metadata
)
VALUES
(
  '91111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  DATE '2026-07-01',
  'business',
  100,
  100,
  1,
  0,
  'OPEN',
  '{"fixture":"rls","tenant":"A"}'::jsonb
),
(
  '92222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  DATE '2026-07-01',
  'standard',
  50,
  100,
  1,
  0,
  'OPEN',
  '{"fixture":"rls","tenant":"B"}'::jsonb
);

INSERT INTO public.billing_usage_ledger (
  id,
  tenant_id,
  scan_id,
  event_type,
  plan_code_snapshot,
  quota_month,
  billing_units,
  unit_price_eur_ht,
  amount_eur_ht,
  currency_code,
  cloud_provider,
  scan_profile,
  modules,
  metadata
)
VALUES
(
  'b1111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  'scan_consumed',
  'business',
  DATE '2026-07-01',
  1,
  0,
  0,
  'EUR',
  'azure',
  'web',
  '["webSecurity"]'::jsonb,
  '{"fixture":"rls","tenant":"A"}'::jsonb
),
(
  'b2222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  '32222222-2222-4222-8222-222222222222',
  'scan_consumed',
  'standard',
  DATE '2026-07-01',
  1,
  0,
  0,
  'EUR',
  'azure',
  'web',
  '["webSecurity"]'::jsonb,
  '{"fixture":"rls","tenant":"B"}'::jsonb
);

INSERT INTO public.outbox_events (
  id,
  aggregate_type,
  aggregate_id,
  tenant_id,
  event_type,
  payload,
  status,
  attempts
)
VALUES
(
  'c1111111-1111-4111-8111-111111111111',
  'scan',
  '31111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'scan.fixture.created',
  '{"fixture":"rls","tenant":"A"}'::jsonb,
  'PENDING',
  0
),
(
  'c2222222-2222-4222-8222-222222222222',
  'scan',
  '32222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'scan.fixture.created',
  '{"fixture":"rls","tenant":"B"}'::jsonb,
  'PENDING',
  0
);

INSERT INTO public.azure_onboarding_sessions (
  id,
  tenant_id,
  api_key_id,
  state_hash,
  nonce_hash,
  redirect_uri,
  microsoft_tenant_id,
  admin_consent,
  status,
  subscription_count,
  expires_at
)
VALUES
(
  '41111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  repeat('1', 64),
  repeat('3', 64),
  'https://tenant-a.rls.local.invalid/callback',
  'd1111111-1111-4111-8111-111111111111',
  true,
  'STARTED',
  1,
  now() + INTERVAL '1 day'
),
(
  '42222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'a2222222-2222-4222-8222-222222222222',
  repeat('2', 64),
  repeat('4', 64),
  'https://tenant-b.rls.local.invalid/callback',
  'd2222222-2222-4222-8222-222222222222',
  true,
  'STARTED',
  1,
  now() + INTERVAL '1 day'
);

INSERT INTO public.admin_audit_log (
  id,
  actor,
  action,
  metadata
)
VALUES (
  'aa111111-1111-4111-8111-111111111111',
  'rls-fixture',
  'fixture_created',
  '{"fixture":"rls"}'::jsonb
);

INSERT INTO public.retention_audit_log (
  id,
  action,
  affected_rows,
  metadata
)
VALUES (
  'aa222222-2222-4222-8222-222222222222',
  'fixture_created',
  0,
  '{"fixture":"rls"}'::jsonb
);

COMMIT;
