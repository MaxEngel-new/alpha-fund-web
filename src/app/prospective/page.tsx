import type { Metadata } from "next";
import { CalendarClock, FileCheck2, Hourglass, Lock, TriangleAlert } from "lucide-react";
import { HoldingsExplorer } from "@/components/holdings-explorer";
import { Badge, Callout, Card, Container, PageHeader, Provenance, Section } from "@/components/ui";
import { HOLDINGS_LABEL } from "@/lib/holdings";
import { loadHoldingsSessions } from "@/lib/holdings-data";
import { loadProspective } from "@/lib/prospective-data";

export const metadata: Metadata = {
  title: "Prospective Monitor",
  description: "Four frozen, pre-registered portfolios tracked forward from their first recorded decision, with their published prospective holdings decisions.",
};

const SAFEGUARDS = [
  "A decision is labelled prospective only if its data cutoff precedes the recording time, which precedes the earliest possible execution, judged on the exchange calendar.",
  "All four portfolios are recorded in one atomic write, or not at all; duplicates and late records are refused.",
  "The ledger is append-only and hash-chained; any edit, deletion or reordering is detected.",
  "Recording requires committed code (a documented exception, if ever used, is written into the record); the market data behind each decision is preserved in a hashed snapshot.",
  "Missing data blocks recording rather than being filled in; no holding is ever erased because of missing data.",
  "Portfolio definitions are frozen: any change must create a new version, and earlier records stay attributed to the old one.",
];

function describeStrategy(strategy: string, params: Record<string, unknown>): string {
  if (strategy === "equal_weight") return "Equal weight across every eligible stock";
  if (strategy === "cross_sectional_rank") {
    const top = Number(params.top_fraction ?? 0) * 100;
    return `Top ${top.toFixed(0)}% by 12-1 momentum, equally weighted`;
  }
  return strategy;
}

export default function ProspectivePage() {
  const { dataset, preview } = loadProspective();
  const p = dataset.data;
  const sessions = loadHoldingsSessions();
  const recorded = p.status === "decisions_recorded" ? p.record : undefined;
  const decided = sessions.length > 0 || recorded !== undefined;
  const firstDecision = recorded ? recorded.decision_sessions[0] : decided ? sessions[sessions.length - 1].session : null;
  const awaiting = !decided && p.status === "awaiting_first_observation" && p.prospective_records === 0;
  const label = (id: string) => p.books.find((b) => b.id === id)?.label ?? id;
  const execution = p.execution as { schedule?: string; no_trade_band?: number; min_trade_value?: number };

  return (
    <Container>
      <PageHeader eyebrow="Prospective Monitor" title={decided ? "Four portfolios, recorded before the outcome is known" : "Four portfolios, to be recorded before the outcome is known"}>
        Historical backtests can be fitted to the past, however carefully. Prospective records cannot: each month-end decision is
        written down before it could be executed, and evaluated only on what happens next.
      </PageHeader>

      {preview ? (
        <div role="alert" className="mt-8 flex gap-3 rounded-xl border border-rose/50 bg-rose/10 p-4 text-sm text-fg">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose" aria-hidden />
          <p>
            <strong>Unapproved preview.</strong> This page shows a re-exported Prospective Monitor dataset that has not been approved for
            publication. It is visible only in a local review build and is never part of the public site.
          </p>
        </div>
      ) : null}

      <section className="mt-8" aria-live="polite">
        {recorded ? (
          <div className="rounded-2xl border border-teal/30 bg-teal/[0.05] p-6 sm:p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <FileCheck2 className="h-8 w-8 shrink-0 text-teal" aria-hidden />
              <div>
                <p className="font-serif text-2xl text-fg">First prospective decisions recorded on {firstDecision}.</p>
                <p className="mt-1 text-sm text-fg-muted">Awaiting the first performance observation. Practice (backfill) runs are never shown here.</p>
              </div>
            </div>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Decisions recorded", String(recorded.decisions), "one per frozen portfolio; target allocations, not trades"],
                ["Ledger events", String(recorded.ledger_events), `${recorded.decisions} decisions + ${recorded.observations} starting-state observations`],
                ["Simulated fills", String(recorded.simulated_fills), "paper-portfolio executions recorded so far"],
                ["Investment performance", "Not yet available", "starts after fills are observed in a later recording"],
              ].map(([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-line bg-ink-900/70 px-4 py-3">
                  <dt className="text-xs uppercase tracking-wider text-fg-subtle">{label}</dt>
                  <dd className="mt-1 font-serif text-2xl text-fg">{value}</dd>
                  <dd className="mt-0.5 text-xs text-fg-muted">{hint}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">{recorded.explanation}</p>
          </div>
        ) : decided ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-teal/30 bg-teal/[0.05] p-6 sm:flex-row sm:items-center sm:p-8">
            <FileCheck2 className="h-8 w-8 shrink-0 text-teal" aria-hidden />
            <div>
              <p className="font-serif text-2xl text-fg">First prospective decisions recorded on {firstDecision}.</p>
              <p className="mt-1 text-sm text-fg-muted">
                Awaiting the first performance observation: there is no performance to show until the decisions have been executed in the
                paper portfolios and observed in a later recording. Practice (backfill) runs are never shown here.
              </p>
            </div>
          </div>
        ) : awaiting ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-teal/30 bg-teal/[0.05] p-6 sm:flex-row sm:items-center sm:p-8">
            <Hourglass className="h-8 w-8 shrink-0 text-teal" aria-hidden />
            <div>
              <p className="font-serif text-2xl text-fg">Awaiting first prospective observation.</p>
              <p className="mt-1 text-sm text-fg-muted">
                No prospective record exists yet, so there is no performance to show. Practice (backfill) runs are never shown here.
              </p>
            </div>
          </div>
        ) : (
          <Callout title="Prospective records exist" tone="amber">
            Records exist but have not been approved for publication on this site.
          </Callout>
        )}
      </section>

      <Section id="portfolios" title="The four frozen portfolios" kicker="Pre-registered">
        <div className="grid gap-4 sm:grid-cols-2">
          {p.books.map((b) => (
            <Card key={b.id}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-serif text-lg text-fg">{b.label}</h3>
                <Badge tone={b.overlay === "none" ? "neutral" : "prospective"}>{b.overlay === "none" ? "No overlay" : "Combined overlay"}</Badge>
              </div>
              <p className="mt-2 text-sm text-fg-muted">{describeStrategy(b.strategy, b.params)}.</p>
              <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-fg-subtle">Version</dt>
                <dd className="text-fg-muted">{b.version}</dd>
                <dt className="text-fg-subtle">Definition hash</dt>
                <dd className="font-mono text-xs text-fg-muted">{b.book_hash}…</dd>
                <dt className="text-fg-subtle">Performance</dt>
                <dd className="text-fg-muted">{recorded ? "Not yet available (no simulated fills)" : awaiting || decided ? "No observations yet" : "Not published"}</dd>
              </dl>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          All four rebalance {execution.schedule ?? "monthly"} with a {((execution.no_trade_band ?? 0) * 100).toFixed(2)}% no-trade
          band and a ${(execution.min_trade_value ?? 0).toLocaleString("en-US")} minimum trade, in a cash-only paper account. The
          combined overlay applies the adaptive drawdown policy and a 12% volatility target, whichever is more restrictive. These
          are hypothetical portfolios; no orders are placed anywhere.
        </p>
      </Section>

      {decided ? (
        <Section id="holdings" title="Portfolio holdings decisions" kicker="Prospective · hypothetical">
          <HoldingsExplorer sessions={sessions} />
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-amber/30 bg-amber/[0.05] p-5 text-sm leading-relaxed text-fg-muted">
              <p className="font-medium text-fg">{HOLDINGS_LABEL}</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>These are research decisions recorded in a hash-chained ledger, not brokerage holdings. No account holds these positions and no orders exist.</li>
                <li>Target weights describe what each paper portfolio aims to hold; they do not guarantee execution at those weights.</li>
                <li>No investment performance is implied by the selections. Performance will be reported only from later recorded observations.</li>
                <li>The research universe is a hand-compiled list of current large U.S. companies: it is survivorship-biased, and its free data source has known gaps and revisions.</li>
                <li>
                  Excluded from the current universe:{" "}
                  {Object.entries(sessions[0].export.data.universe_exclusions).map(([s, why], i) => (
                    <span key={s}>{i ? "; " : ""}<span className="font-mono text-fg">{s}</span> ({why})</span>
                  ))}
                  .
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-ink-950/60 p-5 text-sm text-fg-muted">
              <p className="font-medium text-fg">Provenance of {sessions[0].session}</p>
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_1fr]">
                <dt className="text-fg-subtle">Classification</dt>
                <dd>{sessions[0].export.meta.classification}</dd>
                <dt className="text-fg-subtle">Source</dt>
                <dd className="font-mono text-xs">{sessions[0].export.meta.source_report.join("; ")}</dd>
                <dt className="text-fg-subtle">Ledger commit</dt>
                <dd className="font-mono text-xs">{sessions[0].export.meta.backend_commit} (published at the remote head {sessions[0].export.meta.anchored_at_remote_head})</dd>
                <dt className="text-fg-subtle">Ledger head hash</dt>
                <dd className="break-all font-mono text-xs">{sessions[0].export.meta.ledger_head_hash}</dd>
                <dt className="text-fg-subtle">Configuration hash</dt>
                <dd className="break-all font-mono text-xs">{sessions[0].export.meta.config_sha256}</dd>
                <dt className="text-fg-subtle">Decision code commit</dt>
                <dd className="font-mono text-xs">{sessions[0].export.meta.decision_code_commit}</dd>
                <dt className="text-fg-subtle">Exported</dt>
                <dd className="font-mono text-xs">{sessions[0].export.meta.generated_at}</dd>
              </dl>
            </div>
          </div>
        </Section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="question" title={`Research question ${p.question.id}`} kicker={`Registered ${p.question.registered}`}>
          <Card>
            <blockquote className="font-serif text-lg leading-relaxed text-fg">“{p.question.text}”</blockquote>
            <ul className="mt-4 space-y-1.5 text-sm text-fg-muted">
              {p.question.pairs.map((pair) => (
                <li key={pair.overlay}>
                  <span className="text-fg">{label(pair.overlay)}</span> compared with <span className="text-fg">{label(pair.unrestricted)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-fg-muted">
              Minimum observation period: <span className="text-fg">{p.question.minimum_months} months</span>. This is an{" "}
              {p.question.status} comparison of one market path; it is not expected to be statistically conclusive.
            </p>
          </Card>
        </Section>
        <Section id="windows" title={recorded ? "Next recording windows" : "Upcoming recording windows"} kicker="Exchange calendar">
          <ul className="space-y-3">
            {p.windows.map((w) => (
              <li key={w.decision_session} className="flex gap-3 rounded-lg border border-line bg-ink-850/80 px-4 py-3">
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue" aria-hidden />
                <div className="text-sm">
                  <p className="text-fg">Decision session {w.decision_session}</p>
                  <p className="text-fg-muted">
                    Opens {w.opens} · closes {w.closes}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-fg-subtle">A window opens 60 minutes after the session close and closes at the next session&apos;s close.</p>
        </Section>
      </div>

      <Section id="integrity" title="Integrity safeguards" kicker="Why the records can be trusted">
        <ul className="grid gap-3 sm:grid-cols-2">
          {SAFEGUARDS.map((s) => (
            <li key={s} className="flex gap-3 rounded-lg border border-line bg-ink-850/80 px-4 py-3 text-sm leading-relaxed text-fg-muted">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-fg-subtle">
          {p.backfill_note} A local file cannot prove when it was written, so the ledger is committed and pushed after each recording.{" "}
          {p.anchoring ?? "Records will be anchored in time by publishing the ledger's hash in its version history after each recording."}
          {dataset.meta.ledger_head_hash ? (
            <>
              {" "}Ledger head hash: <span className="break-all font-mono text-xs">{String(dataset.meta.ledger_head_hash)}</span>.
            </>
          ) : null}
        </p>
      </Section>

      <Provenance meta={dataset.meta} />
    </Container>
  );
}
