// scanners/azure/db.js
/* eslint-disable no-console */

const { SqlManagementClient } = require("@azure/arm-sql");
const { PostgreSQLManagementFlexibleServerClient } = require("@azure/arm-postgresql-flexible");

/**
 * Audits Azure PaaS Databases (SQL, PostgreSQL) for security best practices.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - DB module results block.
 */
async function auditDb(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[DB-SCAN] Starting Database audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            publicAccessEnabled: [],
            allowsAzureServices: [],
            outdatedTls: []
        },
        summary: {
            totalDbs: 0,
            partialErrorsCount: 0,
            publicAccessEnabledCount: 0,
            allowsAzureServicesCount: 0,
            outdatedTlsCount: 0
        }
    };

    let totalDbsScanned = 0;

    for (const subId of subscriptions) {
        console.log(`[DB-SCAN] Scanning subscription: ${subId}`);

        // ==========================================
        // 1. AZURE SQL SERVERS
        // ==========================================
        try {
            const sqlClient = new SqlManagementClient(credential, subId);
            for await (const server of sqlClient.servers.list()) {
                totalDbsScanned++;

                const resourceGroup = server.id.split('/')[4];
                const findingDetails = {
                    id: server.id,
                    name: server.name,
                    engine: "Azure SQL",
                    location: server.location,
                    resourceGroup: resourceGroup,
                    subscriptionId: subId
                };

                // Check TLS Version
                if (server.minimalTlsVersion !== '1.2' && server.minimalTlsVersion !== '1.3') {
                    result.details.outdatedTls.push(findingDetails);
                }

                // Check Public Network Access
                if (server.publicNetworkAccess === 'Enabled' || !server.publicNetworkAccess) {
                    result.details.publicAccessEnabled.push(findingDetails);

                    // Inspect Firewall Rules for "Allow Azure Services" (0.0.0.0)
                    let allowsAzure = false;
                    for await (const rule of sqlClient.firewallRules.listByServer(resourceGroup, server.name)) {
                        if (rule.startIpAddress === '0.0.0.0' && rule.endIpAddress === '0.0.0.0') {
                            allowsAzure = true;
                            break;
                        }
                    }
                    if (allowsAzure) {
                        result.details.allowsAzureServices.push(findingDetails);
                    }
                }
            }
        } catch (error) {
            console.error(`[DB-SCAN] Error scanning Azure SQL in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Azure SQL", error: error.message });
        }

        // ==========================================
        // 2. AZURE POSTGRESQL FLEXIBLE SERVERS
        // ==========================================
        try {
            const pgClient = new PostgreSQLManagementFlexibleServerClient(credential, subId);

            // Fix SDK: Using the async iterator correctly if available,
            // or falling back to the raw array if the SDK wraps it differently.
            const pgServers = [];
            if (typeof pgClient.servers?.list === 'function') {
                const listResult = pgClient.servers.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const server of listResult) {
                        pgServers.push(server);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) pgServers.push(...response.value);
                    else if (Array.isArray(response)) pgServers.push(...response);
                }
            } else if (typeof pgClient.flexibleServers?.list === 'function') {
                // Some SDK versions place it under flexibleServers instead of servers
                const listResult = pgClient.flexibleServers.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const server of listResult) {
                        pgServers.push(server);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) pgServers.push(...response.value);
                    else if (Array.isArray(response)) pgServers.push(...response);
                }
            }

            for (const server of pgServers) {
                totalDbsScanned++;

                const resourceGroup = server.id.split('/')[4];
                const findingDetails = {
                    id: server.id,
                    name: server.name,
                    engine: "PostgreSQL Flexible",
                    location: server.location,
                    resourceGroup: resourceGroup,
                    subscriptionId: subId
                };

                // Check Public Network Access
                if (server.network && server.network.publicNetworkAccess === 'Enabled') {
                    result.details.publicAccessEnabled.push(findingDetails);

                    // Inspect Firewall Rules
                    let allowsAzure = false;
                    const fwRules = [];

                    if (typeof pgClient.firewallRules?.listByServer === 'function') {
                        const fwResult = pgClient.firewallRules.listByServer(resourceGroup, server.name);
                        if (fwResult[Symbol.asyncIterator]) {
                            for await (const rule of fwResult) fwRules.push(rule);
                        } else {
                            const fwResp = await fwResult;
                            if (fwResp && fwResp.value) fwRules.push(...fwResp.value);
                            else if (Array.isArray(fwResp)) fwRules.push(...fwResp);
                        }
                    }

                    for (const rule of fwRules) {
                        if (rule.startIpAddress === '0.0.0.0' && rule.endIpAddress === '0.0.0.0') {
                            allowsAzure = true;
                            break;
                        }
                    }

                    if (allowsAzure) {
                        result.details.allowsAzureServices.push(findingDetails);
                    }
                }
            }
        } catch (error) {
            console.error(`[DB-SCAN] Error scanning PostgreSQL in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "PostgreSQL Flexible", error: error.message });
        }
    }

    result.summary.totalDbs = totalDbsScanned;
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.publicAccessEnabledCount = result.details.publicAccessEnabled.length;
    result.summary.allowsAzureServicesCount = result.details.allowsAzureServices.length;
    result.summary.outdatedTlsCount = result.details.outdatedTls.length;

    // --- Build standardized checks output ---

    // CHECK 1: Public Network Access
    if (result.summary.publicAccessEnabledCount > 0) {
        result.checks.push({
            area: "Database Security",
            title: "Databases have Public Network Access enabled",
            status: "FAILED",
            checkId: "CHECK-AZ-DB-001",
            severity: "CRITICAL",
            description: "Public Network Access is enabled for one or more database servers. This exposes the database endpoint to the Internet, increasing the risk of brute-force attacks and unauthorized access.",
            resourceType: "Microsoft.Sql/servers",
            recommendation: "Disable Public Network Access and configure Azure Private Link (Private Endpoints) to ensure the database is only accessible from trusted virtual networks.",
            affectedResourcesCount: result.summary.publicAccessEnabledCount,
            affectedResourcesSample: result.details.publicAccessEnabled.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "Database Security",
            title: "Database public access is disabled",
            status: "PASSED",
            checkId: "CHECK-AZ-DB-001",
            severity: "INFO",
            description: "All analyzed databases are properly isolated from the public internet.",
            resourceType: "Microsoft.Sql/servers",
            recommendation: "Continue enforcing Private Endpoints for all PaaS data services.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 2: Allow Azure Services
    if (result.summary.allowsAzureServicesCount > 0) {
        result.checks.push({
            area: "Database Security",
            title: "Databases allow access from any Azure service",
            status: "FAILED",
            checkId: "CHECK-AZ-DB-002",
            severity: "HIGH",
            description: "A firewall rule (0.0.0.0 to 0.0.0.0) is configured to 'Allow access to Azure services'. This setting permits ANY resource deployed in Azure—including those owned by attackers—to attempt connections to your database.",
            resourceType: "Microsoft.Sql/servers",
            recommendation: "Remove the 'Allow Azure Services' firewall rule. Use VNet integration or Private Endpoints to grant access only to your specific Azure resources.",
            affectedResourcesCount: result.summary.allowsAzureServicesCount,
            affectedResourcesSample: result.details.allowsAzureServices.slice(0, 5)
        });
    }

    // CHECK 3: Outdated TLS Version (SQL specific)
    if (result.summary.outdatedTlsCount > 0) {
        result.checks.push({
            area: "Database Security",
            title: "Databases allow outdated TLS versions",
            status: "FAILED",
            checkId: "CHECK-AZ-DB-003",
            severity: "MEDIUM",
            description: "One or more SQL servers allow connections using TLS versions older than 1.2. These protocols have known cryptographic vulnerabilities.",
            resourceType: "Microsoft.Sql/servers",
            recommendation: "Enforce a minimum TLS version of 1.2 on the database server settings.",
            affectedResourcesCount: result.summary.outdatedTlsCount,
            affectedResourcesSample: result.details.outdatedTls.slice(0, 5)
        });
    }

    // Overall status determination
    if (result.summary.partialErrorsCount > 0 && totalDbsScanned === 0 && subscriptions.length > 0) {
        result.status = "FAILED";
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    result.databases_analyzed = result.summary.totalDbs;

    console.log(`[DB-SCAN] Completed in ${result.duration_ms}ms. Analyzed ${result.summary.totalDbs} DBs.`);
    return result;
}

module.exports = { auditDb };