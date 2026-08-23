const { AppError, NotFoundError, ValidationError } = require('../lib/errors');
const { withTenantSession, withDatabaseSession, withDatabaseTransaction } = require('../lib/db-context');

class BillingService {
  constructor(pg, config) { this.pg = pg; this.config = config; }
  getPlanDefinition(planCode) {
    const planQuotas = this.config.planQuotas;
    const resourceLimits = this.config.planResourceLimits || {};
    const plans = {
      free: { quotaLimit: planQuotas.free, resourceLimit: resourceLimits.free ?? 10, payg: false, unitPriceEur: 0 },
      standard: { quotaLimit: planQuotas.standard, resourceLimit: resourceLimits.standard ?? 500, payg: false, unitPriceEur: 0 },
      business: { quotaLimit: planQuotas.business, resourceLimit: resourceLimits.business ?? 2500, payg: false, unitPriceEur: 0 },
      payg: { quotaLimit: null, resourceLimit: resourceLimits.payg ?? null, payg: true, unitPriceEur: this.config.paygUnitPriceEur }
    };
    const plan = plans[planCode];
    if (!plan) throw new AppError(`Unsupported plan code: ${planCode}`, { code: 'UNSUPPORTED_PLAN', statusCode: 500 });
    return plan;
  }
  getActiveScanLimit(planCode) { const limits = this.config.backpressure?.activeScanLimits || {}; return Number(limits[planCode] ?? limits.standard ?? 3); }
  getCurrentQuotaMonth() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); }
  normalizeQuotaMonth(value, { required = false, completedOnly = false } = {}) {
    if (value == null || String(value).trim() === '') {
      if (required) throw new ValidationError('A billing month is required in YYYY-MM-01 format.');
      return this.getCurrentQuotaMonth();
    }
    const month = String(value).trim();
    if (!/^(?:20|21)[0-9]{2}-(?:0[1-9]|1[0-2])-01$/.test(month)) {
      throw new ValidationError('Billing month must use YYYY-MM-01 format.');
    }
    const parsed = new Date(`${month}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== month) {
      throw new ValidationError('Billing month is not a valid calendar month.');
    }
    if (completedOnly && month >= this.getCurrentQuotaMonth()) {
      throw new ValidationError('Only a completed billing month can be closed.');
    }
    return month;
  }
  money(value) { return Number(Number(value || 0).toFixed(2)); }
  async lockTenantMonth(client, tenantId, quotaMonth) { await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [`bevoac:${tenantId}`, `quota:${quotaMonth}`]); }
  async getTenantContext(client, tenantId, { forUpdate = false } = {}) {
    const result = await client.query(`SELECT id, company_name, plan_code, is_active FROM tenants WHERE id = $1 LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`, [tenantId]);
    return result.rows[0] || null;
  }
  async getUsageCounts(client, tenantId, quotaMonth) {
    const result = await client.query(
      `SELECT
        COALESCE(SUM(CASE WHEN is_quota_included = TRUE AND status IN ('PENDING','IN_PROGRESS','DONE') THEN billing_units ELSE 0 END), 0)::int AS included_units,
        COALESCE(SUM(CASE WHEN is_quota_included = FALSE AND status IN ('PENDING','IN_PROGRESS','DONE') THEN billing_units ELSE 0 END), 0)::int AS payg_units
       FROM scans WHERE tenant_id = $1 AND quota_month = $2::date`,
      [tenantId, quotaMonth]
    );
    return { includedUnits: Number(result.rows[0]?.included_units || 0), paygUnits: Number(result.rows[0]?.payg_units || 0) };
  }
  async getActiveScanCount(client, tenantId) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM scans WHERE tenant_id = $1 AND status IN ('PENDING','IN_PROGRESS')`, [tenantId]);
    return Number(result.rows[0]?.count || 0);
  }
  async assertBackpressure(client, tenant, metadata) {
    const activeLimit = this.getActiveScanLimit(tenant.plan_code);
    const activeCount = await this.getActiveScanCount(client, tenant.id);
    if (activeLimit != null && activeCount >= activeLimit) {
      throw new AppError('Too many active scans for this tenant. Retry when an existing scan has completed.', {
        code: 'TENANT_ACTIVE_SCAN_LIMIT_REACHED', statusCode: 429,
        details: { activeScanLimit: activeLimit, activeScanCount: activeCount, planCode: tenant.plan_code, retryAfterSeconds: 30, metadata }
      });
    }
    return { activeLimit, activeCount };
  }
  async recordLedgerEvent(client, payload) {
    await client.query(
      `INSERT INTO billing_usage_ledger (
        tenant_id, scan_id, event_type, plan_code_snapshot, quota_month, billing_units,
        unit_price_eur_ht, amount_eur_ht, currency_code, cloud_provider, scan_profile,
        modules, metadata, recorded_at
      ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, 'EUR', $9, $10, $11::jsonb, $12::jsonb, NOW())`,
      [payload.tenantId, payload.scanId || null, payload.eventType, payload.planCodeSnapshot, payload.quotaMonth, payload.billingUnits, this.money(payload.unitPriceEurHt), this.money(payload.amountEurHt), payload.cloudProvider || null, payload.scanProfile || null, JSON.stringify(payload.modules || []), JSON.stringify(payload.metadata || {})]
    );
  }
  async upsertSnapshot(client, tenantId, quotaMonth) {
    const tenant = await this.getTenantContext(client, tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found while upserting billing snapshot.');
    const plan = this.getPlanDefinition(tenant.plan_code);
    const aggregates = await client.query(
      `SELECT
        COALESCE(SUM(CASE WHEN event_type = 'scan_consumed' AND amount_eur_ht = 0 THEN billing_units ELSE 0 END), 0)::int AS included_units_used,
        COALESCE(SUM(CASE WHEN event_type = 'scan_consumed' AND amount_eur_ht > 0 THEN billing_units ELSE 0 END), 0)::int AS payg_units_used,
        COALESCE(SUM(CASE WHEN event_type = 'scan_consumed' AND amount_eur_ht > 0 THEN amount_eur_ht ELSE 0 END), 0)::numeric(10,2) AS payg_amount_eur_ht,
        COALESCE(SUM(CASE WHEN event_type = 'adjustment' THEN amount_eur_ht ELSE 0 END), 0)::numeric(10,2) AS adjustments_amount_eur_ht,
        COALESCE(SUM(CASE WHEN event_type IN ('credit','scan_refunded') THEN amount_eur_ht ELSE 0 END), 0)::numeric(10,2) AS credits_amount_eur_ht,
        COALESCE(SUM(CASE WHEN event_type = 'scan_reserved' THEN billing_units ELSE 0 END), 0)::int AS reserved_units
       FROM billing_usage_ledger WHERE tenant_id = $1 AND quota_month = $2::date`,
      [tenantId, quotaMonth]
    );
    const row = aggregates.rows[0] || {};
    const totalAmount = this.money(Number(row.payg_amount_eur_ht || 0) + Number(row.adjustments_amount_eur_ht || 0) + Number(row.credits_amount_eur_ht || 0));
    await client.query(
      `INSERT INTO billing_monthly_snapshots (
        tenant_id, quota_month, plan_code_snapshot, quota_limit, resource_limit, included_units_used, payg_units_used,
        payg_unit_price_eur_ht, payg_amount_eur_ht, adjustments_amount_eur_ht, credits_amount_eur_ht,
        total_amount_eur_ht, currency_code, snapshot_status, generated_at, metadata
      ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'EUR', 'OPEN', NOW(), $13::jsonb)
      ON CONFLICT (tenant_id, quota_month) DO UPDATE SET
        plan_code_snapshot = EXCLUDED.plan_code_snapshot,
        quota_limit = EXCLUDED.quota_limit,
        resource_limit = EXCLUDED.resource_limit,
        included_units_used = EXCLUDED.included_units_used,
        payg_units_used = EXCLUDED.payg_units_used,
        payg_unit_price_eur_ht = EXCLUDED.payg_unit_price_eur_ht,
        payg_amount_eur_ht = EXCLUDED.payg_amount_eur_ht,
        adjustments_amount_eur_ht = EXCLUDED.adjustments_amount_eur_ht,
        credits_amount_eur_ht = EXCLUDED.credits_amount_eur_ht,
        total_amount_eur_ht = EXCLUDED.total_amount_eur_ht,
        generated_at = NOW(),
        metadata = EXCLUDED.metadata`,
      [tenantId, quotaMonth, tenant.plan_code, plan.quotaLimit, plan.resourceLimit, Number(row.included_units_used || 0), Number(row.payg_units_used || 0), this.money(plan.unitPriceEur), this.money(row.payg_amount_eur_ht || 0), this.money(row.adjustments_amount_eur_ht || 0), this.money(row.credits_amount_eur_ht || 0), totalAmount, JSON.stringify({ refreshedAt: new Date().toISOString(), source: 'billing-service-v6-2-0-client-ready', reservedUnits: Number(row.reserved_units || 0) })]
    );
  }
  async authorizeScan(client, { tenantId, billingUnits, cloudProvider, scanProfile, modules, metadata }) {
    const quotaMonth = this.getCurrentQuotaMonth();
    await this.lockTenantMonth(client, tenantId, quotaMonth);
    const tenant = await this.getTenantContext(client, tenantId);
    if (!tenant || !tenant.is_active) throw new NotFoundError('Tenant not found or inactive.');
    const plan = this.getPlanDefinition(tenant.plan_code);
    const backpressure = await this.assertBackpressure(client, tenant, metadata);
    const usage = await this.getUsageCounts(client, tenantId, quotaMonth);
    let isQuotaIncluded = false, amountEurHt = 0, scansUsed = usage.includedUnits, scansRemaining = plan.quotaLimit;
    if (plan.quotaLimit === null || (plan.payg === true && plan.quotaLimit === 0)) {
      isQuotaIncluded = false; amountEurHt = this.money(billingUnits * plan.unitPriceEur);
    } else {
      const projected = usage.includedUnits + billingUnits;
      if (projected > plan.quotaLimit) {
        await this.recordLedgerEvent(client, { tenantId, eventType: 'scan_blocked_quota', planCodeSnapshot: tenant.plan_code, quotaMonth, billingUnits, unitPriceEurHt: 0, amountEurHt: 0, cloudProvider, scanProfile, modules, metadata: { ...metadata, reason: 'MONTHLY_SCAN_QUOTA_EXCEEDED', quotaLimit: plan.quotaLimit, resourceLimit: plan.resourceLimit } });
        await this.upsertSnapshot(client, tenantId, quotaMonth);
        throw new AppError('Monthly scan quota exceeded. Standard and business plans are hard-blocked; no PAYG fallback is applied.', { code: 'MONTHLY_SCAN_QUOTA_EXCEEDED', statusCode: 429, details: { quotaMonth, quotaLimit: plan.quotaLimit, billingUnitsRequested: billingUnits } });
      }
      isQuotaIncluded = true; scansUsed = projected; scansRemaining = Math.max(plan.quotaLimit - projected, 0);
    }
    return { tenant, quotaMonth, plan, backpressure, billing: { planCode: tenant.plan_code, billingUnits, isQuotaIncluded, quotaMonth, quotaLimit: plan.quotaLimit, resourceLimit: plan.resourceLimit, activeScanLimit: backpressure.activeLimit, activeScanCountBeforeCreate: backpressure.activeCount, scansUsed, scansRemaining, paygUnitPrice: this.money(plan.unitPriceEur), estimatedCostEur: amountEurHt } };
  }
  async getTenantBillingOverview(tenantId) {
    return withTenantSession(this.pg, tenantId, async (client) => {
      const quotaMonth = this.getCurrentQuotaMonth();
      await this.upsertSnapshot(client, tenantId, quotaMonth);
      const snapshotResult = await client.query(`SELECT t.company_name, s.* FROM billing_monthly_snapshots s INNER JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1 AND s.quota_month = $2::date LIMIT 1`, [tenantId, quotaMonth]);
      if (snapshotResult.rowCount !== 1) return null;
      const row = snapshotResult.rows[0];
      return { tenantId, companyName: row.company_name, quotaMonth: row.quota_month, planCode: row.plan_code_snapshot, quotaLimit: row.quota_limit, resourceLimit: row.resource_limit, consumption: { includedUnitsUsed: Number(row.included_units_used || 0), scansRemaining: row.quota_limit == null ? null : Math.max(Number(row.quota_limit) - Number(row.included_units_used || 0), 0), paygUnitsUsed: Number(row.payg_units_used || 0) }, pricing: { paygUnitPriceEurHt: this.money(row.payg_unit_price_eur_ht || 0), paygAmountEurHt: this.money(row.payg_amount_eur_ht || 0), adjustmentsAmountEurHt: this.money(row.adjustments_amount_eur_ht || 0), creditsAmountEurHt: this.money(row.credits_amount_eur_ht || 0), totalAmountEurHt: this.money(row.total_amount_eur_ht || 0) }, snapshot: { status: row.snapshot_status, generatedAt: row.generated_at, closedAt: row.closed_at } };
    });
  }
  async getAdminBillingOverview(quotaMonth) {
    return withDatabaseSession(this.pg, async (client) => {
      const resolvedMonth = this.normalizeQuotaMonth(quotaMonth);
      const result = await client.query(`SELECT t.id AS tenant_id, t.company_name, t.plan_code, s.* FROM billing_monthly_snapshots s INNER JOIN tenants t ON t.id = s.tenant_id WHERE s.quota_month = $1::date ORDER BY t.company_name ASC`, [resolvedMonth]);
      return { quotaMonth: resolvedMonth, tenants: result.rows.map((row) => ({ tenantId: row.tenant_id, companyName: row.company_name, planCode: row.plan_code, quotaLimit: row.quota_limit, resourceLimit: row.resource_limit, includedUnitsUsed: Number(row.included_units_used || 0), scansRemaining: row.quota_limit == null ? null : Math.max(Number(row.quota_limit) - Number(row.included_units_used || 0), 0), paygUnitsUsed: Number(row.payg_units_used || 0), paygAmountEurHt: this.money(row.payg_amount_eur_ht || 0), totalAmountEurHt: this.money(row.total_amount_eur_ht || 0), snapshotStatus: row.snapshot_status, generatedAt: row.generated_at, closedAt: row.closed_at })) };
    });
  }
  async getTenantLedger(tenantId, quotaMonth) {
    return withTenantSession(this.pg, tenantId, async (client) => {
      const resolvedMonth = this.normalizeQuotaMonth(quotaMonth);
      const tenant = await this.getTenantContext(client, tenantId);
      if (!tenant) return null;
      const result = await client.query(`SELECT id, scan_id, event_type, plan_code_snapshot, quota_month, billing_units, unit_price_eur_ht, amount_eur_ht, currency_code, cloud_provider, scan_profile, modules, metadata, recorded_at FROM billing_usage_ledger WHERE tenant_id = $1 AND quota_month = $2::date ORDER BY recorded_at DESC, id DESC`, [tenantId, resolvedMonth]);
      return { tenantId, companyName: tenant.company_name, planCode: tenant.plan_code, quotaMonth: resolvedMonth, entries: result.rows.map((row) => ({ id: row.id, scanId: row.scan_id, entryType: row.event_type, planCodeSnapshot: row.plan_code_snapshot, billingUnits: Number(row.billing_units || 0), unitPriceEurHt: this.money(row.unit_price_eur_ht || 0), amountEurHt: this.money(row.amount_eur_ht || 0), currencyCode: row.currency_code, cloudProvider: row.cloud_provider, scanProfile: row.scan_profile, modules: row.modules, metadata: row.metadata, recordedAt: row.recorded_at })) };
    });
  }
  async closeBillingMonth(quotaMonth, actor) {
    return withDatabaseTransaction(this.pg, async (client) => {
      const resolvedMonth = this.normalizeQuotaMonth(quotaMonth, { required: true, completedOnly: true });
      const countResult = await client.query('SELECT COUNT(*)::int AS count FROM billing_monthly_snapshots WHERE quota_month = $1::date', [resolvedMonth]);
      if (Number(countResult.rows[0]?.count || 0) === 0) throw new AppError(`No billing snapshots found for month ${resolvedMonth}`, { code: 'BILLING_MONTH_NOT_INITIALIZED', statusCode: 400 });
      const alreadyClosed = await client.query('SELECT COUNT(*)::int AS count FROM billing_monthly_snapshots WHERE quota_month = $1::date AND snapshot_status = $2', [resolvedMonth, 'CLOSED']);
      if (Number(alreadyClosed.rows[0]?.count || 0) > 0) throw new AppError(`Billing month ${resolvedMonth} is already CLOSED`, { code: 'BILLING_MONTH_ALREADY_CLOSED', statusCode: 409 });
      const update = await client.query(`UPDATE billing_monthly_snapshots SET snapshot_status = 'CLOSED', closed_at = NOW() WHERE quota_month = $1::date`, [resolvedMonth]);
      await client.query(`INSERT INTO admin_audit_log (actor, action, metadata, created_at) VALUES ($1, $2, $3::jsonb, NOW())`, [actor || 'admin', 'billing.close_month', JSON.stringify({ quotaMonth: resolvedMonth, affectedRows: update.rowCount || 0 })]);
      return { quotaMonth: resolvedMonth, tenantsClosedCount: update.rowCount || 0, status: 'CLOSED' };
    });
  }
}
module.exports = { BillingService };
