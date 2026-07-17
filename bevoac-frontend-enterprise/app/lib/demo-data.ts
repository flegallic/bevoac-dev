import type { BevoacDashboardData } from "./types";

export const demoDashboardData: BevoacDashboardData = {
  tenantName: "Nexir Demo",
  tenantDomain: "nexir-demo.onmicrosoft.com",
  adminIdentity: "Console",
  refreshedAt: "2025-04-24T23:58:00.000Z",
  nextScanLabel: "Next scan in 1 min · every 5 min",
  globalScore: 72,
  scoreDelta: 4,
  statusLabel: "Needs attention",
  categories: [
    { label: "Identity", value: 81 },
    { label: "Network", value: 58 },
    { label: "Data", value: 64 },
    { label: "Compute", value: 76 }
  ],
  severityCounts: {
    critical: 2,
    high: 3,
    medium: 4,
    low: 0
  },
  trend: [
    { label: "D-29", score: 58, findings: 18 },
    { label: "D-24", score: 61, findings: 17 },
    { label: "D-19", score: 66, findings: 14 },
    { label: "D-14", score: 68, findings: 12 },
    { label: "D-9", score: 69, findings: 11 },
    { label: "D-4", score: 71, findings: 10 },
    { label: "Now", score: 72, findings: 9 }
  ],
  priorityActions: [
    {
      id: "01",
      severity: "critical",
      resource: "nsg-public",
      title: "Port 22 (SSH) open to 0.0.0.0/0",
      recommendation: "Restrict source IP range to corporate VPN CIDR or use Azure Bastion."
    },
    {
      id: "02",
      severity: "critical",
      resource: "stgbackups",
      title: "Storage account allows public blob access",
      recommendation: "Disable public access and use SAS tokens or Private Endpoints."
    },
    {
      id: "03",
      severity: "high",
      resource: "vm-db-01",
      title: "Disk encryption not enabled",
      recommendation: "Enable ADE with a Key Vault-backed CMK."
    }
  ],
  resourceTypes: [
    { label: "Network", value: 34, color: "#3ce7c4" },
    { label: "Storage", value: 27, color: "#60a5fa" },
    { label: "Compute", value: 22, color: "#f59e0b" },
    { label: "Identity", value: 17, color: "#f43f5e" }
  ],
  recentAlerts: [
    {
      id: "a1",
      severity: "critical",
      title: "Public SSH exposure detected on nsg-public",
      resource: "nsg-public",
      date: "2025-04-24T08:14:00.000Z"
    },
    {
      id: "a2",
      severity: "critical",
      title: "Public blob container detected on stgbackups",
      resource: "stgbackups",
      date: "2025-04-24T08:14:00.000Z"
    },
    {
      id: "a3",
      severity: "high",
      title: "Disk encryption disabled on vm-db-01",
      resource: "vm-db-01",
      date: "2025-04-24T08:14:00.000Z"
    },
    {
      id: "a4",
      severity: "high",
      title: "Expired secret still in use",
      resource: "App registrations",
      date: "2025-04-23T19:02:00.000Z"
    }
  ],
  apiStatus: "fallback"
};
