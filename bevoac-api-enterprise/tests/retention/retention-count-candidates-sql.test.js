'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countCandidates,
  runRetentionSweep
} = require('../../scripts/retention-sweep');

const retentionDays = {
  free: 30,
  standard: 90,
  business: 180,
  payg: 180,
  fallback: 180
};

test(
  'countCandidates uses one candidate relation and a qualified per-plan aggregation',
  async () => {
    const calls = [];

    const client = {
      async query(sql, params) {
        calls.push({ sql, params });

        return {
          rows: [
            {
              total: 4,
              done: 3,
              failed: 1,
              done_by_plan: {
                free: 1,
                standard: 2
              }
            }
          ]
        };
      }
    };

    const result = await countCandidates(client, {
      failedDays: 90,
      days: retentionDays
    });

    assert.equal(calls.length, 1);

    const [{ sql, params }] = calls;

    assert.match(sql, /WITH\s+candidates\s+AS\s*\(/i);
    assert.match(sql, /FROM\s+candidates\s+c/i);
    assert.match(sql, /GROUP\s+BY\s+c\.plan_code/i);
    assert.match(
      sql,
      /jsonb_object_agg\s*\(\s*p\.plan_code\s*,\s*p\.count_by_plan\s*\)/i
    );

    assert.doesNotMatch(
      sql,
      /RIGHT\s+JOIN\s+scans\s+s\s+ON\s+true/i
    );

    assert.doesNotMatch(
      sql,
      /jsonb_object_agg\s*\(\s*plan_code\s*,/i
    );

    assert.deepEqual(
      params,
      [90, 180, 30, 90, 180, 180, 180]
    );

    assert.deepEqual(result, {
      total: 4,
      done: 3,
      failed: 1,
      done_by_plan: {
        free: 1,
        standard: 2
      }
    });
  }
);

test(
  'dry-run returns the candidate summary without transaction or deletion',
  async () => {
    const statements = [];

    const client = {
      async query(sql) {
        statements.push(sql);

        if (statements.length > 1) {
          throw new Error(
            'Dry-run attempted an unexpected database write.'
          );
        }

        return {
          rows: [
            {
              total: 3,
              done: 2,
              failed: 1,
              done_by_plan: {
                free: 1,
                business: 1
              }
            }
          ]
        };
      }
    };

    const config = {
      retention: {
        scanResultRetentionDays: 180,
        failedScanRetentionDays: 90,
        idempotencyRetentionDays: 30,
        onboardingSessionRetentionDays: 30
      }
    };

    const result = await runRetentionSweep({
      client,
      config,
      env: {
        DRY_RUN: 'true'
      }
    });

    assert.equal(statements.length, 1);
    assert.equal(result.dryRun, true);
    assert.equal(result.removableScans, 3);
    assert.equal(result.removableDoneScans, 2);
    assert.equal(result.removableFailedScans, 1);
    assert.deepEqual(result.doneByPlan, {
      free: 1,
      business: 1
    });

    assert.equal(
      statements.some((sql) =>
        /\b(?:BEGIN|DELETE|INSERT|UPDATE|COMMIT|ROLLBACK)\b/i.test(sql)
      ),
      false
    );
  }
);
