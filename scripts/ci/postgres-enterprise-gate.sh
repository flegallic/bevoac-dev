#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_PASSWORD:=postgres}"
: "${CI_DATABASE:=bevoac_ci}"

export PGPASSWORD="$POSTGRES_PASSWORD"

psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d postgres <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bevoac_ci' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS bevoac_ci;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bevoacadmin') THEN
    CREATE ROLE bevoacadmin LOGIN PASSWORD 'ci_bevoacadmin_password' NOSUPERUSER CREATEROLE CREATEDB INHERIT NOREPLICATION BYPASSRLS;
  ELSE
    ALTER ROLE bevoacadmin WITH LOGIN PASSWORD 'ci_bevoacadmin_password' NOSUPERUSER CREATEROLE CREATEDB INHERIT NOREPLICATION BYPASSRLS;
  END IF;
END $$;
CREATE DATABASE bevoac_ci OWNER bevoacadmin;
REVOKE ALL ON DATABASE bevoac_ci FROM PUBLIC;
GRANT CONNECT ON DATABASE bevoac_ci TO bevoacadmin;
SQL

export PG_HOST="$PGHOST" PG_PORT="$PGPORT" PG_DATABASE="$CI_DATABASE" PG_USER="bevoacadmin" PG_PASSWORD="ci_bevoacadmin_password" PG_SSL_MODE="disable" NODE_ENV="production"
export PG_API_PASSWORD="ci_api_password"
export PG_WORKER_PASSWORD="ci_worker_password"
export PG_OUTBOX_PASSWORD="ci_outbox_password"
export PG_RETENTION_PASSWORD="ci_retention_password"
export PG_ADMIN_API_PASSWORD="ci_admin_api_password"
export PG_OPERATOR_PASSWORD="ci_operator_password"

(
  cd bevoac-api-enterprise
  ALLOW_RUNTIME_ROLE_SYNC=true node scripts/sync-runtime-db-roles.js
)

export PGPASSWORD="$PG_PASSWORD"
psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" <<'SQL'
GRANT CONNECT ON DATABASE bevoac_ci TO bevoac_api, bevoac_worker, bevoac_outbox, bevoac_retention, bevoac_admin_api, bevoac_operator;
SQL

(
  cd bevoac-api-enterprise
  node scripts/init-db.js
  node scripts/migrate-db.js
  ALLOW_SECURE_API_KEY_AUTH_APPLY=true node scripts/apply-secure-api-key-auth.js
  ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY=true node scripts/apply-runtime-role-rls.js
)

export PGPASSWORD="$PG_PASSWORD"
psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -f tests/integration/rls-fixtures.sql

CI_API_KEY="ci-tenant-a-api-key"
CI_API_HASH="$(node -e "const {hashApiKey}=require('./bevoac-api-enterprise/src/lib/security'); process.stdout.write(hashApiKey(process.argv[1]));" "$CI_API_KEY")"
psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -v hash="$CI_API_HASH" <<'SQL'
UPDATE public.api_keys
SET key_hash = :'hash'
WHERE id = 'a1111111-1111-4111-8111-111111111111'::uuid;

INSERT INTO public.scans (
  id, tenant_id, cloud_provider, scan_profile, modules, subscriptions,
  billing_units, is_quota_included, quota_month, status, billing_state
) VALUES (
  '35555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'azure', 'web', '[]'::jsonb, '[]'::jsonb,
  1, true, date_trunc('month', now())::date, 'PENDING', 'RESERVED'
);

INSERT INTO public.billing_usage_ledger (
  id, tenant_id, scan_id, event_type, plan_code_snapshot, quota_month,
  billing_units, unit_price_eur_ht, amount_eur_ht, currency_code,
  cloud_provider, scan_profile, modules, metadata
) VALUES (
  'b5555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '35555555-5555-4555-8555-555555555555',
  'scan_reserved', 'business', date_trunc('month', now())::date,
  1, 0, 0, 'EUR', 'azure', 'web', '[]'::jsonb, '{"source":"ci"}'::jsonb
);
SQL

psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" <<'SQL'
DO $$
DECLARE
  migration_count integer;
  enabled_count integer;
  forced_count integer;
  policy_count integer;
  hardened_roles integer;
  safe_membership_count integer;
  unsafe_membership_count integer;
  grant_count integer;
BEGIN
  SELECT count(*) INTO migration_count FROM public.schema_migrations;
  SELECT count(*) INTO enabled_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
  SELECT count(*) INTO forced_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity;
  SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname='public';
  SELECT count(*) INTO hardened_roles FROM pg_roles WHERE rolname IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator') AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls;
  SELECT
    count(*) FILTER (
      WHERE granted.rolname IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator')
        AND member.rolname = 'bevoacadmin'
        AND grantor.rolsuper
        AND m.admin_option
        AND NOT m.inherit_option
        AND NOT m.set_option
    ),
    count(*) FILTER (
      WHERE NOT (
        granted.rolname IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator')
        AND member.rolname = 'bevoacadmin'
        AND grantor.rolsuper
        AND m.admin_option
        AND NOT m.inherit_option
        AND NOT m.set_option
      )
    )
  INTO safe_membership_count, unsafe_membership_count
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid=m.roleid
  JOIN pg_roles member ON member.oid=m.member
  JOIN pg_roles grantor ON grantor.oid=m.grantor
  WHERE granted.rolname IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator')
     OR member.rolname IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator');
  SELECT count(*) INTO grant_count FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('bevoac_api','bevoac_worker','bevoac_outbox','bevoac_retention','bevoac_admin_api','bevoac_operator');
  IF migration_count <> 8 OR enabled_count <> 15 OR forced_count <> 15 OR policy_count <> 29 OR hardened_roles <> 6 OR safe_membership_count <> 6 OR unsafe_membership_count <> 0 OR grant_count <> 58 THEN
    RAISE EXCEPTION 'Enterprise DB gate failed: migrations %, enabled %, forced %, policies %, roles %, safe memberships %, unsafe memberships %, grants %', migration_count, enabled_count, forced_count, policy_count, hardened_roles, safe_membership_count, unsafe_membership_count, grant_count;
  END IF;
END $$;
SQL

# Verify the exact database boundary before the application integration tests
# intentionally create additional disposable rows.
CI_PG_HOST="$PGHOST" \
CI_PG_PORT="$PGPORT" \
CI_PG_DATABASE="$CI_DATABASE" \
CI_PG_ADMIN_PASSWORD=ci_bevoacadmin_password \
CI_PG_API_PASSWORD=ci_api_password \
CI_PG_WORKER_PASSWORD=ci_worker_password \
CI_PG_OUTBOX_PASSWORD=ci_outbox_password \
CI_PG_RETENTION_PASSWORD=ci_retention_password \
CI_PG_ADMIN_API_PASSWORD=ci_admin_api_password \
CI_PG_OPERATOR_PASSWORD=ci_operator_password \
  node bevoac-api-enterprise/scripts/ci/verify-enterprise-db.js

BEVOAC_INTEGRATION_DB=1 BEVOAC_CI_API_KEY="$CI_API_KEY" \
  PG_USER=bevoac_api PG_PASSWORD=ci_api_password \
  PG_ADMIN_USER=bevoacadmin PG_ADMIN_PASSWORD=ci_bevoacadmin_password \
  node --test bevoac-api-enterprise/tests/integration/public-api-postgres.integration.test.js

BEVOAC_INTEGRATION_DB=1 PG_USER=bevoac_worker PG_PASSWORD=ci_worker_password \
  node --test bevoac-worker-enterprise/tests/integration/worker-postgres.integration.test.js

echo "POSTGRES_ENTERPRISE_GATE_OK=true"
