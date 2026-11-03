import type { Metadata } from "next";
import Link from "next/link";
import { Card, Container, PageHeader, Provenance, Section } from "@/components/ui";
import { methodology, platform } from "@/lib/data";

export const metadata: Metadata = {
  title: "Methodology",
  description: "Data sources, quality controls, accounting, transaction costs, survivorship bias, validation, statistics, risk management and prospective data integrity.",
};

const TOC = [
  ["data", "Data and quality controls"],
  ["accounting", "Portfolio accounting"],
  ["costs", "Transaction costs"],
  ["survivorship", "Survivorship bias"],
  ["backtests", "Backtests"],
  ["walk-forward", "Walk-forward validation"],
  ["statistics", "Statistical limitations"],
  ["risk", "Risk management"],
  ["prospective", "Prospective data integrity"],
] as const;

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl space-y-3 text-[15px] leading-relaxed text-fg-muted">{children}</div>;
}

export default function MethodologyPage() {
  const m = methodology.data;
  const c = m.financial.costs;
  const account = m.financial.account as Record<string, number | string | boolean>;
  const stop = m.financial.risk_rules.find((r) => r.name === "max_drawdown_stop");
  const e = m.eligibility;
  const universe = platform.data.universe;

  return (
    <Container>
      <PageHeader eyebrow="Methodology" title="Assumptions, controls and their limits">
        Every number on this site depends on the choices below. They are stated so that the results can be judged, and
        doubted, on their merits.
      </PageHeader>

      <div className="grid gap-10 pt-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="space-y-1.5 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <Link href={`#${id}`} className="text-fg-muted hover:text-fg">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <Section id="data" title="Data sources and quality controls">
            <Prose>
              <p>
                Daily prices, dividends and splits come from Yahoo Finance: free, unofficial and sometimes revised after the fact.
                Downloads are batched, retried with bounded exponential backoff and recorded in a manifest with their download time.
              </p>
              <p>
                The research dataset behind the published backtests (2008 to September 2026) was downloaded in Sprint 12, checked by the
                per-symbol quality check below, and is frozen: its files are fingerprinted and re-checked by a reproducibility audit.
              </p>
              <p>
                The separate live dataset used for prospective research is refreshed through a staged, validated pipeline. Rows with
                inconsistent prices, missing values or conflicting duplicates are quarantined, never corrected. Changes to previously
                stored bars are classified (dividend re-adjustments, late open/high/low and volume finalization, genuine price
                revisions), logged, and the previous file is archived.
              </p>
              <p>
                A per-symbol quality check excludes series with structural problems; currently{" "}
                {Object.entries(universe.excluded).map(([s, why], i) => (
                  <span key={s}>
                    {i ? " and " : ""}
                    <span className="font-mono text-fg">{s}</span> ({why})
                  </span>
                ))}
                .
              </p>
            </Prose>
          </Section>

          <Section id="accounting" title="Portfolio accounting">
            <Prose>
              <p>
                Simulations start with ${m.financial.initial_capital.toLocaleString("en-US")} in a <strong className="text-fg">cash-only</strong>{" "}
                account: no borrowing, no short selling, gross exposure at most 100%, and cash can never go negative. Dividends are
                credited as cash on the ex-date; prices are split-adjusted.
              </p>
              <p>
                A margin-research mode exists only for explicitly labelled studies, with illustrative (not broker-quoted) costs:{" "}
                {(Number(account.financing_rate) * 100).toFixed(0)}% a year financing and{" "}
                {(Number(account.short_borrow_fee) * 100).toFixed(0)}% a year borrow fees. Accounting invariants are checked after
                every simulated bar, and any violation stops the run.
              </p>
              <p>Fills happen at the close of the session after the decision, never on the bar that produced the signal.</p>
            </Prose>
          </Section>

          <Section id="costs" title="Transaction costs">
            <Card className="max-w-3xl">
              <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt className="text-fg-muted">Commission</dt>
                <dd className="font-mono text-fg">{c.commission_bps} bps per fill</dd>
                <dt className="text-fg-muted">Slippage (adverse)</dt>
                <dd className="font-mono text-fg">{c.slippage_bps} bps per fill</dd>
                <dt className="text-fg-muted">One-way cost</dt>
                <dd className="font-mono text-fg">{c.commission_bps + c.half_spread_bps + c.slippage_bps} bps</dd>
                <dt className="text-fg-muted">Round trip</dt>
                <dd className="font-mono text-fg">{2 * (c.commission_bps + c.half_spread_bps + c.slippage_bps)} bps</dd>
              </dl>
            </Card>
            <Prose>
              <p className="mt-4">
                Costs are a fixed share of traded value regardless of size or liquidity. That is reasonable for large, liquid
                stocks at modest size, and optimistic for anything else.
              </p>
            </Prose>
          </Section>

          <Section id="survivorship" title="Survivorship bias">
            <Prose>
              <p>
                The universe is a hand-compiled list of {universe.candidates} current large U.S. companies. Companies that were
                delisted, acquired or shrank out of the index before today are absent, and free sources do not provide their
                history.
              </p>
              <p>
                The effect of this bias is not simply optimistic: its size and even its direction differ by strategy and by
                statistic. It is therefore treated as unknown. Verdicts on this universe are capped, and every backtest is
                labelled survivorship-biased.
              </p>
            </Prose>
          </Section>

          <Section id="backtests" title="Backtests">
            <Prose>
              <p>
                Strategies produce only target weights; a shared simulator turns them into orders under the account rules. Stocks
                are eligible on a date only with a price that day, at least {e.min_history_days} sessions of history, a price of at
                least ${e.min_price} and a {e.liquidity_lookback}-day median dollar volume of at least $
                {(e.min_median_dollar_volume / 1e6).toFixed(0)} million, all measured with data available on that date.
              </p>
              <p>
                The published backtests cover 2010–2025, a period examined repeatedly during development. They are exploratory:
                useful to understand behaviour and costs, not evidence of an edge. Any equity curve shown was regenerated with the
                research code and checked against the stored report before publication.
              </p>
            </Prose>
          </Section>

          <Section id="walk-forward" title="Walk-forward validation">
            <Prose>
              <p>
                Machine-learning models are trained only on the past. In each fold the training rows whose forward-return labels
                overlap the test period are purged, a fresh model is fitted, and hyperparameters are chosen on validation data taken
                from the training slice only. Every model is compared with naive baselines on the same folds.
              </p>
            </Prose>
          </Section>

          <Section id="statistics" title="Statistical limitations">
            <Prose>
              <p>
                Overlapping multi-day returns make naive tests far too confident. Inference uses Hansen-Hodrick standard errors
                with a batch-means robustness check, and multiple-testing correction (Holm for confirmatory families,
                Benjamini-Hochberg for exploratory screens).
              </p>
              <p>
                In simulation, the combined test&apos;s false-positive rate ranged from about 2% to 9% at a nominal 5%. Error control
                is approximate, not guaranteed. Pre-registration limits the forking paths but cannot remove the reuse of the same
                historical period across sprints.
              </p>
            </Prose>
          </Section>

          <Section id="risk" title="Risk-management methodology">
            <Prose>
              <p>
                In the research workflows, candidate strategies run by default with a permanent stop that flattens a portfolio after
                a {(Number(stop?.params.max_drawdown ?? 0.25) * 100).toFixed(0)}% drawdown. The published risk comparison isolates
                each policy instead: its &ldquo;No overlay&rdquo; rows have no stop at all. Optional overlays, used only where stated, are an adaptive drawdown policy (reduce at 10%, liquidate and cool
                down at 15%, re-enter gradually when market volatility allows, hard stop at 25% from the all-time high) and a 12%
                volatility target. When several apply, the most restrictive wins, and they can only reduce exposure.
              </p>
              <p>These thresholds are illustrative. They were set in advance and were never tuned on historical results.</p>
            </Prose>
          </Section>

          <Section id="prospective" title="Prospective data integrity">
            <Prose>
              <p>
                A record is prospective only if its data were final (downloaded at least {m.settle_minutes} minutes after the{" "}
                {m.market_close} New York close) before it was written, and it was written before the next session&apos;s close. Holidays,
                early closes and daylight-saving changes come from an exchange-calendar implementation verified against every SPY
                trading day since 2008.
              </p>
              <p>
                Records are appended to a hash-chained ledger in a single atomic write, require committed code (a documented
                exception, if ever used, is written into the record), and keep a hashed
                snapshot of the market data behind each decision. A local file cannot prove when it was written; publishing each
                ledger hash in the version history provides the external time evidence.
              </p>
            </Prose>
          </Section>

          <Provenance meta={methodology.meta} />
        </div>
      </div>
    </Container>
  );
}
