'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  withDatabaseSession,
  withDatabaseTransaction
} = require('../../src/lib/db-context');

class FakeClient {
  constructor() {
    this.calls = [];
    this.released = false;
  }

  async query(sql) {
    this.calls.push(sql);

    return {
      rowCount: 0,
      rows: []
    };
  }

  release() {
    this.released = true;
  }
}

class FakePool {
  constructor(client) {
    this.client = client;
  }

  async connect() {
    return this.client;
  }
}

test(
  'neutral database session does not set mutable security context',
  async () => {
    const client = new FakeClient();

    const value = await withDatabaseSession(
      new FakePool(client),
      async (session) => {
        await session.query('SELECT 1');
        return 'ok';
      }
    );

    assert.equal(value, 'ok');
    assert.deepEqual(client.calls, ['SELECT 1']);
    assert.equal(client.released, true);
  }
);

test(
  'neutral database transaction controls commit and release',
  async () => {
    const client = new FakeClient();

    await withDatabaseTransaction(
      new FakePool(client),
      async (transaction) => {
        await transaction.query('SELECT 1');
      }
    );

    assert.deepEqual(
      client.calls,
      [
        'BEGIN',
        'SELECT 1',
        'COMMIT'
      ]
    );

    assert.equal(client.released, true);
  }
);

test(
  'admin billing no longer relies on app.service_context',
  () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../src/services/billing-service.js'
      ),
      'utf8'
    );

    assert.match(source, /withDatabaseSession/);
    assert.match(source, /withDatabaseTransaction/);

    assert.doesNotMatch(
      source,
      /withServiceSession/
    );

    assert.doesNotMatch(
      source,
      /withServiceTransaction/
    );

    assert.doesNotMatch(
      source,
      /bevoac_admin_service/
    );

    assert.match(
      source,
      /withTenantSession/
    );
  }
);

test(
  'dedicated outbox no longer relies on app.service_context',
  () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../src/services/outbox-service.js'
      ),
      'utf8'
    );

    assert.doesNotMatch(
      source,
      /setServiceContext/
    );

    assert.doesNotMatch(
      source,
      /bevoac_outbox_service/
    );

    assert.doesNotMatch(
      source,
      /app\.service_context/
    );
  }
);
