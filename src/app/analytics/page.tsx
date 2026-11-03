import type { Metadata } from "next";
import { EquityExplorer } from "@/components/charts/equity-explorer";
import { Badge, Callout, Container, PageHeader, Provenance, Section, TableWrap, td, tdNum, th } from "@/components/ui";
import { analytics, CONFIG_LABELS, STRATEGY_LABELS } from "@/lib/data";
import { num, pct, times } from "@/lib/format";

export const metadata: Metadata = {
  title: "Portfolio Analytics",
  description: "Exploratory historical backtests of systematic equity portfolios on a survivorship-biased universe, with costs and benchmarks.",
};

const STRATEGIES = [
  { id: "equal_weight", label: "Eligible equal weight" },
  { id: "momentum_12_1", label: "12-1 momentum" },
];
const CONFIGS = Object.entries(CONFIG_LABELS).map(([id, label]) => ({ id, label }));

export default function AnalyticsPage() {
  const a = analytics.data;
  const costs = analytics.meta.costs as { one_way_bps: number; round_trip_bps: number };
  const executionRows = Object.values(a.execution_study);
  const studyStrategies = [...new Set(executionRows.map((r) => r.strategy))];

  return (
    <Container>
      <PageHeader eyebrow="Portfolio Analytics" title="Historical backtests, with every caveat attached">
        Simulated portfolios on 106 large U.S. stocks, {analytics.meta.period}, net of {costs.one_way_bps} bps one-way trading
        costs, in a cash-only account. These are research backtests, not the returns of any account or fund.
      </PageHeader>

      <div className="mt-8 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone="exploratory">Exploratory historical backtest</Badge>
          <Badge tone="exploratory">Survivorship-biased universe</Badge>
          <Badge tone="neutral">Not prospective performance</Badge>
        </div>
        <Callout title="How to read these results" tone="amber">
          The universe is today&apos;s large caps, so companies that failed or were acquired are missing: the size and even the
          direction of that bias are unknown for any given statistic. Every date shown was examined during earlier research, so
          these numbers cannot validate anything. Overlay thresholds are illustrative and were not tuned. Historical results are
          not indicative of future performance.
        </Callout>
      </div>

      <Section id="equity" title="Equity curves and drawdowns" kicker="Risk-overlay comparison (Sprint 14)">
        <EquityExplorer curves={a.curves} strategies={STRATEGIES} configurations={CONFIGS} />
        <p className="mt-3 text-sm text-fg-subtle">{String(analytics.meta.curve_note)} {String(analytics.meta.verification)}</p>
      </Section>

      <Section id="metrics" title="Risk and return by configuration" kicker="Net of costs">
        <TableWrap caption="Risk and return statistics by strategy and risk configuration, 2010 to 2025">
          <thead>
            <tr>
              <th scope="col" className={th}>Portfolio</th>
              <th scope="col" className={th}>Configuration</th>
              <th scope="col" className={`${th} text-right`}>CAGR</th>
              <th scope="col" className={`${th} text-right`}>Sharpe</th>
              <th scope="col" className={`${th} text-right`}>Sortino</th>
              <th scope="col" className={`${th} text-right`}>Max drawdown</th>
              <th scope="col" className={`${th} text-right`}>Volatility</th>
              <th scope="col" className={`${th} text-right`}>Worst month</th>
              <th scope="col" className={`${th} text-right`}>Turnover / yr</th>
              <th scope="col" className={`${th} text-right`}>Costs / yr</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(a.risk_comparison).map((r) => (
              <tr key={`${r.strategy}|${r.configuration}`}>
                <th scope="row" className={`${td} font-normal text-fg`}>{STRATEGY_LABELS[r.strategy]}</th>
                <td className={td}>{CONFIG_LABELS[r.configuration]}</td>
                <td className={tdNum}>{pct(r.cagr, 1, true)}</td>
                <td className={tdNum}>{num(r.sharpe)}</td>
                <td className={tdNum}>{num(r.sortino)}</td>
                <td className={tdNum}>{pct(r.max_drawdown)}</td>
                <td className={tdNum}>{pct(r.volatility)}</td>
                <td className={tdNum}>{pct(r.worst_month)}</td>
                <td className={tdNum}>{times(r.turnover)}</td>
                <td className={tdNum}>{pct(r.costs_per_year, 2)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className={`${td} font-normal text-fg`}>SPY buy &amp; hold</th>
              <td className={td}>Benchmark</td>
              <td className={tdNum}>{pct(a.spy.cagr, 1, true)}</td>
              <td className={tdNum}>{num(a.spy.sharpe)}</td>
              <td className={tdNum}>{num(a.spy.sortino)}</td>
              <td className={tdNum}>{pct(a.spy.max_drawdown)}</td>
              <td className={tdNum}>{pct(a.spy.volatility)}</td>
              <td className={tdNum}>{pct(a.spy.worst_month)}</td>
              <td className={tdNum}>{times(a.spy.turnover)}</td>
              <td className={tdNum}>{pct(a.spy.costs_per_year, 2)}</td>
            </tr>
          </tbody>
        </TableWrap>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          The portfolios&apos; higher returns than SPY are not evidence of skill: the universe was chosen knowing which companies
          are large today, and the period had already been examined during development. Every overlay roughly halved the maximum
          drawdown and cost 5–9 points of CAGR. None improved the Sharpe ratio by a
          margin that would mean anything on a previously examined sample, and no significance tests were run. The permanent
          25% stop fired once, sold near the low and stayed in cash.
        </p>
      </Section>

      <Section id="execution" title="Rebalancing frequency and trading costs" kicker="Execution study (Sprint 13)">
        <TableWrap caption="Effect of rebalancing frequency on returns, turnover and costs, 2010 to 2025">
          <thead>
            <tr>
              <th scope="col" className={th}>Portfolio</th>
              <th scope="col" className={th}>Rebalancing</th>
              <th scope="col" className={`${th} text-right`}>CAGR</th>
              <th scope="col" className={`${th} text-right`}>Sharpe (95% CI)</th>
              <th scope="col" className={`${th} text-right`}>Max drawdown</th>
              <th scope="col" className={`${th} text-right`}>Turnover / yr</th>
              <th scope="col" className={`${th} text-right`}>Costs / yr</th>
            </tr>
          </thead>
          <tbody>
            {studyStrategies.flatMap((s) =>
              executionRows
                .filter((r) => r.strategy === s)
                .map((r, i) => (
                  <tr key={`${s}|${r.variant}`}>
                    <th scope="row" className={`${td} font-normal text-fg`}>
                      {i === 0 ? STRATEGY_LABELS[s] ?? s : <span className="sr-only">{STRATEGY_LABELS[s] ?? s}</span>}
                      {i === 0 && r.note ? <span className="mt-0.5 block text-xs text-amber">{r.note}</span> : null}
                    </th>
                    <td className={td}>{{ daily: "Daily", monthly: "Monthly", monthly_band: "Monthly + 0.25% band" }[r.variant]}</td>
                    <td className={tdNum}>{pct(r.cagr, 1, true)}</td>
                    <td className={tdNum}>
                      {num(r.sharpe)} <span className="text-fg-subtle">({num(r.sharpe_ci[0])}, {num(r.sharpe_ci[1])})</span>
                    </td>
                    <td className={tdNum}>{pct(r.max_drawdown)}</td>
                    <td className={tdNum}>{times(r.turnover)}</td>
                    <td className={tdNum}>{pct(r.costs_per_year, 2)}</td>
                  </tr>
                )),
            )}
          </tbody>
        </TableWrap>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Costs follow one convention: {costs.one_way_bps} bps of traded value per fill (commission plus slippage), so a round
          trip costs {costs.round_trip_bps} bps. Moving from daily to monthly rebalancing cut turnover by 72–81%, which mattered
          most for momentum-type portfolios. The long/short book lost money after borrow and trading costs.
        </p>
      </Section>

      <Provenance meta={analytics.meta} />
    </Container>
  );
}
