-- Secure API-key authentication boundary.
--
-- Optional additive migration.
-- It does not enable RLS and does not alter existing runtime connections.
-- Apply only through scripts/apply-secure-api-key-auth.js.

CREATE OR REPLACE FUNCTION public.bevoac_authenticate_api_key(
  p_key_hash character varying
)
RETURNS TABLE (
  api_key_id uuid,
  tenant_id uuid,
  scopes jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_api_key_id uuid;
  v_tenant_id uuid;
  v_scopes jsonb;
BEGIN
  -- SECURITY DEFINER changes current_user to the function owner.
  -- session_user remains the actual PostgreSQL login identity.
  IF session_user <> 'bevoac_api' THEN
    RAISE EXCEPTION
      'bevoac_authenticate_api_key is restricted to bevoac_api'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    ak.id,
    ak.tenant_id,
    COALESCE(ak.scopes, '[]'::jsonb)
  INTO
    v_api_key_id,
    v_tenant_id,
    v_scopes
  FROM public.api_keys AS ak
  INNER JOIN public.tenants AS t
    ON t.id = ak.tenant_id
  WHERE ak.key_hash = p_key_hash
    AND ak.is_active = TRUE
    AND (
      ak.expires_at IS NULL
      OR ak.expires_at > statement_timestamp()
    )
    AND t.is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.api_keys
  SET last_used_at = statement_timestamp()
  WHERE id = v_api_key_id
    AND (
      last_used_at IS NULL
      OR last_used_at <
        statement_timestamp() - INTERVAL '60 seconds'
    );

  api_key_id := v_api_key_id;
  tenant_id := v_tenant_id;
  scopes := v_scopes;

  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.bevoac_authenticate_api_key(character varying)
  OWNER TO bevoacadmin;

REVOKE ALL
  ON FUNCTION public.bevoac_authenticate_api_key(character varying)
  FROM PUBLIC;

REVOKE ALL
  ON FUNCTION public.bevoac_authenticate_api_key(character varying)
  FROM
    bevoac_worker,
    bevoac_outbox,
    bevoac_retention,
    bevoac_admin_api,
    bevoac_operator;

GRANT EXECUTE
  ON FUNCTION public.bevoac_authenticate_api_key(character varying)
  TO bevoac_api;
