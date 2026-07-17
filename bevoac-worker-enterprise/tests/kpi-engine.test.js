'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { coverageKpi, riskCountKpi, buildScanScorecard } = require('../src/lib/kpi-engine');
const { enhanceModuleResult } = require('../src/lib/module-enhancers');

test('coverageKpi computes percent and status', () => {
  const kpi = coverageKpi({ kpiId: 'TEST', label: 'coverage', domain: 'unit', compliant: 9, total: 10, warningBelow: 95, criticalBelow: 80 });
  assert.equal(kpi.valuePct, 90);
  assert.equal(kpi.status, 'WARN');
});

test('riskCountKpi computes count status', () => {
  const kpi = riskCountKpi({ kpiId: 'RISK', label: 'risk', domain: 'unit', count: 3, warningAt: 1, criticalAt: 5 });
  assert.equal(kpi.value, 3);
  assert.equal(kpi.status, 'WARN');
});

test('storage enhancer adds storage KPIs without removing existing fields', () => {
  const result = enhanceModuleResult('storage', {
    status: 'SUCCESS',
    summary: {
      totalStorageAccounts: 10,
      publicStorageAccountsCount: 1,
      storageWithBlobPublicAccessEnabledCount: 2,
      storageWithSharedKeyAccessEnabledCount: 3,
      storageWithMinTlsBelow12Count: 0,
      storageWithLocalUsersEnabledCount: 0
    },
    checks: []
  });
  assert.equal(result.summary.totalStorageAccounts, 10);
  assert.ok(result.kpis.some((kpi) => kpi.kpiId === 'STORAGE_NON_PUBLIC_COVERAGE'));
  assert.equal(result.evidenceMetadata.moduleName, 'storage');
});

test('buildScanScorecard aggregates kpis from web, entra and azure modules', () => {
  const scorecard = buildScanScorecard({
    webSecurity: { kpis: [{ kpiId: 'WEB', status: 'PASS' }] },
    microsoft_entra: { kpis: [{ kpiId: 'ENTRA', status: 'WARN' }] },
    azure_infrastructure: { modules: { storage: { kpis: [{ kpiId: 'STORAGE', status: 'FAIL' }] } } }
  });
  assert.equal(scorecard.totalKpis, 3);
  assert.equal(scorecard.byStatus.PASS, 1);
  assert.equal(scorecard.byStatus.WARN, 1);
  assert.equal(scorecard.byStatus.FAIL, 1);
});
