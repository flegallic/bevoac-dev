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

async function buildServer() {
  const config = getConfig();

  if (!isHttpRuntime(config.runtimeMode)) {
    throw new Error(
      `APP_RUNTIME_MODE=${config.runtimeMode} cannot start the HTTP server.`
    );
  }

  const publicApiEnabled =
    runtimeSupportsPublicApi(config.runtimeMode);

  const adminApiEnabled =
    runtimeSupportsAdminApi(config.runtimeMode);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty' }
          : undefined
    },
    bodyLimit: 1024 * 1024
  });

  app.decorate('config', config);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      if (config.allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error('Origin not allowed'), false);
    }
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
    if (error.validation) {
      const details =
        config.nodeEnv === 'production'
          ? null
          : error.validation;

      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        details
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: sanitizeErrorDetails(
          error,
          config.nodeEnv
        )
      });
    }

    request.log.error(
      { err: error },
      'Unhandled error'
    );

    return reply.code(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.'
    });
  });

  await app.register(
    require('./routes/health'),
    { prefix: '/v1' }
  );

  if (publicApiEnabled) {
    await app.register(
      require('./routes/scans'),
      { prefix: '/v1' }
    );

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
  start
};
