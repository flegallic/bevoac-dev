const PdfPrinter = require('pdfmake');

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'];
const STATUSES = ['FAILED', 'WARNING', 'PASSED', 'INFO', 'UNKNOWN'];

const SEVERITY_WEIGHT = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
  UNKNOWN: 0
};

const SCORE_PENALTY = {
  CRITICAL: 25,
  HIGH: 12,
  MEDIUM: 6,
  LOW: 2,
  INFO: 0,
  UNKNOWN: 0
};

const RESOURCE_ID_RE = /\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/([^/]+\/[^/]+)\/([^/]+)/i;

const WEB_FINDING_TITLES = {
  'HDR-HSTS-001': 'Strict-Transport-Security header is missing',
  'HDR-SERVER-001': 'Server header discloses technology stack',
  'HDR-CSP-001': 'Content-Security-Policy header is missing or weak',
  'HDR-XFRAME-001': 'Clickjacking protection header is missing',
  'HDR-XCTO-001': 'MIME sniffing protection header is missing',
  'TLS-CERT-001': 'TLS certificate validity issue detected',
  'TLS-PROTOCOL-001': 'Weak TLS protocol or cipher posture detected',
  'DNS-RESOLVE-001': 'DNS resolution issue detected',
  'NMAP-PORTS-001': 'Unexpected exposed web ports detected'
};

const WEB_FINDING_DESCRIPTIONS = {
  'HDR-HSTS-001': 'The target web endpoint does not enforce HTTP Strict Transport Security. Browsers may not be instructed to always use HTTPS for this host.',
  'HDR-SERVER-001': 'The target web endpoint discloses server or technology information through HTTP response headers.',
  'HDR-CSP-001': 'The target web endpoint does not expose a sufficiently restrictive Content-Security-Policy header.',
  'HDR-XFRAME-001': 'The target web endpoint may be embeddable in frames and could be exposed to clickjacking scenarios.',
  'HDR-XCTO-001': 'The target web endpoint may allow MIME sniffing because X-Content-Type-Options is missing or weak.',
  'TLS-CERT-001': 'The TLS certificate could not be validated as production-grade for the target endpoint.',
  'TLS-PROTOCOL-001': 'The TLS configuration exposes weak or legacy protocol/cipher posture.',
  'DNS-RESOLVE-001': 'The target DNS configuration returned an unexpected or degraded result.',
  'NMAP-PORTS-001': 'The target host exposes one or more network ports that should be reviewed against the expected internet-facing surface.'
};

const WEB_FINDING_RECOMMENDATIONS = {
  'HDR-HSTS-001': 'Enable Strict-Transport-Security with an appropriate max-age and includeSubDomains/preload only after validating all subdomains are HTTPS-ready.',
  'HDR-SERVER-001': 'Suppress or minimize Server and X-Powered-By style headers at the reverse proxy, CDN or application gateway layer.',
  'HDR-CSP-001': 'Deploy a restrictive Content-Security-Policy tailored to the application and validate it in report-only mode before enforcement.',
  'HDR-XFRAME-001': 'Set X-Frame-Options DENY/SAMEORIGIN or use frame-ancestors in Content-Security-Policy.',
  'HDR-XCTO-001': 'Set X-Content-Type-Options: nosniff on HTTP responses.',
  'TLS-CERT-001': 'Renew or correct the certificate chain and monitor expiry through an automated control.',
  'TLS-PROTOCOL-001': 'Disable legacy TLS versions and weak ciphers at the edge service or load balancer.',
  'DNS-RESOLVE-001': 'Review DNS records, authoritative configuration and expected exposure for the host.',
  'NMAP-PORTS-001': 'Close unexpected ports or restrict access through firewall, WAF, reverse proxy or private access controls.'
};


function createPrinter() {
  return new PdfPrinter(fonts);
}

function safeText(value, fallback = 'N/A') {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) return value.length ? value.map((item) => safeText(item, '')).filter(Boolean).join(', ') : fallback;
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).trim();
  return text === '' ? fallback : text;
}

function truncate(value, max = 240) {
  const text = safeText(value, '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeSeverity(value) {
  const severity = String(value || 'UNKNOWN').trim().toUpperCase();
  return SEVERITIES.includes(severity) ? severity : 'UNKNOWN';
}

function normalizeStatus(value) {
  const status = String(value || 'UNKNOWN').trim().toUpperCase();
  return STATUSES.includes(status) ? status : 'UNKNOWN';
}

function severityColor(severity) {
  if (severity === 'CRITICAL') return '#8b0000';
  if (severity === 'HIGH') return '#c0392b';
  if (severity === 'MEDIUM') return '#d68910';
  if (severity === 'LOW') return '#2874a6';
  if (severity === 'INFO') return '#1f618d';
  return '#6c757d';
}

function statusColor(status) {
  if (status === 'FAILED') return '#c0392b';
  if (status === 'WARNING') return '#d68910';
  if (status === 'PASSED') return '#1e8449';
  if (status === 'INFO') return '#1f618d';
  return '#6c757d';
}

function moduleDisplayName(moduleName) {
  const raw = String(moduleName || 'unknown').trim();
  const mapping = {
    nsg: 'NSG',
    storage: 'Storage',
    keyvault: 'Key Vault',
    key_vault: 'Key Vault',
    vm: 'Virtual Machines',
    vms: 'Virtual Machines',
    virtual_machines: 'Virtual Machines',
    logs: 'Logs',
    governance: 'Governance',
    finops: 'FinOps',
    entra: 'Microsoft Entra',
    microsoft_entra: 'Microsoft Entra',
    entra_b2b: 'Entra B2B',
    db: 'Databases',
    database: 'Databases',
    databases: 'Databases',
    appservices: 'App Services',
    app_services: 'App Services',
    tags: 'Tags',
    web: 'Web Security',
    websecurity: 'Web Security',
    azure_infrastructure: 'Azure Infrastructure'
  };
  return mapping[raw.toLowerCase()] || raw.toUpperCase();
}

function emptyCountMap(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function toIsoDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toISOString();
}

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
}

function normalizeChecks(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.checks)) return input.checks;
  if (Array.isArray(input.findings)) return input.findings;
  return [];
}

function extractResourceMetadata(resource) {
  const id = safeText(resource?.id, '');
  const match = id.match(RESOURCE_ID_RE);
  const subscriptionId = resource?.subscriptionId || (match ? match[1] : null);
  const resourceGroup = resource?.resourceGroup || (match ? match[2] : null);
  const resourceType = resource?.resourceType || (match ? match[3] : null);
  const name = resource?.name || (match ? match[4] : null);

  return {
    id: id || null,
    name: name || null,
    resourceGroup: resourceGroup || null,
    location: resource?.location || null,
    subscriptionId: subscriptionId || null,
    resourceType: resourceType || null
  };
}

function hostFromUrl(value) {
  if (!value) return null;
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch (_) {
    return null;
  }
}

function inferScanTargetUrl(scanData = {}, finding = {}) {
  return scanData.targetUrl ||
    scanData.target?.targetUrl ||
    scanData.azure?.targetUrl ||
    scanData.webSecurity?.targetUrl ||
    scanData.webSecurity?.target?.url ||
    scanData.webSecurity?.target?.targetUrl ||
    finding.targetUrl ||
    finding.url ||
    null;
}

function normalizeAffectedCount(check, affectedResources) {
  const explicit = asNumber(check?.affectedResourcesCount, null);
  if (explicit !== null && explicit > 0) return explicit;

  const candidates = [
    check?.affectedUsersCount,
    check?.staleUsersCount,
    check?.inactiveUsersCount,
    check?.guestUsersCount,
    check?.count,
    check?.total,
    check?.summary?.affectedUsersCount,
    check?.summary?.staleUsersCount,
    check?.summary?.inactiveUsersCount,
    check?.summary?.guestUsersCount,
    check?.summary?.count,
    check?.summary?.total,
    check?.details?.affectedUsersCount,
    check?.details?.staleUsersCount,
    check?.details?.inactiveUsersCount,
    check?.details?.guestUsersCount,
    check?.details?.count,
    check?.details?.total
  ];

  for (const candidate of candidates) {
    const value = asNumber(candidate, null);
    if (value !== null && value > 0) return value;
  }

  const text = `${check?.description || ''} ${check?.title || ''}`;
  const detectedMatch = text.match(/Detected\s+(\d+)/i);
  if (detectedMatch) return Number(detectedMatch[1]);

  if (explicit !== null) return explicit;
  return Array.isArray(affectedResources) ? affectedResources.length : 0;
}

function normalizeModuleExecutionStatus(moduleData, findings = []) {
  const explicit = String(moduleData?.executionStatus || moduleData?.status || '').trim().toUpperCase();
  if (explicit === 'SUCCESS' || explicit === 'FAILED') return explicit;
  if (findings.length > 0) return 'SUCCESS';
  return 'N/A';
}

function normalizeModuleSecurityPosture(findings = []) {
  const statuses = findings.map((finding) => normalizeStatus(finding.status));
  if (statuses.includes('FAILED')) return 'FAIL';
  if (statuses.includes('WARNING')) return 'WARN';
  if (statuses.includes('PASSED')) return 'PASS';
  if (statuses.includes('INFO')) return 'INFO';
  return 'N/A';
}

function deriveWebEvidenceResource(check, scanData = {}) {
  const targetUrl = inferScanTargetUrl(scanData, check);
  const host = hostFromUrl(targetUrl) || check?.host || check?.targetHost || 'N/A';

  const resource = {
    host,
    url: targetUrl || check?.url || 'N/A',
    resourceType: 'Web target'
  };

  const candidates = [
    'hstsHeaderPresent',
    'strictTransportSecurity',
    'serverHeader',
    'xPoweredBy',
    'contentSecurityPolicy',
    'xFrameOptions',
    'xContentTypeOptions',
    'openPorts',
    'ports',
    'statusCode',
    'tlsVersion',
    'certificateExpiresAt',
    'issuer',
    'resolvedIp',
    'cdnProvider'
  ];

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(check || {}, key)) resource[key] = check[key];
    if (Object.prototype.hasOwnProperty.call(check?.details || {}, key)) resource[key] = check.details[key];
    if (Object.prototype.hasOwnProperty.call(check?.observed || {}, key)) resource[key] = check.observed[key];
  }

  return resource;
}

function observedProperties(resource) {
  if (!resource || typeof resource !== 'object') return [];
  const ignored = new Set([
    'id', 'name', 'resourceGroup', 'resource_group', 'location', 'subscriptionId', 'subscription_id',
    'resourceType', 'type', 'host', 'url'
  ]);
  const preferredOrder = [
    'publicNetworkAccess',
    'defaultAction',
    'networkAclsDefaultAction',
    'networkAclsBypass',
    'bypass',
    'minimumTlsVersion',
    'enableHttpsTrafficOnly',
    'allowBlobPublicAccess',
    'allowSharedKeyAccess',
    'privateEndpointsCount',
    'isLocalUserEnabled',
    'enablePurgeProtection',
    'enableSoftDelete',
    'softDeleteEnabled',
    'purgeProtectionEnabled',
    'softDeleteRetentionInDays',
    'enableRbacAuthorization',
    'networkAcls',
    'sku',
    'skuName',
    'ruleName',
    'direction',
    'access',
    'priority',
    'protocol',
    'sourceAddressPrefix',
    'destinationPortRange',
    'destinationPortRanges',
    'osType',
    'exposedPorts',
    'engine',
    'allowAzureServices',
    'retentionDays',
    'missingTags',
    'hstsHeaderPresent',
    'strictTransportSecurity',
    'serverHeader',
    'xPoweredBy',
    'contentSecurityPolicy',
    'xFrameOptions',
    'xContentTypeOptions',
    'openPorts',
    'ports',
    'statusCode',
    'tlsVersion',
    'certificateExpiresAt',
    'issuer',
    'resolvedIp',
    'cdnProvider'
  ];

  const keys = [
    ...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(resource, key)),
    ...Object.keys(resource).filter((key) => !preferredOrder.includes(key))
  ];

  return keys
    .filter((key) => !ignored.has(key))
    .filter((key) => resource[key] !== undefined && resource[key] !== null)
    .filter((key) => typeof resource[key] !== 'object' || Array.isArray(resource[key]))
    .map((key) => `${key}: ${safeText(resource[key], '')}`)
    .filter(Boolean);
}

function normalizeFinding(check, moduleName, moduleData = {}, scanData = {}) {
  const severity = normalizeSeverity(check?.severity);
  const status = normalizeStatus(check?.status);
  const isWeb = String(moduleName || '').toLowerCase() === 'web';
  const checkId = safeText(check?.checkId || check?.id, 'N/A');

  let affectedResources = Array.isArray(check?.affectedResourcesSample) ? [...check.affectedResourcesSample] : [];

  if (isWeb && affectedResources.length === 0 && (status === 'FAILED' || status === 'WARNING')) {
    affectedResources = [deriveWebEvidenceResource(check, scanData)];
  }

  const affectedResourcesCount = normalizeAffectedCount(check, affectedResources);
  const webTitle = isWeb ? WEB_FINDING_TITLES[checkId] : null;
  const webDescription = isWeb ? WEB_FINDING_DESCRIPTIONS[checkId] : null;
  const webRecommendation = isWeb ? WEB_FINDING_RECOMMENDATIONS[checkId] : null;

  return {
    module: moduleName,
    moduleLabel: moduleDisplayName(moduleName),
    moduleExecutionStatus: safeText(moduleData.executionStatus || moduleData.status, 'N/A'),
    moduleSecurityPosture: safeText(moduleData.securityPosture, 'N/A'),
    area: safeText(check?.area || moduleDisplayName(moduleName), moduleDisplayName(moduleName)),
    title: safeText(webTitle || check?.title || check?.name || checkId, 'Control result'),
    checkId,
    severity,
    status,
    description: safeText(check?.description || webDescription, 'No description supplied.'),
    recommendation: safeText(check?.recommendation || check?.remediation || check?.action || webRecommendation, 'No remediation supplied.'),
    resourceType: safeText(check?.resourceType || (isWeb ? 'Web target' : undefined), 'N/A'),
    affectedResourcesCount,
    affectedResourcesSample: affectedResources
  };
}

function collectFindings(scanData) {
  const findings = [];

  function pushFromInput(input, moduleName, moduleData = {}) {
    for (const check of normalizeChecks(input)) {
      findings.push(normalizeFinding(check, moduleName, moduleData, scanData || {}));
    }
  }

  pushFromInput(scanData.webSecurity?.findings || scanData.webSecurity?.checks, 'web', scanData.webSecurity || {});
  pushFromInput(scanData.microsoft_entra?.findings || scanData.microsoft_entra?.checks, 'microsoft_entra', scanData.microsoft_entra || {});

  const infra = scanData.azure_infrastructure || {};
  const infraModules = infra.modules || infra;
  if (Array.isArray(infraModules.findings) || Array.isArray(infraModules.checks)) {
    pushFromInput(infraModules.findings || infraModules.checks, 'azure_infrastructure', infraModules);
  } else {
    for (const [moduleName, moduleData] of Object.entries(infraModules || {})) {
      if (!moduleData || typeof moduleData !== 'object') continue;
      pushFromInput(moduleData.checks || moduleData.findings, moduleName, moduleData);
    }
  }

  return findings;
}

function collectModuleSummary(scanData, findings) {
  const byModule = new Map();

  function ensureModule(moduleName, moduleData = {}) {
    const key = String(moduleName || 'unknown').toLowerCase();
    if (!byModule.has(key)) {
      byModule.set(key, {
        module: key,
        label: moduleDisplayName(key),
        executionStatus: safeText(moduleData.executionStatus || moduleData.status, 'N/A'),
        securityPosture: safeText(moduleData.securityPosture, 'N/A'),
        checks: 0,
        failed: 0,
        warning: 0,
        passed: 0,
        info: 0,
        unknown: 0,
        resourcesAnalyzed: inferResourcesAnalyzed(moduleData),
        _moduleData: moduleData,
        _findings: []
      });
    }
    return byModule.get(key);
  }

  const infraModules = scanData.azure_infrastructure?.modules || {};
  for (const [moduleName, moduleData] of Object.entries(infraModules || {})) {
    if (moduleData && typeof moduleData === 'object') ensureModule(moduleName, moduleData);
  }
  if (scanData.webSecurity) ensureModule('web', scanData.webSecurity);
  if (scanData.microsoft_entra) ensureModule('microsoft_entra', scanData.microsoft_entra);

  for (const finding of findings) {
    const row = ensureModule(finding.module, {});
    row._findings.push(finding);
    row.checks += 1;
    if (finding.status === 'FAILED') row.failed += 1;
    else if (finding.status === 'WARNING') row.warning += 1;
    else if (finding.status === 'PASSED') row.passed += 1;
    else if (finding.status === 'INFO') row.info += 1;
    else row.unknown += 1;
  }

  return [...byModule.values()].map((row) => ({
    module: row.module,
    label: row.label,
    executionStatus: normalizeModuleExecutionStatus(row._moduleData, row._findings),
    securityPosture: normalizeModuleSecurityPosture(row._findings),
    checks: row.checks,
    failed: row.failed,
    warning: row.warning,
    passed: row.passed,
    info: row.info,
    unknown: row.unknown,
    resourcesAnalyzed: row.resourcesAnalyzed
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function inferResourcesAnalyzed(moduleData) {
  if (!moduleData || typeof moduleData !== 'object') return 'N/A';
  const candidates = [
    moduleData.resources_analyzed,
    moduleData.resourcesAnalyzed,
    moduleData.nsgs_analyzed,
    moduleData.storage_accounts_analyzed,
    moduleData.vaults_analyzed,
    moduleData.vms_analyzed,
    moduleData.summary?.totalNsgs,
    moduleData.summary?.totalStorageAccounts,
    moduleData.summary?.totalVaults,
    moduleData.summary?.totalVms
  ];
  for (const candidate of candidates) {
    const value = asNumber(candidate, null);
    if (value !== null) return String(value);
  }
  return 'N/A';
}

function summarizeFindings(findings) {
  const severityCounts = emptyCountMap(SEVERITIES);
  const statusCounts = emptyCountMap(STATUSES);
  for (const finding of findings) {
    increment(severityCounts, finding.severity);
    increment(statusCounts, finding.status);
  }
  return { severityCounts, statusCounts };
}

function computeScore(findings) {
  const failedFindings = findings.filter((finding) => finding.status === 'FAILED' || finding.status === 'WARNING');
  if (failedFindings.length === 0) return { score: 100, penalty: 0, level: 'Strong', decision: 'No blocking risk detected' };

  const rawPenalty = failedFindings.reduce((sum, finding) => sum + (SCORE_PENALTY[finding.severity] || 0), 0);
  const cappedPenalty = Math.min(80, rawPenalty);
  const score = Math.max(0, 100 - cappedPenalty);
  let level = 'Controlled';
  let decision = 'Maintain controls and monitor regularly';
  if (score < 40) {
    level = 'Critical exposure';
    decision = 'Immediate remediation required';
  } else if (score < 60) {
    level = 'High risk';
    decision = 'Priority remediation required';
  } else if (score < 80) {
    level = 'Moderate risk';
    decision = 'Planned remediation recommended';
  } else if (score < 95) {
    level = 'Controlled';
    decision = 'Improve selected controls';
  } else {
    level = 'Strong';
    decision = 'No blocking risk detected';
  }
  return { score, penalty: rawPenalty, level, decision };
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const statusWeight = (status) => (status === 'FAILED' ? 3 : status === 'WARNING' ? 2 : status === 'UNKNOWN' ? 1 : 0);
    return (
      statusWeight(b.status) - statusWeight(a.status) ||
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
      Number(b.affectedResourcesCount || 0) - Number(a.affectedResourcesCount || 0) ||
      a.moduleLabel.localeCompare(b.moduleLabel) ||
      a.checkId.localeCompare(b.checkId)
    );
  });
}

function topRisks(findings, limit = 5) {
  return sortFindings(findings).filter((finding) => finding.status === 'FAILED' || finding.status === 'WARNING').slice(0, limit);
}

function cell(text, options = {}) {
  return { text: safeText(text, ''), ...options };
}

function badge(text, color) {
  return { text: safeText(text), color, bold: true };
}

function sectionTitle(text) {
  return { text, style: 'sectionTitle' };
}

function subTitle(text) {
  return { text, style: 'subTitle' };
}

function smallNote(text) {
  return { text, style: 'smallNote' };
}

function tableOrEmpty(body, widths, emptyMessage, options = {}) {
  if (!body || body.length <= 1) return { text: emptyMessage, italics: true, margin: [0, 4, 0, 8] };
  return {
    table: {
      headerRows: 1,
      widths,
      body
    },
    layout: options.layout || 'lightHorizontalLines',
    margin: options.margin || [0, 4, 0, 12],
    fontSize: options.fontSize || 7
  };
}

function severitySummaryTable(severityCounts) {
  return {
    table: {
      widths: ['*', '*', '*', '*', '*', '*'],
      body: [
        SEVERITIES.map((severity) => cell(severity.charAt(0) + severity.slice(1).toLowerCase(), { bold: true, fillColor: '#eaf2f8' })),
        SEVERITIES.map((severity) => cell(String(severityCounts[severity] || 0), { color: severityColor(severity), bold: true }))
      ]
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 12]
  };
}

function statusSummaryTable(statusCounts) {
  return {
    table: {
      widths: ['*', '*', '*', '*', '*'],
      body: [
        STATUSES.map((status) => cell(status.charAt(0) + status.slice(1).toLowerCase(), { bold: true, fillColor: '#eaf2f8' })),
        STATUSES.map((status) => cell(String(statusCounts[status] || 0), { color: statusColor(status), bold: true }))
      ]
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 12]
  };
}

function moduleSummaryTable(moduleSummary) {
  const body = [[
    cell('Module', { style: 'tableHeader' }),
    cell('Execution', { style: 'tableHeader' }),
    cell('Posture', { style: 'tableHeader' }),
    cell('Checks', { style: 'tableHeader' }),
    cell('Failed', { style: 'tableHeader' }),
    cell('Warning', { style: 'tableHeader' }),
    cell('Passed', { style: 'tableHeader' }),
    cell('Resources', { style: 'tableHeader' })
  ]];
  for (const module of moduleSummary) {
    const postureColor = module.securityPosture === 'FAIL' ? '#c0392b' : module.securityPosture === 'WARN' ? '#d68910' : module.securityPosture === 'PASS' ? '#1e8449' : module.securityPosture === 'INFO' ? '#1f618d' : '#6c757d';
    body.push([
      cell(module.label, { bold: true }),
      cell(module.executionStatus),
      cell(module.securityPosture, { color: postureColor, bold: true }),
      cell(String(module.checks)),
      cell(String(module.failed), { color: module.failed > 0 ? '#c0392b' : '#1e8449', bold: module.failed > 0 }),
      cell(String(module.warning), { color: module.warning > 0 ? '#d68910' : '#566573', bold: module.warning > 0 }),
      cell(String(module.passed)),
      cell(module.resourcesAnalyzed)
    ]);
  }
  return tableOrEmpty(body, ['17%', '12%', '12%', '8%', '8%', '8%', '8%', '15%'], 'No module summary available.');
}

function topRisksTable(risks) {
  const body = [[
    cell('#', { style: 'tableHeader' }),
    cell('Severity', { style: 'tableHeader' }),
    cell('Module', { style: 'tableHeader' }),
    cell('Risk', { style: 'tableHeader' }),
    cell('Affected', { style: 'tableHeader' }),
    cell('Recommended action', { style: 'tableHeader' })
  ]];
  risks.forEach((risk, index) => {
    body.push([
      cell(String(index + 1)),
      badge(risk.severity, severityColor(risk.severity)),
      cell(risk.moduleLabel),
      cell(risk.title, { bold: true }),
      cell(String(risk.affectedResourcesCount ?? 0)),
      cell(risk.recommendation)
    ]);
  });
  return tableOrEmpty(body, ['5%', '10%', '12%', '27%', '8%', '38%'], 'No failed or warning finding detected.');
}

function remediationTable(risks) {
  const body = [[
    cell('Priority', { style: 'tableHeader' }),
    cell('Severity', { style: 'tableHeader' }),
    cell('Control', { style: 'tableHeader' }),
    cell('Action', { style: 'tableHeader' }),
    cell('Recommended SLA', { style: 'tableHeader' })
  ]];
  risks.forEach((risk, index) => {
    const sla = risk.severity === 'CRITICAL' ? '24-72h' : risk.severity === 'HIGH' ? '7 days' : risk.severity === 'MEDIUM' ? '30 days' : 'Best effort';
    body.push([
      cell(`P${Math.min(index + 1, 3)}`, { bold: true }),
      badge(risk.severity, severityColor(risk.severity)),
      cell(risk.checkId),
      cell(risk.recommendation),
      cell(sla)
    ]);
  });
  return tableOrEmpty(body, ['8%', '10%', '14%', '50%', '18%'], 'No remediation action required for failed or warning findings.');
}

function controlMatrixTable(findings) {
  const body = [[
    cell('Severity', { style: 'tableHeader' }),
    cell('Status', { style: 'tableHeader' }),
    cell('Module', { style: 'tableHeader' }),
    cell('Check ID', { style: 'tableHeader' }),
    cell('Finding', { style: 'tableHeader' }),
    cell('Affected', { style: 'tableHeader' })
  ]];
  for (const finding of sortFindings(findings)) {
    body.push([
      badge(finding.severity, severityColor(finding.severity)),
      badge(finding.status, statusColor(finding.status)),
      cell(finding.moduleLabel),
      cell(finding.checkId),
      cell(finding.title),
      cell(String(finding.affectedResourcesCount ?? 0))
    ]);
  }
  return tableOrEmpty(body, ['10%', '10%', '13%', '16%', '41%', '10%'], 'No checks were returned for this scan.', { fontSize: 7 });
}

function contextRows(scanData, scoreInfo) {
  const resourceCount = scanData.resourceCount == null ? 'N/A' : String(scanData.resourceCount);
  const resourceLimit = scanData.resourceLimit == null ? 'N/A' : String(scanData.resourceLimit);
  const usage = scanData.resourceCount != null && scanData.resourceLimit ? formatPercent((Number(scanData.resourceCount) / Number(scanData.resourceLimit)) * 100) : 'N/A';
  return [
    ['Scan ID', safeText(scanData.scanId)],
    ['Tenant Bevoac', safeText(scanData.tenantId)],
    ['Cloud provider', safeText(scanData.cloudProvider || 'azure')],
    ['Scan profile', safeText(scanData.scanProfile)],
    ['Completed at', toIsoDateTime(scanData.completedAt)],
    ['Microsoft tenant', safeText(scanData.microsoftTenantId || scanData.target?.microsoftTenantId)],
    ['Subscriptions', safeText(scanData.subscriptions || scanData.target?.subscriptions)],
    ['Resources counted', `${resourceCount} / ${resourceLimit} (${usage})`],
    ['Global score', `${scoreInfo.score}/100 - ${scoreInfo.level}`],
    ['Decision', scoreInfo.decision]
  ];
}

function executiveNarrative(scoreInfo, risks, moduleSummary) {
  const failingModules = moduleSummary.filter((module) => module.failed > 0).map((module) => module.label);
  if (risks.length === 0) {
    return 'The scan did not detect failed or warning controls. Continue monitoring, maintain least privilege, and rerun Bevoac after material infrastructure changes.';
  }
  const top = risks.slice(0, 3).map((risk) => `${risk.moduleLabel}: ${risk.title}`).join('; ');
  return `The scan requires action. Global risk level is ${scoreInfo.level}. Main risk areas: ${failingModules.join(', ') || 'N/A'}. Top risks detected: ${top}. Recommended next step: remediate critical and high findings, then relaunch a Bevoac scan to confirm closure.`;
}

function resourceIdentityRows(meta, resourceTypeFallback) {
  return [
    ['Name', meta.name],
    ['Resource group', meta.resourceGroup],
    ['Location', meta.location],
    ['Subscription', meta.subscriptionId],
    ['Resource type', meta.resourceType || resourceTypeFallback]
  ].map(([label, value]) => [
    cell(label, { bold: true, color: '#17324d' }),
    cell(value)
  ]);
}

function resourceEvidenceTable(finding, maxResources = 10) {
  const resources = finding.affectedResourcesSample || [];

  if (resources.length === 0) {
    if (finding.affectedResourcesCount > 0) {
      const isIdentity = /entra|identity|user|guest/i.test(`${finding.moduleLabel} ${finding.title} ${finding.area}`);
      return smallNote(isIdentity
        ? `Affected identities count is ${finding.affectedResourcesCount}. Detailed identity lists are aggregated for privacy and are not included in the PDF.`
        : `Affected resources count is ${finding.affectedResourcesCount}, but no resource sample was returned by the scanner.`);
    }
    return smallNote('No affected resource detected for this control.');
  }

  const blocks = [];
  resources.slice(0, maxResources).forEach((resource, index) => {
    const meta = extractResourceMetadata(resource);
    const observed = observedProperties(resource).slice(0, 18);
    const host = resource?.host || hostFromUrl(resource?.url);
    const resourceName = meta.name || host || resource?.url || `Resource ${index + 1}`;
    const resourceType = meta.resourceType || resource?.resourceType || resource?.type || finding.resourceType || 'N/A';
    const identityRows = resourceIdentityRows({ ...meta, name: resourceName, resourceType }, resourceType);

    const stack = [
      { text: `Resource ${index + 1}: ${safeText(resourceName)}`, bold: true, color: '#17324d', margin: [0, 2, 0, 3], fontSize: 7 },
      {
        table: {
          widths: ['18%', '82%'],
          body: identityRows
        },
        layout: 'lightHorizontalLines',
        fontSize: 6,
        margin: [0, 0, 0, 3]
      }
    ];

    const resourceId = meta.id || resource?.id;
    if (resourceId) {
      stack.push({ text: 'Resource ID', bold: true, color: '#17324d', margin: [0, 1, 0, 1], fontSize: 6 });
      stack.push({ text: safeText(resourceId), fontSize: 5, color: '#566573', margin: [0, 0, 0, 3] });
    }

    stack.push({ text: 'Observed properties', bold: true, color: '#17324d', margin: [0, 1, 0, 1], fontSize: 6 });
    if (observed.length) {
      stack.push({ ul: observed.map((item) => safeText(item)), fontSize: 5.5, margin: [0, 0, 0, 4] });
    } else {
      stack.push(cell('No additional properties collected by current scanner version.', { italics: true, fontSize: 5.5, color: '#566573', margin: [0, 0, 0, 4] }));
    }

    blocks.push({
      stack,
      margin: [0, 4, 0, 6],
      fillColor: index % 2 === 0 ? '#f8fafc' : null
    });
  });

  if (finding.affectedResourcesCount > maxResources) {
    blocks.push(smallNote(`Showing first ${maxResources} affected resources out of ${finding.affectedResourcesCount}. Full JSON evidence remains available through the scan API result.`));
  }
  return { stack: blocks };
}

function findingEvidenceBlock(finding) {
  return [
    {
      table: {
        widths: ['14%', '86%'],
        body: [
          [cell('Check ID', { bold: true }), cell(finding.checkId)],
          [cell('Module', { bold: true }), cell(finding.moduleLabel)],
          [cell('Severity', { bold: true }), badge(finding.severity, severityColor(finding.severity))],
          [cell('Status', { bold: true }), badge(finding.status, statusColor(finding.status))],
          [cell('Resource type', { bold: true }), cell(finding.resourceType)],
          [cell('Affected', { bold: true }), cell(String(finding.affectedResourcesCount ?? 0))]
        ]
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 6],
      fontSize: 6
    },
    { text: finding.title, bold: true, fontSize: 9, margin: [0, 3, 0, 3] },
    { text: 'Description', bold: true, color: '#205081', margin: [0, 3, 0, 2] },
    { text: finding.description, margin: [0, 0, 0, 4] },
    { text: 'Recommended action', bold: true, color: '#205081', margin: [0, 3, 0, 2] },
    { text: finding.recommendation, margin: [0, 0, 0, 4] },
    { text: 'Affected resources and observed properties', bold: true, color: '#205081', margin: [0, 3, 0, 2] },
    resourceEvidenceTable(finding),
    { text: '', margin: [0, 0, 0, 6] }
  ];
}


function collectKpisForPdf(scanData) {
  const collected = [];
  const pushKpis = (sourceModule, holder) => {
    const list = Array.isArray(holder?.kpis) ? holder.kpis : [];
    for (const kpi of list) {
      if (!kpi || typeof kpi !== 'object') continue;
      collected.push({ ...kpi, sourceModule: kpi.sourceModule || sourceModule });
    }
  };

  if (Array.isArray(scanData?.kpiScorecard?.kpis)) {
    for (const kpi of scanData.kpiScorecard.kpis) {
      if (!kpi || typeof kpi !== 'object') continue;
      collected.push({ ...kpi, sourceModule: kpi.sourceModule || 'scorecard' });
    }
  }

  pushKpis('web', scanData?.webSecurity);
  pushKpis('entra', scanData?.microsoft_entra);
  pushKpis('identity_admin_posture', scanData?.identity_admin_posture);
  pushKpis('azure_infrastructure', scanData?.azure_infrastructure);

  const infraModules = scanData?.azure_infrastructure?.modules || {};
  for (const [moduleName, moduleResult] of Object.entries(infraModules)) {
    pushKpis(moduleName, moduleResult);
  }

  const dedup = new Map();
  for (const kpi of collected) {
    const key = `${kpi.sourceModule || 'unknown'}:${kpi.kpiId || kpi.label || JSON.stringify(kpi).slice(0, 120)}`;
    if (!dedup.has(key)) dedup.set(key, kpi);
  }
  return Array.from(dedup.values());
}

function kpiValueText(kpi) {
  if (kpi?.valuePct !== null && kpi?.valuePct !== undefined && Number.isFinite(Number(kpi.valuePct))) return `${Number(kpi.valuePct)}%`;
  if (kpi?.value !== null && kpi?.value !== undefined) return `${kpi.value}${kpi.unit && kpi.unit !== 'count' ? ` ${kpi.unit}` : ''}`;
  if (kpi?.numerator !== null && kpi?.numerator !== undefined && kpi?.denominator !== null && kpi?.denominator !== undefined) return `${kpi.numerator}/${kpi.denominator}`;
  return 'N/A';
}

function kpiStatusColor(status) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  if (normalized === 'PASS' || normalized === 'PASSED') return '#1e8449';
  if (normalized === 'WARN' || normalized === 'WARNING') return '#d68910';
  if (normalized === 'FAIL' || normalized === 'FAILED') return '#c0392b';
  return '#6c757d';
}

function kpiDisplayName(kpi) {
  const id = safeText(kpi?.kpiId || kpi?.id || 'N/A');
  const label = safeText(kpi?.label || kpi?.name || '');
  if (id !== 'N/A' && label && label !== id) return `${id} - ${label}`;
  if (id !== 'N/A') return id;
  return label || 'N/A';
}

function kpiScorecardTable(kpis) {
  const list = Array.isArray(kpis) ? kpis : [];
  const body = [[
    cell('Status', { style: 'tableHeader' }),
    cell('Module', { style: 'tableHeader' }),
    cell('KPI', { style: 'tableHeader' }),
    cell('Value', { style: 'tableHeader' }),
    cell('Evidence source', { style: 'tableHeader' }),
    cell('Recommended action', { style: 'tableHeader' })
  ]];

  for (const kpi of list) {
    const status = String(kpi.status || 'UNKNOWN').toUpperCase();
    body.push([
      cell(status, { color: kpiStatusColor(status), bold: true }),
      cell(kpi.sourceModule || 'N/A'),
      cell(kpiDisplayName(kpi), { bold: true }),
      cell(kpiValueText(kpi)),
      cell(kpi.evidenceSource || 'N/A'),
      cell(kpi.recommendation || 'N/A')
    ]);
  }

  return tableOrEmpty(body, ['9%', '13%', '24%', '9%', '21%', '24%'], 'No KPI scorecard data available for this scan.', { fontSize: 6 });
}

function buildDocDefinition(scanData) {
  const findings = collectFindings(scanData);
  const sortedFindings = sortFindings(findings);
  const moduleSummary = collectModuleSummary(scanData, findings);
  const { severityCounts, statusCounts } = summarizeFindings(findings);
  const scoreInfo = computeScore(findings);
  const risks = topRisks(findings, 5);

  const content = [
    { text: 'BEVOAC ENTERPRISE SECURITY AUDIT REPORT', style: 'coverTitle', alignment: 'center' },
    { text: `Generated on ${new Date().toISOString().slice(0, 10)}`, alignment: 'center', margin: [0, 0, 0, 18] },
    {
      columns: [
        { width: '35%', text: `${scoreInfo.score}/100`, style: 'scoreBox', alignment: 'center' },
        {
          width: '65%',
          stack: [
            { text: scoreInfo.level, fontSize: 18, bold: true, color: scoreInfo.score < 40 ? '#8b0000' : scoreInfo.score < 60 ? '#c0392b' : scoreInfo.score < 80 ? '#d68910' : '#1e8449' },
            { text: scoreInfo.decision, fontSize: 11, bold: true, margin: [0, 6, 0, 10] },
            { text: executiveNarrative(scoreInfo, risks, moduleSummary), fontSize: 9 }
          ]
        }
      ],
      columnGap: 16,
      margin: [0, 0, 0, 16]
    },
    sectionTitle('Audit context'),
    { table: { widths: ['25%', '75%'], body: contextRows(scanData, scoreInfo) }, layout: 'lightHorizontalLines', margin: [0, 4, 0, 12] },
    sectionTitle('Report scope and evidence model'),
    {
      ul: [
        'This report is finding-oriented. It does not list every discovered Azure resource individually.',
        'It lists each executed control, its result, remediation guidance and affected resources where a finding exists.',
        'For high-volume findings, the PDF displays a capped evidence sample. The complete scan result remains available through the scan API JSON response.',
        'Infrastructure scope is derived from the authenticated Bevoac tenant and validated Azure scopes. Web scope is derived from registered tenant web targets.'
      ],
      margin: [0, 4, 0, 12]
    },
    sectionTitle('1. Executive Summary'),
    subTitle('1.1 Severity distribution'),
    severitySummaryTable(severityCounts),
    subTitle('1.2 Status distribution'),
    statusSummaryTable(statusCounts),
    subTitle('1.3 Module summary'),
    moduleSummaryTable(moduleSummary),
    subTitle('1.4 Top risks'),
    topRisksTable(risks),
    subTitle('1.5 Remediation priorities'),
    remediationTable(risks),
    subTitle('1.6 KPI Scorecard'),
    kpiScorecardTable(collectKpisForPdf(scanData)),
    sectionTitle('2. Control Matrix'),
    controlMatrixTable(sortedFindings),
    { text: '3. Technical Evidence Appendix', style: 'sectionTitle', pageBreak: 'before' },
    smallNote('This appendix includes each control result, affected resource counts, resource samples, observed technical properties and remediation guidance. Resource samples are capped to keep the PDF readable; complete JSON evidence remains available through the scan API.'),
    ...sortedFindings.flatMap((finding, index) => [
      { text: `${index + 1}. ${finding.checkId} - ${finding.title}`, style: 'evidenceTitle', color: severityColor(finding.severity), margin: [0, index === 0 ? 8 : 14, 0, 4] },
      ...findingEvidenceBlock(finding)
    ]),
    { text: '4. Methodology and interpretation', style: 'sectionTitle', pageBreak: 'before' },
    {
      ul: [
        'Execution status SUCCESS means that the scanner module ran successfully; it does not mean that the module is compliant.',
        'Security posture PASS means no blocking failed control was detected for the module.',
        'Security posture FAIL means at least one failed control was detected; WARN means no failed control but at least one warning control was detected.',
        'Severity counters always include CRITICAL, HIGH, MEDIUM, LOW, INFO and UNKNOWN, even when the value is zero.',
        'The global score is a decision-support indicator based on failed and warning findings. It does not replace a formal risk acceptance process.',
        'After remediation, rerun Bevoac to verify that failed controls have moved to PASSED.',
        'The PDF is a finding/remediation/evidence report. Complete raw evidence remains available in the scan JSON API result.'
      ],
      margin: [0, 6, 0, 12]
    }
  ];

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 34, 28, 30],
    defaultStyle: { font: 'Helvetica', fontSize: 7, lineHeight: 1.15 },
    header: (currentPage) => currentPage === 1 ? null : { text: 'Bevoac Enterprise Security Audit Report', alignment: 'right', margin: [0, 12, 28, 0], font: 'Helvetica', fontSize: 7, color: '#566573' },
    footer: (currentPage, pageCount) => ({ text: `Page ${currentPage} / ${pageCount}`, alignment: 'right', margin: [0, 0, 28, 10], font: 'Helvetica', fontSize: 7, color: '#566573' }),
    content,
    styles: {
      coverTitle: { fontSize: 22, bold: true, color: '#17324d', margin: [0, 10, 0, 8] },
      scoreBox: { fontSize: 34, bold: true, color: '#17324d', margin: [0, 4, 0, 4] },
      sectionTitle: { fontSize: 14, bold: true, color: '#17324d', margin: [0, 10, 0, 6] },
      subTitle: { fontSize: 10, bold: true, color: '#205081', margin: [0, 6, 0, 3] },
      evidenceTitle: { fontSize: 10, bold: true },
      tableHeader: { bold: true, fillColor: '#eaf2f8', color: '#17324d' },
      smallNote: { fontSize: 6, color: '#566573', italics: true, margin: [0, 2, 0, 6] }
    }
  };
}

async function generateExecutiveSummaryBuffer(scanData) {
  return new Promise((resolve, reject) => {
    try {
      const printer = createPrinter();
      const docDefinition = buildDocDefinition(scanData || {});
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateExecutiveSummaryBuffer,
  buildDocDefinition,
  collectFindings,
  collectModuleSummary,
  summarizeFindings,
  computeScore,
  normalizeFinding,
  normalizeAffectedCount,
  normalizeModuleSecurityPosture,
  normalizeModuleExecutionStatus
};
