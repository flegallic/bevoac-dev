import { demoDashboardData } from "@/app/lib/demo-data";

function severityValue(key: "critical" | "high" | "medium" | "low") {
  return demoDashboardData.severityCounts[key];
}

export default function DashboardShell() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      <section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">
          Demonstration only — synthetic data
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-white">
          Bevoac Cloud Security Posture
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          This interface is a non-contractual product demonstration. It is not
          connected to a customer tenant, does not accept API keys, does not
          launch scans, and must not be used as a production client portal.
        </p>
      </section>

      <section className="mt-8 grid gap-5 md:grid-cols-3">
        <article className="panel rounded-2xl p-6 md:col-span-1">
          <p className="text-sm text-slate-400">Synthetic posture score</p>
          <p className="mt-4 text-6xl font-semibold text-white">
            {demoDashboardData.globalScore}
          </p>
          <p className="mt-2 text-sm text-slate-400">out of 100</p>
        </article>

        <article className="panel rounded-2xl p-6 md:col-span-2">
          <p className="text-sm font-semibold text-white">Example findings</p>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-3xl font-semibold text-rose-300">{severityValue("critical")}</p><p className="text-xs text-slate-400">Critical</p></div>
            <div><p className="text-3xl font-semibold text-amber-300">{severityValue("high")}</p><p className="text-xs text-slate-400">High</p></div>
            <div><p className="text-3xl font-semibold text-sky-300">{severityValue("medium")}</p><p className="text-xs text-slate-400">Medium</p></div>
            <div><p className="text-3xl font-semibold text-emerald-300">{severityValue("low")}</p><p className="text-xs text-slate-400">Low</p></div>
          </div>
        </article>
      </section>

      <section className="panel mt-5 rounded-2xl p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Illustrative remediation priorities</p>
            <p className="mt-1 text-xs text-slate-500">No live customer resource is displayed.</p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            API release scope: separate
          </span>
        </div>
        <div className="mt-5 space-y-4">
          {demoDashboardData.priorityActions.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-white/10 px-2 py-1 text-xs uppercase text-slate-300">
                  {item.severity}
                </span>
                <span className="text-xs text-slate-500">Synthetic resource: {item.resource}</span>
              </div>
              <h2 className="mt-3 text-base font-medium text-white">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.recommendation}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
