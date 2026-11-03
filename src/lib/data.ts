/**
 * Typed access to the approved, sanitized static datasets in src/data (built by exporter/export_data.py).
 * The Prospective Monitor dataset is loaded at build time by prospective-data.ts (it supports candidate previews).
 * The website never reads backend files at runtime.
 */
import analyticsJson from "@/data/analytics.json";
import methodologyJson from "@/data/methodology.json";
import platformJson from "@/data/platform.json";
import researchJson from "@/data/research.json";
import roadmapJson from "@/data/roadmap.json";

export interface DatasetMeta {
  source_report: string[];
  generated_at: string;
  classification: string;
  period: string;
  methodology_ref: string;
  backend_commit: string;
  [key: string]: unknown;
}

export interface Dataset<T> {
  meta: DatasetMeta;
  data: T;
}

export interface CurvePoint {
  month: string;
  equity: number;
  drawdown: number;
}

export interface MetricRow {
  cagr: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  volatility: number;
  turnover: number;
  costs_per_year: number;
  average_gross: number;
  worst_month: number;
  share_months_up: number;
  time_in_cash?: number;
  risk_transitions?: number;
  missed_recovery_per_episode?: number | null;
}

export interface RiskRow extends MetricRow {
  strategy: string;
  configuration: string;
}

export interface ExecutionRow extends MetricRow {
  strategy: string;
  variant: string;
  sharpe_ci: [number, number];
  note: string | null;
}

export interface Analytics {
  curves: Record<string, CurvePoint[]>;
  verification: Record<string, { fields: string[]; max_abs_difference: number }>;
  risk_comparison: Record<string, RiskRow>;
  execution_study: Record<string, ExecutionRow>;
  spy: MetricRow;
}

export interface Hypothesis {
  statement: string;
  metric: string | null;
  value: number | null;
  verdict: string;
  tier: string;
  revision: { from: string; to: string; reason: string } | null;
  replication_of: string | null;
  notes?: string[];
}

export interface PrimaryResult {
  metric: string;
  discovery: { estimate: number; ci: [number, number]; p: number; holm_p: number | null };
  replication: { estimate: number; p: number };
  verdict: string;
  reasons: string[];
  account: string;
}

export interface Research {
  hypotheses: Record<string, Hypothesis>;
  primary: Record<string, PrimaryResult>;
  exploratory_leads: { feature: string; horizon: number; estimate: number; p: number }[];
  inference_simulation: { alpha: number; reps: number; scenarios: Record<string, string | number>[] };
  features: Record<string, Record<string, unknown>>;
  universe: { name: string; source: string; survivorship_bias_free: boolean; n_candidates: number };
}

export interface Book {
  id: string;
  label: string;
  version: number;
  overlay: string;
  strategy: string;
  params: Record<string, unknown>;
  book_hash: string;
}

export interface Window {
  decision_session: string;
  opens: string;
  closes: string;
  opens_utc: string;
  closes_utc: string;
}

/** Counts from the verified, externally anchored prospective ledger (no record contents). */
export interface ProspectiveRecord {
  ledger_events: number;
  decisions: number;
  observations: number;
  other_events: number;
  decision_sessions: string[];
  decisions_per_session: Record<string, number>;
  first_recorded_at: string;
  simulated_fills: number;
  observations_with_simulated_holdings: number;
  performance: "not_available" | string;
  explanation: string;
}

export interface Prospective {
  status: "awaiting_first_observation" | "decisions_recorded" | string;
  prospective_records: number;
  record?: ProspectiveRecord;
  anchoring?: string;
  books: Book[];
  execution: Record<string, unknown>;
  overlays: Record<string, unknown>;
  question: { id: string; registered: string; text: string; pairs: { unrestricted: string; overlay: string }[]; minimum_months: number; status: string };
  windows: Window[];
  backfill_note: string;
}

export interface Sprint {
  sprint: string;
  date: string;
  status: "complete" | "in development";
  inferred: boolean;
  title: string;
  objective: string;
  delivered: string[];
  engineering: string[];
  findings: string[];
  limitations: string[];
  source: string;
}

export interface Platform {
  tests_passing: number;
  sprints_complete: number;
  capabilities: { title: string; text: string }[];
  universe: {
    name: string;
    source: string;
    candidates: number;
    usable: number;
    excluded: Record<string, string>;
    benchmark: string;
    history: string;
    survivorship_bias_free: boolean;
  };
}

export interface Methodology {
  financial: {
    initial_capital: number;
    costs: { commission_bps: number; half_spread_bps: number; slippage_bps: number; commission_per_order: number };
    account: Record<string, unknown>;
    corporate_actions: Record<string, unknown>;
    risk_rules: { name: string; params: Record<string, number> }[];
  };
  eligibility: Record<string, number>;
  settle_minutes: number;
  market_close: string;
}

export const analytics = analyticsJson as unknown as Dataset<Analytics>;
export const research = researchJson as unknown as Dataset<Research>;
export const roadmap = roadmapJson as unknown as Dataset<{ sprints: Sprint[] }>;
export const platform = platformJson as unknown as Dataset<Platform>;
export const methodology = methodologyJson as unknown as Dataset<Methodology>;

export const CONFIG_LABELS: Record<string, string> = {
  no_overlay: "No overlay",
  permanent_stop: "Permanent 25% stop",
  adaptive_drawdown: "Adaptive drawdown",
  volatility_target: "Volatility target 12%",
  combined: "Combined overlay",
};

export const STRATEGY_LABELS: Record<string, string> = {
  equal_weight: "Eligible equal weight",
  momentum_12_1: "12-1 momentum",
  inverse_volatility: "Inverse volatility",
  rank_composite: "Rank composite",
  equal_weight_20pct_cash: "Equal weight, 20% cash",
  momentum_long_short: "Momentum long/short",
};
