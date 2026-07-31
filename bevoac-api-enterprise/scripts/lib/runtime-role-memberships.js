'use strict';

function normalizeRuntimeRoles(runtimeRoles) {
  return runtimeRoles instanceof Set ? runtimeRoles : new Set(runtimeRoles);
}

function isSafeAdministrativeRuntimeMembership(row, runtimeRoles, adminRole) {
  const runtimeSet = normalizeRuntimeRoles(runtimeRoles);
  return runtimeSet.has(row.granted_role) &&
    row.member_role === adminRole &&
    row.grantor_superuser === true &&
    row.admin_option === true &&
    row.inherit_option === false &&
    row.set_option === false;
}

function classifyRuntimeRoleMemberships(rows, runtimeRoles, adminRole) {
  const safeAdministrative = [];
  const unsafe = [];

  for (const row of rows) {
    if (isSafeAdministrativeRuntimeMembership(row, runtimeRoles, adminRole)) {
      safeAdministrative.push(row);
    } else {
      unsafe.push(row);
    }
  }

  return { safeAdministrative, unsafe };
}

module.exports = {
  classifyRuntimeRoleMemberships,
  isSafeAdministrativeRuntimeMembership
};
