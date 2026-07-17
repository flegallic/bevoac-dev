// scanners/azure/vms.js
/* eslint-disable no-console */
const { ComputeManagementClient } = require("@azure/arm-compute");
const { NetworkManagementClient } = require("@azure/arm-network");

/**
 * Audit des Virtual Machines Azure (Chiffrement, Boot Security, Accès, Réseau)
 * Format: ModuleResult (summary, checks, details)
 *
 * @param {string[]} subscriptions - Liste d'IDs de souscriptions à scanner
 * @param {import("@azure/identity").TokenCredential} credential - Credential Azure (Bevoac Multi-Tenant)
 * @returns {Promise<{
 *   status: "SUCCESS" | "FAILED",
 *   duration_ms: number,
 *   vms_analyzed: number,
 *   summary: any,
 *   checks: any[],
 *   details: any
 * }>}
 */
async function auditVMs(subscriptions, credential) {
  const startTime = Date.now();
  console.log(`[AZURE-VMS] Starting Virtual Machines audit for subscriptions: ${subscriptions.join(", ")}`);

  const checks = [];

  // Détails par type de problème
  const unencryptedDisksVMs = [];
  const noManagedIdentityVMs = [];
  const noTrustedLaunchVMs = [];
  const publicAdminPortsVMs = [];
  const passwordAuthLinuxVMs = [];

  const partialErrors = [];
  let totalVMs = 0;

  try {
    for (const subId of subscriptions) {
      try {
        const computeClient = new ComputeManagementClient(credential, subId);
        const networkClient = new NetworkManagementClient(credential, subId);

        const iter = computeClient.virtualMachines.listAll();

        // eslint-disable-next-line no-restricted-syntax
        for await (const vm of iter) {
          totalVMs += 1;

          const id = vm.id || null;
          const name = vm.name || null;
          const resourceGroup = extractResourceGroupFromId(id);
          const location = vm.location || null;
          const osType = vm.storageProfile?.osDisk?.osType || "Unknown"; // Linux | Windows

          const baseInfo = {
            id,
            name,
            resourceGroup,
            subscriptionId: subId,
            location,
            osType
          };

          // ---------------------------------------------------------
          // 1. Chiffrement des disques (OS + Data)
          // ---------------------------------------------------------
          let isFullyEncrypted = true;
          const encryptionIssues = [];

          // OS Disk
          if (vm.storageProfile && vm.storageProfile.osDisk) {
            const osDisk = vm.storageProfile.osDisk;
            // On vérifie soit Azure Disk Encryption (ADE), soit Server-Side Encryption (managedDisk)
            const hasADE = osDisk.encryptionSettings !== undefined;
            const hasCMK = osDisk.managedDisk && osDisk.managedDisk.diskEncryptionSet !== undefined;

            // Par défaut, Azure gère un chiffrement SSE avec PMK, mais dans un contexte strict,
            // on exige souvent au moins l'intention explicite (CMK ou ADE) pour les environnements de prod.
            // Pour limiter les faux positifs, on considère que si c'est un managedDisk récent, le PMK de base est actif.
            // Mais on note si l'encryptionSettings.enabled === false.
            if (osDisk.encryptionSettings && osDisk.encryptionSettings.enabled === false) {
                isFullyEncrypted = false;
                encryptionIssues.push("OS Disk explicitly unencrypted");
            }
          }

          // Data Disks
          if (vm.storageProfile && vm.storageProfile.dataDisks) {
            for (const disk of vm.storageProfile.dataDisks) {
              if (disk.encryptionSettings && disk.encryptionSettings.enabled === false) {
                isFullyEncrypted = false;
                encryptionIssues.push(`Data Disk LUN ${disk.lun} explicitly unencrypted`);
              }
            }
          }

          if (!isFullyEncrypted) {
            unencryptedDisksVMs.push({ ...baseInfo, encryptionIssues });
          }

          // ---------------------------------------------------------
          // 2. Identité Managée (SystemAssigned / UserAssigned)
          // ---------------------------------------------------------
          let hasIdentity = false;
          if (vm.identity && vm.identity.type && vm.identity.type !== "None") {
            hasIdentity = true;
          }
          if (!hasIdentity) {
            noManagedIdentityVMs.push(baseInfo);
          }

          // ---------------------------------------------------------
          // 3. Trusted Launch (Secure Boot & vTPM)
          // ---------------------------------------------------------
          let hasTrustedLaunch = false;
          if (vm.securityProfile && vm.securityProfile.securityType === "TrustedLaunch") {
             const uefi = vm.securityProfile.uefiSettings;
             if (uefi && uefi.secureBootEnabled && uefi.vTpmEnabled) {
                 hasTrustedLaunch = true;
             }
          }
          if (!hasTrustedLaunch) {
            noTrustedLaunchVMs.push(baseInfo);
          }

          // ---------------------------------------------------------
          // 4. Authentification Linux (Mot de passe en clair ?)
          // ---------------------------------------------------------
          if (osType.toLowerCase() === "linux") {
            if (vm.osProfile && vm.osProfile.linuxConfiguration) {
              const linuxConf = vm.osProfile.linuxConfiguration;
              // S'il n'y a pas disablePasswordAuthentication = true, c'est risqué.
              if (linuxConf.disablePasswordAuthentication !== true) {
                passwordAuthLinuxVMs.push(baseInfo);
              }
            }
          }

          // ---------------------------------------------------------
          // 5. Exposition Réseau (Ports d'admin)
          // ---------------------------------------------------------
          // Pour faire ça de manière 'zéro erreur', il faut regarder la NIC rattachée.
          let hasExposedAdminPort = false;
          const exposedPorts = [];

          if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (const nicRef of vm.networkProfile.networkInterfaces) {
              try {
                const nicName = nicRef.id.split('/').pop();
                const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);

                // On regarde si un NSG est attaché à la NIC (il peut aussi y en avoir un sur le subnet)
                if (nic.networkSecurityGroup && nic.networkSecurityGroup.id) {
                    const nsgName = nic.networkSecurityGroup.id.split('/').pop();
                    const nsg = await networkClient.networkSecurityGroups.get(resourceGroup, nsgName);

                    if (nsg.securityRules) {
                        for (const rule of nsg.securityRules) {
                            if (rule.access === "Allow" && rule.direction === "Inbound") {
                                const isPublicSource = rule.sourceAddressPrefix === "*" || rule.sourceAddressPrefix === "Internet" || rule.sourceAddressPrefix === "0.0.0.0/0";
                                const isDestAdmin = rule.destinationPortRange === "22" || rule.destinationPortRange === "3389" || rule.destinationPortRange === "*";

                                if (isPublicSource && isDestAdmin) {
                                    hasExposedAdminPort = true;
                                    exposedPorts.push(rule.destinationPortRange);
                                }
                            }
                        }
                    }
                } else if (nic.ipConfigurations) {
                    // Si pas de NSG sur la NIC, a-t-elle une IP Publique ?
                    // Si oui, et pas de NSG, c'est extrêmement grave, on flag comme exposé.
                    for (const ipConf of nic.ipConfigurations) {
                        if (ipConf.publicIPAddress) {
                            hasExposedAdminPort = true;
                            exposedPorts.push("Direct Public IP without NIC NSG");
                        }
                    }
                }
              } catch (err) {
                 console.warn(`[AZURE-VMS] Could not fetch NIC/NSG for VM ${name}: ${err.message}`);
              }
            }
          }

          if (hasExposedAdminPort) {
            publicAdminPortsVMs.push({ ...baseInfo, exposedPorts: [...new Set(exposedPorts)] });
          }

        }
      } catch (subErr) {
        console.warn(`[AZURE-VMS] Warning: Failed to scan subscription ${subId}. Reason: ${subErr.message}`);
        partialErrors.push({
          subscriptionId: subId,
          scope: "virtualMachines.listAll",
          message: subErr.message
        });
      }
    }

    // =========================================================
    // CONSTRUCTION DU RAPPORT
    // =========================================================

    const summary = {
      partialErrorsCount: partialErrors.length,
      totalVMs,
      unencryptedDisksVMsCount: unencryptedDisksVMs.length,
      noManagedIdentityVMsCount: noManagedIdentityVMs.length,
      noTrustedLaunchVMsCount: noTrustedLaunchVMs.length,
      publicAdminPortsVMsCount: publicAdminPortsVMs.length,
      passwordAuthLinuxVMsCount: passwordAuthLinuxVMs.length
    };

    // CHECK 1: Exposed Admin Ports
    checks.push(
      publicAdminPortsVMs.length > 0
        ? {
            checkId: "CHECK-AZ-VMS-001",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "FAILED",
            severity: "CRITICAL",
            title: "Management ports (RDP/SSH) are exposed to the Internet",
            description: "One or more virtual machines have network interfaces with public IPs and Allow rules for ports 22 or 3389 from 'Any' source. This is a severe vector for brute-force and ransomware attacks.",
            recommendation: "Remove public IPs from VMs. Use Azure Bastion or Just-In-Time (JIT) VM access. Restrict NSG inbound rules to specific trusted corporate IP ranges.",
            affectedResourcesCount: publicAdminPortsVMs.length,
            affectedResourcesSample: publicAdminPortsVMs.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-VMS-001",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "PASSED",
            severity: "INFO",
            title: "No management ports directly exposed to the Internet",
            description: "All analyzed VMs enforce network security boundaries blocking direct, unrestricted inbound access to management ports.",
            recommendation: "Continue using Azure Bastion and strict NSG rules for administrative access.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    // CHECK 2: Encryption
    checks.push(
      unencryptedDisksVMs.length > 0
        ? {
            checkId: "CHECK-AZ-VMS-002",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "FAILED",
            severity: "HIGH",
            title: "Virtual Machine disks are explicitly unencrypted",
            description: "One or more VMs have OS or Data disks configured with encryption disabled. This risks data exposure if underlying storage is compromised.",
            recommendation: "Enable Azure Disk Encryption (ADE) or Server-Side Encryption with Customer-Managed Keys (CMK) on all attached volumes.",
            affectedResourcesCount: unencryptedDisksVMs.length,
            affectedResourcesSample: unencryptedDisksVMs.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-VMS-002",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "PASSED",
            severity: "INFO",
            title: "Virtual Machine disks utilize encryption",
            description: "No analyzed VMs were found with explicitly disabled disk encryption.",
            recommendation: "Maintain encryption-at-rest policies for all newly provisioned VM disks.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    // CHECK 3: Trusted Launch
    checks.push(
      noTrustedLaunchVMs.length > 0
        ? {
            checkId: "CHECK-AZ-VMS-003",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "FAILED",
            severity: "MEDIUM",
            title: "Virtual Machines are not utilizing Trusted Launch",
            description: "Some VMs are not configured with Trusted Launch (Secure Boot and vTPM). This leaves them vulnerable to bootkits, rootkits, and kernel-level malware.",
            recommendation: "Redeploy or configure VMs to use Trusted Launch architecture to ensure boot chain integrity.",
            affectedResourcesCount: noTrustedLaunchVMs.length,
            affectedResourcesSample: noTrustedLaunchVMs.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-VMS-003",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "PASSED",
            severity: "INFO",
            title: "Trusted Launch is enabled on all virtual machines",
            description: "All analyzed VMs utilize Secure Boot and vTPM to protect the boot sequence.",
            recommendation: "Make Trusted Launch the default for all future VM deployments.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    // CHECK 4: Managed Identity
    checks.push(
      noManagedIdentityVMs.length > 0
        ? {
            checkId: "CHECK-AZ-VMS-004",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "FAILED",
            severity: "LOW",
            title: "Virtual Machines are not using Managed Identities",
            description: "Some VMs do not have a System-Assigned or User-Assigned Managed Identity. Developers might resort to hardcoding credentials to access Azure APIs from within these VMs.",
            recommendation: "Assign Managed Identities to VMs that require access to Azure resources (Key Vault, Storage) to eliminate credential management overhead.",
            affectedResourcesCount: noManagedIdentityVMs.length,
            affectedResourcesSample: noManagedIdentityVMs.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-VMS-004",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "PASSED",
            severity: "INFO",
            title: "Managed Identities are configured",
            description: "All analyzed VMs possess a Managed Identity, facilitating secure credential-free access to other Azure services.",
            recommendation: "Ensure Role-Based Access Control (RBAC) assignments for these identities follow the principle of least privilege.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    // CHECK 5: Linux Password Auth
    checks.push(
      passwordAuthLinuxVMs.length > 0
        ? {
            checkId: "CHECK-AZ-VMS-005",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "FAILED",
            severity: "MEDIUM",
            title: "Linux Virtual Machines allow password-based authentication",
            description: "One or more Linux VMs do not explicitly disable password authentication, making them susceptible to credential brute-forcing.",
            recommendation: "Disable password authentication. Require SSH keys (or Azure AD integration) for all Linux VM logons.",
            affectedResourcesCount: passwordAuthLinuxVMs.length,
            affectedResourcesSample: passwordAuthLinuxVMs.slice(0, 10),
          }
        : {
            checkId: "CHECK-AZ-VMS-005",
            area: "Virtual Machines",
            resourceType: "Microsoft.Compute/virtualMachines",
            status: "PASSED",
            severity: "INFO",
            title: "Linux password authentication is disabled",
            description: "No analyzed Linux VMs were found with password authentication enabled.",
            recommendation: "Continue enforcing SSH key pairs or Entra ID login for Linux environments.",
            affectedResourcesCount: 0,
            affectedResourcesSample: [],
          }
    );

    const durationMs = Date.now() - startTime;
    console.log(`[AZURE-VMS] Audit completed in ${durationMs}ms. Analyzed ${totalVMs} VMs.`);

    return {
      status: "SUCCESS",
      duration_ms: durationMs,
      vms_analyzed: totalVMs,
      summary,
      checks,
      details: {
        partialErrors,
        publicAdminPortsVMs,
        unencryptedDisksVMs,
        noTrustedLaunchVMs,
        noManagedIdentityVMs,
        passwordAuthLinuxVMs
      }
    };

  } catch (err) {
    console.error(`[AZURE-VMS] CRITICAL ERROR: ${err.message}`);
    return {
      status: "FAILED",
      duration_ms: Date.now() - startTime,
      error: "Virtual Machines audit failed due to API or permission error.",
      details: err.message
    };
  }
}

function extractResourceGroupFromId(id) {
  if (!id) return null;
  const match = id.match(/resourceGroups\/([^\/]+)/i);
  return match ? match[1] : null;
}

module.exports = { auditVMs };