"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CreditCard,
  Eye,
  EyeOff,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lock,
  LogOut,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Siren,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { demoDashboardData } from "@/app/lib/demo-data";
import type { BevoacDashboardData, Severity } from "@/app/lib/types";
import { SeverityBadge } from "./badge";
import { DonutChart, TrendChart } from "./charts";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Resources", icon: Boxes },
  { label: "Monitoring", icon: Activity },
  { label: "Scans", icon: Search },
  { label: "Alerts", icon: Bell },
  { label: "Integrations", icon: PlugZap },
  { label: "Billing", icon: CreditCard }
];

const severityLabels: Record<Severity, string> = {
  critical: "Critical findings",
  high: "High findings",
  medium: "Medium findings",
  low: "Low findings"
};

const severityTone: Record<Severity, string> = {
  critical: "text-rose-200",
  high: "text-amber-200",
  medium: "text-sky-200",
  low: "text-emerald-200"
};

type ClientConnection = {
  apiUrl: string;
  apiKeyHeader: string;
  apiKey: string;
};

const defaultConnection: ClientConnection = {
  apiUrl: "https://apim-bevoac-prod.azure-api.net/v1/health",
  apiKeyHeader: "Ocp-Apim-Subscription-Key",
  apiKey: ""
};

const sessionKey = "bevoac.client.connection";

function readSessionConnection(): ClientConnection {
  if (typeof window === "undefined") return defaultConnection;

  try {
    const saved = window.sessionStorage.getItem(sessionKey);
    return saved ? { ...defaultConnection, ...JSON.parse(saved) } : defaultConnection;
  } catch {
    return defaultConnection;
  }
}

function writeSessionConnection(connection: ClientConnection) {
  window.sessionStorage.setItem(sessionKey, JSON.stringify(connection));
}

function clearSessionConnection() {
  window.sessionStorage.removeItem(sessionKey);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function Sidebar({ data }: { data: BevoacDashboardData }) {
  return (
    <aside className="hidden min-h-svh w-72 shrink-0 border-r border-white/10 bg-ink-950/72 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-signal-400/12 text-signal-400 ring-1 ring-signal-400/30">
          <ShieldCheck size={21} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Bevoac Cloud Security Posture</p>
          <p className="mt-1 text-xs text-slate-500">{data.tenantName}</p>
        </div>
      </div>

      <div className="mt-7 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3">
        <p className="text-xs font-medium text-slate-400">{data.tenantDomain}</p>
      </div>

      <nav className="mt-7 space-y-1.5">
        {navItems.map((item) => (
          <a
            key={item.label}
            href="#"
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              item.active
                ? "bg-white text-ink-950 shadow-glow"
                : "text-slate-400 hover:bg-white/[0.055] hover:text-white"
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="mt-auto rounded-lg border border-signal-400/20 bg-signal-400/10 p-4">
        <p className="text-xs font-semibold uppercase text-signal-400">API status</p>
        <p className="mt-2 text-sm text-slate-300">
          {data.apiStatus === "live" ? "Connected to Bevoac API" : "Fallback data displayed"}
        </p>
      </div>
    </aside>
  );
}

function MobileHeader({ data }: { data: BevoacDashboardData }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/88 px-4 py-3 backdrop-blur-xl lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-signal-400/12 text-signal-400 ring-1 ring-signal-400/30">
            <ShieldCheck size={19} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Bevoac Cloud Security Posture</p>
            <p className="truncate text-xs text-slate-500">{data.tenantDomain}</p>
          </div>
        </div>
        <button className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-300">
          <LayoutDashboard size={18} />
        </button>
      </div>
    </header>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative mx-auto size-40">
      <svg viewBox="0 0 140 140" className="size-full -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="13" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="#3ce7c4"
          strokeLinecap="round"
          strokeWidth="13"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-4xl font-semibold text-white">{score}</p>
          <p className="text-xs text-slate-500">/ 100</p>
        </div>
      </div>
    </div>
  );
}

function CategoryMeter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-signal-400" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950">
      <div className="flex items-center gap-3 text-slate-300">
        <RefreshCw className="animate-spin text-signal-400" size={20} />
        Loading Bevoac posture...
      </div>
    </div>
  );
}

function ConnectionPanel({
  connection,
  connected,
  saving,
  onChange,
  onConnect,
  onDisconnect
}: {
  connection: ClientConnection;
  connected: boolean;
  saving: boolean;
  onChange: (connection: ClientConnection) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <section className="mb-5 rounded-lg border border-signal-400/20 bg-signal-400/[0.07] p-4 backdrop-blur">
      <form
        className="grid gap-4 xl:grid-cols-[1fr_220px_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onConnect();
        }}
      >
        <label className="block min-w-0">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-signal-400">
            <Link2 size={14} />
            API sync URL
          </span>
          <input
            value={connection.apiUrl}
            onChange={(event) => onChange({ ...connection, apiUrl: event.target.value })}
            className="h-11 w-full rounded-lg border border-white/10 bg-ink-950/70 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-signal-400/50"
            placeholder="https://apim-bevoac-prod.azure-api.net/v1/health"
            type="url"
            required
          />
        </label>

        <label className="block min-w-0">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-signal-400">
            <KeyRound size={14} />
            Key header
          </span>
          <input
            value={connection.apiKeyHeader}
            onChange={(event) => onChange({ ...connection, apiKeyHeader: event.target.value })}
            className="h-11 w-full rounded-lg border border-white/10 bg-ink-950/70 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-signal-400/50"
            placeholder="Ocp-Apim-Subscription-Key"
            required
          />
        </label>

        <label className="block min-w-0">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-signal-400">
            <Lock size={14} />
            BEVOAC_API_KEY
          </span>
          <div className="flex h-11 overflow-hidden rounded-lg border border-white/10 bg-ink-950/70 focus-within:border-signal-400/50">
            <input
              value={connection.apiKey}
              onChange={(event) => onChange({ ...connection, apiKey: event.target.value })}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-600"
              placeholder="Paste client subscription key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              required
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="grid w-11 place-items-center border-l border-white/10 text-slate-400 transition hover:text-white"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={saving ? "animate-spin" : ""} size={16} />
            {connected ? "Resync" : "Connect"}
          </button>
          {connected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="grid size-11 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-rose-400/40 hover:text-rose-200"
              aria-label="Disconnect and clear this session"
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </form>

      <p className="mt-3 text-xs leading-5 text-slate-400">
        The key is scoped to this browser session and sent only to the server proxy for the current sync request.
      </p>
    </section>
  );
}

export default function DashboardShell() {
  const [data, setData] = useState<BevoacDashboardData>(demoDashboardData);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ClientConnection>(defaultConnection);
  const [connected, setConnected] = useState(false);

  async function loadDashboard(nextConnection = connection, useClientConnection = connected) {
    try {
      setSyncing(true);
      setError(null);
      const response = await fetch("/api/bevoac", {
        method: useClientConnection ? "POST" : "GET",
        headers: useClientConnection ? { "Content-Type": "application/json" } : undefined,
        body: useClientConnection ? JSON.stringify(nextConnection) : undefined,
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
      const payload = (await response.json()) as BevoacDashboardData & { apiError?: string };
      setData(payload);
      setError(payload.apiError ?? null);
      if (useClientConnection) {
        writeSessionConnection(nextConnection);
        setConnected(true);
      }
    } catch (apiError) {
      setData(demoDashboardData);
      setError(apiError instanceof Error ? apiError.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    const savedConnection = readSessionConnection();
    const hasSavedKey = Boolean(savedConnection.apiKey);
    setConnection(savedConnection);
    setConnected(hasSavedKey);
    loadDashboard(savedConnection, hasSavedKey);

    const interval = window.setInterval(() => {
      const currentConnection = readSessionConnection();
      loadDashboard(currentConnection, Boolean(currentConnection.apiKey));
    }, 60_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalFindings = useMemo(
    () => Object.values(data.severityCounts).reduce((sum, value) => sum + value, 0),
    [data.severityCounts]
  );

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="flex min-h-svh bg-transparent text-slate-100">
      <Sidebar data={data} />
      <main className="min-w-0 flex-1">
        <MobileHeader data={data} />
        <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <section className="mb-5 flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.035] px-4 py-4 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
                <span className="rounded-full border border-signal-400/30 bg-signal-400/10 px-2.5 py-1 text-signal-400">
                  {data.adminIdentity}
                </span>
                <span>Live posture · refreshed {formatTime(data.refreshedAt)}</span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">Security posture</h1>
              <p className="mt-2 text-sm text-slate-400 sm:text-base">Continuous monitoring of {data.tenantDomain}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-400">{data.nextScanLabel}</span>
              <button
                onClick={() => loadDashboard(connection, connected)}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-slate-200"
              >
                <Zap size={16} />
                Launch scan
              </button>
            </div>
          </section>

          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <p>{error}. Configure BEVOAC_API_KEY if your API Management endpoint requires authentication.</p>
            </div>
          )}

          <ConnectionPanel
            connection={connection}
            connected={connected}
            saving={syncing}
            onChange={setConnection}
            onConnect={() => loadDashboard(connection, true)}
            onDisconnect={() => {
              clearSessionConnection();
              setConnected(false);
              setConnection(defaultConnection);
              setData(demoDashboardData);
              setError(null);
            }}
          />

          <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
            <div className="panel rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Global score</p>
                  <p className="mt-1 text-lg font-semibold text-white">{data.statusLabel}</p>
                </div>
                <Gauge className="text-signal-400" size={24} />
              </div>
              <ScoreGauge score={data.globalScore} />
              <div className="mt-2 flex items-center justify-center gap-2 text-sm text-signal-400">
                <GitBranch size={16} />
                +{data.scoreDelta} pts since last week
              </div>
              <div className="mt-7 space-y-5">
                {data.categories.map((category) => (
                  <CategoryMeter key={category.label} label={category.label} value={category.value} />
                ))}
              </div>
            </div>

            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(severityLabels) as Severity[]).map((severity) => (
                  <div key={severity} className="panel rounded-lg p-4">
                    <p className={`text-3xl font-semibold ${severityTone[severity]}`}>{data.severityCounts[severity]}</p>
                    <p className="mt-2 text-sm text-slate-400">{severityLabels[severity]}</p>
                  </div>
                ))}
              </div>

              <div className="panel rounded-lg p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-white">Posture trend</p>
                    <p className="mt-1 text-sm text-slate-400">Score evolution — last 30 days</p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="rounded-full bg-signal-400/10 px-3 py-1 text-signal-400">Score</span>
                    <span className="rounded-full bg-slate-500/10 px-3 py-1 text-slate-400">Findings</span>
                  </div>
                </div>
                <TrendChart data={data.trend} />
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
            <div className="panel rounded-lg p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-white">Top priority actions</p>
                  <p className="mt-1 text-sm text-slate-400">Sorted by impact and severity</p>
                </div>
                <a href="#" className="hidden text-sm font-medium text-signal-400 hover:text-signal-300 sm:inline">
                  View all findings →
                </a>
              </div>
              <div className="divide-y divide-white/10">
                {data.priorityActions.map((finding) => (
                  <article key={finding.id} className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[44px_1fr_auto] md:items-center">
                    <span className="text-sm font-semibold text-slate-500">{finding.id}</span>
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={finding.severity} />
                        <span className="text-sm font-semibold text-slate-300">{finding.resource}</span>
                      </div>
                      <h2 className="text-base font-semibold text-white">{finding.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{finding.recommendation}</p>
                    </div>
                    <button className="w-fit rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-signal-400/50 hover:text-signal-400">
                      Remediate
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-5">
              <div className="panel rounded-lg p-5">
                <div className="mb-5">
                  <p className="text-lg font-semibold text-white">Findings by resource type</p>
                  <p className="mt-1 text-sm text-slate-400">Distribution across the tenant</p>
                </div>
                <DonutChart data={data.resourceTypes} />
              </div>

              <div className="panel rounded-lg p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">Recent alerts</p>
                    <p className="mt-1 text-sm text-slate-400">{totalFindings} active findings</p>
                  </div>
                  <a href="#" className="text-sm font-medium text-signal-400 hover:text-signal-300">
                    Open feed →
                  </a>
                </div>
                <div className="space-y-3">
                  {data.recentAlerts.map((alert) => (
                    <article key={alert.id} className="rounded-lg border border-white/10 bg-ink-950/40 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Siren className={alert.severity === "critical" ? "text-rose-300" : "text-amber-300"} size={16} />
                        <SeverityBadge severity={alert.severity} />
                      </div>
                      <p className="text-sm font-semibold text-white">{alert.title}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{alert.resource}</span>
                        <span>{formatDateTime(alert.date)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
