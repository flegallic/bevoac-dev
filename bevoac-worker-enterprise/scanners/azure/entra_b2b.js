// scanners/azure/entra_b2b.js
/* eslint-disable no-console */

const { Client } = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch"); // Required by Graph Client

/**
 * Audits Microsoft Entra ID specifically for B2B/Guest User anomalies.
 *
 * @param {string} tenantId - The Microsoft Tenant ID to audit.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential for Graph.
 * @returns {Promise<Object>} - Entra B2B module results block.
 */
async function auditEntraB2B(tenantId, credential) {
    const startTime = Date.now();
    console.log(`[ENTRA-B2B-SCAN] Starting Guest Account audit for tenant: ${tenantId}`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            staleGuests: [],
            guestAdmins: [],
            guestsMissingMfa: [],
            partialErrors: []
        },
        summary: {
            totalGuests: 0,
            staleGuestsCount: 0,
            guestAdminsCount: 0,
            guestsMissingMfaCount: 0,
            partialErrorsCount: 0
        }
    };

    try {
        // Initialize Microsoft Graph Client using the Azure Credential
        const graphClient = Client.init({
            authProvider: async (done) => {
                try {
                    const token = await credential.getToken("https://graph.microsoft.com/.default");
                    done(null, token.token);
                } catch (err) {
                    done(err, null);
                }
            }
        });

        // ==========================================
        // 1. FETCH ALL GUEST USERS (with SignInActivity)
        // ==========================================
        console.log(`[ENTRA-B2B-SCAN] Fetching all Guest users...`);
        const guests = [];
        try {
            // Need AuditLog.Read.All and User.Read.All permissions for signInActivity
            let guestResponse = await graphClient
                .api('/users')
                .filter("userType eq 'Guest'")
                .select('id,displayName,userPrincipalName,createdDateTime,signInActivity')
                .top(500)
                .get();

            if (guestResponse && guestResponse.value) {
                guests.push(...guestResponse.value);
            }

            while (guestResponse['@odata.nextLink']) {
                guestResponse = await graphClient.api(guestResponse['@odata.nextLink']).get();
                if (guestResponse && guestResponse.value) {
                    guests.push(...guestResponse.value);
                }
            }

            result.summary.totalGuests = guests.length;
        } catch (error) {
            console.error(`[ENTRA-B2B-SCAN] Error fetching guests:`, error.message);
            result.details.partialErrors.push({ engine: "GuestUsers", error: error.message });
        }

        // Process Guest Data
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        for (const guest of guests) {
            // A. Check for Stale Accounts (> 90 days no login)
            let isStale = false;
            let lastSignIn = null;

            if (guest.signInActivity && guest.signInActivity.lastSignInDateTime) {
                lastSignIn = new Date(guest.signInActivity.lastSignInDateTime);
                if (lastSignIn < ninetyDaysAgo) {
                    isStale = true;
                }
            } else {
                // If they never signed in, check if the account was created > 90 days ago
                const createdAt = new Date(guest.createdDateTime);
                if (createdAt < ninetyDaysAgo) {
                    isStale = true;
                    lastSignIn = "Never";
                }
            }

            if (isStale) {
                result.details.staleGuests.push({
                    id: guest.id,
                    userPrincipalName: guest.userPrincipalName,
                    displayName: guest.displayName,
                    lastSignIn: lastSignIn === "Never" ? null : lastSignIn.toISOString()
                });
            }

            // B. Check for MFA Registration
            // Requires UserAuthenticationMethod.Read.All permission
            try {
                const methodsResponse = await graphClient
                    .api(`/users/${guest.id}/authentication/methods`)
                    .get();

                const hasMfa = methodsResponse.value && methodsResponse.value.some(method =>
                    ['microsoftAuthenticatorAuthenticationMethod', 'fido2AuthenticationMethod', 'phoneAuthenticationMethod'].includes(method['@odata.type'].split('.').pop())
                );

                if (!hasMfa) {
                    result.details.guestsMissingMfa.push({
                        id: guest.id,
                        userPrincipalName: guest.userPrincipalName,
                        displayName: guest.displayName
                    });
                }
            } catch (error) {
                // If we get 403, we just skip MFA check to avoid crashing the whole scan (Defensive programming)
                if (!result.details.partialErrors.find(e => e.engine === "GuestMfa")) {
                    result.details.partialErrors.push({ engine: "GuestMfa", error: "Missing permissions to read Authentication Methods." });
                }
            }
        }

        // ==========================================
        // 2. CHECK GUEST ADMINS (Global Administrator Role)
        // ==========================================
        console.log(`[ENTRA-B2B-SCAN] Checking Global Administrator role assignments...`);
        try {
            // RoleTemplateId for Global Administrator is always '62e90394-69f5-4237-9190-012177145e10'
            const roleResponse = await graphClient
                .api("/roleManagement/directory/roleAssignments")
                .filter("roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'")
                .expand("principal")
                .get();

            if (roleResponse && roleResponse.value) {
                for (const assignment of roleResponse.value) {
                    const principal = assignment.principal;
                    if (principal && principal.userType === 'Guest') {
                        result.details.guestAdmins.push({
                            id: principal.id,
                            userPrincipalName: principal.userPrincipalName,
                            displayName: principal.displayName
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[ENTRA-B2B-SCAN] Error fetching role assignments:`, error.message);
            result.details.partialErrors.push({ engine: "RoleAssignments", error: error.message });
        }

        // Update counts
        result.summary.staleGuestsCount = result.details.staleGuests.length;
        result.summary.guestAdminsCount = result.details.guestAdmins.length;
        result.summary.guestsMissingMfaCount = result.details.guestsMissingMfa.length;
        result.summary.partialErrorsCount = result.details.partialErrors.length;

        // --- Build standardized checks output ---

        // CHECK 1: Stale Guest Accounts
        if (result.summary.staleGuestsCount > 0) {
            result.checks.push({
                area: "External Identities",
                title: "Stale B2B Guest accounts detected (>90 days)",
                status: "FAILED",
                checkId: "CHECK-ENTRA-B2B-001",
                severity: "MEDIUM",
                description: "Guest users were found who have not signed in for over 90 days. Unused external accounts increase the attack surface if the partner's credentials become compromised.",
                resourceType: "Microsoft Graph/Users",
                recommendation: "Implement automated Access Reviews for B2B collaboration to periodically require guests or their sponsors to attest to the continued need for access.",
                affectedResourcesCount: result.summary.staleGuestsCount,
                affectedResourcesSample: result.details.staleGuests.slice(0, 5)
            });
        }

        // CHECK 2: Guest Global Administrators
        if (result.summary.guestAdminsCount > 0) {
            result.checks.push({
                area: "External Identities",
                title: "Guest users have Global Administrator rights",
                status: "FAILED",
                checkId: "CHECK-ENTRA-B2B-002",
                severity: "CRITICAL",
                description: "External B2B guest accounts have been assigned the Global Administrator role. This is a severe security risk as compromising an external identity gives full control over the tenant.",
                resourceType: "Microsoft Graph/RoleAssignments",
                recommendation: "Immediately revoke the Global Administrator role from all guest accounts. If external support requires admin rights, use Privileged Identity Management (PIM) with Just-In-Time (JIT) access.",
                affectedResourcesCount: result.summary.guestAdminsCount,
                affectedResourcesSample: result.details.guestAdmins.slice(0, 5)
            });
        }

        // CHECK 3: Guests missing MFA
        if (result.summary.guestsMissingMfaCount > 0) {
            result.checks.push({
                area: "External Identities",
                title: "Guest accounts without MFA methods registered",
                status: "WARNING",
                checkId: "CHECK-ENTRA-B2B-003",
                severity: "HIGH",
                description: "External guest accounts do not have Multi-Factor Authentication registered. Attackers often target B2B accounts because they might have weaker security policies than internal employees.",
                resourceType: "Microsoft Graph/AuthenticationMethods",
                recommendation: "Configure a Conditional Access policy that enforces MFA for all 'Guest or external users' accessing any cloud apps.",
                affectedResourcesCount: result.summary.guestsMissingMfaCount,
                affectedResourcesSample: result.details.guestsMissingMfa.slice(0, 5)
            });
        }

        // PASSED CHECK
        if (
            result.summary.staleGuestsCount === 0 &&
            result.summary.guestAdminsCount === 0 &&
            result.summary.guestsMissingMfaCount === 0
        ) {
            result.checks.push({
                area: "External Identities",
                title: "B2B Guest identity posture is healthy",
                status: "PASSED",
                checkId: "CHECK-ENTRA-B2B-000",
                severity: "INFO",
                description: "No inactive guest accounts, unmanaged guest admins, or guests lacking MFA were detected.",
                resourceType: "Multiple",
                recommendation: "Continue to enforce Conditional Access for external identities and conduct regular access reviews.",
                affectedResourcesCount: 0,
                affectedResourcesSample: []
            });
        }

        result.status = "SUCCESS";

    } catch (error) {
        console.error(`[ENTRA-B2B-SCAN] Fatal error in Entra B2B module:`, error.message);
        result.status = "FAILED";
        result.checks.push({
            area: "External Identities",
            title: "Entra B2B Scan Failed",
            status: "FAILED",
            checkId: "CHECK-ENTRA-B2B-ERR",
            severity: "HIGH",
            description: `Module execution crashed: ${error.message}`,
            recommendation: "Verify the Microsoft Graph API permissions (AuditLog.Read.All, User.Read.All, RoleManagement.Read.Directory) and admin consent."
        });
    }

    result.duration_ms = Date.now() - startTime;
    console.log(`[ENTRA-B2B-SCAN] Completed in ${result.duration_ms}ms.`);
    return result;
}

module.exports = { auditEntraB2B };