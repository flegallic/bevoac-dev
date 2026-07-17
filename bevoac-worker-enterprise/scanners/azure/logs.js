// scanners/azure/logs.js
/* eslint-disable no-console */

const { OperationalInsightsManagementClient } = require("@azure/arm-operationalinsights");

/**
 * Audits Azure Log Analytics Workspaces for centralized logging and retention policies.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - Logs module results block.
 */
async function auditLogs(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[LOGS-SCAN] Starting Logs & Diagnostics audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            missingWorkspaces: [],
            shortRetentionWorkspaces: []
        },
        summary: {
            totalWorkspaces: 0,
            partialErrorsCount: 0,
            missingWorkspacesCount: 0,
            shortRetentionWorkspacesCount: 0
        }
    };

    let totalWorkspacesScanned = 0;

    for (const subId of subscriptions) {
        console.log(`[LOGS-SCAN] Scanning subscription: ${subId}`);

        try {
            const logClient = new OperationalInsightsManagementClient(credential, subId);
            const workspaces = [];

            // Defensive programming against SDK variations
            if (typeof logClient.workspaces?.list === 'function') {
                const listResult = logClient.workspaces.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const ws of listResult) {
                        workspaces.push(ws);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) workspaces.push(...response.value);
                    else if (Array.isArray(response)) workspaces.push(...response);
                }
            }

            // CHECK 1: Does the subscription have at least one workspace?
            if (workspaces.length === 0) {
                result.details.missingWorkspaces.push({ subscriptionId: subId });
            }

            for (const ws of workspaces) {
                totalWorkspacesScanned++;

                const resourceGroup = ws.id.split('/')[4];
                // Azure typically exposes retentionInDays directly
                const retention = ws.retentionInDays || 30; // Default to 30 if undefined

                const findingDetails = {
                    id: ws.id,
                    name: ws.name,
                    location: ws.location,
                    resourceGroup: resourceGroup,
                    subscriptionId: subId,
                    retentionDays: retention
                };

                // CHECK 2: Is the retention period at least 90 days?
                if (retention < 90) {
                    result.details.shortRetentionWorkspaces.push(findingDetails);
                }
            }
        } catch (error) {
            console.error(`[LOGS-SCAN] Error scanning Operational Insights in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Log Analytics", error: error.message });
        }
    }

    result.summary.totalWorkspaces = totalWorkspacesScanned;
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.missingWorkspacesCount = result.details.missingWorkspaces.length;
    result.summary.shortRetentionWorkspacesCount = result.details.shortRetentionWorkspaces.length;

    // --- Build standardized checks output ---

    // CHECK 1: Missing Workspaces
    if (result.summary.missingWorkspacesCount > 0) {
        result.checks.push({
            area: "Logs & Monitoring",
            title: "Subscriptions missing centralized Log Analytics Workspace",
            status: "FAILED",
            checkId: "CHECK-AZ-LOG-001",
            severity: "HIGH",
            description: "One or more subscriptions do not have any Log Analytics Workspace deployed. Without centralized logging, auditing security incidents and tracing unauthorized access is impossible.",
            resourceType: "Microsoft.OperationalInsights/workspaces",
            recommendation: "Deploy a Log Analytics Workspace in the subscription and configure critical resources (Key Vaults, Databases, Network Security Groups) to forward their diagnostic logs to it.",
            affectedResourcesCount: result.summary.missingWorkspacesCount,
            affectedResourcesSample: result.details.missingWorkspaces.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "Logs & Monitoring",
            title: "Log Analytics Workspaces are deployed",
            status: "PASSED",
            checkId: "CHECK-AZ-LOG-001",
            severity: "INFO",
            description: "All analyzed subscriptions contain at least one Log Analytics Workspace for centralized log collection.",
            resourceType: "Microsoft.OperationalInsights/workspaces",
            recommendation: "Ensure that diagnostic settings on your resources are actively pointing to these workspaces.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 2: Short Retention
    if (result.summary.shortRetentionWorkspacesCount > 0) {
        result.checks.push({
            area: "Logs & Monitoring",
            title: "Log Analytics retention is less than 90 days",
            status: "FAILED",
            checkId: "CHECK-AZ-LOG-002",
            severity: "MEDIUM",
            description: "Workspaces were found with a log retention period of less than 90 days. Advanced persistent threats (APTs) often remain undetected for months. Short retention policies destroy critical forensic evidence.",
            resourceType: "Microsoft.OperationalInsights/workspaces",
            recommendation: "Increase the workspace data retention to at least 90 days to meet minimum cybersecurity compliance standards.",
            affectedResourcesCount: result.summary.shortRetentionWorkspacesCount,
            affectedResourcesSample: result.details.shortRetentionWorkspaces.slice(0, 5)
        });
    } else {
        // Only show passed if there are actually workspaces and none have short retention
        if (totalWorkspacesScanned > 0) {
            result.checks.push({
                area: "Logs & Monitoring",
                title: "Log retention meets 90-day minimum standard",
                status: "PASSED",
                checkId: "CHECK-AZ-LOG-002",
                severity: "INFO",
                description: "All deployed Log Analytics Workspaces retain data for 90 days or more.",
                resourceType: "Microsoft.OperationalInsights/workspaces",
                recommendation: "Maintain this retention policy. For highly sensitive environments, consider exporting older logs to a cold Storage Account for long-term archiving (1+ years).",
                affectedResourcesCount: 0,
                affectedResourcesSample: []
            });
        }
    }

    // Overall status determination
    if (result.summary.partialErrorsCount > 0 && totalWorkspacesScanned === 0 && subscriptions.length > 0) {
        result.status = "FAILED";
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    result.workspaces_analyzed = result.summary.totalWorkspaces;

    console.log(`[LOGS-SCAN] Completed in ${result.duration_ms}ms. Analyzed ${result.summary.totalWorkspaces} Workspaces.`);
    return result;
}

module.exports = { auditLogs };