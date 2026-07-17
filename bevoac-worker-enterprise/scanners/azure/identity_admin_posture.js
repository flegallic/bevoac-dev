'use strict';

require('isomorphic-fetch');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'identity_admin_posture';
const PRIVILEGED_ROLE_TEMPLATE_IDS = [
  { id: '62e90394-69f5-4237-9190-012177145e10', name: 'Global Administrator' },
  { id: 'e8611ab8-c189-46e8-94e1-60213ab1f814', name: 'Privileged Role Administrator' },
  { id: '194ae4cb-b126-40b2-bd5b-6091b380977d', name: 'Security Administrator' },
  { id: '29232cdf-9323-42fd-ade2-1d097af3e4de', name: 'Exchange Administrator' },
  { id: '729827e3-9c14-49f7-bb1b-9608f156bbb8', name: 'Helpdesk Administrator' }
];

function buildGraphClient(targetTenantId, credential = null) {
  const effectiveCredential = credential || new ClientSecretCredential(
    targetTenantId,
    process.env.MICROSOFT_CLIENT_ID,
    process.env.MICROSOFT_CLIENT_SECRET
  );
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await effectiveCredential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });
}

async function fetchAllPages(client, apiPath) {
  const all = [];
  let response = await client.api(apiPath).get();
  if (Array.isArray(response?.value)) all.push(...response.value);
  while (response && response['@odata.nextLink']) {
    response = await client.api(response['@odata.nextLink']).get();
    if (Array.isArray(response?.value)) all.push(...response.value);
  }
  return all;
}

function normalizeUser(user, roleName = null) {
  return {
    id: user?.id || null,
    userPrincipalName: user?.userPrincipalName || null,
    displayName: user?.displayName || null,
    userType: user?.userType || null,
    accountEnabled: typeof user?.accountEnabled === 'boolean' ? user.accountEnabled : null,
    lastSignInDateTime: user?.signInActivity?.lastSignInDateTime || null,
    lastPasswordChangeDateTime: user?.lastPasswordChangeDateTime || null,
    roleName
  };
}

async function auditIdentityAdminPosture(targetTenantId, credential = null) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { privilegedUsers: [], privilegedUsersMissingMfa: [], dormantPrivilegedUsers: [], stalePasswordPrivilegedUsers: [], guestPrivilegedUsers: [], partialErrors: [] },
    summary: { privilegedUsersCount: 0, privilegedUsersWithMfaCount: 0, privilegedUsersMissingMfaCount: 0, dormantPrivilegedUsersCount: 0, stalePasswordPrivilegedUsersCount: 0, guestPrivilegedUsersCount: 0, partialErrorsCount: 0 }
  };

  if (!targetTenantId) {
    result.status = 'FAILED';
    result.details.partialErrors.push({ scope: 'identity_admin_posture', message: 'microsoftTenantId is required.' });
    result.summary.partialErrorsCount = 1;
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  try {
    const graphClient = buildGraphClient(targetTenantId, credential);
    const privilegedById = new Map();

    for (const role of PRIVILEGED_ROLE_TEMPLATE_IDS) {
      try {
        const roleRes = await graphClient.api('/directoryRoles').filter(`roleTemplateId eq '${role.id}'`).get();
        const directoryRole = Array.isArray(roleRes?.value) ? roleRes.value[0] : null;
        if (!directoryRole?.id) continue;
        const members = await fetchAllPages(graphClient, `/directoryRoles/${directoryRole.id}/members`);
        for (const member of members) {
          if (!member?.id) continue;
          const existing = privilegedById.get(member.id) || normalizeUser(member, role.name);
          existing.roles = Array.from(new Set([...(existing.roles || []), role.name]));
          privilegedById.set(member.id, existing);
        }
      } catch (error) {
        result.details.partialErrors.push({ scope: `directoryRoles/${role.name}`, message: error.message });
      }
    }

    const privilegedUsers = Array.from(privilegedById.values());
    const mfaRegistration = new Map();
    try {
      const registrations = await fetchAllPages(graphClient, '/reports/credentialUserRegistrationDetails');
      for (const item of registrations) {
        const id = item.id || item.userId;
        if (id) mfaRegistration.set(id, item);
      }
    } catch (error) {
      result.details.partialErrors.push({ scope: 'credentialUserRegistrationDetails', message: error.message });
    }

    const now = new Date();
    const dormantCutoff = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    const passwordCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    for (const user of privilegedUsers) {
      const reg = mfaRegistration.get(user.id);
      const hasMfa = reg ? reg.isMfaRegistered !== false : null;
      user.isMfaRegistered = hasMfa;
      if (hasMfa === true) result.summary.privilegedUsersWithMfaCount += 1;
      if (hasMfa !== true) result.details.privilegedUsersMissingMfa.push(user);
      if (String(user.userType || '').toLowerCase() === 'guest') result.details.guestPrivilegedUsers.push(user);
      if (!user.lastSignInDateTime || new Date(user.lastSignInDateTime) < dormantCutoff) result.details.dormantPrivilegedUsers.push(user);
      if (user.lastPasswordChangeDateTime && new Date(user.lastPasswordChangeDateTime) < passwordCutoff) result.details.stalePasswordPrivilegedUsers.push(user);
    }

    result.details.privilegedUsers = privilegedUsers;
  } catch (error) {
    result.details.partialErrors.push({ scope: 'identity_admin_posture', message: error.message });
  }

  result.summary.privilegedUsersCount = result.details.privilegedUsers.length;
  result.summary.privilegedUsersMissingMfaCount = result.details.privilegedUsersMissingMfa.length;
  result.summary.dormantPrivilegedUsersCount = result.details.dormantPrivilegedUsers.length;
  result.summary.stalePasswordPrivilegedUsersCount = result.details.stalePasswordPrivilegedUsers.length;
  result.summary.guestPrivilegedUsersCount = result.details.guestPrivilegedUsers.length;
  result.summary.partialErrorsCount = result.details.partialErrors.length;

  if (result.summary.privilegedUsersMissingMfaCount > 0) {
    result.checks.push({
      checkId: 'CHECK-IDENTITY-ADMIN-001',
      area: 'Privileged Identity',
      resourceType: 'Microsoft Graph/directoryRoles',
      status: 'FAILED',
      severity: 'CRITICAL',
      title: 'Privileged accounts without confirmed MFA registration',
      description: 'One or more privileged accounts do not have a confirmed MFA registration signal in Microsoft Graph.',
      recommendation: 'Require MFA for all privileged accounts and enforce Conditional Access policies targeting administrator roles.',
      affectedResourcesCount: result.summary.privilegedUsersMissingMfaCount,
      affectedResourcesSample: result.details.privilegedUsersMissingMfa.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-IDENTITY-ADMIN-001',
      area: 'Privileged Identity',
      resourceType: 'Microsoft Graph/directoryRoles',
      status: 'PASSED',
      severity: 'INFO',
      title: 'Privileged accounts have confirmed MFA registration',
      description: 'All discovered privileged accounts have a positive MFA registration signal.',
      recommendation: 'Continue enforcing MFA and review break-glass account exceptions.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  if (result.summary.dormantPrivilegedUsersCount > 0) {
    result.checks.push({
      checkId: 'CHECK-IDENTITY-ADMIN-002',
      area: 'Privileged Identity',
      resourceType: 'Microsoft Graph/directoryRoles',
      status: 'WARNING',
      severity: 'HIGH',
      title: 'Dormant privileged accounts were found',
      description: 'Privileged users with no recent sign-in activity increase the risk of unnoticed compromise or stale access.',
      recommendation: 'Review dormant privileged accounts, remove permanent assignments and prefer PIM/JIT activation.',
      affectedResourcesCount: result.summary.dormantPrivilegedUsersCount,
      affectedResourcesSample: result.details.dormantPrivilegedUsers.slice(0, 10)
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'PRIVILEGED_MFA_COVERAGE',
      label: '% de comptes privilégiés avec MFA confirmé',
      domain: 'privileged_identity',
      compliant: result.summary.privilegedUsersWithMfaCount,
      total: result.summary.privilegedUsersCount,
      warningBelow: 100,
      criticalBelow: 95,
      evidenceSource: 'identity_admin_posture.summary.privilegedUsersWithMfaCount'
    }),
    riskCountKpi({
      kpiId: 'PRIVILEGED_DORMANT_ACCOUNTS',
      label: 'Comptes privilégiés dormants',
      domain: 'privileged_identity',
      count: result.summary.dormantPrivilegedUsersCount,
      warningAt: 1,
      criticalAt: 5,
      evidenceSource: 'identity_admin_posture.details.dormantPrivilegedUsers'
    }),
    riskCountKpi({
      kpiId: 'PRIVILEGED_GUEST_ACCOUNTS',
      label: 'Comptes invités avec privilèges',
      domain: 'privileged_identity',
      count: result.summary.guestPrivilegedUsersCount,
      warningAt: 1,
      criticalAt: 1,
      evidenceSource: 'identity_admin_posture.details.guestPrivilegedUsers'
    })
  ];

  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, ['Microsoft Graph/directoryRoles', 'Microsoft Graph/reports']);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.privilegedUsersCount === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditIdentityAdminPosture, PRIVILEGED_ROLE_TEMPLATE_IDS };
