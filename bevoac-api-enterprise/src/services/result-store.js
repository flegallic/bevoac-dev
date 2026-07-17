const crypto = require('crypto');
const zlib = require('zlib');
const { ValidationError } = require('../lib/errors');
const { buildResultSummary } = require('../lib/findings-collector');

function toJsonObject(value) { if (value == null) return null; if (typeof value === 'string') return JSON.parse(value); return value; }
function jsonByteLength(value) { return Buffer.byteLength(JSON.stringify(value || null), 'utf8'); }
function sha256Hex(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function gzipToBase64(jsonString) { return zlib.gzipSync(Buffer.from(jsonString, 'utf8')).toString('base64'); }
function ungzipFromBase64(value) { return zlib.gunzipSync(Buffer.from(value, 'base64')).toString('utf8'); }

async function loadResultForScan(client, scanId, tenantId) {
  if (!tenantId) throw new Error('tenantId is required to load a scan result.');
  const res = await client.query(
    `SELECT r.result_json, r.result_gzip_base64, r.compression
       FROM scan_results r
       INNER JOIN scans s ON s.id = r.scan_id AND s.tenant_id = r.tenant_id
      WHERE r.scan_id = $1 AND r.tenant_id = $2
      LIMIT 1`,
    [scanId, tenantId]
  );
  if (res.rowCount === 1) {
    const row = res.rows[0];
    if (row.compression === 'gzip_base64') return JSON.parse(ungzipFromBase64(row.result_gzip_base64));
    return toJsonObject(row.result_json);
  }
  const fallback = await client.query('SELECT result FROM scans WHERE id = $1 AND tenant_id = $2 LIMIT 1', [scanId, tenantId]);
  if (fallback.rowCount === 1 && fallback.rows[0].result) return toJsonObject(fallback.rows[0].result);
  return null;
}

async function loadResultSummaryForScan(client, scanId, tenantId) {
  const res = await client.query('SELECT result_summary FROM scan_results WHERE scan_id = $1 AND tenant_id = $2 LIMIT 1', [scanId, tenantId]);
  if (res.rowCount === 1) return toJsonObject(res.rows[0].result_summary);
  const result = await loadResultForScan(client, scanId, tenantId);
  return result ? buildResultSummary(result) : null;
}

async function assertPdfInputWithinLimit(result, maxBytes) {
  const size = jsonByteLength(result);
  if (maxBytes != null && size > maxBytes) throw new ValidationError(`Scan result is too large for synchronous PDF generation (${size}/${maxBytes} bytes). Use JSON export or archive workflow.`);
  return size;
}

function withTimeout(promise, timeoutMs, message) {
  let handle;
  const timeout = new Promise((_, reject) => { handle = setTimeout(() => reject(new ValidationError(message || `Operation timed out after ${timeoutMs}ms.`)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

module.exports = { toJsonObject, jsonByteLength, sha256Hex, gzipToBase64, ungzipFromBase64, buildResultSummary, loadResultForScan, loadResultSummaryForScan, assertPdfInputWithinLimit, withTimeout };
