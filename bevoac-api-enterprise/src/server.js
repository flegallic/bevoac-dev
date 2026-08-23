'use strict';

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const { getConfig } = require('./config/env');
const { AppError } = require('./lib/errors');
const { hashApiKey } = require('./lib/security');
const { sanitizeErrorDetails } = require('./lib/error-sanitizer');
const {
  isHttpRuntime,
  runtimeSupportsPublicApi,
  runtimeSupportsAdminApi
} = require('./lib/runtime-mode');

function errorBody({ code, message, details = null, request }) {
  return {
    error: code,
    message,
    details,
    correlationId: request.id
  };
}

async function buildServer() {
  const config = getConfig();

  if (!isHttpRuntime(config.runtimeMode)) {
    throw new Error(
      `APP_RUNTIME_MODE=${config.runtimeMode} cannot start the HTTP server.`
    );
  }

  const publicApiEnabled = runtimeSupportsPublicApi(config.runtimeMode);
  const adminApiEnabled = runtimeSupportsAdminApi(config.runtimeMode);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-admin-secret',
          'req.headers.x-bevoac-backend-token',
          'headers.authorization',
          'headers.x-admin-secret',
          'headers.x-bevoac-backend-token',
          '*.password',
          '*.clientSecret',
          '*.connectionString',
          '*.token'
        ],
        censor: '[REDACTED]'
      },
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty' }
          : undefined
    },
    bodyLimit: config.http.bodyLimitBytes,
    requestIdHeader: 'x-correlation-id',
    genReqId(request) {
      const supplied = request.headers['x-correlation-id'];
      if (
        supplied &&
        /^[A-Za-z0-9._:-]{8,128}$/.test(String(supplied))
      ) {
        return String(supplied);
      }
      return cryptoRandomUuid();
    }
  });

  app.decorate('config', config);

  await app.register(require('./plugins/security-headers'));

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'), false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Correlation-ID'
    ],
    maxAge: 600
  });

  const adminOnly = config.runtimeMode === 'admin_api';

  await app.register(rateLimit, {
    max: adminOnly
      ? config.adminRateLimitMax
      : config.apiRateLimitMax,
    timeWindow: adminOnly
      ? config.adminRateLimitWindow
      : config.apiRateLimitWindow,
    keyGenerator: (request) => {
      const rawAuthorization =
        request.headers.authorization || 'anonymous';
      const keyHash =
        rawAuthorization === 'anonymous'
          ? 'anonymous'
          : hashApiKey(rawAuthorization);
      return `${request.ip}:${keyHash}`;
    }
  });

  if (publicApiEnabled) {
    await app.register(require('./plugins/apim-backend-boundary'));
  }

  await app.register(require('./plugins/swagger'));
  await app.register(require('./plugins/postgres'));

  if (config.serviceBus) {
    await app.register(require('./plugins/servicebus'));
  }

  const needsEmbeddedOutbox =
    publicApiEnabled &&
    (
      config.outbox.publisherEnabled !== false ||
      config.outbox.immediatePublishAfterRequest !== false
    );

  if (needsEmbeddedOutbox) {
    if (!config.serviceBus) {
      throw new Error(
        'Embedded outbox publishing requires Service Bus configuration.'
      );
    }
    await app.register(require('./plugins/outbox-publisher'));
  }

  if (publicApiEnabled) {
    await app.register(require('./plugins/auth-api-key'));
  }

  if (adminApiEnabled) {
    await app.register(require('./plugins/auth-admin'));
  }

  app.setErrorHandler((error, request, reply) => {
    reply.header('X-Correlation-ID', request.id);

    if (error.validation) {
      const details =
        config.nodeEnv === 'production' ? null : error.validation;
      return reply.code(400).send(errorBody({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details,
        request
      }));
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody({
        code: error.code,
        message: error.message,
        details: sanitizeErrorDetails(error, config.nodeEnv),
        request
      }));
    }

    request.log.error(
      { err: error, correlationId: request.id },
      'Unhandled error'
    );

    return reply.code(500).send(errorBody({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
      request
    }));
  });

  await app.register(require('./routes/health'), { prefix: '/v1' });

  if (publicApiEnabled) {
    await app.register(require('./routes/scans'), { prefix: '/v1' });
    await app.register(
      require('./routes/onboarding-azure'),
      { prefix: '/v1' }
    );
  }

  if (adminApiEnabled) {
    await app.register(
      require('./routes/admin-billing'),
      { prefix: '/v1' }
    );
  }

  return app;
}

function cryptoRandomUuid() {
  return require('crypto').randomUUID();
}

async function start() {
  const app = await buildServer();
  await app.listen({
    host: app.config.host,
    port: app.config.port
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildServer,
  start,
  errorBody
};
