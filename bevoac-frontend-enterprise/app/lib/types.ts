export type Severity = "critical" | "high" | "medium" | "low";

export type CategoryScore = {
  label: string;
  value: number;
};

export type Finding = {
  id: string;
  severity: Severity;
  resource: string;
  title: string;
  recommendation: string;
};

export type AlertItem = {
  id: string;
  severity: Severity;
  title: string;
  resource: string;
  date: string;
};

export type ResourceDistribution = {
  label: string;
  value: number;
  color: string;
};

export type TrendPoint = {
  label: string;
  score: number;
  findings: number;
};

export type BevoacDashboardData = {
  tenantName: string;
  tenantDomain: string;
  adminIdentity: string;
  refreshedAt: string;
  nextScanLabel: string;
  globalScore: number;
  scoreDelta: number;
  statusLabel: string;
  categories: CategoryScore[];
  severityCounts: Record<Severity, number>;
  trend: TrendPoint[];
  priorityActions: Finding[];
  resourceTypes: ResourceDistribution[];
  recentAlerts: AlertItem[];
  apiStatus: "live" | "fallback";
};
