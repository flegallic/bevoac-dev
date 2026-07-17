'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function safePercent(numerator, denominator) {
  const n = finiteNumber(numerator, 0);
  const d = finiteNumber(denominator, 0);
  if (d <= 0) return null;
  return clampPercent((n / d) * 100);
}

function statusFromCoverage(valuePct, thresholds = {}) {
  if (valuePct === null || valuePct === undefined) return 'UNKNOWN';
  const criticalBelow = finiteNumber(thresholds.criticalBelow, 70);
  const warningBelow = finiteNumber(thresholds.warningBelow, 90);
  if (valuePct < criticalBelow) return 'FAIL';
  if (valuePct < warningBelow) return 'WARN';
  return 'PASS';
}

function statusFromRiskCount(count, thresholds = {}) {
  const n = finiteNumber(count, 0);
  const criticalAt = finiteNumber(thresholds.criticalAt, Number.POSITIVE_INFINITY);
  const warningAt = finiteNumber(thresholds.warningAt, 1);
  if (n >= criticalAt) return 'FAIL';
  if (n >= warningAt) return 'WARN';
  return 'PASS';
}

function buildKpi({
  kpiId,
  label,
  domain,
  numerator = null,
  denominator = null,
  valuePct = null,
  value = null,
  unit = null,
  status = null,
  threshold = null,
  evidenceSource = null,
  limitations = [],
  recommendation = null
}) {
  const computedPct = valuePct !== null && valuePct !== undefined ? clampPercent(Number(valuePct)) : safePercent(numerator, denominator);
  return {
    kpiId,
    label,
    domain,
    numerator: numerator === null || numerator === undefined ? null : finiteNumber(numerator, 0),
    denominator: denominator === null || denominator === undefined ? null : finiteNumber(denominator, 0),
    valuePct: computedPct,
    value: value === null || value === undefined ? null : value,
    unit: unit || (computedPct !== null ? 'percent' : null),
    status: status || statusFromCoverage(computedPct, threshold || {}),
    threshold: threshold || null,
    evidenceSource: evidenceSource || null,
    limitations: asArray(limitations),
    recommendation: recommendation || null
  };
}

function coverageKpi({ kpiId, label, domain, compliant, total, evidenceSource, warningBelow = 90, criticalBelow = 70, recommendation = null, limitations = [] }) {
  const threshold = { warningBelow, criticalBelow };
  const valuePct = safePercent(compliant, total);
  return buildKpi({
    kpiId,
    label,
    domain,
    numerator: compliant,
    denominator: total,
    valuePct,
    status: statusFromCoverage(valuePct, threshold),
    threshold,
    evidenceSource,
    recommendation,
    limitations
  });
}

function riskCountKpi({ kpiId, label, domain, count, evidenceSource, warningAt = 1, criticalAt = 10, recommendation = null, limitations = [] }) {
  const threshold = { warningAt, criticalAt };
  return buildKpi({
    kpiId,
    label,
    domain,
    value: finiteNumber(count, 0),
    unit: 'count',
    status: statusFromRiskCount(count, threshold),
    threshold,
    evidenceSource,
    recommendation,
    limitations
  });
}

function mergeKpis(...groups) {
  return groups.flatMap((group) => {
    if (!group) return [];
    if (Array.isArray(group)) return group;
    if (typeof group === 'object') return [group];
    return [];
  }).filter(Boolean);
}

function countChecksByStatus(checks) {
  const counters = { PASSED: 0, FAILED: 0, WARNING: 0, INFO: 0, UNKNOWN: 0 };
  for (const check of asArray(checks)) {
    const status = String(check?.status || 'UNKNOWN').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(counters, status)) counters[status] += 1;
    else counters.UNKNOWN += 1;
  }
  return counters;
}

function buildModuleEvidenceMetadata(moduleName, result, resourceTypes = []) {
  return {
    moduleName,
    generatedAt: new Date().toISOString(),
    executionStatus: result?.executionStatus || result?.status || 'UNKNOWN',
    partialErrorsCount: finiteNumber(result?.summary?.partialErrorsCount || result?.details?.partialErrors?.length, 0),
    resourceTypesCovered: asArray(resourceTypes)
  };
}

function buildScanScorecard(scanResult) {
  const allKpis = [];
  const add = (moduleName, moduleResult) => {
    for (const kpi of asArray(moduleResult?.kpis)) {
      allKpis.push({ ...kpi, sourceModule: moduleName });
    }
  };

  add('web', scanResult?.webSecurity);
  add('entra', scanResult?.microsoft_entra);
  add('identity_admin_posture', scanResult?.identity_admin_posture);

  const infraModules = scanResult?.azure_infrastructure?.modules || {};
  for (const [moduleName, moduleResult] of Object.entries(infraModules)) add(moduleName, moduleResult);

  const byStatus = allKpis.reduce((acc, kpi) => {
    const status = kpi.status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    totalKpis: allKpis.length,
    byStatus,
    kpis: allKpis
  };
}

module.exports = {
  asArray,
  finiteNumber,
  safePercent,
  buildKpi,
  coverageKpi,
  riskCountKpi,
  mergeKpis,
  countChecksByStatus,
  buildModuleEvidenceMetadata,
  buildScanScorecard,
  statusFromCoverage,
  statusFromRiskCount
};
