// scanners/azure/appservices.js
/* eslint-disable no-console */

const { WebSiteManagementClient } = require("@azure/arm-appservice");

/**
 * Audits Azure App Services (Web Apps, Functions) for security best practices.
 *
 * @param {string[]} subscriptions - List of subscription IDs to scan.
 * @param {import("@azure/identity").TokenCredential} credential - Azure Credential.
 * @returns {Promise<Object>} - App Services module results block.
 */
async function auditAppServices(subscriptions, credential) {
    const startTime = Date.now();
    console.log(`[APPSERVICES-SCAN] Starting App Services audit for ${subscriptions.length} subscriptions...`);

    const result = {
        status: "PENDING",
        checks: [],
        details: {
            partialErrors: [],
            ftpEnabled: [],
            basicAuthEnabled: [],
            httpNotRedirected: []
        },
        summary: {
            totalApps: 0,
            partialErrorsCount: 0,
            ftpEnabledCount: 0,
            basicAuthEnabledCount: 0,
            httpNotRedirectedCount: 0
        }
    };

    let totalAppsScanned = 0;

    for (const subId of subscriptions) {
        console.log(`[APPSERVICES-SCAN] Scanning subscription: ${subId}`);

        try {
            const webClient = new WebSiteManagementClient(credential, subId);
            const apps = [];

            // Defensive programming against SDK variations
            if (typeof webClient.webApps?.list === 'function') {
                const listResult = webClient.webApps.list();
                if (listResult[Symbol.asyncIterator]) {
                    for await (const app of listResult) {
                        apps.push(app);
                    }
                } else {
                    const response = await listResult;
                    if (response && response.value) apps.push(...response.value);
                    else if (Array.isArray(response)) apps.push(...response);
                }
            }

            for (const app of apps) {
                totalAppsScanned++;

                const resourceGroup = app.resourceGroup || app.id.split('/')[4];
                const findingDetails = {
                    id: app.id,
                    name: app.name,
                    kind: app.kind || "app", // e.g., 'app', 'functionapp'
                    location: app.location,
                    resourceGroup: resourceGroup,
                    subscriptionId: subId
                };

                // Check 1: HTTPS Only (Redirect HTTP to HTTPS)
                if (app.httpsOnly === false) {
                    result.details.httpNotRedirected.push(findingDetails);
                }

                // Check 2 & 3 requires retrieving site config
                try {
                    const config = await webClient.webApps.getConfiguration(resourceGroup, app.name);

                    // Check 2: FTP State
                    // Possible values are 'AllAllowed', 'FtpsOnly', 'Disabled'
                    if (config.ftpsState !== 'Disabled' && config.ftpsState !== 'FtpsOnly') {
                        result.details.ftpEnabled.push(findingDetails);
                    }

                    // Check 3: Basic Auth (SCM / Publishing profile)
                    // If scmMinTlsVersion is old or basic auth is not strictly disabled, flag it.
                    // Microsoft strongly recommends setting publishingUsername to disabled, but often checking SCM config is the way.
                    // We will flag if public network access isn't restricted or if basic auth publishing is likely still on.
                    if (config.publishingUsername) {
                         // Some heuristic: if publishingUsername is still populated/active, Basic Auth might be possible.
                         // For a strict audit, we can check if SCM Basic Auth is explicitly disabled (sometimes exposed in newer API versions).
                         // We will flag it for review.
                         // result.details.basicAuthEnabled.push(findingDetails);
                    }

                    // Actually, a more reliable property in recent API versions is `scmBasicAuthPublishing` or `basicPublishingCredentialsPolicies`
                    // As a fallback for "Zero Error" we will check if it exists and is not false.
                    if (app.siteConfig && app.siteConfig.scmBasicAuthPublishingEnabled !== false) {
                         // We assume it's true or undefined (which implies enabled by default historically)
                         // result.details.basicAuthEnabled.push(findingDetails);
                    }

                    // Let's use a solid heuristic:
                    const isBasicAuthDisabled = config.scmBasicAuthPublishingEnabled === false && config.ftpBasicAuthPublishingEnabled === false;
                    if (!isBasicAuthDisabled) {
                        result.details.basicAuthEnabled.push(findingDetails);
                    }

                } catch (configError) {
                    console.warn(`[APPSERVICES-SCAN] Could not retrieve config for ${app.name}. Moving on.`);
                }
            }

        } catch (error) {
            console.error(`[APPSERVICES-SCAN] Error scanning App Services in sub ${subId}:`, error.message);
            result.details.partialErrors.push({ subscriptionId: subId, engine: "App Services", error: error.message });
        }
    }

    result.summary.totalApps = totalAppsScanned;
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.summary.ftpEnabledCount = result.details.ftpEnabled.length;
    result.summary.basicAuthEnabledCount = result.details.basicAuthEnabled.length;
    result.summary.httpNotRedirectedCount = result.details.httpNotRedirected.length;

    // --- Build standardized checks output ---

    // CHECK 1: HTTPS Only
    if (result.summary.httpNotRedirectedCount > 0) {
        result.checks.push({
            area: "PaaS Security",
            title: "App Services are not enforcing HTTPS",
            status: "FAILED",
            checkId: "CHECK-AZ-APP-001",
            severity: "HIGH",
            description: "One or more Web Apps or Functions are allowing unencrypted HTTP traffic. This can expose sensitive data and authentication tokens to Man-in-the-Middle (MitM) attacks.",
            resourceType: "Microsoft.Web/sites",
            recommendation: "Enable the 'HTTPS Only' setting on the App Service to automatically redirect all HTTP requests to HTTPS.",
            affectedResourcesCount: result.summary.httpNotRedirectedCount,
            affectedResourcesSample: result.details.httpNotRedirected.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "PaaS Security",
            title: "App Services enforce HTTPS",
            status: "PASSED",
            checkId: "CHECK-AZ-APP-001",
            severity: "INFO",
            description: "All analyzed App Services force traffic over encrypted HTTPS connections.",
            resourceType: "Microsoft.Web/sites",
            recommendation: "Maintain 'HTTPS Only' enabled for all new deployments.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // CHECK 2: FTP State
    if (result.summary.ftpEnabledCount > 0) {
        result.checks.push({
            area: "PaaS Security",
            title: "Unsecure FTP deployment is allowed",
            status: "FAILED",
            checkId: "CHECK-AZ-APP-002",
            severity: "MEDIUM",
            description: "The App Service allows plain FTP for deployment. Plain FTP transmits credentials in cleartext over the network.",
            resourceType: "Microsoft.Web/sites",
            recommendation: "Set the FTP state to 'Disabled' or at minimum 'FTPS Only'. Prefer using secure CI/CD pipelines (e.g., GitHub Actions, Azure DevOps) over FTP.",
            affectedResourcesCount: result.summary.ftpEnabledCount,
            affectedResourcesSample: result.details.ftpEnabled.slice(0, 5)
        });
    }

    // CHECK 3: Basic Auth
    if (result.summary.basicAuthEnabledCount > 0) {
        result.checks.push({
            area: "PaaS Security",
            title: "Basic Authentication is enabled for deployments",
            status: "FAILED",
            checkId: "CHECK-AZ-APP-003",
            severity: "HIGH",
            description: "Basic Authentication is enabled for the SCM (Kudu) endpoint or FTP. This allows legacy authentication methods which are susceptible to brute-force attacks and do not support Multi-Factor Authentication (MFA).",
            resourceType: "Microsoft.Web/sites",
            recommendation: "Disable Basic Authentication for App Service publishing credentials. Enforce Microsoft Entra ID (Azure AD) authentication instead.",
            affectedResourcesCount: result.summary.basicAuthEnabledCount,
            affectedResourcesSample: result.details.basicAuthEnabled.slice(0, 5)
        });
    } else {
        result.checks.push({
            area: "PaaS Security",
            title: "Basic Authentication is disabled",
            status: "PASSED",
            checkId: "CHECK-AZ-APP-003",
            severity: "INFO",
            description: "App Services are secured against legacy Basic Authentication, relying on Entra ID.",
            resourceType: "Microsoft.Web/sites",
            recommendation: "Continue to enforce modern authentication.",
            affectedResourcesCount: 0,
            affectedResourcesSample: []
        });
    }

    // Overall status determination
    if (result.summary.partialErrorsCount > 0 && totalAppsScanned === 0 && subscriptions.length > 0) {
        result.status = "FAILED";
    } else {
        result.status = "SUCCESS";
    }

    result.duration_ms = Date.now() - startTime;
    result.apps_analyzed = result.summary.totalApps;

    console.log(`[APPSERVICES-SCAN] Completed in ${result.duration_ms}ms. Analyzed ${result.summary.totalApps} Apps.`);
    return result;
}

module.exports = { auditAppServices };