const { guardedHead } = require('../../src/lib/network-guard');

function getHeader(headers, name) {
  const value = headers?.[String(name).toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return value || null;
}

function computeScore(missing) {
  if (missing.length === 0) return 'A';
  if (missing.includes('CSP')) return 'C';
  return 'B';
}

async function checkHeaders(targetUrl, options = {}) {
  try {
    const guarded = await guardedHead(targetUrl, {
      timeoutMs: options.timeoutMs || 10000,
      maxRedirects: options.maxRedirects ?? 2,
      guardConfig: options.guardConfig || {}
    });

    if (guarded.error) {
      return {
        error: `Failed to fetch headers: ${guarded.error.message}`,
        finalUrl: guarded.finalUrl || null,
        resolvedAddresses: guarded.targetInfo?.resolvedAddresses || []
      };
    }

    const response = guarded.response;
    const securityHeaders = {
      'strict-transport-security': getHeader(response.headers, 'strict-transport-security'),
      'content-security-policy': getHeader(response.headers, 'content-security-policy'),
      'x-frame-options': getHeader(response.headers, 'x-frame-options'),
      'x-content-type-options': getHeader(response.headers, 'x-content-type-options')
    };

    const missing = [];
    if (!securityHeaders['strict-transport-security']) missing.push('HSTS');
    if (!securityHeaders['content-security-policy']) missing.push('CSP');
    if (!securityHeaders['x-frame-options']) missing.push('X-Frame-Options');
    if (!securityHeaders['x-content-type-options']) missing.push('X-Content-Type-Options');

    return {
      score: computeScore(missing),
      statusCode: response.statusCode,
      finalUrl: guarded.finalUrl,
      resolvedAddresses: guarded.targetInfo.resolvedAddresses,
      missing,
      headers_found: securityHeaders,
      server_leak: getHeader(response.headers, 'server') || getHeader(response.headers, 'x-powered-by') || null
    };
  } catch (error) {
    return { error: `Failed to fetch headers: ${error.message}` };
  }
}

module.exports = { checkHeaders };
