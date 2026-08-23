'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditTags } = require('../scanners/azure/tags');

function resource(index) {
  return {
    id: `/subscriptions/s/resourceGroups/rg/providers/Microsoft.Test/items/${index}`,
    name: `item-${index}`,
    type: 'Microsoft.Test/items',
    subscriptionId: '11111111-1111-4111-8111-111111111111',
    tags: { Environment: 'prod', Owner: 'security' }
  };
}

test('tags module consumes every Resource Graph page and reports complete coverage', async () => {
  const calls = [];
  const client = {
    async resources(request) {
      calls.push(request);
      if (calls.length === 1) {
        return {
          data: Array.from({ length: 1000 }, (_, index) => resource(index)),
          skipToken: 'page-2'
        };
      }
      return {
        data: Array.from({ length: 500 }, (_, index) => resource(1000 + index))
      };
    }
  };

  const result = await auditTags(
    ['11111111-1111-4111-8111-111111111111'],
    {},
    { resourceGraphClient: client, maxRows: 5000, maxPages: 10, logger: { error() {} } }
  );

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.summary.totalResourcesScanned, 1500);
  assert.equal(result.summary.resourceGraphTruncated, false);
  assert.equal(result.summary.untaggedCount, 0);
  assert.equal(result.summary.missingMandatoryTagsCount, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.skipToken, 'page-2');
});

test('tags module exposes partial coverage when the Resource Graph limit is reached', async () => {
  const client = {
    async resources() {
      return {
        data: Array.from({ length: 1000 }, (_, index) => resource(index)),
        skipToken: 'more'
      };
    }
  };

  const result = await auditTags(
    ['11111111-1111-4111-8111-111111111111'],
    {},
    { resourceGraphClient: client, maxRows: 1000, maxPages: 10, logger: { error() {} } }
  );

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.summary.resourceGraphTruncated, true);
  assert.equal(result.summary.partialErrorsCount, 1);
  assert.equal(result.details.partialErrors[0].code, 'RESOURCE_GRAPH_TRUNCATED');
});
