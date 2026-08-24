import { demoDashboardData } from "./demo-data";
import type {
  AlertItem,
  BevoacDashboardData,
  CategoryScore,
  Finding,
  ResourceDistribution,
  Severity,
  TrendPoint
} from "./types";

const severities: Severity[] = ["critical", "high", "medium", "low"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function clampScore(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))));
}

function asSeverity(value: unknown, fallback: Severity = "medium"): Severity {
  const normalized = String(value ?? "").toLowerCase();
  return severities.includes(normalized as Severity) ? (normalized as Severity) : fallback;
}

function normalizeCategories(source: unknown): CategoryScore[] {
  const list = asArray(source);
  if (!list.length) return demoDashboardData.categories;

  return list.slice(0, 6).map((item, index) => {
    const record = asRecord(item);
    return {
      label: asString(record.label ?? record.name ?? record.category, demoDashboardData.categories[index]?.label ?? "Category"),
      value: clampScore(record.value ?? record.score, demoDashboardData.categories[index]?.value ?? 0)
    };
  });
}

function normalizeSeverityCounts(source: unknown): Record<Severity, number> {
  const record = asRecord(source);
  return severities.reduce(
    (counts, severity) => ({
      ...counts,
      [severity]: Math.max(0, Math.round(asNumber(record[severity], demoDashboardData.severityCounts[severity])))
    }),
    {} as Record<Severity, number>
  );
}

function normalizeTrend(source: unknown): TrendPoint[] {
  const list = asArray(source);
  if (!list.length) return demoDashboardData.trend;

  return list.slice(-12).map((item, index) => {
    const record = asRecord(item);
    return {
      label: asString(record.label ?? record.date ?? record.day, `P${index + 1}`),
      score: clampScore(record.score, demoDashboardData.globalScore),
      findings: Math.max(0, Math.round(asNumber(record.findings ?? record.issues, 0)))
    };
  });
}

function normalizeFindings(source: unknown): Finding[] {
  const list = asArray(source);
  if (!list.length) return demoDashboardData.priorityActions;

  return list.slice(0, 5).map((item, index) => {
    const record = asRecord(item);
    return {
      id: asString(record.id, String(index + 1).padStart(2, "0")),
      severity: asSeverity(record.severity),
      resource: asString(record.resource ?? record.asset ?? record.name, "Resource"),
      title: asString(record.title ?? record.description ?? record.finding, "Security finding"),
      recommendation: asString(record.recommendation ?? record.remediation, "Review the control and apply the recommended remediation.")
    };
  });
}

function normalizeResources(source: unknown): ResourceDistribution[] {
  const list = asArray(source);
  if (!list.length) return demoDashboardData.resourceTypes;

  const colors = ["#3ce7c4", "#60a5fa", "#f59e0b", "#f43f5e", "#a78bfa", "#22c55e"];
  return list.slice(0, 6).map((item, index) => {
    const record = asRecord(item);
    return {
      label: asString(record.label ?? record.type ?? record.name, `Type ${index + 1}`),
      value: Math.max(0, Math.round(asNumber(record.value ?? record.count, 0))),
      color: asString(record.color, colors[index] ?? "#94a3b8")
    };
  });
}

function normalizeAlerts(source: unknown): AlertItem[] {
  const list = asArray(source);
  if (!list.length) return demoDashboardData.recentAlerts;

  return list.slice(0, 6).map((item, index) => {
    const record = asRecord(item);
    return {
      id: asString(record.id, `alert-${index + 1}`),
      severity: asSeverity(record.severity),
      title: asString(record.title ?? record.message, "Security alert"),
      resource: asString(record.resource ?? record.asset ?? record.scope, "Tenant"),
      date: asString(record.date ?? record.createdAt ?? record.timestamp, new Date().toISOString())
    };
  });
}

export function normalizeBevoacPayload(payload: unknown): BevoacDashboardData {
  const root = asRecord(payload);
  const dashboard = asRecord(root.dashboard ?? root.data ?? root.result ?? root);
  const tenant = asRecord(dashboard.tenant);
  const posture = asRecord(dashboard.posture ?? dashboard.securityPosture);
  const findings = asRecord(dashboard.findings);
  const scan = asRecord(dashboard.scan);
  const admin = asRecord(dashboard.admin ?? dashboard.identity);

  const globalScore = clampScore(
    dashboard.globalScore ?? dashboard.score ?? posture.score,
    demoDashboardData.globalScore
  );

  return {
    tenantName: asString(tenant.name ?? dashboard.tenantName, demoDashboardData.tenantName),
    tenantDomain: asString(tenant.domain ?? dashboard.tenantDomain, demoDashboardData.tenantDomain),
    adminIdentity: asString(admin.name ?? admin.displayName ?? dashboard.adminIdentity, demoDashboardData.adminIdentity),
    refreshedAt: asString(dashboard.refreshedAt ?? dashboard.updatedAt ?? root.timestamp, new Date().toISOString()),
    nextScanLabel: asString(scan.nextLabel ?? dashboard.nextScanLabel, demoDashboardData.nextScanLabel),
    globalScore,
    scoreDelta: asNumber(posture.delta ?? dashboard.scoreDelta, demoDashboardData.scoreDelta),
    statusLabel: asString(posture.status ?? dashboard.statusLabel, globalScore >= 85 ? "Healthy" : "Needs attention"),
    categories: normalizeCategories(dashboard.categories ?? posture.categories),
    severityCounts: normalizeSeverityCounts(findings.bySeverity ?? dashboard.severityCounts),
    trend: normalizeTrend(dashboard.trend ?? posture.trend),
    priorityActions: normalizeFindings(dashboard.priorityActions ?? findings.priority ?? findings.items),
    resourceTypes: normalizeResources(dashboard.resourceTypes ?? findings.byResourceType),
    recentAlerts: normalizeAlerts(dashboard.recentAlerts ?? dashboard.alerts),
    apiStatus: "demo"
  };
}
