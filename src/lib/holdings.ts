/**
 * Pure logic for the prospective holdings view (no framework imports, so it is unit-tested with node:test).
 * Weights are shown exactly as recorded in the approved export; nothing here recomputes a decision.
 */

export type WeightView = "target" | "risk_adjusted";
export type SortKey = "company" | "ticker" | "weight";
export type SortDir = "asc" | "desc";

export interface HoldingRow {
  ticker: string;
  company: string | null;
  /** SEC issuer identifier of the current listed issuer (only with a verified name). */
  issuer_cik?: string | null;
  target_weight: number;
  risk_adjusted_weight: number;
}

export interface HoldingsPortfolio {
  id: string;
  label: string;
  version: number;
  overlay: string;
  book_hash: string;
  decision_record_hash: string;
  risk_state: string;
  permitted_exposure: Record<string, number>;
  holdings: HoldingRow[];
  stock_allocation: { target: number; risk_adjusted: number };
  cash_allocation: { target: number; risk_adjusted: number };
  executed: { status: "not_available" | "recorded"; note: string; fills?: number };
}

export interface HoldingsExport {
  meta: {
    source_report: string[];
    generated_at: string;
    classification: string;
    period: string;
    methodology_ref: string;
    backend_commit: string;
    ledger_head_hash: string;
    anchored_at_remote_head: string;
    config_sha256: string;
    decision_code_commit: string | null;
    company_names: string;
    /** Present when names come from the public-listing mapping: names are current issuers, not historical identities. */
    company_name_basis?: string;
    company_name_sources?: { name: string; url: string; sha256: string; revision?: string }[];
    company_names_unmapped?: string[];
    /** Names resolved by review from the issuers' own filings or sites, with the sources and any naming ambiguity. */
    company_names_reviewed?: Record<
      string,
      { company: string; basis: string; reviewed_on?: string; ambiguity?: string; sources?: { name: string; url: string }[] }
    >;
  };
  data: {
    decision_session: string;
    recorded_at: string;
    data_cutoff: string;
    intended_execution: string;
    intended_execution_date: string;
    execution_rule: string;
    universe_exclusions: Record<string, string>;
    portfolios: HoldingsPortfolio[];
  };
}

export const HOLDINGS_LABEL = "Prospective hypothetical portfolio allocations — not real-money positions.";

export const VIEW_LABELS: Record<WeightView, string> = {
  target: "Original target weight",
  risk_adjusted: "Risk-adjusted target weight",
};

/** The executed view is only ever "simulated execution" of a paper portfolio, never a brokerage position. */
export const EXECUTED_LABEL = "Simulated execution (paper portfolio)";

export function weightOf(row: HoldingRow, view: WeightView): number {
  return view === "target" ? row.target_weight : row.risk_adjusted_weight;
}

export function filterRows(rows: HoldingRow[], query: string): HoldingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.ticker.toLowerCase().includes(q) || (r.company ?? "").toLowerCase().includes(q));
}

export function sortRows(rows: HoldingRow[], key: SortKey, dir: SortDir, view: WeightView): HoldingRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byTicker = (a: HoldingRow, b: HoldingRow) => a.ticker.localeCompare(b.ticker);
  return [...rows].sort((a, b) => {
    if (key === "weight") {
      const d = weightOf(a, view) - weightOf(b, view);
      return d !== 0 ? sign * d : byTicker(a, b);
    }
    if (key === "company") {
      // Unmapped company names always sort after mapped ones, then by ticker.
      if (a.company === null && b.company === null) return sign * byTicker(a, b);
      if (a.company === null) return 1;
      if (b.company === null) return -1;
      const d = a.company.localeCompare(b.company);
      return d !== 0 ? sign * d : byTicker(a, b);
    }
    return sign * byTicker(a, b);
  });
}

export interface PortfolioSummary {
  positions: number;
  stocks: number;
  cash: number;
  minWeight: number;
  maxWeight: number;
  equalWeighted: boolean;
}

export function summarize(portfolio: HoldingsPortfolio, view: WeightView): PortfolioSummary {
  const weights = portfolio.holdings.map((r) => weightOf(r, view)).filter((w) => w > 0);
  const minWeight = weights.length ? Math.min(...weights) : 0;
  const maxWeight = weights.length ? Math.max(...weights) : 0;
  return {
    positions: weights.length,
    stocks: portfolio.stock_allocation[view],
    cash: portfolio.cash_allocation[view],
    minWeight,
    maxWeight,
    equalWeighted: weights.length > 0 && maxWeight - minWeight < 1e-12,
  };
}

/** Plain-language explanation of how the two target views relate for this portfolio. */
export function targetDifference(portfolio: HoldingsPortfolio): string {
  const identical = portfolio.holdings.every((r) => r.target_weight === r.risk_adjusted_weight);
  const limits = Object.entries(portfolio.permitted_exposure)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${(v * 100).toFixed(0)}%`)
    .join(", ");
  if (identical) {
    return `Identical this month: every applicable limit permitted full exposure (${limits}; risk state ${portfolio.risk_state}), so the risk-adjusted targets equal the original targets.`;
  }
  return `Different this month: the risk limits (${limits}; risk state ${portfolio.risk_state}) reduced exposure, so risk-adjusted weights are smaller and the remainder is held as cash.`;
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  "portfolio_id",
  "portfolio_name",
  "decision_date",
  "intended_execution_date",
  "classification",
  "asset_type",
  "ticker",
  "company_name",
  "issuer_cik",
  "target_weight",
  "risk_adjusted_weight",
] as const;

/** CSV with only the approved public fields; weights are written exactly as recorded (shortest round-trip form). */
export function toCsv(exp: HoldingsExport, portfolio: HoldingsPortfolio): string {
  const base = [portfolio.id, portfolio.label, exp.data.decision_session, exp.data.intended_execution_date, "PROSPECTIVE"];
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of [...portfolio.holdings].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    lines.push([...base, "equity", r.ticker, r.company, r.issuer_cik ?? null, r.target_weight, r.risk_adjusted_weight].map(csvCell).join(","));
  }
  lines.push([...base, "cash", "", "Cash (unallocated)", "", portfolio.cash_allocation.target, portfolio.cash_allocation.risk_adjusted].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export function pctExact(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}
