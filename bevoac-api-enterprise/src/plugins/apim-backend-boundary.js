'use strict';

const fp = require('fastify-plugin');
const { ForbiddenError } = require('../lib/errors');
const { secureCompare } = require('../lib/security');
const {
  EXEMPT_PATHS,
  normalizedPath,
  isBoundaryExempt
} = require('../lib/apim-boundary');

module.exports = fp(async function apimBackendBoundaryPlugin(fastify) {
  const boundary = fastify.config.apimBackendBoundary;

  if (!boundary?.required) {
    fastify.log.warn('APIM backend boundary is disabled for this runtime.');
    return;
  }

  fastify.addHook('onRequest', async function enforceApimBoundary(request) {
    const path = normalizedPath(request.raw.url || request.url);
    if (isBoundaryExempt(path)) return;

    const provided = request.headers[boundary.headerName];
    if (!secureCompare(provided, boundary.sharedSecret)) {
      request.log.warn(
        { path, sourceIp: request.ip },
        'Rejected request that did not satisfy the APIM backend boundary.'
      );
      throw new ForbiddenError('Direct backend access is not allowed.');
    }
  });
});

module.exports.EXEMPT_PATHS = EXEMPT_PATHS;
module.exports.normalizedPath = normalizedPath;
module.exports.isBoundaryExempt = isBoundaryExempt;
