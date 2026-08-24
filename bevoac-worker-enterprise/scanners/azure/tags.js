'use strict';

const { runResourceGraphQueryDetailed } = require('../../src/lib/resource-graph');
const { recordResourceGraphResult } = require('../../src/lib/resource-graph-evidence');
const { throwIfAborted } = require('../../src/lib/abort');

const MANDATORY_TAGS = Object.freeze(['environment', 'owner']);

/**
 * Audit Azure Resources for tagging compliance using the paginated Resource Graph helper.
 *
 * @param {string[]} subscriptions
 * @param {import('@azure/identity').TokenCredential} credential
 * @param {{ signal?: AbortSignal, logger?: object, resourceGraphClient?: object, maxRows?: number, maxPages?: number }} options
 * @returns {Promise<Object>}
 */
async function auditTags(subscriptions, credential, options = {}) {
  const startTime = Date.now();
  const logger = options.logger || console;
  const signal = options.signal || null;
  const result = {
    status: 'PENDING',
    checks: [],
    details: {
      untaggedResources: [],
      missingMandatoryTags: [],
      partialErrors: [],
      resourceGraphQueries: []
    },
    summary: {
      totalResourcesScanned: 0,
      untaggedCount: 0,
      missingMandatoryTagsCount: 0,
      partialErrorsCount: 0,
      resourceGraphTruncated: false
    }
  };

  try {
    throwIfAborted(signal, 'Azure tags audit');
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      const error = new Error('No subscriptions provided for the tags scan.');
      error.code = 'AZURE_SUBSCRIPTIONS_REQUIRED';
      throw error;
    }
    if (!credential && !options.resourceGraphClient) {
      const error = new Error('A credential is required for the tags scan.');
      error.code = 'AZURE_CREDENTIAL_REQUIRED';
      throw error;
    }

    const query = `
      resources
      | project id, name, type, tags, subscriptionId
    `;
    const queryResult = await runResourceGraphQueryDetailed(
      credential || {},
      subscriptions,
      query,
      {
        signal,
        client: options.resourceGraphClient || undefined,
        maxRows: options.maxRows,
        maxPages: options.maxPages
      }
    );
    const resources = recordResourceGraphResult(result, 'tags.inventory', queryResult);
    result.summary.totalResourcesScanned = resources.length;
    result.summary.resourceGraphTruncated = Boolean(queryResult.metadata?.truncated);

    for (const resource of resources) {
      throwIfAborted(signal, 'Azure tags audit');
      const tags = resource?.tags && typeof resource.tags === 'object' ? resource.tags : {};
      const tagKeys = Object.keys(tags).map((key) => key.toLowerCase());
      const base = {
        id: resource?.id || null,
        name: resource?.name || null,
        type: resource?.type || null,
        subscriptionId: resource?.subscriptionId || null
      };

      if (tagKeys.length === 0) {
        result.details.untaggedResources.push(base);
        continue;
      }

      const missingTags = MANDATORY_TAGS.filter((requiredTag) => !tagKeys.includes(requiredTag));
      if (missingTags.length > 0) {
        result.details.missingMandatoryTags.push({ ...base, missingTags });
      }
    }

    result.summary.untaggedCount = result.details.untaggedResources.length;
    result.summary.missingMandatoryTagsCount = result.details.missingMandatoryTags.length;
    result.summary.partialErrorsCount = result.details.partialErrors.length;

    if (result.summary.untaggedCount > 0) {
      result.checks.push({
        area: 'Governance & FinOps',
        title: 'Resources with no tags detected',
        status: 'FAILED',
        checkId: 'CHECK-TAGS-001',
        severity: 'MEDIUM',
        description: 'Resources without tags reduce cost allocation and operational visibility.',
        resourceType: 'Azure Resources',
        recommendation: 'Enforce an approved tagging taxonomy with Azure Policy and inheritance where appropriate.',
        affectedResourcesCount: result.summary.untaggedCount,
        affectedResourcesSample: result.details.untaggedResources.slice(0, 5)
      });
    }

    if (result.summary.missingMandatoryTagsCount > 0) {
      result.checks.push({
        area: 'Governance & FinOps',
        title: 'Resources missing mandatory tags (Environment, Owner)',
        status: 'FAILED',
        checkId: 'CHECK-TAGS-002',
        severity: 'HIGH',
        description: "The required 'Environment' and 'Owner' tags are missing on some resources.",
        resourceType: 'Azure Resources',
        recommendation: 'Enforce and normalize the mandatory tag keys with Azure Policy.',
        affectedResourcesCount: result.summary.missingMandatoryTagsCount,
        affectedResourcesSample: result.details.missingMandatoryTags.slice(0, 5)
      });
    }

    if (
      result.summary.untaggedCount === 0 &&
      result.summary.missingMandatoryTagsCount === 0 &&
      result.summary.totalResourcesScanned > 0
    ) {
      result.checks.push({
        area: 'Governance & FinOps',
        title: 'Resource tagging compliance is 100%',
        status: 'PASSED',
        checkId: 'CHECK-TAGS-000',
        severity: 'INFO',
        description: "All scanned resources contain the mandatory 'Environment' and 'Owner' tags.",
        resourceType: 'Azure Resources',
        recommendation: 'Continue enforcing the tagging policy and review tag values periodically.',
        affectedResourcesCount: 0,
        affectedResourcesSample: []
      });
    }

    if (result.summary.totalResourcesScanned === 0) {
      result.checks.push({
        area: 'Governance & FinOps',
        title: 'No Azure resources were returned for tag analysis',
        status: 'PASSED',
        checkId: 'CHECK-TAGS-EMPTY',
        severity: 'INFO',
        description: 'The verified subscriptions returned no resources for this query.',
        resourceType: 'Azure Resources',
        recommendation: 'Confirm that the selected subscriptions are expected to be empty.',
        affectedResourcesCount: 0,
        affectedResourcesSample: []
      });
    }

    result.status = result.summary.partialErrorsCount > 0 ? 'PARTIAL' : 'SUCCESS';
  } catch (error) {
    logger.error?.({ code: error?.code || 'TAGS_AUDIT_FAILED' }, 'Azure tags audit failed.');
    result.status = 'FAILED';
    result.details.partialErrors.push({
      code: String(error?.code || 'TAGS_AUDIT_FAILED').slice(0, 120),
      message: 'The tags module could not enumerate Azure resources.'
    });
    result.summary.partialErrorsCount = result.details.partialErrors.length;
    result.checks.push({
      area: 'Governance & FinOps',
      title: 'Tags audit failed',
      status: 'FAILED',
      checkId: 'CHECK-TAGS-ERR',
      severity: 'HIGH',
      description: 'The tags module could not enumerate Azure resources.',
      recommendation: 'Verify the Azure connection, Resource Graph permissions and target subscriptions.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditTags, MANDATORY_TAGS };
