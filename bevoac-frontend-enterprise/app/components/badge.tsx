import type { Severity } from "@/app/lib/types";

const severityClass: Record<Severity, string> = {
  critical: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  high: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  medium: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  low: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${severityClass[severity]}`}>
      {severity}
    </span>
  );
}
