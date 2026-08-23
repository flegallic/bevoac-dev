const fs = require('fs');
const {
  resolveRuntimeMode,
  runtimeSupportsPublicApi,
  runtimeSupportsAdminApi,
  runtimeRequiresServiceBus
} = require('../lib/runtime-mode');

const DEFAULT_MICROSOFT_ADMIN_CONSENT_SCOPE = 'https://graph.microsoft.com/.default';
const ONBOARDING_CALLBACK_PATH = '/v1/onboarding/azure/callback';

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') throw new Error(`Missing required environment variable: ${name}`);
  return String(value).trim();
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function optionalNumber(name, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return parsed;
}

function optionalInteger(name, fallback, options = {}) {
  return optionalNumber(name, fallback, { ...options, integer: true });
}

function optionalBoolean(name, fallback) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment variable: ${name}`);
}

function parseOrigins(raw, nodeEnv = 'production') {
  if (!raw) return [];
  const origins = [];
  for (const item of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    let parsed;
    try { parsed = new URL(item); } catch (_) { throw new Error(`ALLOWED_ORIGINS contains an invalid URL: ${item}`); }
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
      throw new Error('ALLOWED_ORIGINS must use HTTPS in production.');
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('ALLOWED_ORIGINS supports only HTTP or HTTPS origins.');
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`ALLOWED_ORIGINS must contain origins without path, query or credentials: ${item}`);
    }
    origins.push(parsed.origin);
  }
  return [...new Set(origins)];
}

function parseCsv(raw) {
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeHttpsUrl(value, fieldName, { stripPath = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error(`${fieldName} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:') throw new Error(`${fieldName} must use HTTPS.`);
  parsed.hash = '';
  if (stripPath) {
    parsed.pathname = '';
    parsed.search = '';
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeAllowedHttpsUrl(value, fieldName, allowedOrigins = [], { requireAllowedOrigin = false } = {}) {
  const normalized = normalizeHttpsUrl(value, fieldName);
  if (!normalized) return '';
  const origin = new URL(normalized).origin;
  if ((requireAllowedOrigin || allowedOrigins.length > 0) && !allowedOrigins.includes(origin)) {
    throw new Error(`${fieldName} origin is not present in ALLOWED_ORIGINS.`);
  }
  return normalized;
}

function buildOnboardingRedirectUri(apiPublicBaseUrl) {
  const baseUrl = normalizeHttpsUrl(apiPublicBaseUrl, 'API_PUBLIC_BASE_URL', { stripPath: true });
  return baseUrl ? `${baseUrl}${ONBOARDING_CALLBACK_PATH}` : '';
}

function resolveOnboardingRuntimeConfig(nodeEnv) {
  const apiPublicBaseUrl = normalizeHttpsUrl(optionalEnv('API_PUBLIC_BASE_URL'), 'API_PUBLIC_BASE_URL', { stripPath: true });
  const explicitRedirectUri = normalizeHttpsUrl(optionalEnv('ONBOARDING_REDIRECT_URI'), 'ONBOARDING_REDIRECT_URI');
  const derivedRedirectUri = buildOnboardingRedirectUri(apiPublicBaseUrl);
  const redirectUri = explicitRedirectUri || derivedRedirectUri;
  if (nodeEnv === 'production' && !redirectUri) {
    throw new Error('Missing onboarding callback configuration: set API_PUBLIC_BASE_URL or ONBOARDING_REDIRECT_URI.');
  }
  return { apiPublicBaseUrl, redirectUri };
}

function resolvePgSslConfig(nodeEnv = optionalEnv('NODE_ENV', 'production')) {
  const mode = optionalEnv('PG_SSL_MODE', 'verify-full').toLowerCase();
  if (!['verify-full', 'require', 'disable'].includes(mode)) throw new Error('PG_SSL_MODE must be verify-full, require or disable.');
  if (mode === 'disable') {
    if (nodeEnv === 'production') throw new Error('PG_SSL_MODE=disable is forbidden in production.');
    return false;
  }
  if (
    nodeEnv === 'production' &&
    mode === 'require' &&
    !optionalBoolean('ALLOW_PG_SSL_REQUIRE_ROLLBACK', false)
  ) {
    throw new Error(
      'PG_SSL_MODE=require disables certificate verification and is forbidden in production unless ALLOW_PG_SSL_REQUIRE_ROLLBACK=true.'
    );
  }
  const caBase64 = optionalEnv('PG_SSL_CA_BASE64');
  const ssl = { rejectUnauthorized: mode !== 'require' };
  if (caBase64) ssl.ca = Buffer.from(caBase64, 'base64').toString('utf8');
  else if (optionalEnv('PG_SSL_CA_FILE')) {
    const caFile = optionalEnv('PG_SSL_CA_FILE');
    if (!fs.existsSync(caFile)) throw new Error(`PG_SSL_CA_FILE does not exist: ${caFile}`);
    ssl.ca = fs.readFileSync(caFile, 'utf8');
  }
  return ssl;
}

function getDatabaseConfig(nodeEnv = optionalEnv('NODE_ENV', 'production')) {
  return {
    host: requireEnv('PG_HOST'),
    port: optionalInteger('PG_PORT', 5432, { min: 1, max: 65535 }),
    database: requireEnv('PG_DATABASE'),
    user: requireEnv('PG_USER'),
    password: requireEnv('PG_PASSWORD'),
    max: optionalInteger('PG_POOL_MAX', 20, { min: 1, max: 200 }),
    idleTimeoutMillis: optionalInteger('PG_IDLE_TIMEOUT_MS', 30000, { min: 1000, max: 600000 }),
    connectionTimeoutMillis: optionalInteger('PG_CONNECTION_TIMEOUT_MS', 10000, { min: 1000, max: 120000 }),
    ssl: resolvePgSslConfig(nodeEnv)
  };
}

function getServiceBusConfig(nodeEnv = optionalEnv('NODE_ENV', 'production')) {
  const defaultMode = nodeEnv === 'production' ? 'managed_identity' : 'connection_string';
  const authMode = optionalEnv('SERVICEBUS_AUTH_MODE', defaultMode).toLowerCase();
  if (!['managed_identity', 'connection_string'].includes(authMode)) throw new Error('SERVICEBUS_AUTH_MODE must be managed_identity or connection_string.');
  const queueName = requireEnv('SERVICEBUS_QUEUE_NAME');
  const ttlSeconds = optionalInteger('SERVICEBUS_MESSAGE_TTL_SECONDS', 300, { min: 60, max: 1209600 });
  const sessionsEnabled = optionalBoolean('SERVICEBUS_SESSIONS_ENABLED', true);
  if (authMode === 'managed_identity') {
    return { authMode, fullyQualifiedNamespace: requireEnv('SERVICEBUS_FQ_NAMESPACE'), queueName, ttlSeconds, sessionsEnabled };
  }
  if (nodeEnv === 'production' && !optionalBoolean('ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK', false)) {
    throw new Error('SERVICEBUS_AUTH_MODE=connection_string requires ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK=true in production.');
  }
  return { authMode: 'connection_string', connectionString: requireEnv('SERVICEBUS_CONNECTION_STRING'), queueName, ttlSeconds, sessionsEnabled };
}

function getAdminAuthConfig(nodeEnv) {
  const mode = optionalEnv('ADMIN_AUTH_MODE', nodeEnv === 'production' ? 'oidc' : 'shared_secret').toLowerCase();
  if (!['oidc', 'shared_secret'].includes(mode)) throw new Error('ADMIN_AUTH_MODE must be oidc or shared_secret.');
  if (nodeEnv === 'production' && mode === 'shared_secret') {
    throw new Error('ADMIN_AUTH_MODE=shared_secret is forbidden in production. Use OIDC.');
  }
  const sharedSecret = optionalEnv('ADMIN_API_SECRET');
  if (mode === 'shared_secret' && !sharedSecret) throw new Error('Missing ADMIN_API_SECRET for shared_secret admin auth.');
  if (mode === 'oidc') {
    requireEnv('ADMIN_OIDC_ISSUER');
    requireEnv('ADMIN_OIDC_AUDIENCE');
    if (nodeEnv === 'production') {
      requireEnv('ADMIN_OIDC_TENANT_ID');
    }
  }
  return {
    mode,
    sharedSecret,
    oidc: {
      issuer: optionalEnv('ADMIN_OIDC_ISSUER'),
      audience: optionalEnv('ADMIN_OIDC_AUDIENCE'),
      jwksUri: optionalEnv('ADMIN_OIDC_JWKS_URI'),
      requiredRoles: parseCsv(optionalEnv('ADMIN_OIDC_REQUIRED_ROLES', 'Bevoac.Admin')),
      clockToleranceSeconds: optionalInteger('ADMIN_OIDC_CLOCK_TOLERANCE_SECONDS', 60, { min: 0, max: 300 }),
      tenantId: optionalEnv('ADMIN_OIDC_TENANT_ID')
    }
  };
}

function getConfig() {
  const nodeEnv = optionalEnv('NODE_ENV', 'production');

  const runtimeMode = resolveRuntimeMode(
    optionalEnv('APP_RUNTIME_MODE', nodeEnv === 'production' ? 'public_api' : 'combined')
  );

  if (nodeEnv === 'production' && runtimeMode === 'combined') {
    throw new Error(
      'APP_RUNTIME_MODE=combined is forbidden in production. ' +
      'Deploy public_api and admin_api as separate runtimes.'
    );
  }

  const publicApiEnabled =
    runtimeSupportsPublicApi(runtimeMode);

  const adminApiEnabled =
    runtimeSupportsAdminApi(runtimeMode);

  const outbox = {
    publisherEnabled: optionalBoolean(
      'OUTBOX_PUBLISHER_ENABLED',
      true
    ),
    immediatePublishAfterRequest: optionalBoolean(
      'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST',
      true
    ),
    publishIntervalMs: optionalInteger(
      'OUTBOX_PUBLISH_INTERVAL_MS',
      5000, { min: 100, max: 3600000 }
    ),
    batchSize: optionalInteger(
      'OUTBOX_PUBLISH_BATCH_SIZE',
      25, { min: 1, max: 1000 }
    ),
    maxAttempts: optionalInteger(
      'OUTBOX_MAX_ATTEMPTS',
      10, { min: 1, max: 100 }
    ),
    baseBackoffSeconds: optionalInteger(
      'OUTBOX_BASE_BACKOFF_SECONDS',
      15, { min: 1, max: 3600 }
    )
  };

  const adminApiSecret = adminApiEnabled
    ? optionalEnv('ADMIN_API_SECRET')
    : '';

  const onboardingStateSecret = publicApiEnabled
    ? optionalEnv(
        'ONBOARDING_STATE_SECRET',
        nodeEnv === 'production'
          ? ''
          : adminApiSecret
      )
    : '';

  if (
    publicApiEnabled &&
    nodeEnv === 'production' &&
    !onboardingStateSecret
  ) {
    throw new Error(
      'Missing required environment variable: ' +
      'ONBOARDING_STATE_SECRET'
    );
  }
  if (
    publicApiEnabled &&
    nodeEnv === 'production' &&
    onboardingStateSecret.length < 32
  ) {
    throw new Error(
      'ONBOARDING_STATE_SECRET must contain at least 32 characters in production.'
    );
  }

  const onboardingRuntime = publicApiEnabled
    ? resolveOnboardingRuntimeConfig(nodeEnv)
    : {
        apiPublicBaseUrl: '',
        redirectUri: ''
      };

  const serviceBusRequired =
    runtimeRequiresServiceBus(
      runtimeMode,
      outbox
    );
  const allowedOrigins = parseOrigins(optionalEnv('ALLOWED_ORIGINS'), nodeEnv);
  const swaggerEnabled = optionalBoolean('SWAGGER_ENABLED', nodeEnv !== 'production');
  const apimBackendBoundaryRequired = publicApiEnabled && optionalBoolean('APIM_BACKEND_BOUNDARY_REQUIRED', nodeEnv === 'production');
  const apimBackendSharedSecret = publicApiEnabled ? optionalEnv('APIM_BACKEND_SHARED_SECRET') : '';
  if (apimBackendBoundaryRequired && !apimBackendSharedSecret) {
    throw new Error('APIM_BACKEND_SHARED_SECRET is required when APIM_BACKEND_BOUNDARY_REQUIRED=true.');
  }
  if (apimBackendBoundaryRequired && apimBackendSharedSecret.length < 32) {
    throw new Error('APIM_BACKEND_SHARED_SECRET must contain at least 32 characters.');
  }

  const microsoftClientId = publicApiEnabled
    ? optionalEnv('MICROSOFT_CLIENT_ID')
    : '';
  const microsoftClientSecret = publicApiEnabled
    ? optionalEnv('MICROSOFT_CLIENT_SECRET')
    : '';
  if (publicApiEnabled && nodeEnv === 'production') {
    if (!microsoftClientId) throw new Error('Missing required environment variable: MICROSOFT_CLIENT_ID');
    if (!microsoftClientSecret) throw new Error('Missing required environment variable: MICROSOFT_CLIENT_SECRET');
  }

  return {
    nodeEnv,
    runtimeMode,
    host: optionalEnv('HOST', '0.0.0.0'),
    port: optionalInteger('PORT', 8080, { min: 1, max: 65535 }),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    allowedOrigins,
    http: {
      bodyLimitBytes: optionalInteger('HTTP_BODY_LIMIT_BYTES', 1024 * 1024, { min: 1024, max: 10 * 1024 * 1024 })
    },
    apiRateLimitMax: optionalInteger(
      'API_RATE_LIMIT_MAX',
      60, { min: 1, max: 100000 }
    ),
    apiRateLimitWindow: optionalEnv(
      'API_RATE_LIMIT_WINDOW',
      '1 minute'
    ),
    adminRateLimitMax: optionalInteger(
      'ADMIN_RATE_LIMIT_MAX',
      20, { min: 1, max: 100000 }
    ),
    adminRateLimitWindow: optionalEnv(
      'ADMIN_RATE_LIMIT_WINDOW',
      '1 minute'
    ),
    postgres: getDatabaseConfig(nodeEnv),
    serviceBus: serviceBusRequired
      ? getServiceBusConfig(nodeEnv)
      : null,
    outbox,
    adminApiSecret,
    adminAuth: adminApiEnabled
      ? getAdminAuthConfig(nodeEnv)
      : null,
    backpressure: {
      activeScanLimits: {
        free: optionalInteger('ACTIVE_SCAN_LIMIT_FREE', 1, { min: 1, max: 1000 }),
        standard: optionalInteger('ACTIVE_SCAN_LIMIT_STANDARD', 3, { min: 1, max: 1000 }),
        business: optionalInteger('ACTIVE_SCAN_LIMIT_BUSINESS', 10, { min: 1, max: 1000 }),
        payg: optionalInteger('ACTIVE_SCAN_LIMIT_PAYG', 10, { min: 1, max: 1000 })
      }
    },
    resultStore: {
      maxResultBytes: optionalInteger('MAX_RESULT_JSON_BYTES', 8 * 1024 * 1024, { min: 1024, max: 128 * 1024 * 1024 }),
      currentMonthInlineResultMaxBytes: optionalInteger('CURRENT_MONTH_INLINE_RESULT_MAX_BYTES', 256 * 1024, { min: 0, max: 8 * 1024 * 1024 })
    },
    pdf: {
      timeoutMs: optionalInteger('PDF_GENERATION_TIMEOUT_MS', 20000, { min: 1000, max: 120000 }),
      maxFindings: optionalInteger('PDF_MAX_FINDINGS', 500, { min: 1, max: 10000 }),
      maxEvidenceItems: optionalInteger('PDF_MAX_EVIDENCE_ITEMS', 1200, { min: 1, max: 50000 }),
      maxInputBytes: optionalInteger('PDF_MAX_INPUT_JSON_BYTES', 5 * 1024 * 1024, { min: 1024, max: 128 * 1024 * 1024 })
    },
    retention: {
      scanResultRetentionDays: optionalInteger('SCAN_RESULT_RETENTION_DAYS', 180, { min: 1, max: 3650 }),
      failedScanRetentionDays: optionalInteger('FAILED_SCAN_RETENTION_DAYS', 90, { min: 1, max: 3650 }),
      idempotencyRetentionDays: optionalInteger('IDEMPOTENCY_RETENTION_DAYS', 30, { min: 1, max: 3650 }),
      onboardingSessionRetentionDays: optionalInteger('ONBOARDING_SESSION_RETENTION_DAYS', 30, { min: 1, max: 3650 })
    },
    microsoft: {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      adminConsentScope: optionalEnv(
        'MICROSOFT_ADMIN_CONSENT_SCOPE',
        DEFAULT_MICROSOFT_ADMIN_CONSENT_SCOPE
      )
    },
    onboarding: publicApiEnabled
      ? {
          stateSecret: onboardingStateSecret,
          stateTtlMinutes: optionalInteger('ONBOARDING_STATE_TTL_MINUTES', 20, { min: 5, max: 120 }),
          apiPublicBaseUrl:
            onboardingRuntime.apiPublicBaseUrl,
          redirectUri:
            onboardingRuntime.redirectUri,
          frontendSuccessUrl: normalizeAllowedHttpsUrl(
            optionalEnv('ONBOARDING_FRONTEND_SUCCESS_URL'),
            'ONBOARDING_FRONTEND_SUCCESS_URL',
            allowedOrigins,
            { requireAllowedOrigin: nodeEnv === 'production' }
          ),
          azureRequestTimeoutMs: optionalInteger('ONBOARDING_AZURE_REQUEST_TIMEOUT_MS', 15000, { min: 1000, max: 120000 }),
          allowInferredRedirectUri: optionalBoolean(
            'ONBOARDING_ALLOW_INFER_REDIRECT_URI',
            nodeEnv !== 'production'
          )
        }
      : null,
    swagger: { enabled: swaggerEnabled },
    apimBackendBoundary: {
      required: apimBackendBoundaryRequired,
      headerName: 'x-bevoac-backend-token',
      sharedSecret: apimBackendSharedSecret
    },
    planQuotas: {
      free: optionalInteger('DEFAULT_PLAN_FREE_QUOTA', 30, { min: 0, max: 10000000 }),
      standard: optionalInteger('DEFAULT_PLAN_STANDARD_QUOTA', 2500, { min: 0, max: 10000000 }),
      business: optionalInteger('DEFAULT_PLAN_BUSINESS_QUOTA', 10000, { min: 0, max: 10000000 })
    },
    planResourceLimits: {
      free: optionalInteger('DEFAULT_PLAN_FREE_RESOURCE_LIMIT', 10, { min: 1, max: 1000000 }),
      standard: optionalInteger('DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT', 500, { min: 1, max: 1000000 }),
      business: optionalInteger('DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT', 2500, { min: 1, max: 1000000 }),
      payg: optionalEnv(
        'DEFAULT_PLAN_PAYG_RESOURCE_LIMIT'
      )
        ? optionalInteger('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT', null, { min: 1, max: 1000000 })
        : null
    },
    paygUnitPriceEur: optionalNumber('PAYG_UNIT_PRICE_EUR', 0.10, { min: 0, max: 100000 })
  };
}

module.exports = {
  getConfig,
  getDatabaseConfig,
  resolvePgSslConfig,
  requireEnv,
  optionalBoolean,
  optionalNumber,
  optionalInteger,
  normalizeHttpsUrl,
  normalizeAllowedHttpsUrl,
  parseOrigins,
  buildOnboardingRedirectUri,
  resolveOnboardingRuntimeConfig
};
