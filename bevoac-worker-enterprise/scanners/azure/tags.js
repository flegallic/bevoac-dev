// scanners/azure/tags.js
/* eslint-disable no-console */

const { ResourceGraphClient } = require("@azure/arm-resourcegraph");

/**
 * Audits Azure Resources for tagging compliance using Azure Resource Graph.
 *
 * @param {string[]} subscriptions - List of Azure subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - Tags module results block.
 */
async function auditTags(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[TAGS-SCAN] Starting Azure Resource Tags audit via Resource Graph...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            untaggedResources: [],
            missingMandatoryTags: [],
            partialErrors: []
        },
        summary: {
            totalResourcesScanned: 0,
            untaggedCount: 0,
            missingMandatoryTagsCount: 0,
            partialErrorsCount: 0
        }
    };

    // Mandatory enterprise tags (Case-insensitive comparison later)
    const MANDATORY_TAGS = ['environment', 'owner'];

    try {
        if (!subscriptions || subscriptions.length === 0) {
            throw new Error("No subscriptions provided for the tags scan.");
        }

        const client = new ResourceGraphClient(credential);

        // Kusto Query to fetch all resources with their tags
        const query = `
            resources
            | project id, name, type, tags, subscriptionId
        `;

        const queryResponse = await client.resources({
            query: query,
            subscriptions: subscriptions,
            options: {
                resultFormat: "objectArray"
            }
        });

        const resources = queryResponse.data || [];
        result.summary.totalResourcesScanned = resources.length;

        for (const resource of resources) {
            const tags = resource.tags || {};
            // Azure Resource Graph returns tags as an object/dictionary
            const tagKeys = Object.keys(tags).map(k => k.toLowerCase());

            // 1. Check for completely untagged resources
            if (tagKeys.length === 0) {
                result.details.untaggedResources.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    subscriptionId: resource.subscriptionId
                });
                continue;
            }

            // 2. Check for missing mandatory tags
            const missingTags = MANDATORY_TAGS.filter(reqTag => !tagKeys.includes(reqTag));

            if (missingTags.length > 0) {
                result.details.missingMandatoryTags.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    subscriptionId: resource.subscriptionId,
                    missingTags: missingTags
                });
            }
        }

        result.summary.untaggedCount = result.details.untaggedResources.length;
        result.summary.missingMandatoryTagsCount = result.details.missingMandatoryTags.length;

        // --- Build standardized checks output ---

        if (result.summary.untaggedCount > 0) {
            result.checks.push({
                area: "Governance & FinOps",
                title: "Resources with no tags detected",
                status: "FAILED",
                checkId: "CHECK-TAGS-001",
                severity: "MEDIUM",
                description: "Several resources have absolutely no tags assigned. This prevents proper cost allocation (Chargeback/Showback) and reduces operational visibility.",
                resourceType: "Azure Resources",
                recommendation: "Implement Azure Policies with 'Append' or 'Modify' effects to automatically inherit tags from the Resource Group, or 'Deny' resource creation if tags are missing.",
                affectedResourcesCount: result.summary.untaggedCount,
                affectedResourcesSample: result.details.untaggedResources.slice(0, 5)
            });
        }

        if (result.summary.missingMandatoryTagsCount > 0) {
            result.checks.push({
                area: "Governance & FinOps",
                title: "Resources missing mandatory tags (Environment, Owner)",
                status: "FAILED",
                checkId: "CHECK-TAGS-002",
                severity: "HIGH",
                description: "Critical organizational tags ('Environment' and 'Owner') are missing on some resources. Without these, incident response and FinOps processes are severely impacted.",
                resourceType: "Azure Resources",
                recommendation: "Enforce a mandatory tagging taxonomy across the tenant using Azure Policy. Standardize tag keys to avoid case-sensitivity issues.",
                affectedResourcesCount: result.summary.missingMandatoryTagsCount,
                affectedResourcesSample: result.details.missingMandatoryTags.slice(0, 5)
            });
        }

        if (result.summary.untaggedCount === 0 && result.summary.missingMandatoryTagsCount === 0 && result.summary.totalResourcesScanned > 0) {
            result.checks.push({
                area: "Governance & FinOps",
                title: "Resource tagging compliance is 100%",
                status: "PASSED",
                checkId: "CHECK-TAGS-000",
                severity: "INFO",
                description: "All scanned resources possess tags, including the mandatory 'Environment' and 'Owner' tags.",
                resourceType: "Azure Resources",
                recommendation: "Continue enforcing tagging policies and periodically review tag values for consistency.",
                affectedResourcesCount: 0,
                affectedResourcesSample: []
            });
        }

        result.status = "SUCCESS";

    } catch (error) {
        console.error(`[TAGS-SCAN] Fatal error:`, error.message);
        result.status = "FAILED";
        result.checks.push({
            area: "Governance & FinOps",
            title: "Tags Audit Failed",
            status: "FAILED",
            checkId: "CHECK-TAGS-ERR",
            severity: "HIGH",
            description: `Module execution crashed: ${error.message}`,
            recommendation: "Verify Azure credentials and ensure the application has Reader role over the target subscriptions."
        });
    }

    result.duration_ms = Date.now() - startTime;
    console.log(`[TAGS-SCAN] Completed in ${result.duration_ms}ms. Scanned ${result.summary.totalResourcesScanned} resources.`);
    return result;
}

module.exports = { auditTags };