// scanners/azure/checkEntraID.js
require('isomorphic-fetch');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { throwIfAborted, azureAbortOptions } = require('../../src/lib/abort');

/**
 * Enterprise-Grade Entra ID (O365) Auditor
 * Format: Standardized CSPM (Cloud Security Posture Management)
 */
async function auditEntraID(targetTenantId, options = {}) {
  throwIfAborted(options.signal, 'Entra audit');
  console.log(`[ENTRA ID] Starting Advanced Cross-Tenant audit for Client Tenant: ${targetTenantId}`);

  const bevoacAppId = process.env.MICROSOFT_CLIENT_ID;
  const bevoacSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!bevoacAppId || !bevoacSecret) {
    return {
      status: "FAILED",
      error: "bevoac App credentials missing in Worker environment."
    };
  }

  try {
    const credential = new ClientSecretCredential(targetTenantId, bevoacAppId, bevoacSecret);
    const graphClient = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default', azureAbortOptions(options.signal));
          return tokenResponse.token;
        }
      }
    });

    const startTime = Date.now();
    const securityChecks = [];

    function normalizeUser(user, extra = {}) {
      return {
        id: user?.id || null,
        userPrincipalName: user?.userPrincipalName || user?.userPrincipalNameValue || null,
        displayName: user?.displayName || user?.userDisplayName || null,
        userType: user?.userType || null,
        accountEnabled: typeof user?.accountEnabled === 'boolean' ? user.accountEnabled : null,
        lastSignInDateTime: user?.signInActivity?.lastSignInDateTime || user?.lastSignInDateTime || null,
        lastPasswordChangeDateTime: user?.lastPasswordChangeDateTime || null,
        riskLevel: extra.riskLevel || user?.riskLevel || "unknown",
        riskState: extra.riskState || user?.riskState || null,
        source: extra.source || null
      };
    }

    async function fetchAllPages(client, apiPath, selectParams = null) {
      let allItems = [];
      let request = client.api(apiPath);

      if (selectParams) {
        request = request.select(selectParams);
      }

      throwIfAborted(options.signal, `Microsoft Graph ${apiPath}`);
      let response = await request.get();
      throwIfAborted(options.signal, `Microsoft Graph ${apiPath}`);

      if (response && response.value) {
        allItems = allItems.concat(response.value);
      }

      while (response && response['@odata.nextLink']) {
        console.log(`[ENTRA ID] Fetching next page for ${apiPath}...`);
        throwIfAborted(options.signal, `Microsoft Graph ${apiPath}`);
        response = await client.api(response['@odata.nextLink']).get();
        throwIfAborted(options.signal, `Microsoft Graph ${apiPath}`);

        if (response && response.value) {
          allItems = allItems.concat(response.value);
        }
      }

      return allItems;
    }

    securityChecks.push({
      checkId: "CHECK-AZ-BASELINE-001",
      status: "INFO",
      severity: "LOW",
      title: "Baseline: Architectural hygiene recommendations (v0)",
      description: "The audit is currently performed via global Cross-Tenant delegation.",
      recommendation: "Plan the upgrade to a 'client-side connector' model (Managed Identity) for improved isolation."
    });

    console.log("[ENTRA ID] Fetching policies, roles, users, MFA registration, and risk signals...");

    let policies = [];
    let usersData = [];
    let mfaRegistrationData = [];
    let globalAdminsCount = 0;
    let guestGlobalAdminsCount = 0;
    let highRiskSignInsCount = 0;

    let guestGlobalAdmins = [];
    let stalePasswordUsers = [];
    let zombieUsers = [];
    let unregisteredMfaUsers = [];
    let highRiskSignIns = [];

    try {
      const [policiesRes, rolesRes, usersRes, mfaRes] = await Promise.allSettled([
        graphClient.api('/identity/conditionalAccess/policies').get(),
        graphClient
          .api('/directoryRoles')
          .filter("roleTemplateId eq '62e90394-69f5-4237-9190-012177145e10'")
          .get(),
        fetchAllPages(
          graphClient,
          '/users',
          'id,displayName,userPrincipalName,lastPasswordChangeDateTime,signInActivity,accountEnabled,userType'
        ),
        fetchAllPages(
          graphClient,
          '/reports/credentialUserRegistrationDetails'
        )
      ]);

      if (policiesRes.status === 'fulfilled') {
        policies = policiesRes.value.value || [];
      } else {
        console.warn(`[ENTRA ID] Conditional Access fetch failed: ${policiesRes.reason?.message || policiesRes.reason}`);
      }

      if (usersRes.status === 'fulfilled') {
        usersData = usersRes.value || [];
      } else {
        console.warn(`[ENTRA ID] Users fetch failed: ${usersRes.reason?.message || usersRes.reason}`);
      }

      if (mfaRes.status === 'fulfilled') {
        mfaRegistrationData = mfaRes.value || [];
      } else {
        console.warn(`[ENTRA ID] MFA registration fetch failed: ${mfaRes.reason?.message || mfaRes.reason}`);
      }

      if (
        rolesRes.status === 'fulfilled' &&
        rolesRes.value &&
        Array.isArray(rolesRes.value.value) &&
        rolesRes.value.value.length > 0
      ) {
        const globalAdminRoleId = rolesRes.value.value[0].id;
        const members = await fetchAllPages(
          graphClient,
          `/directoryRoles/${globalAdminRoleId}/members`
        );

        globalAdminsCount = Array.isArray(members) ? members.length : 0;

        guestGlobalAdmins = (members || [])
          .filter(member => member.userType === 'Guest')
          .map(member =>
            normalizeUser(member, {
              source: "directoryRoles/globalAdministratorMembers"
            })
          );

        guestGlobalAdminsCount = guestGlobalAdmins.length;
      } else if (rolesRes.status === 'rejected') {
        console.warn(`[ENTRA ID] Directory roles fetch failed: ${rolesRes.reason?.message || rolesRes.reason}`);
      }

      try {
        const riskySignInsRes = await fetchAllPages(
          graphClient,
          '/identityProtection/riskySignIns'
        );

        highRiskSignIns = (riskySignInsRes || [])
          .filter(signIn =>
            signIn.riskLevelDuringSignIn === 'high' ||
            signIn.riskLevelAggregated === 'high'
          )
          .map(signIn => ({
            id: signIn.id || null,
            userPrincipalName: signIn.userPrincipalName || null,
            displayName: signIn.userDisplayName || null,
            userType: null,
            accountEnabled: null,
            lastSignInDateTime: signIn.createdDateTime || null,
            lastPasswordChangeDateTime: null,
            riskLevel: signIn.riskLevelDuringSignIn || signIn.riskLevelAggregated || "high",
            riskState: signIn.riskState || null,
            source: "identityProtection/riskySignIns"
          }));

        highRiskSignInsCount = highRiskSignIns.length;
      } catch (riskErr) {
        console.warn(`[ENTRA ID] Risky sign-ins query failed: ${riskErr.message}`);
      }
    } catch (err) {
      console.error(`[ENTRA ID] Partial Data Fetch Error: ${err.message}`);
    }

    // -----------------------------------------------------------------
    // EVALUATION 1: CONDITIONAL ACCESS
    // -----------------------------------------------------------------
    let mfaEnforcedForAdmins = false;
    let legacyAuthBlocked = false;

    for (const policy of policies) {
      if (policy.state !== 'enabled') {
        continue;
      }

      const builtInControls = policy?.grantControls?.builtInControls || [];
      const clientAppTypes = policy?.conditions?.clientAppTypes || [];

      if (builtInControls.includes('mfa')) {
        mfaEnforcedForAdmins = true;
      }

      if (
        clientAppTypes.includes('exchangeActiveSync') &&
        builtInControls.includes('block')
      ) {
        legacyAuthBlocked = true;
      }
    }

    securityChecks.push(
      !mfaEnforcedForAdmins
        ? {
            checkId: "CHECK-ENTRA-CA-001",
            status: "FAILED",
            severity: "CRITICAL",
            title: "Absence of strictly enforced Multi-Factor Authentication",
            description: `Out of ${policies.length} detected policies, none strictly enforce MFA requirements.`,
            recommendation: "Create a Conditional Access policy targeting 'All Users' or administrative roles to require Multi-Factor Authentication."
          }
        : {
            checkId: "CHECK-ENTRA-CA-001",
            status: "PASSED",
            severity: "INFO",
            title: "Multi-Factor Authentication is enforced",
            description: "A valid Conditional Access policy enforcing MFA has been detected.",
            recommendation: "Maintain a regular review of MFA exclusion groups (e.g., Break-glass accounts)."
          }
    );

    securityChecks.push(
      !legacyAuthBlocked
        ? {
            checkId: "CHECK-ENTRA-CA-002",
            status: "FAILED",
            severity: "HIGH",
            title: "Legacy Authentication is not blocked",
            description: "Authentication via older protocols (POP, IMAP, ActiveSync) is not explicitly blocked, increasing vulnerability to password spraying attacks.",
            recommendation: "Create a Conditional Access policy to explicitly block 'Legacy authentication clients'."
          }
        : {
            checkId: "CHECK-ENTRA-CA-002",
            status: "PASSED",
            severity: "INFO",
            title: "Legacy Authentication is blocked",
            description: "A Conditional Access policy successfully blocks older, insecure authentication protocols.",
            recommendation: "Continue to enforce modern authentication standards across all new enterprise applications."
          }
    );

    // -----------------------------------------------------------------
    // EVALUATION 2: PRIVILEGED ROLES
    // -----------------------------------------------------------------
    securityChecks.push(
      globalAdminsCount > 5
        ? {
            checkId: "CHECK-ENTRA-ROLES-001",
            status: "FAILED",
            severity: "MEDIUM",
            title: "Excessive number of Global Administrators",
            description: `The tenant currently has ${globalAdminsCount} Global Administrators, exceeding Microsoft's strict recommendation of 5 maximum.`,
            recommendation: "Reduce the number of permanent Global Admins and implement Microsoft Entra PIM to grant this role exclusively via 'Just-In-Time' access."
          }
        : {
            checkId: "CHECK-ENTRA-ROLES-001",
            status: "PASSED",
            severity: "INFO",
            title: "Healthy Global Administrator management",
            description: `The tenant has ${globalAdminsCount} Global Administrators, which is within the recommended limit of 5.`,
            recommendation: "Continue applying the Principle of Least Privilege (PoLP) when onboarding new personnel."
          }
    );

    securityChecks.push(
      guestGlobalAdminsCount > 0
        ? {
            checkId: "CHECK-ENTRA-ROLES-002",
            status: "FAILED",
            severity: "HIGH",
            title: "Guest users with permanent Global Administrator role",
            description: `Detected ${guestGlobalAdminsCount} guest accounts holding a permanent Global Administrator role.`,
            recommendation: "Remove permanent Global Administrator assignments from guest accounts and use Just-In-Time elevation via PIM if absolutely necessary.",
            affectedUsersCount: guestGlobalAdmins.length,
            affectedUsersSample: guestGlobalAdmins.slice(0, 10)
          }
        : {
            checkId: "CHECK-ENTRA-ROLES-002",
            status: "PASSED",
            severity: "INFO",
            title: "No guest users with permanent Global Administrator role",
            description: "No external guest accounts hold a permanent Global Administrator role.",
            recommendation: "Continue to review privileged assignments regularly and prefer Just-In-Time access via PIM.",
            affectedUsersCount: 0,
            affectedUsersSample: []
          }
    );

    // -----------------------------------------------------------------
    // EVALUATION 3: USER HYGIENE
    // -----------------------------------------------------------------
    let stalePasswordUsersCount = 0;
    let zombieUsersCount = 0;
    let mfaRegisteredCount = 0;
    let mfaUnregisteredCount = 0;

    if (usersData.length > 0) {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      stalePasswordUsers = usersData
        .filter(user => {
          if (!user.lastPasswordChangeDateTime) {
            return false;
          }

          const pwdDate = new Date(user.lastPasswordChangeDateTime);
          return pwdDate < ninetyDaysAgo && user.accountEnabled;
        })
        .map(user =>
          normalizeUser(user, {
            source: "users/stalePassword"
          })
        );

      stalePasswordUsersCount = stalePasswordUsers.length;

      securityChecks.push(
        stalePasswordUsersCount > 0
          ? {
              checkId: "CHECK-ENTRA-USR-001",
              status: "FAILED",
              severity: "MEDIUM",
              title: "Active users with stale passwords (> 90 days)",
              description: `Detected ${stalePasswordUsersCount} active users who have not changed their password in over 90 days.`,
              recommendation: "Enforce a password rotation policy or mitigate risk by ensuring MFA is strictly applied to these accounts.",
              affectedUsersCount: stalePasswordUsers.length,
              affectedUsersSample: stalePasswordUsers.slice(0, 10)
            }
          : {
              checkId: "CHECK-ENTRA-USR-001",
              status: "PASSED",
              severity: "INFO",
              title: "Password age compliance",
              description: "No active users were found with a password older than 90 days.",
              recommendation: "Maintain current password rotation lifecycle.",
              affectedUsersCount: 0,
              affectedUsersSample: []
            }
      );

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      zombieUsers = usersData
        .filter(user => {
          if (!user.accountEnabled) {
            return false;
          }

          if (!user.signInActivity || !user.signInActivity.lastSignInDateTime) {
            return true;
          }

          const lastSignIn = new Date(user.signInActivity.lastSignInDateTime);
          return lastSignIn < thirtyDaysAgo;
        })
        .map(user =>
          normalizeUser(user, {
            source: "users/inactive"
          })
        );

      zombieUsersCount = zombieUsers.length;

      securityChecks.push(
        zombieUsersCount > 0
          ? {
              checkId: "CHECK-ENTRA-USR-002",
              status: "FAILED",
              severity: "LOW",
              title: "Inactive or Zombie Accounts detected",
              description: `Detected ${zombieUsersCount} active accounts with no sign-in activity in the last 30 days. This consumes licenses and increases attack surface.`,
              recommendation: "Disable or delete inactive accounts and reclaim associated Microsoft 365 licenses.",
              affectedUsersCount: zombieUsers.length,
              affectedUsersSample: zombieUsers.slice(0, 10)
            }
          : {
              checkId: "CHECK-ENTRA-USR-002",
              status: "PASSED",
              severity: "INFO",
              title: "No inactive zombie accounts over 30 days",
              description: "No active accounts were found without sign-in activity for more than 30 days.",
              recommendation: "Maintain regular reviews of inactive accounts to keep license usage optimized.",
              affectedUsersCount: 0,
              affectedUsersSample: []
            }
      );
    }

    if (mfaRegistrationData.length > 0) {
      unregisteredMfaUsers = mfaRegistrationData
        .filter(user => user.isMfaRegistered === false)
        .map(user => ({
          id: user.id || null,
          userPrincipalName: user.userPrincipalName || null,
          displayName: user.userDisplayName || null,
          userType: user.userType || null,
          accountEnabled: null,
          lastSignInDateTime: null,
          lastPasswordChangeDateTime: null,
          riskLevel: "unknown",
          riskState: null,
          source: "reports/credentialUserRegistrationDetails",
          isMfaRegistered: false
        }));

      mfaUnregisteredCount = unregisteredMfaUsers.length;
      mfaRegisteredCount = mfaRegistrationData.length - mfaUnregisteredCount;

      securityChecks.push(
        mfaUnregisteredCount > 0
          ? {
              checkId: "CHECK-ENTRA-MFA-001",
              status: "FAILED",
              severity: "HIGH",
              title: "Users missing MFA registration",
              description: `Detected ${mfaUnregisteredCount} users who have not registered any Multi-Factor Authentication method.`,
              recommendation: "Trigger a Microsoft Entra ID Registration Campaign to force users to register an authenticator app or phone number upon next login.",
              affectedUsersCount: unregisteredMfaUsers.length,
              affectedUsersSample: unregisteredMfaUsers.slice(0, 10)
            }
          : {
              checkId: "CHECK-ENTRA-MFA-001",
              status: "PASSED",
              severity: "INFO",
              title: "All users have registered MFA",
              description: "All accounts in the tenant have at least one Multi-Factor Authentication method registered.",
              recommendation: "Continue to enforce MFA registration and review methods periodically.",
              affectedUsersCount: 0,
              affectedUsersSample: []
            }
      );
    }

    securityChecks.push(
      highRiskSignInsCount > 0
        ? {
            checkId: "CHECK-ENTRA-RISK-001",
            status: "FAILED",
            severity: "HIGH",
            title: "High-risk sign-ins detected",
            description: `Detected ${highRiskSignInsCount} sign-ins classified as high risk during the analysis window.`,
            recommendation: "Investigate high-risk sign-ins in Microsoft Entra ID Protection and remediate compromised accounts immediately.",
            affectedUsersCount: highRiskSignIns.length,
            affectedUsersSample: highRiskSignIns.slice(0, 10)
          }
        : {
            checkId: "CHECK-ENTRA-RISK-001",
            status: "PASSED",
            severity: "INFO",
            title: "No high-risk sign-ins detected during the analysis window",
            description: "No sign-ins were classified as high risk according to Microsoft Entra ID Protection risk signals.",
            recommendation: "Maintain monitoring of risky sign-ins and configure alerts for sudden spikes.",
            affectedUsersCount: 0,
            affectedUsersSample: []
          }
    );

    const durationMs = Date.now() - startTime;
    console.log(`[ENTRA ID] Audit completed in ${durationMs}ms. Analyzed ${usersData.length} users.`);

    const summary = {
      totalUsers: usersData.length,
      globalAdmins: globalAdminsCount,
      guestGlobalAdmins: guestGlobalAdminsCount,
      mfaRegisteredUsers: mfaRegisteredCount,
      mfaMissingUsers: mfaUnregisteredCount,
      stalePasswordUsersOver90d: stalePasswordUsersCount,
      inactiveUsersOver30d: zombieUsersCount,
      highRiskSignInsCount,
      conditionalAccessSummary: {
        totalPolicies: policies.length,
        mfaEnforcedForAdmins,
        legacyAuthBlocked
      }
    };

    return {
      status: "SUCCESS",
      duration_ms: durationMs,
      users_analyzed: usersData.length,
      summary,
      checks: securityChecks,
      details: {
        stalePasswordUsers,
        inactiveUsers: zombieUsers,
        usersMissingMfa: unregisteredMfaUsers,
        guestGlobalAdmins,
        highRiskSignIns
      }
    };
  } catch (criticalError) {
    console.error(`[ENTRA ID] CRITICAL ERROR: ${criticalError.message}`);
    return {
      status: "FAILED",
      error: "Cross-Tenant Authentication Error or insufficient permissions.",
      details: criticalError.message
    };
  }
}

module.exports = { auditEntraID };