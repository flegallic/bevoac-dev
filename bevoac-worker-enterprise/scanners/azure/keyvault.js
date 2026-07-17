// scanners/azure/keyvault.js
/* eslint-disable no-console */

const { KeyVaultManagementClient } = require("@azure/arm-keyvault");

const MODULE_NAME = "Key Vault";
const RESOURCE_TYPE = "Microsoft.KeyVault/vaults";
const DEFAULT_EVIDENCE_SAMPLE_LIMIT = 10;

function safeString(value, fallback = "Unknown") {
    if (value === null || value === undefined || value === "") return fallback;
    if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeAction(value, fallback = "Unknown") {
    return safeString(value, fallback);
}

function normalizeBypass(value) {
    return safeString(value, "None");
}

function extractSubscriptionIdFromId(resourceId, fallback = null) {
    const match = String(resourceId || "").match(/\/subscriptions\/([^/]+)/i);
    return match ? match[1] : fallback;
}

function extractResourceGroupFromId(resourceId) {
    const match = String(resourceId || "").match(/\/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "Unknown";
}

function countPrivateEndpointConnections(props) {
    const connections = props?.privateEndpointConnections;
    return Array.isArray(connections) ? connections.length : 0;
}

function countApprovedPrivateEndpointConnections(props) {
    const connections = props?.privateEndpointConnections;
    if (!Array.isArray(connections)) return 0;

    return connections.filter((connection) => {
        const state = connection?.properties?.privateLinkServiceConnectionState?.status
            || connection?.privateLinkServiceConnectionState?.status;
        return String(state || "").toLowerCase() === "approved";
    }).length;
}

function mapKeyVaultEvidence(vault, subscriptionId) {
    const props = vault.properties || {};
    const networkAcls = props.networkAcls || {};
    const sku = props.sku || {};

    return {
        id: vault.id,
        name: vault.name,
        location: vault.location,
        resourceGroup: extractResourceGroupFromId(vault.id),
        subscriptionId: extractSubscriptionIdFromId(vault.id, subscriptionId),
        resourceType: RESOURCE_TYPE,

        publicNetworkAccess: normalizeAction(props.publicNetworkAccess, "Unknown"),
        networkAclsDefaultAction: normalizeAction(networkAcls.defaultAction, "None"),
        networkAclsBypass: normalizeBypass(networkAcls.bypass),
        enablePurgeProtection: normalizeBoolean(props.enablePurgeProtection),
        enableSoftDelete: normalizeBoolean(props.enableSoftDelete),
        softDeleteRetentionInDays: props.softDeleteRetentionInDays ?? "Unknown",
        enableRbacAuthorization: normalizeBoolean(props.enableRbacAuthorization),
        skuName: safeString(sku.name, "Unknown"),
        privateEndpointsCount: countPrivateEndpointConnections(props),
        approvedPrivateEndpointsCount: countApprovedPrivateEndpointConnections(props)
    };
}

function isPubliclyAccessible(vaultEvidence) {
    const publicNetworkAccess = String(vaultEvidence.publicNetworkAccess || "").toLowerCase();
    const defaultAction = String(vaultEvidence.networkAclsDefaultAction || "").toLowerCase();

    if (publicNetworkAccess === "disabled") return false;

    // Key Vault is considered exposed when public network access is enabled/unknown
    // and no default deny network ACL is configured.
    return defaultAction !== "deny";
}

function buildCheck({ title, status, checkId, severity, description, recommendation, affectedResources }) {
    const resources = Array.isArray(affectedResources) ? affectedResources : [];

    return {
        area: "Key Vault Security",
        title,
        status,
        checkId,
        severity,
        description,
        resourceType: RESOURCE_TYPE,
        recommendation,
        affectedResourcesCount: resources.length,
        affectedResourcesSample: resources.slice(0, DEFAULT_EVIDENCE_SAMPLE_LIMIT)
    };
}

function computeSecurityPosture(summary) {
    if (
        summary.publiclyAccessibleCount > 0
        || summary.missingPurgeProtectionCount > 0
        || summary.missingSoftDeleteCount > 0
    ) {
        return "FAIL";
    }

    if (summary.partialErrorsCount > 0) return "WARN";
    return "PASS";
}

/**
 * Audits Azure Key Vaults for security best practices.
 *
 * The scanner intentionally returns production-grade evidence objects in
 * affectedResourcesSample so the PDF report can display observed properties
 * instead of the generic "No additional properties collected" message.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - Key Vault module results block.
 */
async function auditKeyVault(subscriptions, credential) {
    const startTime = Date.now();
    const subscriptionList = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : [];

    console.log(`[KEYVAULT-SCAN] Starting Key Vault audit for ${subscriptionList.length} subscriptions...`);

    const result = {
        status: "PENDING",
        executionStatus: "PENDING",
        securityPosture: "UNKNOWN",
        checks: [],
        details: {
            partialErrors: [],
            allVaults: [],
            publiclyAccessible: [],
            missingPurgeProtection: [],
            missingSoftDelete: []
        },
        summary: {
            totalVaults: 0,
            partialErrorsCount: 0,
            publiclyAccessibleCount: 0,
            missingPurgeProtectionCount: 0,
            missingSoftDeleteCount: 0,
            vaultsWithPrivateEndpointCount: 0,
            vaultsWithRbacAuthorizationCount: 0
        }
    };

    for (const subId of subscriptionList) {
        try {
            console.log(`[KEYVAULT-SCAN] Scanning subscription: ${subId}`);
            const kvClient = new KeyVaultManagementClient(credential, subId);

            for await (const vault of kvClient.vaults.listBySubscription()) {
                const props = vault.properties;
                if (!props) continue;

                const evidence = mapKeyVaultEvidence(vault, subId);
                result.details.allVaults.push(evidence);

                if (isPubliclyAccessible(evidence)) {
                    result.details.publiclyAccessible.push(evidence);
                }

                if (evidence.enablePurgeProtection !== true) {
                    result.details.missingPurgeProtection.push(evidence);
                }

                if (evidence.enableSoftDelete !== true) {
                    result.details.missingSoftDelete.push(evidence);
                }
            }
        } catch (error) {
            console.error(`[KEYVAULT-SCAN] Error scanning subscription ${subId}:`, error.message);
            result.details.partialErrors.push({
                subscriptionId: subId,
                error: error.message
            });
        }
    }

    result.summary.totalVaults = result.details.allVaults.length;
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.publiclyAccessibleCount = result.details.publiclyAccessible.length;
    result.summary.missingPurgeProtectionCount = result.details.missingPurgeProtection.length;
    result.summary.missingSoftDeleteCount = result.details.missingSoftDelete.length;
    result.summary.vaultsWithPrivateEndpointCount = result.details.allVaults.filter((vault) => Number(vault.privateEndpointsCount) > 0).length;
    result.summary.vaultsWithRbacAuthorizationCount = result.details.allVaults.filter((vault) => vault.enableRbacAuthorization === true).length;

    // CHECK 1: Firewall / Public Access
    if (result.summary.publiclyAccessibleCount > 0) {
        result.checks.push(buildCheck({
            title: "Key Vaults are publicly accessible",
            status: "FAILED",
            checkId: "CHECK-AZ-KV-001",
            severity: "CRITICAL",
            description: "One or more Key Vaults allow public network access without a default deny network ACL. This exposes sensitive cryptographic keys and secrets to unauthorized network access and brute-force attempts.",
            recommendation: "Disable public network access or configure Network ACLs to 'Deny' by default. Use Azure Private Link (Private Endpoints) for secure access.",
            affectedResources: result.details.publiclyAccessible
        }));
    } else {
        result.checks.push(buildCheck({
            title: "Key Vaults network access is properly restricted",
            status: "PASSED",
            checkId: "CHECK-AZ-KV-001",
            severity: "INFO",
            description: "All analyzed Key Vaults have public network access disabled or strict network ACLs applied.",
            recommendation: "Maintain strict private networking policies for any newly created Key Vaults.",
            affectedResources: []
        }));
    }

    // CHECK 2: Purge Protection
    if (result.summary.missingPurgeProtectionCount > 0) {
        result.checks.push(buildCheck({
            title: "Purge Protection is disabled on Key Vaults",
            status: "FAILED",
            checkId: "CHECK-AZ-KV-002",
            severity: "HIGH",
            description: "Purge Protection is not enabled. If a vault or its secrets are deleted, an attacker or compromised admin account could permanently purge the data before the retention period expires, leading to irrecoverable data loss.",
            recommendation: "Enable Purge Protection on the Key Vault. Note: once enabled, Purge Protection cannot be disabled and data must complete its retention period.",
            affectedResources: result.details.missingPurgeProtection
        }));
    } else {
        result.checks.push(buildCheck({
            title: "Purge Protection is enabled",
            status: "PASSED",
            checkId: "CHECK-AZ-KV-002",
            severity: "INFO",
            description: "All analyzed Key Vaults have Purge Protection enabled, preventing malicious permanent data deletion.",
            recommendation: "Ensure this setting remains part of your Infrastructure-as-Code templates.",
            affectedResources: []
        }));
    }

    // CHECK 3: Soft Delete
    if (result.summary.missingSoftDeleteCount > 0) {
        result.checks.push(buildCheck({
            title: "Soft Delete is not enabled on Key Vaults",
            status: "FAILED",
            checkId: "CHECK-AZ-KV-003",
            severity: "MEDIUM",
            description: "Soft Delete is missing. Deleting a secret or the vault itself can cause immediate and permanent data loss.",
            recommendation: "Enable Soft Delete to retain deleted secrets and vaults for a configurable period, commonly 90 days, to allow recovery.",
            affectedResources: result.details.missingSoftDelete
        }));
    } else {
        result.checks.push(buildCheck({
            title: "Soft Delete is enabled",
            status: "PASSED",
            checkId: "CHECK-AZ-KV-003",
            severity: "INFO",
            description: "All analyzed Key Vaults have Soft Delete configured, ensuring accidental deletions can be reversed.",
            recommendation: "Continue enforcing Soft Delete across all environments.",
            affectedResources: []
        }));
    }

    if (result.summary.partialErrorsCount === subscriptionList.length && subscriptionList.length > 0) {
        result.status = "FAILED";
        result.executionStatus = "FAILED";
    } else {
        result.status = "SUCCESS";
        result.executionStatus = "SUCCESS";
    }

    result.securityPosture = computeSecurityPosture(result.summary);
    result.duration_ms = Date.now() - startTime;
    result.vaults_analyzed = result.summary.totalVaults;

    console.log(`[KEYVAULT-SCAN] Completed in ${result.duration_ms}ms. Analyzed ${result.summary.totalVaults} Key Vaults.`);
    return result;
}

module.exports = { auditKeyVault };
