"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, TriangleAlert } from "lucide-react";
import {
  EXECUTED_LABEL,
  HOLDINGS_LABEL,
  VIEW_LABELS,
  filterRows,
  pctExact,
  sortRows,
  summarize,
  targetDifference,
  toCsv,
  weightOf,
  type HoldingsExport,
  type SortDir,
  type SortKey,
  type WeightView,
} from "@/lib/holdings";

interface SessionProp {
  session: string;
  preview: boolean;
  file: string;
  export: HoldingsExport;
}

function fmtUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function HoldingsExplorer({ sessions }: { sessions: SessionProp[] }) {
  const [sessionId, setSessionId] = useState(sessions[0].session);
  const current = sessions.find((s) => s.session === sessionId) ?? sessions[0];
  const exp = current.export;
  const [portfolioId, setPortfolioId] = useState(exp.data.portfolios[0].id);
  const portfolio = exp.data.portfolios.find((p) => p.id === portfolioId) ?? exp.data.portfolios[0];
  const [view, setView] = useState<WeightView>("target");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "ticker", dir: "asc" });

  const summary = summarize(portfolio, view);
  const rows = useMemo(
    () => sortRows(filterRows(portfolio.holdings, query), sort.key, sort.dir, view),
    [portfolio, query, sort, view],
  );
  const executedAvailable = portfolio.executed.status === "recorded";
  const namesMapped = portfolio.holdings.some((r) => r.company !== null);
  const nameSources = exp.meta.company_name_sources ?? [];
  const unmapped = exp.meta.company_names_unmapped ?? [];
  const reviewed = Object.entries(exp.meta.company_names_reviewed ?? {});

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "weight" ? "desc" : "asc" }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5" aria-hidden /> : sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />;

  const download = () => {
    const blob = new Blob([toCsv(exp, portfolio)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alpha-fund-${portfolio.id}-${exp.data.decision_session}-prospective-holdings.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {current.preview ? (
        <div role="alert" className="flex gap-3 rounded-xl border border-rose/50 bg-rose/10 p-4 text-sm text-fg">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose" aria-hidden />
          <p>
            <strong>Unapproved preview</strong> of candidate <span className="font-mono">{current.file}</span>. This holdings export has
            not been approved for publication. It is visible only in a local review build and is never part of the public site.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-teal/30 bg-teal/[0.05] p-4 text-sm text-fg">
        <p className="font-medium">{HOLDINGS_LABEL}</p>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 text-sm">
        {sessions.length > 1 ? (
          <label className="flex flex-col gap-1 text-fg-subtle">
            Decision session
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="rounded-md border border-line bg-ink-900 px-3 py-1.5 text-fg"
            >
              {sessions.map((s) => (
                <option key={s.session} value={s.session}>
                  {s.session}
                  {s.preview ? " (unapproved preview)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:grid-cols-[auto_auto_auto_auto] sm:gap-x-6">
          <dt className="text-fg-subtle">Decision date</dt>
          <dd className="font-mono text-fg">{exp.data.decision_session}</dd>
          <dt className="text-fg-subtle">Intended execution</dt>
          <dd className="font-mono text-fg">{exp.data.intended_execution_date} close</dd>
          <dt className="text-fg-subtle">Recorded</dt>
          <dd className="font-mono text-fg-muted">{fmtUtc(exp.data.recorded_at)}</dd>
          <dt className="text-fg-subtle">Data cutoff</dt>
          <dd className="font-mono text-fg-muted">{fmtUtc(exp.data.data_cutoff)}</dd>
        </dl>
      </div>

      <div role="radiogroup" aria-label="Portfolio" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {exp.data.portfolios.map((p) => {
          const s = summarize(p, view);
          const selected = p.id === portfolio.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setPortfolioId(p.id);
                setQuery("");
              }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected ? "border-teal/60 bg-ink-800" : "border-line bg-ink-850/80 hover:bg-ink-800/70"
              }`}
            >
              <span className="block font-serif text-base text-fg">{p.label}</span>
              <span className="mt-1 block text-xs text-fg-muted">
                {s.positions} holdings · {pctExact(s.stocks, 0)} stocks · {pctExact(s.cash, 0)} cash
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <div role="radiogroup" aria-label="Weights shown" className="inline-flex flex-wrap rounded-lg border border-line bg-ink-900 p-1">
          {(["target", "risk_adjusted"] as WeightView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg"}`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={false}
            aria-disabled={!executedAvailable}
            disabled={!executedAvailable}
            title={executedAvailable ? EXECUTED_LABEL : "Not available: no verified simulated fills yet"}
            className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-fg-subtle"
          >
            {EXECUTED_LABEL}
          </button>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-muted">{targetDifference(portfolio)}</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">
          <span className="text-fg">{EXECUTED_LABEL}:</span>{" "}
          {executedAvailable ? portfolio.executed.note : `not available. ${portfolio.executed.note}`} When fills exist, they can
          differ from the targets because of the no-trade band, the minimum trade size, the cash-only account limits and price moves
          between the decision and the execution close.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Stock allocation", pctExact(summary.stocks, 2)],
          ["Cash allocation", pctExact(summary.cash, 2)],
          ["Holdings", String(summary.positions)],
          [summary.equalWeighted ? "Weight per holding" : "Weight range", summary.equalWeighted ? pctExact(summary.maxWeight, 4) : `${pctExact(summary.minWeight, 2)} – ${pctExact(summary.maxWeight, 2)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-ink-850/80 p-4">
            <dt className="text-xs uppercase tracking-wider text-fg-subtle">{k}</dt>
            <dd className="mt-1.5 font-mono text-xl text-fg tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <figure>
        <figcaption className="mb-2 text-sm text-fg-muted">
          {VIEW_LABELS[view]}: stocks {pctExact(summary.stocks, 2)}, cash {pctExact(summary.cash, 2)}
        </figcaption>
        <div
          role="img"
          aria-label={`Allocation meter: ${pctExact(summary.stocks, 2)} in ${summary.positions} stocks, ${pctExact(summary.cash, 2)} cash`}
          className="flex h-3 w-full overflow-hidden rounded-full bg-ink-700"
        >
          <div className="h-full rounded-full bg-teal" style={{ width: `${Math.min(100, summary.stocks * 100)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" aria-hidden /> Stocks</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink-600" aria-hidden /> Cash</span>
        </div>
      </figure>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search by ticker or company</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company"
            className="w-full rounded-lg border border-line bg-ink-900 py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle"
          />
        </label>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-fg hover:bg-ink-800"
        >
          <Download className="h-4 w-4" aria-hidden /> Download CSV
        </button>
      </div>
      <p className="text-xs text-fg-subtle" aria-live="polite">
        Showing {rows.length} of {portfolio.holdings.length} holdings · {VIEW_LABELS[view]}
      </p>

      <div className="max-h-[32rem] overflow-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            {portfolio.label} holdings on {exp.data.decision_session}, {VIEW_LABELS[view].toLowerCase()}
          </caption>
          <thead className="sticky top-0 z-10 bg-ink-800">
            <tr>
              {([
                ["ticker", "Ticker", "text-left"],
                ["company", "Company", "text-left"],
                ["weight", VIEW_LABELS[view], "text-right"],
              ] as [SortKey, string, string][]).map(([key, title, align]) => (
                <th key={key} scope="col" aria-sort={ariaSort(key)} className={`border-b border-line px-3 py-2 ${align}`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-fg-subtle hover:text-fg"
                  >
                    {title} <SortIcon k={key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const w = weightOf(r, view);
              return (
                <tr key={r.ticker} className="border-b border-line/60">
                  <th scope="row" className="px-3 py-2 font-mono font-normal text-fg">{r.ticker}</th>
                  <td className="px-3 py-2 text-fg-muted">{r.company ?? <span className="text-fg-subtle">{namesMapped ? "Pending review" : "Not mapped"}</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-3">
                      <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-ink-700 sm:block" aria-hidden>
                        <span className="block h-full rounded-full bg-teal" style={{ width: `${summary.maxWeight > 0 ? (w / summary.maxWeight) * 100 : 0}%` }} />
                      </span>
                      <span className="font-mono text-fg tabular" title={String(w)}>{pctExact(w, 4)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-fg-muted">No holding matches “{query}”.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {namesMapped ? (
        <p className="text-xs leading-relaxed text-fg-subtle">
          Company names are the issuers listed under each ticker on the date the names were retrieved, taken from{" "}
          {nameSources.map((s, i) => (
            <span key={s.url}>
              {i ? (i === nameSources.length - 1 ? " and " : ", ") : ""}
              {s.name}
              {s.revision ? ` (revision ${s.revision})` : ""}
            </span>
          ))}
          , and published only where the sources agree
          {reviewed.length ? (
            <>
              ; <span className="font-mono">{reviewed.map(([t]) => t).join(", ")}</span>, where they did not, were verified against the
              issuers&apos; own SEC filings
            </>
          ) : null}
          . They are not historical issuer identities: a ticker may have belonged to a predecessor or a differently named company in
          earlier years. Tickers are exactly as recorded.
          {unmapped.length ? (
            <>
              {" "}Shown as tickers pending review: <span className="font-mono">{unmapped.join(", ")}</span>.
            </>
          ) : null}
        </p>
      ) : null}
      {namesMapped && reviewed.length ? (
        <details className="text-xs leading-relaxed text-fg-subtle">
          <summary className="cursor-pointer text-fg-muted">Names verified from issuer filings: sources and naming notes</summary>
          <ul className="mt-2 space-y-2">
            {reviewed.map(([ticker, r]) => (
              <li key={ticker}>
                <span className="font-mono text-fg">{ticker}</span> {r.company}
                {r.reviewed_on ? <> (reviewed {r.reviewed_on})</> : null}. {r.ambiguity}{" "}
                {(r.sources ?? []).map((s, i) => (
                  <span key={s.url}>
                    {i ? "; " : "Source: "}
                    <a href={s.url} className="text-teal underline-offset-2 hover:underline" rel="noopener noreferrer">{s.name}</a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!namesMapped ? (
        <p className="text-xs text-fg-subtle">
          Company names are not shown: the research universe stores tickers only, and names are published only from an owner-reviewed
          mapping rather than guessed. The CSV gives weights at full recorded precision.
        </p>
      ) : null}
    </div>
  );
}
