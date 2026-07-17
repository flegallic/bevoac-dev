-- Enterprise runtime role and RLS boundary.
--
-- Additive optional migration.
--
-- Security model:
-- - tenant isolation uses the real PostgreSQL login through session_user;
-- - app.current_tenant_id selects the tenant only after the login role has
--   been authenticated by PostgreSQL;
-- - mutable application service-context settings are not trusted;
-- - global workloads are authorized only by their dedicated login role;
-- - table grants remain the first privilege boundary;
-- - RLS is enabled and forced as defence in depth.
--
-- Apply only through scripts/apply-runtime-role-rls.js.


DO $guard$
DECLARE
  role_record record;
BEGIN
  IF current_user <> 'bevoacadmin' THEN
    RAISE EXCEPTION
      'Runtime RLS migration must be executed with bevoacadmin'
      USING ERRCODE = '42501';
  END IF;

  FOR role_record IN
    SELECT
      rolname,
      rolcanlogin,
      rolsuper,
      rolinherit,
      rolcreaterole,
      rolcreatedb,
      rolreplication,
      rolbypassrls
    FROM pg_roles
    WHERE rolname = ANY (
      ARRAY[
        'bevoac_api',
        'bevoac_worker',
        'bevoac_outbox',
        'bevoac_retention',
        'bevoac_admin_api',
        'bevoac_operator'
      ]
    )
  LOOP
    IF role_record.rolcanlogin IS NOT TRUE
       OR role_record.rolsuper IS NOT FALSE
       OR role_record.rolinherit IS NOT FALSE
       OR role_record.rolcreaterole IS NOT FALSE
       OR role_record.rolcreatedb IS NOT FALSE
       OR role_record.rolreplication IS NOT FALSE
       OR role_record.rolbypassrls IS NOT FALSE
    THEN
      RAISE EXCEPTION
        'Unsafe PostgreSQL attributes for runtime role %',
        role_record.rolname;
    END IF;
  END LOOP;

  IF (
    SELECT COUNT(*)
    FROM pg_roles
    WHERE rolname = ANY (
      ARRAY[
        'bevoac_api',
        'bevoac_worker',
        'bevoac_outbox',
        'bevoac_retention',
        'bevoac_admin_api',
        'bevoac_operator'
      ]
    )
  ) <> 6 THEN
    RAISE EXCEPTION
      'One or more required runtime roles are missing';
  END IF;
END;
$guard$;


CREATE OR REPLACE FUNCTION public.bevoac_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  raw_tenant_id text;
BEGIN
  raw_tenant_id :=
    current_setting(
      'app.current_tenant_id',
      true
    );

  IF raw_tenant_id IS NULL
     OR btrim(raw_tenant_id) = ''
  THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN raw_tenant_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;
END;
$function$;

ALTER FUNCTION public.bevoac_current_tenant_id()
  OWNER TO bevoacadmin;

REVOKE ALL
  ON FUNCTION public.bevoac_current_tenant_id()
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.bevoac_current_tenant_id()
  TO bevoac_api, bevoac_worker;


REVOKE ALL PRIVILEGES
  ON ALL TABLES IN SCHEMA public
  FROM bevoac_api, bevoac_worker, bevoac_outbox, bevoac_retention, bevoac_admin_api, bevoac_operator;

REVOKE ALL PRIVILEGES
  ON ALL SEQUENCES IN SCHEMA public
  FROM bevoac_api, bevoac_worker, bevoac_outbox, bevoac_retention, bevoac_admin_api, bevoac_operator;

GRANT SELECT
  ON TABLE public.tenants
  TO bevoac_api;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.azure_onboarding_sessions
  TO bevoac_api;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.tenant_azure_integrations
  TO bevoac_api;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.tenant_azure_scopes
  TO bevoac_api;

GRANT SELECT
  ON TABLE public.tenant_web_targets
  TO bevoac_api;

GRANT SELECT, INSERT
  ON TABLE public.scans
  TO bevoac_api;

GRANT SELECT
  ON TABLE public.scan_results
  TO bevoac_api;

GRANT SELECT, INSERT
  ON TABLE public.scan_request_idempotency
  TO bevoac_api;

GRANT SELECT, INSERT
  ON TABLE public.billing_usage_ledger
  TO bevoac_api;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.billing_monthly_snapshots
  TO bevoac_api;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.outbox_events
  TO bevoac_api;

GRANT SELECT, UPDATE
  ON TABLE public.scans
  TO bevoac_worker;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.scan_results
  TO bevoac_worker;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.scan_attempts
  TO bevoac_worker;

GRANT SELECT, INSERT
  ON TABLE public.billing_usage_ledger
  TO bevoac_worker;

GRANT SELECT, UPDATE
  ON TABLE public.outbox_events
  TO bevoac_outbox;

GRANT SELECT
  ON TABLE public.tenants
  TO bevoac_retention;

GRANT SELECT, DELETE
  ON TABLE public.scans
  TO bevoac_retention;

GRANT SELECT, DELETE
  ON TABLE public.scan_request_idempotency
  TO bevoac_retention;

GRANT SELECT, DELETE
  ON TABLE public.azure_onboarding_sessions
  TO bevoac_retention;

GRANT INSERT
  ON TABLE public.retention_audit_log
  TO bevoac_retention;

GRANT SELECT
  ON TABLE public.tenants
  TO bevoac_admin_api;

GRANT SELECT, UPDATE
  ON TABLE public.billing_monthly_snapshots
  TO bevoac_admin_api;

GRANT SELECT
  ON TABLE public.billing_usage_ledger
  TO bevoac_admin_api;

GRANT INSERT
  ON TABLE public.admin_audit_log
  TO bevoac_admin_api;

GRANT SELECT, INSERT
  ON TABLE public.tenants
  TO bevoac_operator;

GRANT INSERT
  ON TABLE public.api_keys
  TO bevoac_operator;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.tenant_azure_scopes
  TO bevoac_operator;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.tenant_web_targets
  TO bevoac_operator;

ALTER TABLE public.tenants
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenants
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.api_keys
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.api_keys
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.azure_onboarding_sessions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.azure_onboarding_sessions
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_azure_integrations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_azure_integrations
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_azure_scopes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_azure_scopes
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_web_targets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_web_targets
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.scans
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scans
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.scan_results
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scan_results
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.scan_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scan_attempts
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.scan_request_idempotency
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scan_request_idempotency
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.billing_usage_ledger
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_usage_ledger
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.billing_monthly_snapshots
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_monthly_snapshots
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.outbox_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.outbox_events
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.retention_audit_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.retention_audit_log
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_audit_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_audit_log
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tenants_bevoac_api
  ON public.tenants;

CREATE POLICY rls_tenants_bevoac_api
  ON public.tenants
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_tenants_bevoac_admin_api
  ON public.tenants;

CREATE POLICY rls_tenants_bevoac_admin_api
  ON public.tenants
  AS PERMISSIVE
  FOR ALL
  TO bevoac_admin_api
  USING (session_user = 'bevoac_admin_api')
  WITH CHECK (session_user = 'bevoac_admin_api');

DROP POLICY IF EXISTS rls_tenants_bevoac_retention
  ON public.tenants;

CREATE POLICY rls_tenants_bevoac_retention
  ON public.tenants
  AS PERMISSIVE
  FOR ALL
  TO bevoac_retention
  USING (session_user = 'bevoac_retention')
  WITH CHECK (session_user = 'bevoac_retention');

DROP POLICY IF EXISTS rls_tenants_bevoac_operator
  ON public.tenants;

CREATE POLICY rls_tenants_bevoac_operator
  ON public.tenants
  AS PERMISSIVE
  FOR ALL
  TO bevoac_operator
  USING (session_user = 'bevoac_operator')
  WITH CHECK (session_user = 'bevoac_operator');

DROP POLICY IF EXISTS rls_api_keys_bevoac_operator
  ON public.api_keys;

CREATE POLICY rls_api_keys_bevoac_operator
  ON public.api_keys
  AS PERMISSIVE
  FOR ALL
  TO bevoac_operator
  USING (session_user = 'bevoac_operator')
  WITH CHECK (session_user = 'bevoac_operator');

DROP POLICY IF EXISTS rls_azure_onboarding_sessions_bevoac_api
  ON public.azure_onboarding_sessions;

CREATE POLICY rls_azure_onboarding_sessions_bevoac_api
  ON public.azure_onboarding_sessions
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_azure_onboarding_sessions_bevoac_retention
  ON public.azure_onboarding_sessions;

CREATE POLICY rls_azure_onboarding_sessions_bevoac_retention
  ON public.azure_onboarding_sessions
  AS PERMISSIVE
  FOR ALL
  TO bevoac_retention
  USING (session_user = 'bevoac_retention')
  WITH CHECK (session_user = 'bevoac_retention');

DROP POLICY IF EXISTS rls_tenant_azure_integrations_bevoac_api
  ON public.tenant_azure_integrations;

CREATE POLICY rls_tenant_azure_integrations_bevoac_api
  ON public.tenant_azure_integrations
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_tenant_azure_scopes_bevoac_api
  ON public.tenant_azure_scopes;

CREATE POLICY rls_tenant_azure_scopes_bevoac_api
  ON public.tenant_azure_scopes
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_tenant_azure_scopes_bevoac_operator
  ON public.tenant_azure_scopes;

CREATE POLICY rls_tenant_azure_scopes_bevoac_operator
  ON public.tenant_azure_scopes
  AS PERMISSIVE
  FOR ALL
  TO bevoac_operator
  USING (session_user = 'bevoac_operator')
  WITH CHECK (session_user = 'bevoac_operator');

DROP POLICY IF EXISTS rls_tenant_web_targets_bevoac_api
  ON public.tenant_web_targets;

CREATE POLICY rls_tenant_web_targets_bevoac_api
  ON public.tenant_web_targets
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_tenant_web_targets_bevoac_operator
  ON public.tenant_web_targets;

CREATE POLICY rls_tenant_web_targets_bevoac_operator
  ON public.tenant_web_targets
  AS PERMISSIVE
  FOR ALL
  TO bevoac_operator
  USING (session_user = 'bevoac_operator')
  WITH CHECK (session_user = 'bevoac_operator');

DROP POLICY IF EXISTS rls_scans_bevoac_api
  ON public.scans;

CREATE POLICY rls_scans_bevoac_api
  ON public.scans
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scans_bevoac_worker
  ON public.scans;

CREATE POLICY rls_scans_bevoac_worker
  ON public.scans
  AS PERMISSIVE
  FOR ALL
  TO bevoac_worker
  USING (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scans_bevoac_retention
  ON public.scans;

CREATE POLICY rls_scans_bevoac_retention
  ON public.scans
  AS PERMISSIVE
  FOR ALL
  TO bevoac_retention
  USING (session_user = 'bevoac_retention')
  WITH CHECK (session_user = 'bevoac_retention');

DROP POLICY IF EXISTS rls_scan_results_bevoac_api
  ON public.scan_results;

CREATE POLICY rls_scan_results_bevoac_api
  ON public.scan_results
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scan_results_bevoac_worker
  ON public.scan_results;

CREATE POLICY rls_scan_results_bevoac_worker
  ON public.scan_results
  AS PERMISSIVE
  FOR ALL
  TO bevoac_worker
  USING (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scan_attempts_bevoac_worker
  ON public.scan_attempts;

CREATE POLICY rls_scan_attempts_bevoac_worker
  ON public.scan_attempts
  AS PERMISSIVE
  FOR ALL
  TO bevoac_worker
  USING (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scan_request_idempotency_bevoac_api
  ON public.scan_request_idempotency;

CREATE POLICY rls_scan_request_idempotency_bevoac_api
  ON public.scan_request_idempotency
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_scan_request_idempotency_bevoac_retention
  ON public.scan_request_idempotency;

CREATE POLICY rls_scan_request_idempotency_bevoac_retention
  ON public.scan_request_idempotency
  AS PERMISSIVE
  FOR ALL
  TO bevoac_retention
  USING (session_user = 'bevoac_retention')
  WITH CHECK (session_user = 'bevoac_retention');

DROP POLICY IF EXISTS rls_billing_usage_ledger_bevoac_api
  ON public.billing_usage_ledger;

CREATE POLICY rls_billing_usage_ledger_bevoac_api
  ON public.billing_usage_ledger
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_billing_usage_ledger_bevoac_worker
  ON public.billing_usage_ledger;

CREATE POLICY rls_billing_usage_ledger_bevoac_worker
  ON public.billing_usage_ledger
  AS PERMISSIVE
  FOR ALL
  TO bevoac_worker
  USING (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_worker' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_billing_usage_ledger_bevoac_admin_api
  ON public.billing_usage_ledger;

CREATE POLICY rls_billing_usage_ledger_bevoac_admin_api
  ON public.billing_usage_ledger
  AS PERMISSIVE
  FOR ALL
  TO bevoac_admin_api
  USING (session_user = 'bevoac_admin_api')
  WITH CHECK (session_user = 'bevoac_admin_api');

DROP POLICY IF EXISTS rls_billing_monthly_snapshots_bevoac_api
  ON public.billing_monthly_snapshots;

CREATE POLICY rls_billing_monthly_snapshots_bevoac_api
  ON public.billing_monthly_snapshots
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_billing_monthly_snapshots_bevoac_admin_api
  ON public.billing_monthly_snapshots;

CREATE POLICY rls_billing_monthly_snapshots_bevoac_admin_api
  ON public.billing_monthly_snapshots
  AS PERMISSIVE
  FOR ALL
  TO bevoac_admin_api
  USING (session_user = 'bevoac_admin_api')
  WITH CHECK (session_user = 'bevoac_admin_api');

DROP POLICY IF EXISTS rls_outbox_events_bevoac_api
  ON public.outbox_events;

CREATE POLICY rls_outbox_events_bevoac_api
  ON public.outbox_events
  AS PERMISSIVE
  FOR ALL
  TO bevoac_api
  USING (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id())
  WITH CHECK (session_user = 'bevoac_api' AND tenant_id = public.bevoac_current_tenant_id());

DROP POLICY IF EXISTS rls_outbox_events_bevoac_outbox
  ON public.outbox_events;

CREATE POLICY rls_outbox_events_bevoac_outbox
  ON public.outbox_events
  AS PERMISSIVE
  FOR ALL
  TO bevoac_outbox
  USING (session_user = 'bevoac_outbox')
  WITH CHECK (session_user = 'bevoac_outbox');

DROP POLICY IF EXISTS rls_retention_audit_log_bevoac_retention
  ON public.retention_audit_log;

CREATE POLICY rls_retention_audit_log_bevoac_retention
  ON public.retention_audit_log
  AS PERMISSIVE
  FOR ALL
  TO bevoac_retention
  USING (session_user = 'bevoac_retention')
  WITH CHECK (session_user = 'bevoac_retention');

DROP POLICY IF EXISTS rls_admin_audit_log_bevoac_admin_api
  ON public.admin_audit_log;

CREATE POLICY rls_admin_audit_log_bevoac_admin_api
  ON public.admin_audit_log
  AS PERMISSIVE
  FOR ALL
  TO bevoac_admin_api
  USING (session_user = 'bevoac_admin_api')
  WITH CHECK (session_user = 'bevoac_admin_api');


REVOKE ALL
  ON FUNCTION public.bevoac_assert_billing_scan_tenant()
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.bevoac_assert_billing_scan_tenant()
  TO bevoac_api, bevoac_worker;

REVOKE ALL
  ON FUNCTION public.bevoac_assert_outbox_scan_tenant()
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.bevoac_assert_outbox_scan_tenant()
  TO bevoac_api;

REVOKE ALL
  ON FUNCTION public.bevoac_authenticate_api_key(
    character varying
  )
  FROM
    PUBLIC,
    bevoac_worker,
    bevoac_outbox,
    bevoac_retention,
    bevoac_admin_api,
    bevoac_operator;

GRANT EXECUTE
  ON FUNCTION public.bevoac_authenticate_api_key(
    character varying
  )
  TO bevoac_api;
