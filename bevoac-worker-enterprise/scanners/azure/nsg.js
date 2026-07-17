// scanners/azure/nsg.js
/* eslint-disable no-console */

const { NetworkManagementClient } = require("@azure/arm-network");

/**
 * Audits Azure Network Security Groups (NSGs) for overly permissive inbound rules.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - NSG module results block.
 */
async function auditNsg(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[NSG-SCAN] Starting NSG audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            permissiveSshRdp: [],
            permissiveDatabase: [],
            permissiveAny: []
        },
        summary: {
            totalNsgs: 0,
            partialErrorsCount: 0,
            permissiveSshRdpCount: 0,
            permissiveDatabaseCount: 0,
            permissiveAnyCount: 0
        }
    };

    let totalNsgsScanned = 0;

    for (const subId of subscriptions) {
        try {
            console.log(`[NSG-SCAN] Scanning subscription: ${subId}`);
            const networkClient = new NetworkManagementClient(credential, subId);

            for await (const nsg of networkClient.networkSecurityGroups.listAll()) {
                totalNsgsScanned++;

                // We only care about explicit inbound rules created by the user (not default rules)
                const securityRules = nsg.securityRules || [];

                for (const rule of securityRules) {
                    // Only analyze Inbound Allow rules
                    if (rule.direction !== 'Inbound' || rule.access !== 'Allow') {
                        continue;
                    }

                    // Check if source is broadly open ("*", "Internet", or "0.0.0.0/0")
                    const sourcePrefix = (rule.sourceAddressPrefix || "").toLowerCase();
                    const sourcePrefixes = (rule.sourceAddressPrefixes || []).map(p => p.toLowerCase());

                    const isSourceOpen =
                        sourcePrefix === '*' ||
                        sourcePrefix === 'internet' ||
                        sourcePrefix === '0.0.0.0/0' ||
                        sourcePrefixes.includes('*') ||
                        sourcePrefixes.includes('internet') ||
                        sourcePrefixes.includes('0.0.0.0/0');

                    if (!isSourceOpen) {
                        continue; // Source is restricted, rule is fine
                    }

                    // Extract destination ports
                    const destPort = rule.destinationPortRange || "";
                    const destPorts = rule.destinationPortRanges || [];
                    const allPorts = [destPort, ...destPorts].map(p => String(p));

                    const isAnyPort = allPorts.includes('*');
                    const isManagementPort = allPorts.some(p => ['22', '3389'].includes(p));
                    const isDatabasePort = allPorts.some(p => ['1433', '3306', '5432', '6379', '27017'].includes(p));

                    const findingDetails = {
                        id: nsg.id,
                        name: nsg.name,
                        location: nsg.location,
                        resourceGroup: nsg.id.split('/')[4],
                        subscriptionId: subId,
                        ruleName: rule.name,
                        priority: rule.priority,
                        destinationPorts: allPorts.join(', ')
                    };

                    if (isManagementPort || (isAnyPort && !isManagementPort)) {
                        // If it's * or explicitly 22/3389
                        if (isManagementPort) {
                            result.details.permissiveSshRdp.push(findingDetails);
                        } else {
                            result.details.permissiveAny.push(findingDetails);
                        }
                    } else if (isDatabasePort) {
                        result.details.permissiveDatabase.push(findingDetails);
                    }
                }
            }
        } catch (error) {
            console.error(`[NSG-SCAN] Error scanning subscription ${subId}:`, error.message);
            result.details.partialErrors.push({
                subscriptionId: subId,
                error: error.message
            });
        }
    }

    result.summary.totalNsgs = totalNsgsScanned;
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.permissiveSshRdpCount = result.details.permissiveSshRdp.length;
    result.summary.permissiveDatabaseCount = result.details.permissiveDatabase.length;
    result.summary.permissiveAnyCount = result.details.permissiveAny.length;

    // Build standard checks output
    // CHECK 1: Management Ports (SSH/RDP)
    if (result.summary.permissiveSshRdpCount > 0) {
        result.checks.push({
            area: "Network Security",
            title: "Management ports exposed to Internet",
            status: "FAILED",
            checkId: "CHECK-AZ-NSG-001",
            severity: "CRITICAL",
            description: "Network Security Groups contain Inbound Allow rules from any source to management ports (SSH 22 or RDP 3389).",
            resourceType: "Microsoft.Network/networkSecurityGroups",
            recommendation: "Remove overly permissive rules. Restrict source addresses to trusted corporate IPs, or use Azure Bastion / Just-In-Time (JIT) access.",
            affectedResourcesCount: result.summary.permissiveSshRdpCount,
            affectedResourcesSample: result.details.permissiveSshRdp.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "Network Security",
            title: "Management ports are securely restricted",
            status: "PASSED",
            checkId: "CHECK-AZ-NSG-001",
            severity: "INFO",
            description: "No NSGs allow inbound SSH/RDP traffic from the entire Internet.",
            resourceType: "Microsoft.Network/networkSecurityGroups",
            recommendation: "Maintain strict source IP filtering for administrative ports.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 2: Database Ports
    if (result.summary.permissiveDatabaseCount > 0) {
        result.checks.push({
            area: "Network Security",
            title: "Database ports exposed to Internet",
            status: "FAILED",
            checkId: "CHECK-AZ-NSG-002",
            severity: "HIGH",
            description: "Network Security Groups contain Inbound Allow rules exposing database ports (e.g., 1433, 3306, 5432, 27017) to the Internet.",
            resourceType: "Microsoft.Network/networkSecurityGroups",
            recommendation: "Never expose database ports publicly. Use private endpoints or VNet peering, and restrict NSG rules tightly.",
            affectedResourcesCount: result.summary.permissiveDatabaseCount,
            affectedResourcesSample: result.details.permissiveDatabase.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "Network Security",
            title: "Database ports are not publicly exposed via NSG",
            status: "PASSED",
            checkId: "CHECK-AZ-NSG-002",
            severity: "INFO",
            description: "No NSGs were found exposing common database ports to the open Internet.",
            resourceType: "Microsoft.Network/networkSecurityGroups",
            recommendation: "Continue using private networking strategies for databases.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 3: ANY (*) Port Rules
    if (result.summary.permissiveAnyCount > 0) {
        result.checks.push({
            area: "Network Security",
            title: "Wildcard (*) port exposure to Internet",
            status: "FAILED",
            checkId: "CHECK-AZ-NSG-003",
            severity: "HIGH",
            description: "Network Security Groups have Inbound Allow rules that open ALL ports (*) to the Internet.",
            resourceType: "Microsoft.Network/networkSecurityGroups",
            recommendation: "Follow the principle of least privilege. Replace wildcard rules with specific, required ports only.",
            affectedResourcesCount: result.summary.permissiveAnyCount,
            affectedResourcesSample: result.details.permissiveAny.slice(0, 5)
        });
    }

    // Overall status determination
    if (result.summary.partialErrorsCount === subscriptions.length && subscriptions.length > 0) {
        result.status = "FAILED";
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    result.nsgs_analyzed = result.summary.totalNsgs;

    console.log(`[NSG-SCAN] Completed in ${result.duration_ms}ms. Analyzed ${result.summary.totalNsgs} NSGs.`);
    return result;
}

module.exports = { auditNsg };