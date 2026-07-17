// scanners/azure/governance.js
/* eslint-disable no-console */

const { SecurityCenter } = require("@azure/arm-security");
const { PolicyClient } = require("@azure/arm-policy");

/**
 * Audits Azure Governance, including Microsoft Defender for Cloud and Azure Policy assignments.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - Governance module results block.
 */
async function auditGovernance(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[GOVERNANCE-SCAN] Starting Governance audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            subscriptionsWithoutDefender: [],
            subscriptionsWithoutSecurityPolicy: []
        },
        summary: {
            totalSubscriptions: subscriptions.length,
            partialErrorsCount: 0,
            missingDefenderCount: 0,
            missingSecurityPolicyCount: 0
        }
    };

    for (const subId of subscriptions) {
        console.log(`[GOVERNANCE-SCAN] Scanning subscription: ${subId}`);

        // ==========================================
        // 1. MICROSOFT DEFENDER FOR CLOUD (Security Center)
        // ==========================================
        try {
            const securityClient = new SecurityCenter(credential, subId);

            // In Azure SDK, pricings.list() returns the Defender plans (VirtualMachines, SqlServers, AppServices, etc.)
            // as well as the foundational CSPM (CloudPostures).
            const pricings = [];
            if (typeof securityClient.pricings?.list === 'function') {
                const listResult = securityClient.pricings.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const pricing of listResult) {
                        pricings.push(pricing);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) pricings.push(...response.value);
                    else if (Array.isArray(response)) pricings.push(...response);
                }
            }

            // Check if any plan is explicitly set to 'Standard' (which means paid Defender is ON for that resource type)
            // or if CloudPostures is enabled. If everything is 'Free', Defender is basically off.
            let hasActiveDefenderPlan = false;
            for (const plan of pricings) {
                if (plan.pricingTier === 'Standard') {
                    hasActiveDefenderPlan = true;
                    break;
                }
            }

            if (!hasActiveDefenderPlan) {
                result.details.subscriptionsWithoutDefender.push({
                    subscriptionId: subId,
                    issue: "Defender for Cloud plans are set to Free/Disabled."
                });
            }

        } catch (error) {
            console.error(`[GOVERNANCE-SCAN] Error scanning Defender in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Defender For Cloud", error: error.message });
        }

        // ==========================================
        // 2. AZURE POLICY ASSIGNMENTS
        // ==========================================
        try {
            const policyClient = new PolicyClient(credential, subId);
            const assignments = [];

            if (typeof policyClient.policyAssignments?.list === 'function') {
                const listResult = policyClient.policyAssignments.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const assignment of listResult) {
                        assignments.push(assignment);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) assignments.push(...response.value);
                    else if (Array.isArray(response)) assignments.push(...response);
                }
            }

            // We look for built-in security initiatives like "Azure Security Benchmark" or "Defender"
            let hasSecurityInitiative = false;
            for (const assignment of assignments) {
                const name = (assignment.displayName || assignment.name || "").toLowerCase();
                const policyDefId = (assignment.policyDefinitionId || "").toLowerCase();

                if (
                    name.includes("security") ||
                    name.includes("defender") ||
                    name.includes("cis") ||
                    name.includes("iso") ||
                    policyDefId.includes("1f3afdf9-d0c9-4c3d-847f-89da613e70a8") // Azure Security Benchmark ID
                ) {
                    hasSecurityInitiative = true;
                    break;
                }
            }

            if (!hasSecurityInitiative) {
                result.details.subscriptionsWithoutSecurityPolicy.push({
                    subscriptionId: subId,
                    issue: "No overarching security policy or benchmark initiative is assigned to this subscription."
                });
            }

        } catch (error) {
            console.error(`[GOVERNANCE-SCAN] Error scanning Azure Policy in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Azure Policy", error: error.message });
        }
    }

    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.missingDefenderCount = result.details.subscriptionsWithoutDefender.length;
    result.summary.missingSecurityPolicyCount = result.details.subscriptionsWithoutSecurityPolicy.length;

    // --- Build standardized checks output ---

    // CHECK 1: Microsoft Defender for Cloud
    if (result.summary.missingDefenderCount > 0) {
        result.checks.push({
            area: "Governance & Compliance",
            title: "Microsoft Defender for Cloud is not enabled",
            status: "FAILED",
            checkId: "CHECK-AZ-GOV-001",
            severity: "HIGH",
            description: "Microsoft Defender for Cloud (formerly Azure Security Center) plans are disabled or set to 'Free'. This leaves your cloud environment without advanced threat protection, anomaly detection, and continuous posture management.",
            resourceType: "Microsoft.Security/pricings",
            recommendation: "Enable Microsoft Defender for Cloud 'Standard' plans for critical resource types (at least CSPM, Servers, and Databases) to benefit from active threat intelligence.",
            affectedResourcesCount: result.summary.missingDefenderCount,
            affectedResourcesSample: result.details.subscriptionsWithoutDefender
        });
    } else {
        result.checks.push({
            area: "Governance & Compliance",
            title: "Microsoft Defender for Cloud is enabled",
            status: "PASSED",
            checkId: "CHECK-AZ-GOV-001",
            severity: "INFO",
            description: "At least one advanced Microsoft Defender for Cloud plan is enabled on the analyzed subscriptions.",
            resourceType: "Microsoft.Security/pricings",
            recommendation: "Regularly review the Defender secure score and address the highest priority recommendations.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 2: Azure Policy Assignments
    if (result.summary.missingSecurityPolicyCount > 0) {
        result.checks.push({
            area: "Governance & Compliance",
            title: "No Security Benchmark Policy assigned",
            status: "FAILED",
            checkId: "CHECK-AZ-GOV-002",
            severity: "MEDIUM",
            description: "The subscription does not have a global security policy initiative assigned (like the Microsoft Cloud Security Benchmark, CIS, or ISO 27001). Without a global policy, it is difficult to enforce compliance at scale.",
            resourceType: "Microsoft.Authorization/policyAssignments",
            recommendation: "Assign the 'Microsoft Cloud Security Benchmark' initiative to your subscription via Azure Policy to continuously audit resource compliance.",
            affectedResourcesCount: result.summary.missingSecurityPolicyCount,
            affectedResourcesSample: result.details.subscriptionsWithoutSecurityPolicy
        });
    } else {
        result.checks.push({
            area: "Governance & Compliance",
            title: "Security Benchmark Policy is assigned",
            status: "PASSED",
            checkId: "CHECK-AZ-GOV-002",
            severity: "INFO",
            description: "A major security benchmark or policy initiative is actively assigned to the subscription.",
            resourceType: "Microsoft.Authorization/policyAssignments",
            recommendation: "Review the compliance state of this policy assignment in the Azure Portal to ensure resources are not drifting from standard.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // Overall status determination
    if (result.summary.partialErrorsCount > 0 && subscriptions.length > 0) {
        // Governance scans are tricky, if both failed completely we fail the module
        if (result.summary.missingDefenderCount === 0 && result.summary.missingSecurityPolicyCount === 0) {
            result.status = "FAILED";
        } else {
            result.status = "SUCCESS";
        }
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    result.subscriptions_analyzed = result.summary.totalSubscriptions;

    console.log(`[GOVERNANCE-SCAN] Completed in ${result.duration_ms}ms.`);
    return result;
}

module.exports = { auditGovernance };