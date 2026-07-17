'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDocDefinition } = require('../../src/services/pdf-generator');

test('PDF document definition includes a KPI Scorecard section when kpis are present', () => {
  const doc = buildDocDefinition({
    scanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    cloudProvider: 'azure',
    scanProfile: 'infra',
    completedAt: '2026-06-04T12:00:00.000Z',
    resourceCount: 3,
    resourceLimit: 500,
    kpiScorecard: {
      totalKpis: 1,
      byStatus: { FAIL: 1 },
      kpis: [
        {
          kpiId: 'STORAGE_NON_PUBLIC_COVERAGE',
          label: '% de comptes de stockage non publics',
          domain: 'cloud_security',
          numerator: 0,
          denominator: 3,
          valuePct: 0,
          unit: 'percent',
          status: 'FAIL',
          sourceModule: 'storage',
          recommendation: 'Restreindre les comptes Storage publics.'
        }
      ]
    },
    azure_infrastructure: {
      modules: {
        storage: {
          status: 'SUCCESS',
          checks: [],
          summary: { totalStorageAccounts: 3 },
          kpis: []
        }
      }
    }
  });

  const content = JSON.stringify(doc.content);
  assert.match(content, /1\.6 KPI Scorecard/);
  assert.match(content, /STORAGE_NON_PUBLIC_COVERAGE/);
  assert.match(content, /% de comptes de stockage non publics/);
});
