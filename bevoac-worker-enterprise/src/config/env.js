'use strict';

const fs = require('fs');

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  return value == null || String(value).trim() === ''
    ? fallback
    : String(value).trim();
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (value == null) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(
  name,
  fallback,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false
  } = {}
) {
  const value = optionalEnv(name);
  if (value == null) return fallback;

  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (integer && !Number.isInteger(parsed)) ||
    parsed < min ||
    parsed > max
  ) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return parsed;
}

function optionalInteger(name, fallback, options = {}) {
  return optionalNumber(name, fallback, {
    ...options,
    integer: true
  });
}

function optionalBoolean(name, fallback) {
  const value = optionalEnv(name);
  if (value == null) return fallback;
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment variable: ${name}`);
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePgSslConfig(
  nodeEnv = optionalEnv('NODE_ENV', 'production')
) {
  const mode = optionalEnv('PG_SSL_MODE', 'verify-full').toLowerCase();

  if (!['verify-full', 'require', 'disable'].includes(mode)) {
    throw new Error(
      'PG_SSL_MODE must be verify-full, require or disable.'
    );
  }

  if (mode === 'disable') {
    if (nodeEnv === 'production') {
      throw new Error('PG_SSL_MODE=disable is forbidden in production.');
    }
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

  const ssl = {
    rejectUnauthorized: mode !== 'require'
  };

  const caBase64 = optionalEnv('PG_SSL_CA_BASE64');
  const caFile = optionalEnv('PG_SSL_CA_FILE');

  if (caBase64) {
    ssl.ca = Buffer.from(caBase64, 'base64').toString('utf8');
  } else if (caFile) {
    if (!fs.existsSync(caFile)) {
      throw new Error(`PG_SSL_CA_FILE does not exist: ${caFile}`);
    }
    ssl.ca = fs.readFileSync(caFile, 'utf8');
  }

  return ssl;
}

function getDatabaseConfig(
  nodeEnv = optionalEnv('NODE_ENV', 'production')
) {
  return {
    host: requireEnv('PG_HOST'),
    port: optionalInteger('PG_PORT', 5432, { min: 1, max: 65535 }),
    database: requireEnv('PG_DATABASE'),
    user: requireEnv('PG_USER'),
    password: requireEnv('PG_PASSWORD'),
    max: optionalInteger('PG_POOL_MAX', 20, { min: 1, max: 200 }),
    idleTimeoutMillis: optionalInteger(
      'PG_IDLE_TIMEOUT_MS',
      30000,
      { min: 1000, max: 600000 }
    ),
    connectionTimeoutMillis: optionalInteger(
      'PG_CONNECTION_TIMEOUT_MS',
      10000,
      { min: 1000, max: 120000 }
    ),
    ssl: resolvePgSslConfig(nodeEnv)
  };
}

function getServiceBusConfig(nodeEnv) {
  const defaultMode =
    nodeEnv === 'production' ? 'managed_identity' : 'connection_string';

  const authMode = optionalEnv(
    'SERVICEBUS_AUTH_MODE',
    defaultMode
  ).toLowerCase();

  if (!['managed_identity', 'connection_string'].includes(authMode)) {
    throw new Error(
      'SERVICEBUS_AUTH_MODE must be managed_identity or connection_string.'
    );
  }

  const queueName = requireEnv('SERVICEBUS_QUEUE_NAME');
  const sessionsEnabled = optionalBoolean(
    'SERVICEBUS_SESSIONS_ENABLED',
    true
  );

  if (authMode === 'managed_identity') {
    return {
      authMode,
      fullyQualifiedNamespace: requireEnv('SERVICEBUS_FQ_NAMESPACE'),
      queueName,
      sessionsEnabled,
      maxDeliveryCount: optionalInteger(
        'SERVICEBUS_MAX_DELIVERY_COUNT',
        5,
        { min: 1, max: 100 }
      )
    };
  }

  if (
    nodeEnv === 'production' &&
    !optionalBoolean('ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK', false)
  ) {
    throw new Error(
      'SERVICEBUS_AUTH_MODE=connection_string requires ' +
      'ALLOW_SERVICEBUS_CONNECTION_STRING_ROLLBACK=true in production.'
    );
  }

  return {
    authMode,
    connectionString: requireEnv('SERVICEBUS_CONNECTION_STRING'),
    queueName,
    sessionsEnabled,
    maxDeliveryCount: optionalInteger(
      'SERVICEBUS_MAX_DELIVERY_COUNT',
      5,
      { min: 1, max: 100 }
    )
  };
}

function getConfig() {
  const nodeEnv = optionalEnv('NODE_ENV', 'production');

  const globalScanTimeoutSeconds = optionalInteger(
    'GLOBAL_SCAN_TIMEOUT_SECONDS',
    180,
    { min: 30, max: 7200 }
  );

  const pageSize = optionalInteger(
    'AZURE_RESOURCE_GRAPH_PAGE_SIZE',
    1000,
    { min: 1, max: 1000 }
  );

  const maxRows = optionalInteger(
    'AZURE_RESOURCE_GRAPH_MAX_ROWS',
    100000,
    { min: pageSize, max: 1000000 }
  );

  const maxPages = optionalInteger(
    'AZURE_RESOURCE_GRAPH_MAX_PAGES',
    Math.ceil(maxRows / pageSize),
    { min: 1, max: 10000 }
  );

  const allowedSchemes = parseCsv(
    optionalEnv('WEB_ALLOWED_SCHEMES', 'https:')
  );
  if (nodeEnv === 'production' && (
    allowedSchemes.length !== 1 || allowedSchemes[0] !== 'https:'
  )) {
    throw new Error('WEB_ALLOWED_SCHEMES must be exactly https: in production.');
  }

  const microsoftClientId = optionalEnv('MICROSOFT_CLIENT_ID');
  const microsoftClientSecret = optionalEnv('MICROSOFT_CLIENT_SECRET');
  if (nodeEnv === 'production') {
    if (!microsoftClientId) throw new Error('Missing required environment variable: MICROSOFT_CLIENT_ID');
    if (!microsoftClientSecret) throw new Error('Missing required environment variable: MICROSOFT_CLIENT_SECRET');
  }

  return {
    nodeEnv,
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    workerName: optionalEnv(
      'WORKER_NAME',
      'bevoac-worker-enterprise'
    ),
    receiverMaxConcurrentCalls: optionalInteger(
      'RECEIVER_MAX_CONCURRENT_CALLS',
      2,
      { min: 1, max: 128 }
    ),
    maxConcurrentTenantSessions: optionalInteger(
      'MAX_CONCURRENT_TENANT_SESSIONS',
      4,
      { min: 1, max: 128 }
    ),
    globalScanTimeoutSeconds,
    maxResultBytes: optionalInteger(
      'MAX_RESULT_JSON_BYTES',
      8 * 1024 * 1024,
      { min: 1024, max: 128 * 1024 * 1024 }
    ),
    resultCompressionThresholdBytes: optionalInteger(
      'RESULT_COMPRESSION_THRESHOLD_BYTES',
      512 * 1024,
      { min: 0, max: 128 * 1024 * 1024 }
    ),
    moduleTimeoutsMs: {
      webHeaders: optionalInteger('TIMEOUT_WEB_HEADERS_MS', 10000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      webDns: optionalInteger('TIMEOUT_WEB_DNS_MS', 8000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      webTls: optionalInteger('TIMEOUT_WEB_TLS_MS', 10000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      webNmap: optionalInteger('TIMEOUT_WEB_NMAP_MS', 30000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      entra: optionalInteger('TIMEOUT_ENTRA_MS', 60000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      azureInfra: optionalInteger('TIMEOUT_AZURE_INFRA_MS', 120000, {
        min: 1000,
        max: globalScanTimeoutSeconds * 1000
      }),
      resourcePreflight: optionalInteger(
        'TIMEOUT_RESOURCE_PREFLIGHT_MS',
        30000,
        { min: 1000, max: globalScanTimeoutSeconds * 1000 }
      )
    },
    networkGuard: {
      maxRedirects: optionalInteger('WEB_MAX_REDIRECTS', 2, {
        min: 0,
        max: 10
      }),
      allowedSchemes,
      blockedHosts: parseCsv(
        optionalEnv(
          'WEB_BLOCKED_HOSTS',
          'localhost,localhost.localdomain'
        )
      ),
      blockedCidrsExtra: parseCsv(
        optionalEnv('WEB_BLOCKED_CIDRS_EXTRA', '')
      )
    },
    planResourceLimits: {
      free: optionalInteger('DEFAULT_PLAN_FREE_RESOURCE_LIMIT', 10, {
        min: 1,
        max: 1000000
      }),
      standard: optionalInteger(
        'DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT',
        500,
        { min: 1, max: 1000000 }
      ),
      business: optionalInteger(
        'DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT',
        2500,
        { min: 1, max: 1000000 }
      ),
      payg: optionalEnv('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT')
        ? optionalInteger('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT', null, {
            min: 1,
            max: 1000000
          })
        : null
    },
    resourceGraph: {
      pageSize,
      maxRows,
      maxPages
    },
    postgres: getDatabaseConfig(nodeEnv),
    serviceBus: getServiceBusConfig(nodeEnv),
    microsoftClientId,
    microsoftClientSecret
  };
}

module.exports = {
  getConfig,
  getDatabaseConfig,
  resolvePgSslConfig,
  requireEnv,
  optionalNumber,
  optionalInteger,
  optionalBoolean
};
