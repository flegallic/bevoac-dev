// scanners/lib/status-semantics.js

const HIGH_RISK = new Set(['HIGH', 'CRITICAL']);
const WARN_RISK = new Set(['MEDIUM', 'LOW']);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getPartialErrorsCount(details = {}) {
  return toArray(details.partialErrors).length;
}

function getAnalyzedCount(moduleResult = {}) {
  const numericKeys = [
    'storage_accounts_analyzed',
    'nsgs_analyzed',
    'vms_analyzed',
    'vaults_analyzed',
    'workspaces_analyzed',
    'databases_analyzed',
    'apps_analyzed',
    'subscriptions_analyzed',
    'duration_ms',
    'totalResourcesScanned'
  ];

  for (const key of numericKeys) {
    if (typeof moduleResult[key] === 'number' && !Number.isNaN(moduleResult[key])) {
      if (key === 'duration_ms') continue;
      return moduleResult[key];
    }
  }

  if (moduleResult.summary && typeof moduleResult.summary === 'object') {
    const summaryKeys = [
      'totalStorageAccounts',
      'totalNsgs',
      'totalVMs',
      'totalVaults',
      'totalWorkspaces',
      'totalDbs',
      'totalApps',
      'totalSubscriptions',
      'totalGuests',
      'totalResourcesScanned'
    ];

    for (const key of summaryKeys) {
      if (typeof moduleResult.summary[key] === 'number' && !Number.isNaN(moduleResult.summary[key])) {
        return moduleResult.summary[key];
      }
    }
  }

  return 0;
}

function getChecks(moduleResult = {}) {
  return toArray(moduleResult.checks);
}

function computeExecutionStatus(moduleResult = {}) {
  const rawStatus = String(moduleResult.status || '').toUpperCase();
  const partialErrorsCount = getPartialErrorsCount(moduleResult.details);
  const analyzedCount = getAnalyzedCount(moduleResult);

  if (moduleResult.error) return 'FAILED';
  if (rawStatus === 'NOT_IMPLEMENTED') return 'FAILED';

  // Cas bloquant : le module a rencontré des erreurs et n'a rien réellement analysé.
  if (partialErrorsCount > 0 && analyzedCount === 0) return 'FAILED';

  // Cas bloquant explicite du module.
  if (rawStatus === 'FAILED' && analyzedCount === 0) return 'FAILED';

  return 'SUCCESS';
}

function computeSecurityPosture(moduleResult = {}) {
  const executionStatus = computeExecutionStatus(moduleResult);
  const partialErrorsCount = getPartialErrorsCount(moduleResult.details);
  const checks = getChecks(moduleResult);

  if (executionStatus === 'FAILED') {
    return 'FAIL';
  }

  let hasFailHigh = false;
  let hasWarn = false;

  for (const check of checks) {
    const checkStatus = String(check.status || '').toUpperCase();
    const severity = String(check.severity || 'LOW').toUpperCase();

    if (checkStatus !== 'FAILED') continue;

    if (HIGH_RISK.has(severity)) {
      hasFailHigh = true;
      break;
    }

    if (WARN_RISK.has(severity) || severity === 'INFO') {
      hasWarn = true;
    }
  }

  if (hasFailHigh) return 'FAIL';
  if (hasWarn || partialErrorsCount > 0) return 'WARN';

  return 'PASS';
}

function decorateModuleStatus(moduleResult = {}) {
  return {
    ...moduleResult,
    executionStatus: computeExecutionStatus(moduleResult),
    securityPosture: computeSecurityPosture(moduleResult)
  };
}

function rollupExecutionStatus(modules = {}) {
  const values = Object.values(modules).map((moduleResult) =>
    moduleResult.executionStatus || computeExecutionStatus(moduleResult)
  );

  return values.includes('FAILED') ? 'FAILED' : 'SUCCESS';
}

function rollupSecurityPosture(modules = {}) {
  const values = Object.values(modules).map((moduleResult) =>
    moduleResult.securityPosture || computeSecurityPosture(moduleResult)
  );

  if (values.includes('FAIL')) return 'FAIL';
  if (values.includes('WARN')) return 'WARN';
  return 'PASS';
}

module.exports = {
  computeExecutionStatus,
  computeSecurityPosture,
  decorateModuleStatus,
  rollupExecutionStatus,
  rollupSecurityPosture
};