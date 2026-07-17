const { StorageManagementClient } = require("@azure/arm-storage");

/**
 * Audit Azure Storage Accounts
 * Format aligné sur les modules de scan Worker type checkEntraID:
 * - logs clairs
 * - timing
 * - summary
 * - checks
 * - details
 * - retour FAILED propre en cas d'erreur critique
 *
 * Ce module est volontairement "pur Worker" :
 * - il ne connaît ni HTTP, ni Fastify, ni billing, ni routes admin
 * - il est appelé par l'orchestrateur Azure infra lorsque le scanProfile
 *   résout vers "storage" (ou "full")
 *
 * @param {string[]} subscriptions
 * @param {import("@azure/identity").TokenCredential} credential
 * @returns {Promise<{
 *   status: "SUCCESS" | "FAILED",
 *   duration_ms: number,
 *   storage_accounts_analyzed?: number,
 *   summary?: {
 *     totalStorageAccounts: number,
 *     publicStorageAccountsCount: number,
 *     storageWithoutSecureTransferCount: number,
 *     storageWithoutPrivateEndpointCount: number,
 *     storageWithBlobPublicAccessEnabledCount: number,
 *     storageWithSharedKeyAccessEnabledCount: number,
 *     storageWithMinTlsBelow12Count: number,
 *     storageWithLocalUsersEnabledCount: number,
 *     partialErrorsCount: number
 *   },
 *   checks?: any[],
 *   details?: {
 *     publicStorageAccounts: any[],
 *     storageWithoutSecureTransfer: any[],
 *     storageWithoutPrivateEndpoint: any[],
 *     storageWithBlobPublicAccessEnabled: any[],
 *     storageWithSharedKeyAccessEnabled: any[],
 *     storageWithMinTlsBelow12: any[],
 *     storageWithLocalUsersEnabled: any[],
 *     partialErrors: any[]
 *   },
 *   error?: string,
 *   details_error?: string
 * }>}
 */
async function auditStorage(subscriptions, credential) {
  const startTime = Date.now();

  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return {
      status: "FAILED",
      duration_ms: Date.now() - startTime,
      error: "Storage audit requires at least one Azure subscription ID.",
      details_error:
        "The subscriptions argument is missing or empty. The storage module cannot enumerate Azure Storage Accounts without subscription scope.",
    };
  }

  if (!credential) {
    return {
      status: "FAILED",
      duration_ms: Date.now() - startTime,
      error: "Storage audit requires a valid Azure credential.",
      details_error:
        "The credential argument is missing. Provide a TokenCredential instance before calling auditStorage().",
    };
  }

  console.log(
    `[AZURE-STORAGE] Starting storage audit for subscriptions: ${subscriptions.join(
      ", "
    )}`
  );

  const checks = [];

  const publicStorageAccounts = [];
  const storageWithoutSecureTransfer = [];
  const storageWithoutPrivateEndpoint = [];
  const storageWithBlobPublicAccessEnabled = [];
  const storageWithSharedKeyAccessEnabled = [];
  const storageWithMinTlsBelow12 = [];
  const storageWithLocalUsersEnabled = [];
  const partialErrors = [];

  let totalStorageAccounts = 0;

  try {
    for (const subscriptionId of subscriptions) {
      console.log(
        `[AZURE-STORAGE] Enumerating storage accounts in subscription ${subscriptionId}`
      );

      const storageClient = new StorageManagementClient(
        credential,
        subscriptionId
      );

      try {
        const iterator = storageClient.storageAccounts.list();

        // eslint-disable-next-line no-restricted-syntax
        for await (const account of iterator) {
          totalStorageAccounts += 1;

          const id = account.id || null;
          const name = account.name || null;
          const location = account.location || null;
          const resourceGroup = extractResourceGroupFromId(id);

          const enableHttpsTrafficOnly =
            typeof account.enableHttpsTrafficOnly === "boolean"
              ? account.enableHttpsTrafficOnly
              : null;

          const allowBlobPublicAccess =
            typeof account.allowBlobPublicAccess === "boolean"
              ? account.allowBlobPublicAccess
              : null;

          const publicNetworkAccess = account.publicNetworkAccess || "Enabled";

          const networkRuleSet = account.networkRuleSet || {};
          const defaultAction = networkRuleSet.defaultAction || "Allow";
          const bypass = Array.isArray(networkRuleSet.bypass)
            ? networkRuleSet.bypass
            : networkRuleSet.bypass
            ? [networkRuleSet.bypass]
            : [];

          const allowSharedKeyAccess =
            typeof account.allowSharedKeyAccess === "boolean"
              ? account.allowSharedKeyAccess
              : null;

          const minimumTlsVersion = account.minimumTlsVersion || null;

          const isLocalUserEnabled =
            typeof account.isLocalUserEnabled === "boolean"
              ? account.isLocalUserEnabled
              : null;

          let privateEndpointsCount = 0;

          try {
            const peIterator = storageClient.privateEndpointConnections.list(
              resourceGroup,
              name
            );

            // eslint-disable-next-line no-restricted-syntax
            for await (const pe of peIterator) {
              if (pe) {
                privateEndpointsCount += 1;
              }
            }
          } catch (peError) {
            console.warn(
              `[AZURE-STORAGE] Private endpoints fetch error for ${name}: ${peError.message}`
            );
            partialErrors.push({
              subscriptionId,
              resourceGroup,
              storageAccountName: name,
              scope: "privateEndpointConnections.list",
              message: peError.message,
            });
          }

          const baseInfo = {
            id,
            name,
            subscriptionId,
            resourceGroup,
            location,
            publicNetworkAccess,
            defaultAction,
            bypass,
            enableHttpsTrafficOnly,
            allowBlobPublicAccess,
            allowSharedKeyAccess,
            minimumTlsVersion,
            isLocalUserEnabled,
            privateEndpointsCount,
          };

          // 1) Stockage ouvert publiquement
          if (
            publicNetworkAccess === "Enabled" &&
            String(defaultAction).toLowerCase() === "allow"
          ) {
            publicStorageAccounts.push(baseInfo);
          }

          // 2) HTTPS non forcé
          if (enableHttpsTrafficOnly === false) {
            storageWithoutSecureTransfer.push(baseInfo);
          }

          // 3) Compte public sans Private Endpoint
          if (
            publicNetworkAccess === "Enabled" &&
            privateEndpointsCount === 0
          ) {
            storageWithoutPrivateEndpoint.push(baseInfo);
          }

          // 4) Blob public access activé
          if (allowBlobPublicAccess === true) {
            storageWithBlobPublicAccessEnabled.push(baseInfo);
          }

          // 5) Shared Key access activé
          if (allowSharedKeyAccess === true) {
            storageWithSharedKeyAccessEnabled.push(baseInfo);
          }

          // 6) TLS minimum inférieur à 1.2
          if (
            minimumTlsVersion &&
            !["TLS1_2", "TLS1_3"].includes(String(minimumTlsVersion))
          ) {
            storageWithMinTlsBelow12.push(baseInfo);
          }

          // 7) Local users activés (SFTP / local auth)
          if (isLocalUserEnabled === true) {
            storageWithLocalUsersEnabled.push(baseInfo);
          }
        }
      } catch (subscriptionError) {
        console.warn(
          `[AZURE-STORAGE] Subscription-level enumeration error on ${subscriptionId}: ${subscriptionError.message}`
        );
        partialErrors.push({
          subscriptionId,
          scope: "storageAccounts.list",
          message: subscriptionError.message,
        });
      }
    }

    const summary = {
      totalStorageAccounts,
      publicStorageAccountsCount: publicStorageAccounts.length,
      storageWithoutSecureTransferCount:
        storageWithoutSecureTransfer.length,
      storageWithoutPrivateEndpointCount:
        storageWithoutPrivateEndpoint.length,
      storageWithBlobPublicAccessEnabledCount:
        storageWithBlobPublicAccessEnabled.length,
      storageWithSharedKeyAccessEnabledCount:
        storageWithSharedKeyAccessEnabled.length,
      storageWithMinTlsBelow12Count:
        storageWithMinTlsBelow12.length,
      storageWithLocalUsersEnabledCount:
        storageWithLocalUsersEnabled.length,
      partialErrorsCount: partialErrors.length,
    };

    checks.push(
      publicStorageAccounts.length > 0
        ? {
            checkId: "CHECK-AZ-STG-001",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "HIGH",
            title:
              "Storage accounts allow public network access from unrestricted sources",
            description:
              "One or more storage accounts are configured with public network access enabled and a permissive default firewall action, increasing the attack surface and the risk of unauthorized access or data exposure.",
            recommendation:
              "Restrict network access to selected virtual networks and IP ranges, and prefer private endpoints for sensitive or production storage workloads.",
            affectedResourcesCount: publicStorageAccounts.length,
            affectedResourcesSample: publicStorageAccounts.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-001",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "No storage accounts were found with unrestricted public network exposure",
            description:
              "All analyzed storage accounts either disable public network exposure or enforce network restrictions.",
            recommendation:
              "Maintain strict firewall rules and private connectivity patterns for storage services.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithoutSecureTransfer.length > 0
        ? {
            checkId: "CHECK-AZ-STG-002",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "HIGH",
            title:
              "Secure transfer is not enforced on some storage accounts",
            description:
              "Some storage accounts do not enforce HTTPS-only access, which may allow clients to use unencrypted HTTP connections.",
            recommendation:
              "Enable 'secure transfer required' on all storage accounts to enforce HTTPS and reduce the risk of plaintext data transit.",
            affectedResourcesCount:
              storageWithoutSecureTransfer.length,
            affectedResourcesSample:
              storageWithoutSecureTransfer.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-002",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "Secure transfer is enforced on all analyzed storage accounts",
            description:
              "All analyzed storage accounts require secure HTTPS transport for client access.",
            recommendation:
              "Keep secure transfer enabled by default and monitor for drift on newly created storage accounts.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithoutPrivateEndpoint.length > 0
        ? {
            checkId: "CHECK-AZ-STG-003",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "MEDIUM",
            title:
              "Publicly reachable storage accounts have no private endpoints configured",
            description:
              "Some storage accounts remain publicly reachable and do not use private endpoints, which may be inconsistent with production-grade isolation requirements.",
            recommendation:
              "Use private endpoints for critical storage accounts and reduce public exposure whenever private connectivity is available.",
            affectedResourcesCount:
              storageWithoutPrivateEndpoint.length,
            affectedResourcesSample:
              storageWithoutPrivateEndpoint.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-003",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "No publicly exposed storage accounts without private endpoint coverage were found",
            description:
              "Analyzed storage accounts do not present the combination of public exposure and missing private endpoint connectivity.",
            recommendation:
              "Continue using private endpoints for storage workloads that handle sensitive or business-critical data.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithBlobPublicAccessEnabled.length > 0
        ? {
            checkId: "CHECK-AZ-STG-004",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "HIGH",
            title:
              "Blob public access is enabled on some storage accounts",
            description:
              "Some storage accounts allow public blob access at the account level, which can enable accidental anonymous exposure of containers or objects.",
            recommendation:
              "Disable blob public access at the storage account level and prefer authenticated access through Entra ID, SAS, or private connectivity.",
            affectedResourcesCount:
              storageWithBlobPublicAccessEnabled.length,
            affectedResourcesSample:
              storageWithBlobPublicAccessEnabled.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-004",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "Blob public access is disabled on all analyzed storage accounts",
            description:
              "No analyzed storage account exposes blob public access at the account level.",
            recommendation:
              "Maintain this setting disabled and review any exception process carefully.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithSharedKeyAccessEnabled.length > 0
        ? {
            checkId: "CHECK-AZ-STG-005",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "MEDIUM",
            title:
              "Shared Key authorization remains enabled on some storage accounts",
            description:
              "Some storage accounts still allow Shared Key access, which may bypass stronger identity-based access patterns and complicate access governance.",
            recommendation:
              "Where possible, disable Shared Key authorization and prefer Microsoft Entra ID-based access controls and scoped delegation.",
            affectedResourcesCount:
              storageWithSharedKeyAccessEnabled.length,
            affectedResourcesSample:
              storageWithSharedKeyAccessEnabled.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-005",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "Shared Key authorization is not enabled on analyzed storage accounts",
            description:
              "Analyzed storage accounts do not rely on Shared Key authorization as an active configuration finding.",
            recommendation:
              "Continue favoring identity-based authentication and tightly scoped delegated access methods.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithMinTlsBelow12.length > 0
        ? {
            checkId: "CHECK-AZ-STG-006",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "MEDIUM",
            title:
              "Some storage accounts allow a minimum TLS version below 1.2",
            description:
              "One or more storage accounts are configured with an outdated minimum TLS version, which may allow weaker transport security negotiation.",
            recommendation:
              "Set the minimum TLS version to TLS1_2 or higher for all storage accounts.",
            affectedResourcesCount:
              storageWithMinTlsBelow12.length,
            affectedResourcesSample:
              storageWithMinTlsBelow12.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-006",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "All analyzed storage accounts enforce a minimum TLS version of 1.2 or higher",
            description:
              "No analyzed storage account was found with a minimum TLS level below current baseline expectations.",
            recommendation:
              "Keep TLS1_2 or higher as the storage baseline.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    checks.push(
      storageWithLocalUsersEnabled.length > 0
        ? {
            checkId: "CHECK-AZ-STG-007",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "FAILED",
            severity: "MEDIUM",
            title:
              "Local users are enabled on some storage accounts",
            description:
              "Some storage accounts have local users enabled, which may expand the authentication surface and create unmanaged access paths, especially with SFTP-enabled scenarios.",
            recommendation:
              "Disable local users where not strictly required and prefer centralized identity and access governance through Microsoft Entra ID.",
            affectedResourcesCount:
              storageWithLocalUsersEnabled.length,
            affectedResourcesSample:
              storageWithLocalUsersEnabled.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-STG-007",
            area: "Storage",
            resourceType: "Microsoft.Storage/storageAccounts",
            status: "PASSED",
            severity: "INFO",
            title:
              "No analyzed storage accounts were found with local users enabled",
            description:
              "Analyzed storage accounts do not expose local-user-based authentication as an active finding.",
            recommendation:
              "Continue minimizing local authentication paths for storage services.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    const durationMs = Date.now() - startTime;

    console.log(
      `[AZURE-STORAGE] Audit completed in ${durationMs}ms. Analyzed ${totalStorageAccounts} storage accounts.`
    );

    return {
      status: "SUCCESS",
      duration_ms: durationMs,
      storage_accounts_analyzed: totalStorageAccounts,
      summary,
      checks,
      details: {
        publicStorageAccounts,
        storageWithoutSecureTransfer,
        storageWithoutPrivateEndpoint,
        storageWithBlobPublicAccessEnabled,
        storageWithSharedKeyAccessEnabled,
        storageWithMinTlsBelow12,
        storageWithLocalUsersEnabled,
        partialErrors,
      },
    };
  } catch (criticalError) {
    const durationMs = Date.now() - startTime;

    console.error(
      `[AZURE-STORAGE] CRITICAL ERROR: ${criticalError.message}`
    );

    return {
      status: "FAILED",
      duration_ms: durationMs,
      error: "Storage audit failed due to authentication or Azure ARM API error.",
      details_error: criticalError.message,
    };
  }
}

/**
 * Extract resource group name from ARM resource ID
 * Example:
 * /subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<name>
 *
 * @param {string | null} id
 * @returns {string | null}
 */
function extractResourceGroupFromId(id) {
  if (!id || typeof id !== "string") {
    return null;
  }

  const match = id.match(/resourceGroups\/([^/]+)/i);
  return match ? match[1] : null;
}

module.exports = { auditStorage };