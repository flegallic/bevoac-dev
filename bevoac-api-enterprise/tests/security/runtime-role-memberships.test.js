'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRuntimeRoleMemberships,
  isSafeAdministrativeRuntimeMembership
} = require('../../scripts/lib/runtime-role-memberships');

const runtimeRoles = Object.freeze([
  'bevoac_api',
  'bevoac_worker',
  'bevoac_outbox',
  'bevoac_retention',
  'bevoac_admin_api',
  'bevoac_operator'
]);

function membership(overrides = {}) {
  return {
    granted_role: 'bevoac_api',
    member_role: 'bevoacadmin',
    grantor_role: 'azuresu',
    grantor_superuser: true,
    admin_option: true,
    inherit_option: false,
    set_option: false,
    ...overrides
  };
}

test('accepts PostgreSQL 16 automatic administrative membership', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership(),
      runtimeRoles,
      'bevoacadmin'
    ),
    true
  );
});

test('accepts the same automatic membership with a generic superuser grantor', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership({ grantor_role: 'postgres' }),
      runtimeRoles,
      'bevoacadmin'
    ),
    true
  );
});

test('rejects memberships that inherit runtime privileges', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership({ inherit_option: true }),
      runtimeRoles,
      'bevoacadmin'
    ),
    false
  );
});

test('rejects memberships that permit SET ROLE', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership({ set_option: true }),
      runtimeRoles,
      'bevoacadmin'
    ),
    false
  );
});

test('rejects memberships granted to a non-administrator member', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership({ member_role: 'another_role' }),
      runtimeRoles,
      'bevoacadmin'
    ),
    false
  );
});

test('rejects memberships granted by a non-superuser', () => {
  assert.equal(
    isSafeAdministrativeRuntimeMembership(
      membership({ grantor_superuser: false }),
      runtimeRoles,
      'bevoacadmin'
    ),
    false
  );
});

test('rejects a runtime role being made a member of another role', () => {
  const result = classifyRuntimeRoleMemberships([
    membership({
      granted_role: 'another_role',
      member_role: 'bevoac_api',
      grantor_superuser: true
    })
  ], runtimeRoles, 'bevoacadmin');

  assert.equal(result.safeAdministrative.length, 0);
  assert.equal(result.unsafe.length, 1);
});
