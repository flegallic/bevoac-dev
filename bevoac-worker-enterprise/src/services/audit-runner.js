'use strict';

const { checkHeaders } = require('../../scanners/generic/checkHeaders');
const { checkSSL } = require('../../scanners/generic/checkSSL');
const { checkDNS } = require('../../scanners/generic/checkDNS');
const { runNmap } = require('../../scanners/generic/runNmap');
const { auditEntraID } = require('../../scanners/azure/checkEntraID');
const { auditIdentityAdminPosture } = require('../../scanners/azure/identity_admin_posture');
const { auditAzureInfra, MODULE_REGISTRY } = require('../../scanners/azure/azureInfra');
const { settleModule, withTimeout } = require('../lib/module-timeout');
const { withRetry } = require('../lib/retry');
const { enhanceModuleResult } = require('../lib/module-enhancers');
const { buildScanScorecard } = require('../lib/kpi-engine');

function buildWebFindings(targetUrl, dnsRes, sslRes, headersRes, nmapRes) {
  const findings = [];
  if (dnsRes.error) findings.push({ id: 'DNS-ERROR-001', area: 'DNS', status: 'FAILED', severity: 'MEDIUM', description: dnsRes.error, recommendation: 'Verifier la resolution DNS, la garde SSRF et la presence des enregistrements TXT/SPF.' });
  else if (!dnsRes.spf_configured) findings.push({ id: 'DNS-SPF-001', area: 'DNS', status: 'FAILED', severity: 'MEDIUM', description: `Aucun SPF detecte pour ${targetUrl}.`, recommendation: 'Publier un enregistrement SPF restrictif pour reduire le spoofing.' });
  if (sslRes.error) findings.push({ id: 'TLS-ERROR-001', area: 'TLS', status: 'FAILED', severity: 'HIGH', description: sslRes.error, recommendation: 'Verifier le certificat TLS, le SNI, la chaine CA et l\'accessibilite du port 443.' });
  else if (sslRes.valid === false) findings.push({ id: 'TLS-VALIDITY-001', area: 'TLS', status: 'FAILED', severity: 'HIGH', description: `Le certificat TLS n'est pas completement valide. Expiration: ${sslRes.expiration_date || 'n/a'}, erreur chaine: ${sslRes.authorization_error || 'n/a'}.`, recommendation: 'Renouveler le certificat et corriger la chaine de confiance / hostname.' });
  else if (typeof sslRes.expires_in_days === 'number' && sslRes.expires_in_days <= 30) findings.push({ id: 'TLS-EXP-002', area: 'TLS', status: 'WARNING', severity: 'LOW', description: `Le certificat TLS expire dans ${sslRes.expires_in_days} jours.`, recommendation: 'Planifier le renouvellement du certificat avant expiration.' });
  if (headersRes.error) findings.push({ id: 'HDR-ERROR-001', area: 'HTTP Headers', status: 'FAILED', severity: 'MEDIUM', description: headersRes.error, recommendation: 'Verifier la disponibilite HTTPS, les redirections et la reponse HEAD/GET du site.' });
  else {
    const missing = headersRes.missing || [];
    if (missing.includes('CSP')) findings.push({ id: 'HDR-CSP-001', area: 'HTTP Headers', status: 'FAILED', severity: 'HIGH', description: 'Absence de Content-Security-Policy.', recommendation: 'Ajouter une CSP stricte adaptee au front.' });
    if (missing.includes('HSTS')) findings.push({ id: 'HDR-HSTS-001', area: 'HTTP Headers', status: 'FAILED', severity: 'MEDIUM', description: 'Absence de Strict-Transport-Security.', recommendation: 'Activer HSTS avec une duree suffisante.' });
    if (headersRes.server_leak) findings.push({ id: 'HDR-SERVER-001', area: 'HTTP Headers', status: 'WARNING', severity: 'LOW', description: `Le header expose potentiellement la stack serveur: ${headersRes.server_leak}.`, recommendation: 'Limiter les fuites d’information dans les headers de reponse.' });
  }
  if (nmapRes.error) findings.push({ id: 'NMAP-ERROR-001', area: 'Network Exposure', status: 'WARNING', severity: 'LOW', description: nmapRes.error, recommendation: 'Verifier que le scan reseau est autorise et que la cible est joignable.' });
  else {
    const risky = (nmapRes.open_ports || []).filter((item) => ![80, 443].includes(Number(item.port)));
    if (risky.length > 0) findings.push({ id: 'NMAP-PORTS-001', area: 'Network Exposure', status: 'WARNING', severity: 'MEDIUM', description: `Ports supplementaires ouverts detectes: ${risky.map((i) => i.port).join(', ')}.`, recommendation: 'Verifier que ces ports sont attendus et restreints aux flux necessaires.' });
  }
  return findings;
}

async function runAudit({ targetUrl, microsoftTenantId, subscriptions, requestedModules, infraCredential, timeoutMs, logger, moduleTimeoutsMs = {}, networkGuard = {} }) {
  const startedAt = Date.now();
  const result = { durationMs: null, webSecurity: null, microsoft_entra: null, identity_admin_posture: null, azure_infrastructure: null, kpiScorecard: null, moduleTimings: {}, error: null };
  async function timed(label, timeout, fn) {
    const start = Date.now();
    const value = await settleModule(label, timeout, fn);
    result.moduleTimings[label] = Date.now() - start;
    return value;
  }
  try {
    await withTimeout('global scan', timeoutMs, async () => {
      if (requestedModules.includes('web') && targetUrl) {
        logger.info({ targetUrl }, 'Running guarded web scanners.');
        const [headersRes, sslRes, dnsRes, nmapRes] = await Promise.all([
          timed('web.headers', moduleTimeoutsMs.webHeaders || 10000, () => checkHeaders(targetUrl, { timeoutMs: moduleTimeoutsMs.webHeaders || 10000, maxRedirects: networkGuard.maxRedirects, guardConfig: networkGuard })),
          timed('web.tls', moduleTimeoutsMs.webTls || 10000, () => checkSSL(targetUrl, { timeoutMs: moduleTimeoutsMs.webTls || 10000, guardConfig: networkGuard })),
          timed('web.dns', moduleTimeoutsMs.webDns || 8000, () => checkDNS(targetUrl, { guardConfig: networkGuard })),
          timed('web.nmap', moduleTimeoutsMs.webNmap || 30000, () => runNmap(targetUrl, { timeoutMs: moduleTimeoutsMs.webNmap || 30000, guardConfig: networkGuard }))
        ]);
        const webSecurity = {
          executionStatus: 'SUCCESS',
          status: 'SUCCESS',
          raw: { headers: headersRes, ssl: sslRes, dns: dnsRes, nmap: nmapRes },
          findings: buildWebFindings(targetUrl, dnsRes, sslRes, headersRes, nmapRes)
        };
        webSecurity.checks = webSecurity.findings;
        result.webSecurity = enhanceModuleResult('web', webSecurity, ['DNS', 'TLS', 'HTTP Headers', 'Network Exposure']);
      }
      if (requestedModules.includes('entra') && microsoftTenantId) {
        logger.info({ microsoftTenantId }, 'Running Entra audit with retry/backoff.');
        const entraResult = await timed('entra', moduleTimeoutsMs.entra || 60000, () => withRetry(() => auditEntraID(microsoftTenantId), { label: 'graph.entra.audit', retries: 2, logger }));
        result.microsoft_entra = enhanceModuleResult('entra', entraResult, ['Microsoft Graph/users', 'Microsoft Graph/directoryRoles', 'Microsoft Graph/reports']);
      }
      if (requestedModules.includes('identity_admin_posture') && microsoftTenantId) {
        logger.info({ microsoftTenantId }, 'Running privileged identity admin posture audit.');
        result.identity_admin_posture = await timed('identity_admin_posture', moduleTimeoutsMs.entra || 60000, () => withRetry(() => auditIdentityAdminPosture(microsoftTenantId, infraCredential), { label: 'graph.identity.admin_posture', retries: 2, logger }));
      }
      const infraModules = requestedModules.filter((item) => Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, item));
      if (infraModules.length > 0) {
        logger.info({ infraModules, subscriptionsCount: Array.isArray(subscriptions) ? subscriptions.length : 0 }, 'Running Azure infrastructure audit with retry/backoff.');
        if (!infraCredential) throw new Error('Azure infrastructure modules were requested but no cross-tenant credential could be created.');
        result.azure_infrastructure = await timed('azure.infra', moduleTimeoutsMs.azureInfra || 120000, () => withRetry(() => auditAzureInfra(subscriptions || [], infraCredential, infraModules, microsoftTenantId || null, { logger }), { label: 'azure.infra.audit', retries: 2, logger }));
      }
    });
  } catch (error) { result.error = error.message; }
  result.kpiScorecard = buildScanScorecard(result);
  result.durationMs = Date.now() - startedAt;
  return result;
}
module.exports = { runAudit, buildWebFindings };
