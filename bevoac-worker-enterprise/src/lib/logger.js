const pino = require('pino');

function buildLogger(config) {
  return pino({
    level: config.logLevel,
    transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    base: { service: config.workerName }
  });
}

module.exports = { buildLogger };
