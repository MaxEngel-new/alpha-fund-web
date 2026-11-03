"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurvePoint } from "@/lib/data";

type SeriesKey = string;

/**
 * Fixed per series (never by rank), in categorical order, validated on the chart surface (#0e1628, dark):
 * every adjacent pair passes the colour-vision-deficiency and normal-vision separation floors. Each series
 * also has its own line pattern, so lines stay distinguishable without colour.
 */
const PALETTE: Record<string, { color: string; dash?: string; pattern: string }> = {
  no_overlay: { color: "#3987e5", pattern: "solid" },
  permanent_stop: { color: "#d95926", dash: "10 5", pattern: "long dash" },
  adaptive_drawdown: { color: "#199e70", dash: "3 3", pattern: "short dash" },
  volatility_target: { color: "#c98500", dash: "10 3 2 3", pattern: "dash-dot" },
  combined: { color: "#d55181", dash: "10 3 2 3 2 3", pattern: "dash-dot-dot" },
  spy: { color: "#008300", dash: "1 4", pattern: "dotted" },
};

interface Props {
  curves: Record<string, CurvePoint[]>;
  strategies: { id: string; label: string }[];
  configurations: { id: string; label: string }[];
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export function EquityExplorer({ curves, strategies, configurations }: Props) {
  const [strategy, setStrategy] = useState(strategies[0].id);
  const [shown, setShown] = useState<Set<SeriesKey>>(new Set(["no_overlay", "combined", "spy"]));
  const [log, setLog] = useState(true);

  const rows = useMemo(() => {
    const spy = curves["spy"];
    return spy.map((point, i) => {
      const row: Record<string, number | string> = { month: point.month, spy: point.equity, spy_dd: point.drawdown };
      for (const c of configurations) {
        const series = curves[`${strategy}|${c.id}`];
        if (series && series[i]) {
          row[c.id] = series[i].equity;
          row[`${c.id}_dd`] = series[i].drawdown;
        }
      }
      return row;
    });
  }, [curves, strategy, configurations]);

  const series = [...configurations, { id: "spy", label: "SPY buy & hold" }];
  const visible = series.filter((s) => shown.has(s.id));
  const last = rows[rows.length - 1];
  const strategyLabel = strategies.find((s) => s.id === strategy)?.label ?? strategy;
  const summary = `${strategyLabel}, growth of 1 from ${rows[0].month} to ${last.month}: ` +
    visible.map((s) => `${s.label} ${Number(last[s.id]).toFixed(2)}`).join("; ");

  const toggle = (id: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border border-line bg-ink-850/80 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Strategy" className="inline-flex rounded-lg border border-line bg-ink-900 p-1">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={strategy === s.id}
              onClick={() => setStrategy(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${strategy === s.id ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} className="accent-teal" />
          Log scale
        </label>
      </div>
      <fieldset className="mt-4 flex flex-wrap gap-2">
        <legend className="sr-only">Series shown</legend>
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={shown.has(s.id)}
            onClick={() => toggle(s.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
              shown.has(s.id) ? "border-line bg-ink-800 text-fg" : "border-line/50 text-fg-subtle"
            }`}
          >
            <svg width="32" height="6" aria-hidden>
              <line x1="1" y1="3" x2="31" y2="3" stroke={PALETTE[s.id].color} strokeWidth="2" strokeLinecap="round" strokeDasharray={PALETTE[s.id].dash} />
            </svg>
            {s.label}
            <span className="sr-only">({PALETTE[s.id].pattern} line)</span>
            {shown.has(s.id) && last[s.id] !== undefined ? <span className="font-mono text-fg-muted tabular">{Number(last[s.id]).toFixed(2)}</span> : null}
          </button>
        ))}
      </fieldset>

      <figure className="mt-5">
        <figcaption className="mb-2 text-sm text-fg-muted">Growth of 1 (month-end, net of costs)</figcaption>
        <div className="h-72 sm:h-96" role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#223049" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#7d8aa1", fontSize: 11 }} minTickGap={48} stroke="#223049" />
              <YAxis
                scale={log ? "log" : "linear"}
                domain={log ? ["auto", "auto"] : [0, "auto"]}
                tick={{ fill: "#7d8aa1", fontSize: 11 }}
                stroke="#223049"
                width={44}
                tickFormatter={(v: number) => v.toFixed(1)}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: "#0a1120", border: "1px solid #223049", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e7ecf4" }}
                formatter={(value, name) => [Number(value).toFixed(2), series.find((s) => s.id === name)?.label ?? name]}
              />
              {visible.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  type="monotone"
                  dot={false}
                  stroke={PALETTE[s.id].color}
                  strokeDasharray={PALETTE[s.id].dash}
                  strokeLinecap="round"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <figure className="mt-6">
        <figcaption className="mb-2 text-sm text-fg-muted">Drawdown (worst daily drawdown in each month)</figcaption>
        <div className="h-44 sm:h-52" role="img" aria-label={`Drawdown from the running peak, ${strategyLabel}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#223049" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#7d8aa1", fontSize: 11 }} minTickGap={48} stroke="#223049" />
              <YAxis tick={{ fill: "#7d8aa1", fontSize: 11 }} tickFormatter={pct} stroke="#223049" width={44} domain={["auto", 0]} />
              <Tooltip
                contentStyle={{ background: "#0a1120", border: "1px solid #223049", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e7ecf4" }}
                formatter={(value, name) => [pct(Number(value)), series.find((s) => `${s.id}_dd` === name)?.label ?? name]}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              {visible.map((s) => (
                <Area
                  key={s.id}
                  dataKey={`${s.id}_dd`}
                  type="monotone"
                  stroke={PALETTE[s.id].color}
                  strokeDasharray={PALETTE[s.id].dash}
                  fill={PALETTE[s.id].color}
                  fillOpacity={s.id === "no_overlay" ? 0.12 : 0.04}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <details className="mt-5 text-sm text-fg-muted">
        <summary className="cursor-pointer text-fg">View chart data as a table (year-end values)</summary>
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Year-end growth of 1 for {strategyLabel}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 bg-ink-800 px-3 py-2">Month</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="sticky top-0 bg-ink-800 px-3 py-2 text-right">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.filter((row) => String(row.month).endsWith("-12")).map((row) => (
                <tr key={String(row.month)} className="border-t border-line/60">
                  <th scope="row" className="px-3 py-1.5 font-normal">{row.month}</th>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1.5 text-right font-mono tabular">{Number(row[s.id]).toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
