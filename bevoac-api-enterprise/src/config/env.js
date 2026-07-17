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

function optionalNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric environment variable: ${name}`);
  return parsed;
}

function optionalBoolean(name, fallback) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment variable: ${name}`);
}

function parseOrigins(raw) {
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
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

function resolvePgSslConfig() {
  const mode = optionalEnv('PG_SSL_MODE', 'verify-full');
  if (mode === 'disable') return false;
  const caBase64 = optionalEnv('PG_SSL_CA_BASE64');
  const ssl = { rejectUnauthorized: mode !== 'require' };
  if (caBase64) ssl.ca = Buffer.from(caBase64, 'base64').toString('utf8');
  else if (optionalEnv('PG_SSL_CA_FILE') && fs.existsSync(process.env.PG_SSL_CA_FILE)) ssl.ca = fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8');
  return ssl;
}

function getDatabaseConfig() {
  return {
    host: requireEnv('PG_HOST'),
    port: Number(optionalEnv('PG_PORT', '5432')),
    database: requireEnv('PG_DATABASE'),
    user: requireEnv('PG_USER'),
    password: requireEnv('PG_PASSWORD'),
    max: optionalNumber('PG_POOL_MAX', 20),
    ssl: resolvePgSslConfig()
  };
}

function getServiceBusConfig() {
  const authMode = optionalEnv('SERVICEBUS_AUTH_MODE', 'connection_string').toLowerCase();
  const queueName = requireEnv('SERVICEBUS_QUEUE_NAME');
  const ttlSeconds = optionalNumber('SERVICEBUS_MESSAGE_TTL_SECONDS', 300);
  const sessionsEnabled = optionalBoolean('SERVICEBUS_SESSIONS_ENABLED', false);
  if (authMode === 'managed_identity') {
    return { authMode, fullyQualifiedNamespace: requireEnv('SERVICEBUS_FQ_NAMESPACE'), queueName, ttlSeconds, sessionsEnabled };
  }
  return { authMode: 'connection_string', connectionString: requireEnv('SERVICEBUS_CONNECTION_STRING'), queueName, ttlSeconds, sessionsEnabled };
}

function getAdminAuthConfig(nodeEnv) {
  const mode = optionalEnv('ADMIN_AUTH_MODE', nodeEnv === 'production' ? 'oidc' : 'shared_secret').toLowerCase();
  const allowSharedSecretInProduction = optionalBoolean('ALLOW_ADMIN_SHARED_SECRET_IN_PRODUCTION', false);
  if (nodeEnv === 'production' && mode === 'shared_secret' && !allowSharedSecretInProduction) {
    throw new Error('ADMIN_AUTH_MODE=shared_secret is forbidden in production unless ALLOW_ADMIN_SHARED_SECRET_IN_PRODUCTION=true. Use OIDC.');
  }
  const sharedSecret = optionalEnv('ADMIN_API_SECRET');
  if (mode === 'shared_secret' && !sharedSecret) throw new Error('Missing ADMIN_API_SECRET for shared_secret admin auth.');
  if (mode === 'oidc') {
    requireEnv('ADMIN_OIDC_ISSUER');
    requireEnv('ADMIN_OIDC_AUDIENCE');
  }
  return {
    mode,
    sharedSecret,
    oidc: {
      issuer: optionalEnv('ADMIN_OIDC_ISSUER'),
      audience: optionalEnv('ADMIN_OIDC_AUDIENCE'),
      jwksUri: optionalEnv('ADMIN_OIDC_JWKS_URI'),
      requiredRoles: parseCsv(optionalEnv('ADMIN_OIDC_REQUIRED_ROLES', 'Bevoac.Admin')),
      clockToleranceSeconds: optionalNumber('ADMIN_OIDC_CLOCK_TOLERANCE_SECONDS', 60)
    }
  };
}

function getConfig() {
  const nodeEnv = optionalEnv('NODE_ENV', 'production');

  const runtimeMode = resolveRuntimeMode(
    optionalEnv('APP_RUNTIME_MODE', 'combined')
  );

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
    publishIntervalMs: optionalNumber(
      'OUTBOX_PUBLISH_INTERVAL_MS',
      5000
    ),
    batchSize: optionalNumber(
      'OUTBOX_PUBLISH_BATCH_SIZE',
      25
    ),
    maxAttempts: optionalNumber(
      'OUTBOX_MAX_ATTEMPTS',
      10
    ),
    baseBackoffSeconds: optionalNumber(
      'OUTBOX_BASE_BACKOFF_SECONDS',
      15
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

  return {
    nodeEnv,
    runtimeMode,
    host: optionalEnv('HOST', '0.0.0.0'),
    port: optionalNumber('PORT', 8080),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    allowedOrigins: parseOrigins(
      optionalEnv('ALLOWED_ORIGINS')
    ),
    apiRateLimitMax: optionalNumber(
      'API_RATE_LIMIT_MAX',
      60
    ),
    apiRateLimitWindow: optionalEnv(
      'API_RATE_LIMIT_WINDOW',
      '1 minute'
    ),
    adminRateLimitMax: optionalNumber(
      'ADMIN_RATE_LIMIT_MAX',
      20
    ),
    adminRateLimitWindow: optionalEnv(
      'ADMIN_RATE_LIMIT_WINDOW',
      '1 minute'
    ),
    postgres: getDatabaseConfig(),
    serviceBus: serviceBusRequired
      ? getServiceBusConfig()
      : null,
    outbox,
    adminApiSecret,
    adminAuth: adminApiEnabled
      ? getAdminAuthConfig(nodeEnv)
      : null,
    backpressure: {
      activeScanLimits: {
        free: optionalNumber(
          'ACTIVE_SCAN_LIMIT_FREE',
          1
        ),
        standard: optionalNumber(
          'ACTIVE_SCAN_LIMIT_STANDARD',
          3
        ),
        business: optionalNumber(
          'ACTIVE_SCAN_LIMIT_BUSINESS',
          10
        ),
        payg: optionalNumber(
          'ACTIVE_SCAN_LIMIT_PAYG',
          10
        )
      }
    },
    resultStore: {
      maxResultBytes: optionalNumber(
        'MAX_RESULT_JSON_BYTES',
        8 * 1024 * 1024
      ),
      currentMonthInlineResultMaxBytes: optionalNumber(
        'CURRENT_MONTH_INLINE_RESULT_MAX_BYTES',
        256 * 1024
      )
    },
    pdf: {
      timeoutMs: optionalNumber(
        'PDF_GENERATION_TIMEOUT_MS',
        20000
      ),
      maxFindings: optionalNumber(
        'PDF_MAX_FINDINGS',
        500
      ),
      maxEvidenceItems: optionalNumber(
        'PDF_MAX_EVIDENCE_ITEMS',
        1200
      ),
      maxInputBytes: optionalNumber(
        'PDF_MAX_INPUT_JSON_BYTES',
        5 * 1024 * 1024
      )
    },
    retention: {
      scanResultRetentionDays: optionalNumber(
        'SCAN_RESULT_RETENTION_DAYS',
        180
      ),
      failedScanRetentionDays: optionalNumber(
        'FAILED_SCAN_RETENTION_DAYS',
        90
      ),
      idempotencyRetentionDays: optionalNumber(
        'IDEMPOTENCY_RETENTION_DAYS',
        30
      ),
      onboardingSessionRetentionDays: optionalNumber(
        'ONBOARDING_SESSION_RETENTION_DAYS',
        30
      )
    },
    microsoft: {
      clientId: publicApiEnabled
        ? optionalEnv('MICROSOFT_CLIENT_ID')
        : '',
      clientSecret: publicApiEnabled
        ? optionalEnv('MICROSOFT_CLIENT_SECRET')
        : '',
      adminConsentScope: optionalEnv(
        'MICROSOFT_ADMIN_CONSENT_SCOPE',
        DEFAULT_MICROSOFT_ADMIN_CONSENT_SCOPE
      )
    },
    onboarding: publicApiEnabled
      ? {
          stateSecret: onboardingStateSecret,
          stateTtlMinutes: optionalNumber(
            'ONBOARDING_STATE_TTL_MINUTES',
            20
          ),
          apiPublicBaseUrl:
            onboardingRuntime.apiPublicBaseUrl,
          redirectUri:
            onboardingRuntime.redirectUri,
          frontendSuccessUrl: optionalEnv(
            'ONBOARDING_FRONTEND_SUCCESS_URL'
          ),
          azureRequestTimeoutMs: optionalNumber(
            'ONBOARDING_AZURE_REQUEST_TIMEOUT_MS',
            15000
          ),
          allowInferredRedirectUri: optionalBoolean(
            'ONBOARDING_ALLOW_INFER_REDIRECT_URI',
            nodeEnv !== 'production'
          )
        }
      : null,
    planQuotas: {
      free: optionalNumber(
        'DEFAULT_PLAN_FREE_QUOTA',
        30
      ),
      standard: optionalNumber(
        'DEFAULT_PLAN_STANDARD_QUOTA',
        2500
      ),
      business: optionalNumber(
        'DEFAULT_PLAN_BUSINESS_QUOTA',
        10000
      )
    },
    planResourceLimits: {
      free: optionalNumber(
        'DEFAULT_PLAN_FREE_RESOURCE_LIMIT',
        10
      ),
      standard: optionalNumber(
        'DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT',
        500
      ),
      business: optionalNumber(
        'DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT',
        2500
      ),
      payg: optionalEnv(
        'DEFAULT_PLAN_PAYG_RESOURCE_LIMIT'
      )
        ? optionalNumber(
            'DEFAULT_PLAN_PAYG_RESOURCE_LIMIT',
            null
          )
        : null
    },
    paygUnitPriceEur: optionalNumber(
      'PAYG_UNIT_PRICE_EUR',
      0.10
    )
  };
}

module.exports = {
  getConfig,
  getDatabaseConfig,
  resolvePgSslConfig,
  requireEnv,
  optionalBoolean,
  optionalNumber,
  normalizeHttpsUrl,
  buildOnboardingRedirectUri,
  resolveOnboardingRuntimeConfig
};
