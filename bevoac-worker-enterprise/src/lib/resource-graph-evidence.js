'use strict';

function recordResourceGraphResult(result, label, queryResult) {
  if (!result || !result.details) throw new Error('A module result with details is required.');
  const rows = Array.isArray(queryResult?.rows) ? queryResult.rows : [];
  const metadata = queryResult?.metadata || null;
  if (!Array.isArray(result.details.resourceGraphQueries)) result.details.resourceGraphQueries = [];
  if (metadata) result.details.resourceGraphQueries.push({ label, ...metadata });
  if (metadata?.truncated) {
    if (!Array.isArray(result.details.partialErrors)) result.details.partialErrors = [];
    result.details.partialErrors.push({
      scope: `ResourceGraph/${label}`,
      code: 'RESOURCE_GRAPH_TRUNCATED',
      message: `Resource Graph results were truncated (${metadata.rowsReturned} rows, reason=${metadata.truncationReason}).`,
      metadata
    });
  }
  return rows;
}

module.exports = { recordResourceGraphResult };
