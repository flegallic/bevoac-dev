"use client";

import type { ResourceDistribution, TrendPoint } from "@/app/lib/types";

function toPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const width = 640;
  const height = 230;
  const padding = 26;
  const maxFindings = Math.max(...data.map((point) => point.findings), 1);

  const scorePoints = data.map((point, index) => ({
    x: padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y: padding + ((100 - point.score) / 100) * (height - padding * 2)
  }));

  const findingPoints = data.map((point, index) => ({
    x: padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y: padding + (point.findings / maxFindings) * (height - padding * 2)
  }));

  return (
    <div className="relative h-[260px] w-full overflow-hidden rounded-lg border border-white/10 bg-ink-950/40">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Score evolution over the last 30 days">
        <defs>
          <linearGradient id="scoreFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3ce7c4" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#3ce7c4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1={padding}
            x2={width - padding}
            y1={padding + line * 48}
            y2={padding + line * 48}
            stroke="rgba(255,255,255,.08)"
          />
        ))}
        <path
          d={`${toPath(scorePoints)} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`}
          fill="url(#scoreFill)"
        />
        <path d={toPath(findingPoints)} fill="none" stroke="#64748b" strokeWidth="2" strokeDasharray="5 7" />
        <path d={toPath(scorePoints)} fill="none" stroke="#3ce7c4" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {scorePoints.map((point, index) => (
          <circle key={data[index].label} cx={point.x} cy={point.y} r="4" fill="#0b111c" stroke="#3ce7c4" strokeWidth="3" />
        ))}
      </svg>
      <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between text-[11px] text-slate-500">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function DonutChart({ data }: { data: ResourceDistribution[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  let cumulative = 0;

  const segments = data.map((item) => {
    const value = (item.value / total) * 100;
    const segment = `${item.color} ${cumulative}% ${cumulative + value}%`;
    cumulative += value;
    return segment;
  });

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[170px_1fr]">
      <div
        className="mx-auto grid size-40 place-items-center rounded-full"
        style={{ background: `conic-gradient(${segments.join(", ")})` }}
        aria-label="Findings distribution by resource type"
      >
        <div className="grid size-24 place-items-center rounded-full bg-ink-900 text-center ring-1 ring-white/10">
          <div>
            <p className="text-3xl font-semibold">{total}</p>
            <p className="text-[11px] uppercase text-slate-500">findings</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-slate-300">{item.label}</span>
            </div>
            <span className="font-semibold text-white">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
