'use strict';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'];
const RESULT_SECTION_FLAGS = [
  ['webSecurity', 'hasWeb'],
  ['microsoft_entra', 'hasEntra'],
  ['identity_admin_posture', 'hasIdentityAdminPosture'],
  ['azure_infrastructure', 'hasAzureInfra'],
  ['aws_infrastructure', 'hasAwsInfra']
];

function emptySeveritySummary() {
  return SEVERITIES.reduce((acc, severity) => {
    acc[severity] = 0;
    return acc;
  }, {});
}

function normalizeSeverity(value) {
  const normalized = String(value || 'UNKNOWN').trim().toUpperCase();
  return SEVERITIES.includes(normalized) ? normalized : 'UNKNOWN';
}

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
}

function looksLikeFinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, 'severity') && (
    Object.prototype.hasOwnProperty.call(value, 'title') ||
    Object.prototype.hasOwnProperty.call(value, 'controlId') ||
    Object.prototype.hasOwnProperty.call(value, 'resourceId') ||
    Object.prototype.hasOwnProperty.call(value, 'recommendation') ||
    Object.prototype.hasOwnProperty.call(value, 'remediation')
  );
}

function collectFindings(input, options = {}) {
  const maxDepth = Number(options.maxDepth || 8);
  const maxFindings = Number(options.maxFindings || 20000);
  const findings = [];
  const visited = new WeakSet();

  function visit(value, path, depth) {
    if (findings.length >= maxFindings) return;
    if (value == null || depth > maxDepth) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) visit(value[i], `${path}[${i}]`, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (looksLikeFinding(value)) {
      findings.push({ ...value, severity: normalizeSeverity(value.severity), status: normalizeStatus(value.status), _sourcePath: path });
      return;
    }

    if (Array.isArray(value.findings)) {
      for (let i = 0; i < value.findings.length; i += 1) visit(value.findings[i], `${path}.findings[${i}]`, depth + 1);
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'findings') continue;
      if (child && typeof child === 'object') visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  }

  visit(input, '$', 0);
  return findings;
}

function summarizeFindings(findings) {
  const bySeverity = emptySeveritySummary();
  const byStatus = {};
  for (const finding of findings || []) {
    const severity = normalizeSeverity(finding?.severity);
    const status = normalizeStatus(finding?.status);
    bySeverity[severity] += 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return { findingCount: (findings || []).length, bySeverity, byStatus };
}

function buildResultSummary(result) {
  const findings = collectFindings(result);
  const summary = summarizeFindings(findings);
  const flags = {};
  for (const [section, flag] of RESULT_SECTION_FLAGS) flags[flag] = Boolean(result && result[section]);
  return {
    ...summary,
    ...flags,
    resourcePreflight: result?.resourcePreflight || null,
    kpiScorecard: result?.kpiScorecard || null,
    error: result?.error || null,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  SEVERITIES,
  emptySeveritySummary,
  normalizeSeverity,
  normalizeStatus,
  collectFindings,
  summarizeFindings,
  buildResultSummary
};
