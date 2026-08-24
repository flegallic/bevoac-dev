'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runResourceGraphQueryDetailed
} = require('../src/lib/resource-graph');

function page(rows, skipToken = null) {
  return {
    data: rows,
    ...(skipToken ? { skipToken } : {})
  };
}

test('Resource Graph consumes all pages beyond 1000 rows', async () => {
  const calls = [];
  const client = {
    async resources(request) {
      calls.push(request);
      if (calls.length === 1) {
        return page(Array.from({ length: 1000 }, (_, i) => ({ id: i })), 'next-1');
      }
      return page(Array.from({ length: 500 }, (_, i) => ({ id: 1000 + i })));
    }
  };

  const result = await runResourceGraphQueryDetailed(
    {},
    ['11111111-1111-4111-8111-111111111111'],
    'Resources',
    { client, pageSize: 1000, maxRows: 5000, maxPages: 10 }
  );

  assert.equal(result.rows.length, 1500);
  assert.equal(result.metadata.pagesProcessed, 2);
  assert.equal(result.metadata.truncated, false);
  assert.equal(calls[1].options.skipToken, 'next-1');
});

test('Resource Graph reports bounded truncation explicitly', async () => {
  const client = {
    async resources() {
      return page(Array.from({ length: 1000 }, (_, i) => ({ id: i })), 'next');
    }
  };

  const result = await runResourceGraphQueryDetailed(
    {},
    ['11111111-1111-4111-8111-111111111111'],
    'Resources',
    { client, pageSize: 1000, maxRows: 1000, maxPages: 10 }
  );

  assert.equal(result.metadata.truncated, true);
  assert.equal(result.metadata.truncationReason, 'MAX_ROWS_REACHED');
});

test('Resource Graph never returns more than maxRows even if a page ignores requested top', async () => {
  const client = {
    async resources() {
      return page(Array.from({ length: 750 }, (_, i) => ({ id: i })), 'next');
    }
  };

  const result = await runResourceGraphQueryDetailed(
    {},
    ['11111111-1111-4111-8111-111111111111'],
    'Resources',
    { client, pageSize: 500, maxRows: 500, maxPages: 10 }
  );

  assert.equal(result.rows.length, 500);
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.metadata.truncationReason, 'MAX_ROWS_REACHED');
});
