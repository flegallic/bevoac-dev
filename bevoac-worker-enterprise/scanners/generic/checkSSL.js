const tls = require('tls');
const { assertPublicHttpTarget } = require('../../src/lib/network-guard');

async function checkSSL(targetUrl, options = {}) {
  return new Promise(async (resolve) => {
    let target;
    try {
      target = await assertPublicHttpTarget(targetUrl, options.guardConfig || {});
    } catch (error) {
      return resolve({ error: `Invalid or blocked TLS target: ${error.message}` });
    }
    const socket = tls.connect({
      host: target.pinnedAddress,
      port: target.parsed.port || 443,
      servername: target.hostname,
      rejectUnauthorized: false
    }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError || null;
      if (!cert || Object.keys(cert).length === 0) {
        socket.destroy();
        return resolve({ error: 'No certificate found' });
      }
      const validTo = new Date(cert.valid_to);
      const now = new Date();
      const daysRemaining = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
      socket.destroy();
      resolve({
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
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ error: `TLS Error: ${err.message}` });
    });
    socket.setTimeout(options.timeoutMs || 10000, () => {
      socket.destroy();
      resolve({ error: 'TLS connection timeout' });
    });
  });
}

module.exports = { checkSSL };
