// scanners/azure/finops.js
/* eslint-disable no-console */

const { ComputeManagementClient } = require("@azure/arm-compute");
const { NetworkManagementClient } = require("@azure/arm-network");
const { WebSiteManagementClient } = require("@azure/arm-appservice");

/**
 * Audits Azure resources for FinOps optimization (wasted costs).
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - FinOps module results block.
 */
async function auditFinOps(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[FINOPS-SCAN] Starting FinOps audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            orphanedDisks: [],
            unattachedPublicIps: [],
            emptyAppServicePlans: [],
            stoppedBilledVms: []
        },
        summary: {
            partialErrorsCount: 0,
            orphanedDisksCount: 0,
            unattachedPublicIpsCount: 0,
            emptyAppServicePlansCount: 0,
            stoppedBilledVmsCount: 0
        }
    };

    for (const subId of subscriptions) {
        console.log(`[FINOPS-SCAN] Scanning subscription: ${subId}`);

        const computeClient = new ComputeManagementClient(credential, subId);
        const networkClient = new NetworkManagementClient(credential, subId);
        const webClient = new WebSiteManagementClient(credential, subId);

        // ==========================================
        // 1. ORPHANED DISKS
        // ==========================================
        try {
            const disks = [];
            if (typeof computeClient.disks?.list === 'function') {
                const listResult = computeClient.disks.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const disk of listResult) {
                        disks.push(disk);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) disks.push(...response.value);
                    else if (Array.isArray(response)) disks.push(...response);
                }
            }

            for (const disk of disks) {
                // diskState 'Unattached' means it's not mounted to any VM but still billed
                if (disk.diskState === 'Unattached') {
                    result.details.orphanedDisks.push({
                        id: disk.id,
                        name: disk.name,
                        resourceGroup: disk.id.split('/')[4],
                        subscriptionId: subId,
                        diskSizeGB: disk.diskSizeGB,
                        sku: disk.sku ? disk.sku.name : "Unknown"
                    });
                }
            }
        } catch (error) {
            console.error(`[FINOPS-SCAN] Error scanning Disks in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Disks", error: error.message });
        }

        // ==========================================
        // 2. UNATTACHED PUBLIC IPs
        // ==========================================
        try {
            const ips = [];
            if (typeof networkClient.publicIPAddresses?.listAll === 'function') {
                const listResult = networkClient.publicIPAddresses.listAll();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const ip of listResult) {
                        ips.push(ip);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) ips.push(...response.value);
                    else if (Array.isArray(response)) ips.push(...response);
                }
            }

            for (const ip of ips) {
                // If ipConfiguration is missing or null, the IP is not attached to any NIC/Gateway/LoadBalancer
                if (!ip.ipConfiguration) {
                    result.details.unattachedPublicIps.push({
                        id: ip.id,
                        name: ip.name,
                        resourceGroup: ip.id.split('/')[4],
                        subscriptionId: subId,
                        sku: ip.sku ? ip.sku.name : "Unknown"
                    });
                }
            }
        } catch (error) {
            console.error(`[FINOPS-SCAN] Error scanning Public IPs in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "Public IPs", error: error.message });
        }

        // ==========================================
        // 3. EMPTY APP SERVICE PLANS
        // ==========================================
        try {
            const plans = [];
            if (typeof webClient.appServicePlans?.list === 'function') {
                const listResult = webClient.appServicePlans.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const plan of listResult) {
                        plans.push(plan);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) plans.push(...response.value);
                    else if (Array.isArray(response)) plans.push(...response);
                }
            }

            for (const plan of plans) {
                // If numberOfSites is 0, the plan is running empty but billing compute
                if (plan.numberOfSites === 0) {
                    result.details.emptyAppServicePlans.push({
                        id: plan.id,
                        name: plan.name,
                        resourceGroup: plan.resourceGroup || plan.id.split('/')[4],
                        subscriptionId: subId,
                        sku: plan.sku ? plan.sku.name : "Unknown"
                    });
                }
            }
        } catch (error) {
            console.error(`[FINOPS-SCAN] Error scanning App Service Plans in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "App Service Plans", error: error.message });
        }

        // ==========================================
        // 4. STOPPED BUT BILLED VMs
        // ==========================================
        try {
            const vms = [];
            if (typeof computeClient.virtualMachines?.listAll === 'function') {
                const listResult = computeClient.virtualMachines.listAll({ statusOnly: 'true' });
                if (listResult[Symbol.asyncIterator]) {
                    for await (const vm of listResult) {
                        vms.push(vm);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) vms.push(...response.value);
                    else if (Array.isArray(response)) vms.push(...response);
                }
            }

            for (const vm of vms) {
                const resourceGroup = vm.id.split('/')[4];
                let isStoppedNotDeallocated = false;

                // instanceView.statuses contains the power state
                if (vm.instanceView && vm.instanceView.statuses) {
                    const powerState = vm.instanceView.statuses.find(s => s.code && s.code.startsWith('PowerState/'));
                    if (powerState && powerState.code === 'PowerState/stopped') {
                        isStoppedNotDeallocated = true;
                    }
                } else {
                    // Fallback to direct API call if statusOnly didn't bring instanceView
                    try {
                        const vmDetails = await computeClient.virtualMachines.get(resourceGroup, vm.name, { expand: 'instanceView' });
                        if (vmDetails.instanceView && vmDetails.instanceView.statuses) {
                            const powerState = vmDetails.instanceView.statuses.find(s => s.code && s.code.startsWith('PowerState/'));
                            if (powerState && powerState.code === 'PowerState/stopped') {
                                isStoppedNotDeallocated = true;
                            }
                        }
                    } catch (e) {
                        // ignore secondary query failure
                    }
                }

                if (isStoppedNotDeallocated) {
                    result.details.stoppedBilledVms.push({
                        id: vm.id,
                        name: vm.name,
                        resourceGroup: resourceGroup,
                        subscriptionId: subId
                    });
                }
            }
        } catch (error) {
            console.error(`[FINOPS-SCAN] Error scanning VMs for PowerState in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "VM PowerStates", error: error.message });
        }
    }

    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.orphanedDisksCount = result.details.orphanedDisks.length;
    result.summary.unattachedPublicIpsCount = result.details.unattachedPublicIps.length;
    result.summary.emptyAppServicePlansCount = result.details.emptyAppServicePlans.length;
    result.summary.stoppedBilledVmsCount = result.details.stoppedBilledVms.length;

    // --- Build standardized checks output ---

    // CHECK 1: Orphaned Disks
    if (result.summary.orphanedDisksCount > 0) {
        result.checks.push({
            area: "FinOps & Cost Optimization",
            title: "Orphaned Managed Disks detected",
            status: "FAILED",
            checkId: "CHECK-AZ-FIN-001",
            severity: "MEDIUM",
            description: "Managed disks were found in 'Unattached' state. Azure bills for the provisioned capacity of managed disks regardless of whether they are attached to a running Virtual Machine.",
            resourceType: "Microsoft.Compute/disks",
            recommendation: "Review the unattached disks. If the data is no longer needed, delete the disks. If the data must be retained, consider taking a snapshot (which is cheaper) and deleting the original disk.",
            affectedResourcesCount: result.summary.orphanedDisksCount,
            affectedResourcesSample: result.details.orphanedDisks.slice(0, 5)
        });
    }

    // CHECK 2: Unattached Public IPs
    if (result.summary.unattachedPublicIpsCount > 0) {
        result.checks.push({
            area: "FinOps & Cost Optimization",
            title: "Unattached Public IP addresses detected",
            status: "FAILED",
            checkId: "CHECK-AZ-FIN-002",
            severity: "LOW",
            description: "Public IP addresses were found that are not associated with any network interface, load balancer, or gateway. Static Public IPs incur an hourly charge even when unused.",
            resourceType: "Microsoft.Network/publicIPAddresses",
            recommendation: "Delete unused Public IP addresses to stop unnecessary hourly charges.",
            affectedResourcesCount: result.summary.unattachedPublicIpsCount,
            affectedResourcesSample: result.details.unattachedPublicIps.slice(0, 5)
        });
    }

    // CHECK 3: Empty App Service Plans
    if (result.summary.emptyAppServicePlansCount > 0) {
        result.checks.push({
            area: "FinOps & Cost Optimization",
            title: "Empty App Service Plans detected",
            status: "FAILED",
            checkId: "CHECK-AZ-FIN-003",
            severity: "MEDIUM",
            description: "App Service Plans were found with zero apps hosted. Azure bills for the dedicated compute instances of an App Service Plan as long as it exists, even if it is completely empty.",
            resourceType: "Microsoft.Web/serverfarms",
            recommendation: "Delete the empty App Service Plans if they are no longer intended for future deployments.",
            affectedResourcesCount: result.summary.emptyAppServicePlansCount,
            affectedResourcesSample: result.details.emptyAppServicePlans.slice(0, 5)
        });
    }

    // CHECK 4: Stopped but Billed VMs
    if (result.summary.stoppedBilledVmsCount > 0) {
        result.checks.push({
            area: "FinOps & Cost Optimization",
            title: "Virtual Machines are stopped but still incurring compute charges",
            status: "FAILED",
            checkId: "CHECK-AZ-FIN-004",
            severity: "HIGH",
            description: "Virtual Machines were found in 'Stopped' state instead of 'Stopped (deallocated)'. This usually occurs when a VM is shut down from within the guest OS. In this state, Azure continues to reserve the hardware and bills you for the compute cores.",
            resourceType: "Microsoft.Compute/virtualMachines",
            recommendation: "Stop the Virtual Machines via the Azure Portal, CLI, or API to transition them to 'Stopped (deallocated)' state and halt compute billing.",
            affectedResourcesCount: result.summary.stoppedBilledVmsCount,
            affectedResourcesSample: result.details.stoppedBilledVms.slice(0, 5)
        });
    }

    // PASSED CHECK (If everything is clean)
    if (
        result.summary.orphanedDisksCount === 0 &&
        result.summary.unattachedPublicIpsCount === 0 &&
        result.summary.emptyAppServicePlansCount === 0 &&
        result.summary.stoppedBilledVmsCount === 0
    ) {
        result.checks.push({
            area: "FinOps & Cost Optimization",
            title: "No obvious cloud waste detected",
            status: "PASSED",
            checkId: "CHECK-AZ-FIN-000",
            severity: "INFO",
            description: "No orphaned disks, unattached IPs, empty plans, or improperly stopped VMs were found.",
            resourceType: "Multiple",
            recommendation: "Continue monitoring your cloud spend. Ensure Auto-Shutdown schedules are configured for Dev/Test environments.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    if (result.summary.partialErrorsCount > 0 && subscriptions.length > 0) {
        result.status = "SUCCESS"; // FinOps is purely informational, partial failures don't ruin the module
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    console.log(`[FINOPS-SCAN] Completed in ${result.duration_ms}ms.`);

    return result;
}

module.exports = { auditFinOps };