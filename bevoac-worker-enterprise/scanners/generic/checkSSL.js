const tls = require('tls');
const { assertPublicHttpTarget } = require('../../src/lib/network-guard');
const { sanitizeString } = require('../../src/lib/result-sanitizer');
const { throwIfAborted } = require('../../src/lib/abort');

async function checkSSL(targetUrl, options = {}) {
  return new Promise(async (resolve) => {
    let target;
    let socket;
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener?.('abort', onAbort);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket?.destroy();
      resolve(value);
    };
    const onAbort = () => finish({ error: 'TLS scan aborted', errorCode: 'ABORT_ERR' });

    try {
      throwIfAborted(options.signal, 'TLS scan');
      target = await assertPublicHttpTarget(targetUrl, options.guardConfig || {});
      throwIfAborted(options.signal, 'TLS scan');
    } catch (error) {
      return finish({ error: sanitizeString(`Invalid or blocked TLS target: ${error.message}`), errorCode: error.code || null });
    }

    socket = tls.connect({
      host: target.pinnedAddress,
      port: target.parsed.port || 443,
      servername: target.hostname,
      rejectUnauthorized: false
    }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError || null;
      if (!cert || Object.keys(cert).length === 0) return finish({ error: 'No certificate found' });
      const validTo = new Date(cert.valid_to);
      const daysRemaining = Math.floor((validTo - new Date()) / (1000 * 60 * 60 * 24));
      finish({
        valid: daysRemaining > 0 && authorized,
        chain_valid: authorized,
        authorization_error: authorizationError,
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        subject: cert.subject?.CN || null,
        expires_in_days: daysRemaining,
        expiration_date: cert.valid_to,
        resolvedAddresses: target.resolvedAddresses
      });
    });

    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    socket.on('error', (err) => finish({ error: sanitizeString(`TLS Error: ${err.message}`) }));
    socket.setTimeout(options.timeoutMs || 10000, () => finish({ error: 'TLS connection timeout' }));
  });
}

module.exports = { checkSSL };
