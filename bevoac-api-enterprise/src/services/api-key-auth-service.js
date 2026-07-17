'use strict';

async function lookupApiKeyPrincipal(pg, keyHash) {
  const result = await pg.query(
    `
    SELECT
      api_key_id,
      tenant_id,
      scopes
    FROM public.bevoac_authenticate_api_key(
      $1::character varying
    )
    `,
    [keyHash]
  );

  if (result.rowCount !== 1) return null;

  return {
    apiKeyId: result.rows[0].api_key_id,
    tenantId: result.rows[0].tenant_id,
    scopes: result.rows[0].scopes
  };
}

module.exports = {
  lookupApiKeyPrincipal
};
