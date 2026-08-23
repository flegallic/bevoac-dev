'use strict';

const { randomUUID } = require('crypto');
const {
  createSignedState,
  verifySignedState,
  sha256
} = require('../lib/onboarding-state');
const {
  normalizeUuid
} = require('../lib/target-authorization');
const {
  ValidationError,
  NotFoundError,
  AppError
} = require('../lib/errors');
const {
  withTenantSession,
  withTenantTransaction
} = require('../lib/db-context');

function boolFromMicrosoft(value) {
  return String(value || '').toLowerCase() === 'true';
}

function appendQuery(url, params) {
  const target = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    ) {
      target.searchParams.set(key, value);
    }
  }

  return target.toString();
}

function normalizeUrl(value, fieldName) {
  const raw = String(value || '').trim();

  if (!raw) {
    throw new ValidationError(
      `${fieldName} is required.`
    );
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new ValidationError(
      `${fieldName} must be a valid URL.`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError(
      `${fieldName} must use HTTPS.`
    );
  }

  parsed.hash = '';

  return parsed.toString();
}

function deriveBaseUrlFromRequest(request) {
  const proto =
    request.headers['x-forwarded-proto'] ||
    request.protocol ||
    'https';

  const host =
    request.headers['x-forwarded-host'] ||
    request.headers.host;

  if (!host) {
    throw new ValidationError(
      'Unable to infer public API host for onboarding callback. ' +
      'Configure ONBOARDING_REDIRECT_URI.'
    );
  }

  return (
    `${String(proto).split(',')[0]}://` +
    String(host).split(',')[0]
  );
}

function inferRedirectUri(config, request) {
  if (config.onboarding.redirectUri) {
    return normalizeUrl(
      config.onboarding.redirectUri,
      'ONBOARDING_REDIRECT_URI'
    );
  }

  if (!config.onboarding.allowInferredRedirectUri) {
    throw new ValidationError(
      'ONBOARDING_REDIRECT_URI is required in production. ' +
      'Do not infer callback URLs from Host or X-Forwarded headers.'
    );
  }

  const base = deriveBaseUrlFromRequest(request)
    .replace(/\/$/, '');

  return normalizeUrl(
    `${base}/v1/onboarding/azure/callback`,
    'inferred onboarding redirect URI'
  );
}

function buildSuccessRedirect(config, params) {
  const base =
    config.onboarding.frontendSuccessUrl ||
    '/v1/onboarding/azure/result';

  const safeParams = {
    status: params.status || 'unknown',
    reason: params.reason || '',
    subscriptionCount: params.subscriptionCount || '0'
  };

  const fragmentParams = new URLSearchParams();
  for (const [key, value] of Object.entries(safeParams)) {
    if (String(value || '').trim() !== '') fragmentParams.set(key, String(value));
  }
  const fragment = fragmentParams.toString();
  if (base.startsWith('/')) return `${base}#${fragment}`;

  const target = new URL(base);
  target.search = '';
  target.hash = fragment;
  return target.toString();
}

class AzureOnboardingService {
  constructor(pg, config, logger) {
    this.pg = pg;
    this.config = config;
    this.logger = logger;
  }

  buildAdminConsentUrl({ redirectUri, state }) {
    const endpoint =
      'https://login.microsoftonline.com/' +
      'organizations/v2.0/adminconsent';

    const scope = String(
      this.config.microsoft.adminConsentScope ||
      'https://graph.microsoft.com/.default'
    ).trim();

    if (!scope) {
      throw new ValidationError(
        'Microsoft admin consent scope is required.'
      );
    }

    return appendQuery(endpoint, {
      client_id: this.config.microsoft.clientId,
      redirect_uri: redirectUri,
      state,
      scope
    });
  }

  async startOnboarding({
    tenantId,
    apiKeyId,
    request
  }) {
    if (!this.config.microsoft.clientId) {
      throw new ValidationError(
        'MICROSOFT_CLIENT_ID is not configured.'
      );
    }

    const redirectUri =
      inferRedirectUri(this.config, request);

    const sessionId = randomUUID();
    const nonce = randomUUID();

    const expiresAt = new Date(
      Date.now() +
      this.config.onboarding.stateTtlMinutes *
      60 *
      1000
    );

    const state = createSignedState(
      this.config.onboarding.stateSecret,
      {
        sid: sessionId,
        tid: tenantId,
        kid: apiKeyId,
        nonce,
        exp: expiresAt.getTime()
      }
    );

    const stateHash = sha256(state);

    await withTenantSession(
      this.pg,
      tenantId,
      async (client) => {
        await client.query(
          `
          INSERT INTO azure_onboarding_sessions (
            id,
            tenant_id,
            api_key_id,
            state_hash,
            nonce_hash,
            redirect_uri,
            status,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            'STARTED',
            $7,
            NOW(),
            NOW()
          )
          `,
          [
            sessionId,
            tenantId,
            apiKeyId,
            stateHash,
            sha256(nonce),
            redirectUri,
            expiresAt
          ]
        );
      }
    );

    return {
      sessionId,
      authorizationUrl:
        this.buildAdminConsentUrl({
          redirectUri,
          state
        }),
      callbackUrl: redirectUri,
      expiresAt: expiresAt.toISOString()
    };
  }

  async handleCallback(query) {
    const state = String(query.state || '');

    let payload;
    let stateHash;
    let microsoftTenantId = null;

    try {
      payload = verifySignedState(
        this.config.onboarding.stateSecret,
        state
      );

      stateHash = sha256(state);

      microsoftTenantId = query.tenant
        ? normalizeUuid(
            query.tenant,
            'tenant'
          )
        : null;
    } catch (error) {
      this.logger?.warn?.(
        { err: error },
        'Rejected Azure onboarding callback before session lookup.'
      );

      return buildSuccessRedirect(
        this.config,
        {
          status: 'error',
          reason:
            error.code ||
            'invalid_state',
          microsoftTenantId: '',
          subscriptionCount: '0'
        }
      );
    }

    const adminConsent =
      boolFromMicrosoft(query.admin_consent);

    const errorCode = query.error
      ? String(query.error).slice(0, 120)
      : null;

    const errorDescription =
      query.error_description
        ? String(
            query.error_description
          ).slice(0, 1000)
        : null;

    try {
      const callbackResult =
        await withTenantTransaction(
          this.pg,
          payload.tid,
          async (client) => {
            const sessionResult =
              await client.query(
                `
                SELECT
                  id,
                  tenant_id,
                  api_key_id,
                  status,
                  expires_at
                FROM azure_onboarding_sessions
                WHERE id = $1
                  AND tenant_id = $2
                  AND state_hash = $3
                  AND api_key_id = $4
                FOR UPDATE
                `,
                [
                  payload.sid,
                  payload.tid,
                  stateHash,
                  payload.kid
                ]
              );

            if (sessionResult.rowCount !== 1) {
              throw new ValidationError(
                'Unknown onboarding session.'
              );
            }

            const session =
              sessionResult.rows[0];

            if (session.status !== 'STARTED') {
              throw new ValidationError(
                'Onboarding session was already consumed.'
              );
            }

            if (
              new Date(
                session.expires_at
              ).getTime() < Date.now()
            ) {
              throw new ValidationError(
                'Onboarding session has expired.'
              );
            }

            if (
              errorCode ||
              !adminConsent ||
              !microsoftTenantId
            ) {
              await client.query(
                `
                UPDATE azure_onboarding_sessions
                SET
                  status = 'FAILED',
                  error_code = $2,
                  error_description = $3,
                  completed_at = NOW(),
                  updated_at = NOW()
                WHERE id = $1
                  AND tenant_id = $4
                `,
                [
                  session.id,
                  errorCode ||
                    'ADMIN_CONSENT_NOT_GRANTED',
                  errorDescription ||
                    'Microsoft admin consent was not granted.',
                  session.tenant_id
                ]
              );

              return {
                terminal: true,
                redirect: buildSuccessRedirect(
                  this.config,
                  {
                    status: 'error',
                    reason:
                      errorCode ||
                      'admin_consent_not_granted',
                    microsoftTenantId:
                      microsoftTenantId || '',
                    subscriptionCount: '0'
                  }
                )
              };
            }

            await this.upsertIntegration(
              client,
              {
                tenantId:
                  session.tenant_id,
                microsoftTenantId,
                status: 'CONSENTED',
                metadata: {
                  callback:
                    'admin_consent',
                  sessionId:
                    session.id
                }
              }
            );

            await this.upsertTenantScope(
              client,
              {
                tenantId:
                  session.tenant_id,
                microsoftTenantId,
                subscriptionId: null,
                displayName:
                  'Tenant consent',
                status: 'CONSENTED',
                source: 'admin_consent',
                metadata: {
                  sessionId:
                    session.id
                }
              }
            );

            await client.query(
              `
              UPDATE azure_onboarding_sessions
              SET
                microsoft_tenant_id =
                  $2::uuid,
                admin_consent = TRUE,
                status = 'VERIFYING',
                updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $3
              `,
              [
                session.id,
                microsoftTenantId,
                session.tenant_id
              ]
            );

            return {
              terminal: false,
              sessionId: session.id,
              tenantId: session.tenant_id
            };
          }
        );

      if (callbackResult.terminal) {
        return callbackResult.redirect;
      }

      const verification =
        await this.refreshSubscriptions({
          tenantId:
            callbackResult.tenantId,
          microsoftTenantId,
          sessionId:
            callbackResult.sessionId
        });

      return buildSuccessRedirect(
        this.config,
        {
          status:
            verification.status ===
            'ACTIVE'
              ? 'success'
              : 'action_required',
          microsoftTenantId,
          subscriptionCount: String(
            verification.subscriptionCount ||
            0
          ),
          sessionId:
            callbackResult.sessionId
        }
      );
    } catch (error) {
      this.logger?.error?.(
        { err: error },
        'Azure onboarding callback failed.'
      );

      return buildSuccessRedirect(
        this.config,
        {
          status: 'error',
          reason:
            error.code ||
            'callback_failed',
          microsoftTenantId:
            microsoftTenantId || '',
          subscriptionCount: '0'
        }
      );
    }
  }

  async upsertIntegration(
    client,
    {
      tenantId,
      microsoftTenantId,
      status,
      metadata
    }
  ) {
    await client.query(
      `
      INSERT INTO tenant_azure_integrations (
        tenant_id,
        microsoft_tenant_id,
        consent_status,
        consented_at,
        last_verified_at,
        subscription_count,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2::uuid,
        $3,
        NOW(),
        NOW(),
        0,
        $4::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (
        tenant_id,
        microsoft_tenant_id
      )
      DO UPDATE
      SET
        consent_status =
          EXCLUDED.consent_status,
        consented_at =
          COALESCE(
            tenant_azure_integrations.consented_at,
            NOW()
          ),
        last_verified_at = NOW(),
        metadata =
          tenant_azure_integrations.metadata ||
          EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        tenantId,
        microsoftTenantId,
        status,
        JSON.stringify(metadata || {})
      ]
    );
  }

  async upsertTenantScope(
    client,
    {
      tenantId,
      microsoftTenantId,
      subscriptionId,
      displayName,
      status,
      source,
      metadata
    }
  ) {
    if (!subscriptionId) {
      await client.query(
        `
        INSERT INTO tenant_azure_scopes (
          tenant_id,
          microsoft_tenant_id,
          subscription_id,
          display_name,
          is_active,
          source,
          status,
          verified_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2::uuid,
          NULL,
          $3,
          TRUE,
          $4,
          $5,
          NOW(),
          $6::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (
          tenant_id,
          microsoft_tenant_id
        )
        WHERE subscription_id IS NULL
        DO UPDATE
        SET
          display_name =
            EXCLUDED.display_name,
          is_active = TRUE,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          verified_at = NOW(),
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        `,
        [
          tenantId,
          microsoftTenantId,
          displayName || null,
          source,
          status,
          JSON.stringify(metadata || {})
        ]
      );

      return;
    }

    await client.query(
      `
      INSERT INTO tenant_azure_scopes (
        tenant_id,
        microsoft_tenant_id,
        subscription_id,
        display_name,
        is_active,
        source,
        status,
        verified_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2::uuid,
        $3::uuid,
        $4,
        TRUE,
        $5,
        $6,
        NOW(),
        $7::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (
        tenant_id,
        microsoft_tenant_id,
        subscription_id
      )
      WHERE subscription_id IS NOT NULL
      DO UPDATE
      SET
        display_name =
          EXCLUDED.display_name,
        is_active = TRUE,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        verified_at = NOW(),
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        tenantId,
        microsoftTenantId,
        subscriptionId,
        displayName || null,
        source,
        status,
        JSON.stringify(metadata || {})
      ]
    );
  }

  async requestManagementToken(
    microsoftTenantId
  ) {
    if (
      !this.config.microsoft.clientId ||
      !this.config.microsoft.clientSecret
    ) {
      throw new AppError(
        'Microsoft client credentials are not configured.',
        {
          code:
            'MICROSOFT_CREDENTIALS_MISSING',
          statusCode: 500
        }
      );
    }

    const tokenUrl =
      `https://login.microsoftonline.com/` +
      `${microsoftTenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id:
        this.config.microsoft.clientId,
      client_secret:
        this.config.microsoft.clientSecret,
      grant_type:
        'client_credentials',
      scope:
        'https://management.azure.com/.default'
    });

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      this.config.onboarding
        .azureRequestTimeoutMs
    );

    try {
      const response = await fetch(
        tokenUrl,
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/x-www-form-urlencoded'
          },
          body,
          signal: controller.signal
        }
      );

      const responsePayload =
        await response
          .json()
          .catch(() => ({}));

      if (
        !response.ok ||
        !responsePayload.access_token
      ) {
        throw new AppError(
          'Unable to acquire Azure management token for customer tenant.',
          {
            code:
              'AZURE_TOKEN_FAILED',
            statusCode: 502,
            details: {
              status: response.status,
              error:
                responsePayload.error,
              errorDescription:
                responsePayload
                  .error_description
            }
          }
        );
      }

      return responsePayload.access_token;
    } finally {
      clearTimeout(timeout);
    }
  }

  async discoverSubscriptions(
    microsoftTenantId
  ) {
    const accessToken =
      await this.requestManagementToken(
        microsoftTenantId
      );

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      this.config.onboarding
        .azureRequestTimeoutMs
    );

    try {
      const response = await fetch(
        'https://management.azure.com/' +
        'subscriptions?api-version=2020-01-01',
        {
          headers: {
            authorization:
              `Bearer ${accessToken}`
          },
          signal: controller.signal
        }
      );

      const responsePayload =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new AppError(
          'Unable to list Azure subscriptions for customer tenant.',
          {
            code:
              'AZURE_SUBSCRIPTIONS_LIST_FAILED',
            statusCode: 502,
            details: {
              status: response.status,
              error:
                responsePayload.error
            }
          }
        );
      }

      const subscriptions =
        Array.isArray(
          responsePayload.value
        )
          ? responsePayload.value
          : [];

      return subscriptions
        .filter(
          (item) =>
            item.subscriptionId &&
            ![
              'Disabled',
              'Deleted'
            ].includes(
              String(item.state || '')
            )
        )
        .map((item) => ({
          subscriptionId:
            normalizeUuid(
              item.subscriptionId,
              'subscriptionId'
            ),
          displayName:
            item.displayName ||
            item.subscriptionId,
          state:
            item.state ||
            'Unknown',
          tenantId:
            item.tenantId ||
            microsoftTenantId
        }));
    } finally {
      clearTimeout(timeout);
    }
  }

  async refreshSubscriptions({
    tenantId,
    microsoftTenantId,
    sessionId = null
  }) {
    let subscriptions = [];

    try {
      subscriptions =
        await this.discoverSubscriptions(
          microsoftTenantId
        );

      return await withTenantTransaction(
        this.pg,
        tenantId,
        async (client) => {
          await client.query(
            `
            UPDATE tenant_azure_scopes
            SET
              is_active = FALSE,
              status = 'STALE',
              updated_at = NOW()
            WHERE tenant_id = $1
              AND microsoft_tenant_id =
                $2::uuid
              AND subscription_id IS NOT NULL
              AND source = 'admin_consent'
            `,
            [
              tenantId,
              microsoftTenantId
            ]
          );

          for (
            const subscription
            of subscriptions
          ) {
            await this.upsertTenantScope(
              client,
              {
                tenantId,
                microsoftTenantId,
                subscriptionId:
                  subscription
                    .subscriptionId,
                displayName:
                  subscription
                    .displayName,
                status: 'VERIFIED',
                source:
                  'admin_consent',
                metadata: {
                  state:
                    subscription.state,
                  tenantId:
                    subscription.tenantId,
                  sessionId
                }
              }
            );
          }

          const status =
            subscriptions.length > 0
              ? 'ACTIVE'
              : 'NEEDS_RBAC';

          await client.query(
            `
            UPDATE tenant_azure_integrations
            SET
              consent_status = $3,
              subscription_count = $4,
              last_verified_at = NOW(),
              last_error = NULL,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND microsoft_tenant_id =
                $2::uuid
            `,
            [
              tenantId,
              microsoftTenantId,
              status,
              subscriptions.length
            ]
          );

          if (sessionId) {
            await client.query(
              `
              UPDATE azure_onboarding_sessions
              SET
                status = $2,
                subscription_count = $3,
                completed_at = NOW(),
                updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $4
              `,
              [
                sessionId,
                status === 'ACTIVE'
                  ? 'COMPLETED'
                  : 'ACTION_REQUIRED',
                subscriptions.length,
                tenantId
              ]
            );
          }

          return {
            status,
            subscriptionCount:
              subscriptions.length,
            subscriptions
          };
        }
      );
    } catch (error) {
      this.logger?.warn?.(
        {
          err: error,
          tenantId,
          microsoftTenantId
        },
        'Azure subscription verification failed.'
      );

      await withTenantTransaction(
        this.pg,
        tenantId,
        async (client) => {
          await client.query(
            `
            UPDATE tenant_azure_integrations
            SET
              consent_status =
                'NEEDS_RBAC',
              last_verified_at = NOW(),
              last_error = $3,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND microsoft_tenant_id =
                $2::uuid
            `,
            [
              tenantId,
              microsoftTenantId,
              error.message ||
                'Azure verification failed.'
            ]
          );

          if (sessionId) {
            await client.query(
              `
              UPDATE azure_onboarding_sessions
              SET
                status =
                  'ACTION_REQUIRED',
                error_code = $2,
                error_description = $3,
                completed_at = NOW(),
                updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $4
              `,
              [
                sessionId,
                error.code ||
                  'AZURE_VERIFICATION_FAILED',
                error.message ||
                  'Azure verification failed.',
                tenantId
              ]
            );
          }
        }
      );

      return {
        status: 'NEEDS_RBAC',
        subscriptionCount: 0,
        subscriptions: [],
        error: error.message
      };
    }
  }

  async getStatus(tenantId) {
    return withTenantSession(
      this.pg,
      tenantId,
      async (client) => {
        const integrations =
          await client.query(
            `
            SELECT
              microsoft_tenant_id,
              consent_status,
              consented_at,
              last_verified_at,
              subscription_count,
              last_error,
              metadata,
              created_at,
              updated_at
            FROM tenant_azure_integrations
            WHERE tenant_id = $1
            ORDER BY updated_at DESC
            `,
            [tenantId]
          );

        const scopes =
          await client.query(
            `
            SELECT
              microsoft_tenant_id,
              subscription_id,
              display_name,
              is_active,
              source,
              status,
              verified_at,
              metadata,
              created_at,
              updated_at
            FROM tenant_azure_scopes
            WHERE tenant_id = $1
            ORDER BY
              microsoft_tenant_id,
              subscription_id NULLS FIRST
            `,
            [tenantId]
          );

        return {
          tenantId,
          integrations:
            integrations.rows.map(
              (row) => ({
                microsoftTenantId:
                  row.microsoft_tenant_id,
                consentStatus:
                  row.consent_status,
                consentedAt:
                  row.consented_at,
                lastVerifiedAt:
                  row.last_verified_at,
                subscriptionCount:
                  row.subscription_count,
                lastError:
                  row.last_error,
                createdAt:
                  row.created_at,
                updatedAt:
                  row.updated_at
              })
            ),
          scopes:
            scopes.rows.map(
              (row) => ({
                microsoftTenantId:
                  row.microsoft_tenant_id,
                subscriptionId:
                  row.subscription_id,
                displayName:
                  row.display_name,
                isActive:
                  row.is_active,
                source:
                  row.source,
                status:
                  row.status,
                verifiedAt:
                  row.verified_at,
                createdAt:
                  row.created_at,
                updatedAt:
                  row.updated_at
              })
            )
        };
      }
    );
  }

  async reverifyTenant({
    tenantId,
    microsoftTenantId
  }) {
    const normalized =
      normalizeUuid(
        microsoftTenantId,
        'microsoftTenantId'
      );

    await withTenantSession(
      this.pg,
      tenantId,
      async (client) => {
        const result =
          await client.query(
            `
            SELECT 1
            FROM tenant_azure_integrations
            WHERE tenant_id = $1
              AND microsoft_tenant_id =
                $2::uuid
            LIMIT 1
            `,
            [
              tenantId,
              normalized
            ]
          );

        if (result.rowCount !== 1) {
          throw new NotFoundError(
            'Azure integration not found for this tenant.'
          );
        }
      }
    );

    return this.refreshSubscriptions({
      tenantId,
      microsoftTenantId: normalized
    });
  }
}

module.exports = {
  AzureOnboardingService,
  buildSuccessRedirect
};
