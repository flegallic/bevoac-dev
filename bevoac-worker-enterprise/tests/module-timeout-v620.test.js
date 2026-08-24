'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTimeout, ModuleTimeoutError } = require('../src/lib/module-timeout');

test('withTimeout aborts the operation signal and rejects on deadline', async () => {
  let observedAbort = false;
  const promise = withTimeout('slow-module', 20, async ({ signal }) => {
    await new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        resolve();
      }, { once: true });
    });
    return 'late-result';
  });

  await assert.rejects(promise, (error) => error instanceof ModuleTimeoutError && error.code === 'MODULE_TIMEOUT');
  assert.equal(observedAbort, true);
});

test('withTimeout rejects immediately when parent signal aborts', async () => {
  const parent = new AbortController();
  const promise = withTimeout('child-module', 5000, async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return 'late-result';
  }, { parentSignal: parent.signal });

  parent.abort(new Error('global scan cancelled'));
  await assert.rejects(promise, /global scan cancelled/);
});

test('withTimeout returns a successful operation before the deadline', async () => {
  const value = await withTimeout('fast-module', 1000, async () => 'ok');
  assert.equal(value, 'ok');
});
