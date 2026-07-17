const fs = require('fs');

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (value == null) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalNumber(name, fallback) {
  const value = optionalEnv(name);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric environment variable: ${name}`);
  return parsed;
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
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function resolvePgSslConfig() {
  const mode = optionalEnv('PG_SSL_MODE', 'verify-full');
  if (mode === 'disable') return false;
  const ssl = { rejectUnauthorized: mode !== 'require' };
  const caBase64 = optionalEnv('PG_SSL_CA_BASE64');
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

function getConfig() {
  const serviceBusAuthMode = optionalEnv('SERVICEBUS_AUTH_MODE', 'connection_string').toLowerCase();
  return {
    nodeEnv: optionalEnv('NODE_ENV', 'production'),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    workerName: optionalEnv('WORKER_NAME', 'bevoac-worker-enterprise'),
    receiverMaxConcurrentCalls: optionalNumber('RECEIVER_MAX_CONCURRENT_CALLS', 2),
    maxConcurrentTenantSessions: optionalNumber('MAX_CONCURRENT_TENANT_SESSIONS', 4),
    globalScanTimeoutSeconds: optionalNumber('GLOBAL_SCAN_TIMEOUT_SECONDS', 180),
    maxResultBytes: optionalNumber('MAX_RESULT_JSON_BYTES', 8 * 1024 * 1024),
    resultCompressionThresholdBytes: optionalNumber('RESULT_COMPRESSION_THRESHOLD_BYTES', 512 * 1024),
    moduleTimeoutsMs: {
      webHeaders: optionalNumber('TIMEOUT_WEB_HEADERS_MS', 10000),
      webDns: optionalNumber('TIMEOUT_WEB_DNS_MS', 8000),
      webTls: optionalNumber('TIMEOUT_WEB_TLS_MS', 10000),
      webNmap: optionalNumber('TIMEOUT_WEB_NMAP_MS', 30000),
      entra: optionalNumber('TIMEOUT_ENTRA_MS', 60000),
      azureInfra: optionalNumber('TIMEOUT_AZURE_INFRA_MS', 120000),
      resourcePreflight: optionalNumber('TIMEOUT_RESOURCE_PREFLIGHT_MS', 30000)
    },
    networkGuard: {
      maxRedirects: optionalNumber('WEB_MAX_REDIRECTS', 2),
      allowedSchemes: parseCsv(optionalEnv('WEB_ALLOWED_SCHEMES', 'https:')),
      blockedHosts: parseCsv(optionalEnv('WEB_BLOCKED_HOSTS', 'localhost,localhost.localdomain')),
      blockedCidrsExtra: parseCsv(optionalEnv('WEB_BLOCKED_CIDRS_EXTRA', ''))
    },
    planResourceLimits: {
      free: optionalNumber('DEFAULT_PLAN_FREE_RESOURCE_LIMIT', 10),
      standard: optionalNumber('DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT', 500),
      business: optionalNumber('DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT', 2500),
      payg: optionalEnv('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT') ? optionalNumber('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT', null) : null
    },
    postgres: getDatabaseConfig(),
    serviceBus: {
      authMode: serviceBusAuthMode,
      connectionString: serviceBusAuthMode === 'managed_identity' ? null : requireEnv('SERVICEBUS_CONNECTION_STRING'),
      fullyQualifiedNamespace: serviceBusAuthMode === 'managed_identity' ? requireEnv('SERVICEBUS_FQ_NAMESPACE') : null,
      queueName: requireEnv('SERVICEBUS_QUEUE_NAME'),
      sessionsEnabled: optionalBoolean('SERVICEBUS_SESSIONS_ENABLED', false)
    },
    microsoftClientId: optionalEnv('MICROSOFT_CLIENT_ID'),
    microsoftClientSecret: optionalEnv('MICROSOFT_CLIENT_SECRET')
  };
}

module.exports = { getConfig, getDatabaseConfig, resolvePgSslConfig, requireEnv, optionalNumber, optionalBoolean };
