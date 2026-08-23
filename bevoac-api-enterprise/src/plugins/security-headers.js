'use strict';

const fp = require('fastify-plugin');
const {
  shouldDisableCaching,
  headersForRequest
} = require('../lib/http-security-policy');

module.exports = fp(async function securityHeadersPlugin(fastify) {
  fastify.addHook('onSend', async function addSecurityHeaders(
    request,
    reply,
    payload
  ) {
    const headers = headersForRequest({
      url: request.raw.url,
      requestId: request.id,
      production: fastify.config.nodeEnv === 'production'
    });

    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }

    return payload;
  });
});

module.exports.shouldDisableCaching = shouldDisableCaching;
module.exports.headersForRequest = headersForRequest;
