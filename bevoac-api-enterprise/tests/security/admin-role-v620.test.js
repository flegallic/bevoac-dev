'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claimHasRequiredRole
} = require('../../src/lib/admin-oidc');

test('admin authorization accepts application roles only', () => {
  assert.equal(
    claimHasRequiredRole({ roles: ['Bevoac.Admin'] }, ['Bevoac.Admin']),
    true
  );
  assert.equal(
    claimHasRequiredRole({ scp: 'Bevoac.Admin' }, ['Bevoac.Admin']),
    false
  );
  assert.equal(
    claimHasRequiredRole({ groups: ['Bevoac.Admin'] }, ['Bevoac.Admin']),
    false
  );
});
