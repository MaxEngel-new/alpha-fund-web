import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CSV_COLUMNS,
  EXECUTED_LABEL,
  HOLDINGS_LABEL,
  VIEW_LABELS,
  filterRows,
  sortRows,
  summarize,
  targetDifference,
  toCsv,
  type HoldingsExport,
  type HoldingsPortfolio,
  type HoldingRow,
} from "../src/lib/holdings.ts";

const rows: HoldingRow[] = [
  { ticker: "MSFT", company: null, target_weight: 0.3, risk_adjusted_weight: 0.15 },
  { ticker: "AAPL", company: "Apple Inc.", target_weight: 0.3, risk_adjusted_weight: 0.15 },
  { ticker: "XOM", company: "Exxon Mobil", target_weight: 0.4, risk_adjusted_weight: 0.2 },
];

function portfolio(overrides: Partial<HoldingsPortfolio> = {}): HoldingsPortfolio {
  return {
    id: "momentum_12_1_adaptive",
    label: "12-1 Momentum + Adaptive Risk",
    version: 1,
    overlay: "combined",
    book_hash: "c".repeat(64),
    decision_record_hash: "d".repeat(64),
    risk_state: "REDUCED",
    permitted_exposure: { account_gross_cap: 1, adaptive_drawdown: 0.5 },
    holdings: rows,
    stock_allocation: { target: 1.0, risk_adjusted: 0.5 },
    cash_allocation: { target: 0, risk_adjusted: 0.5 },
    executed: { status: "not_available", note: "No simulated fills have been recorded yet." },
    ...overrides,
  };
}

function exportWith(p: HoldingsPortfolio): HoldingsExport {
  return {
    meta: {
      source_report: [], generated_at: "2026-11-02T00:00:00+00:00", classification: "PROSPECTIVE", period: "", methodology_ref: "",
      backend_commit: "c9f1797", ledger_head_hash: "f".repeat(64), anchored_at_remote_head: "c9f1797", config_sha256: "a".repeat(64),
      decision_code_commit: "0723c91", company_names: "not mapped: tickers only",
    },
    data: {
      decision_session: "2026-10-30", recorded_at: "", data_cutoff: "", intended_execution: "", intended_execution_date: "2026-11-02",
      execution_rule: "", universe_exclusions: { BK: "no data", TMUS: "split" }, portfolios: [p],
    },
  };
}

describe("sorting and filtering", () => {
  it("sorts by ticker both ways", () => {
    assert.deepEqual(sortRows(rows, "ticker", "asc", "target").map((r) => r.ticker), ["AAPL", "MSFT", "XOM"]);
    assert.deepEqual(sortRows(rows, "ticker", "desc", "target").map((r) => r.ticker), ["XOM", "MSFT", "AAPL"]);
  });
  it("sorts by weight in the selected view, ties broken by ticker", () => {
    assert.deepEqual(sortRows(rows, "weight", "desc", "target").map((r) => r.ticker), ["XOM", "AAPL", "MSFT"]);
    assert.deepEqual(sortRows(rows, "weight", "asc", "risk_adjusted").map((r) => r.ticker), ["AAPL", "MSFT", "XOM"]);
  });
  it("sorts by company with unmapped names last in both directions", () => {
    assert.deepEqual(sortRows(rows, "company", "asc", "target").map((r) => r.ticker), ["AAPL", "XOM", "MSFT"]);
    assert.deepEqual(sortRows(rows, "company", "desc", "target").map((r) => r.ticker), ["XOM", "AAPL", "MSFT"]);
  });
  it("searches ticker and company, case-insensitively", () => {
    assert.deepEqual(filterRows(rows, "xo").map((r) => r.ticker), ["XOM"]);
    assert.deepEqual(filterRows(rows, "apple").map((r) => r.ticker), ["AAPL"]);
    assert.equal(filterRows(rows, "  ").length, 3);
    assert.equal(filterRows(rows, "zzz").length, 0);
  });
  it("does not mutate the input", () => {
    const before = rows.map((r) => r.ticker);
    sortRows(rows, "weight", "desc", "target");
    assert.deepEqual(rows.map((r) => r.ticker), before);
  });
});

describe("summaries and cash", () => {
  it("reports stock and cash allocation per view", () => {
    const s = summarize(portfolio(), "risk_adjusted");
    assert.equal(s.stocks, 0.5);
    assert.equal(s.cash, 0.5);
    assert.equal(s.positions, 3);
    assert.equal(s.equalWeighted, false);
  });
  it("detects equal weighting exactly", () => {
    const equal = portfolio({ holdings: [1, 2, 3].map((i) => ({ ticker: `T${i}`, company: null, target_weight: 1 / 3, risk_adjusted_weight: 1 / 3 })) });
    assert.equal(summarize(equal, "target").equalWeighted, true);
  });
  it("ignores zero weights in the position count", () => {
    const p = portfolio({ holdings: [...rows, { ticker: "ZERO", company: null, target_weight: 0, risk_adjusted_weight: 0 }] });
    assert.equal(summarize(p, "target").positions, 3);
  });
});

describe("labels and disclosures", () => {
  it("labels the holdings as hypothetical, never as real positions", () => {
    assert.equal(HOLDINGS_LABEL, "Prospective hypothetical portfolio allocations — not real-money positions.");
  });
  it("labels execution as simulated, never as actual or brokerage", () => {
    assert.match(EXECUTED_LABEL, /simulated/i);
    assert.doesNotMatch(EXECUTED_LABEL, /actual|brokerage|real/i);
    assert.deepEqual(VIEW_LABELS, { target: "Original target weight", risk_adjusted: "Risk-adjusted target weight" });
  });
  it("explains identical and different target views", () => {
    const same = portfolio({ holdings: rows.map((r) => ({ ...r, risk_adjusted_weight: r.target_weight })), risk_state: "NORMAL" });
    assert.match(targetDifference(same), /^Identical this month/);
    assert.match(targetDifference(portfolio()), /^Different this month/);
  });
});

describe("CSV", () => {
  it("contains only the approved columns, exact weights and a cash row", () => {
    const csv = toCsv(exportWith(portfolio()), portfolio());
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], CSV_COLUMNS.join(","));
    assert.equal(lines.length, 1 + rows.length + 1);
    assert.equal(lines[1], "momentum_12_1_adaptive,12-1 Momentum + Adaptive Risk,2026-10-30,2026-11-02,PROSPECTIVE,equity,AAPL,Apple Inc.,,0.3,0.15");
    assert.equal(lines[2].split(",")[7], ""); // unmapped company name stays empty, never guessed
    assert.equal(lines.at(-1), "momentum_12_1_adaptive,12-1 Momentum + Adaptive Risk,2026-10-30,2026-11-02,PROSPECTIVE,cash,,Cash (unallocated),,0,0.5");
  });
  it("writes weights at full recorded precision", () => {
    const p = portfolio({ holdings: [{ ticker: "AAA", company: null, target_weight: 1 / 106, risk_adjusted_weight: 1 / 106 }] });
    const line = toCsv(exportWith(p), p).split("\n")[1];
    assert.ok(line.endsWith(",0.009433962264150943,0.009433962264150943"));
    assert.equal(Number(line.split(",")[9]), 1 / 106);
  });
  it("includes the issuer CIK only when a verified name provides it", () => {
    const p = portfolio({ holdings: [{ ticker: "AAPL", company: "Apple Inc.", issuer_cik: "0000320193", target_weight: 1, risk_adjusted_weight: 1 }] });
    assert.ok(toCsv(exportWith(p), p).split("\n")[1].includes(",AAPL,Apple Inc.,0000320193,1,1"));
  });
  it("escapes commas and quotes in company names", () => {
    const p = portfolio({ holdings: [{ ticker: "BRK.B", company: 'Berkshire "B", Inc.', target_weight: 1, risk_adjusted_weight: 1 }] });
    assert.ok(toCsv(exportWith(p), p).includes('BRK.B,"Berkshire ""B"", Inc.",,1,1'));
  });
});

describe("the real candidate export, when present", () => {
  it("keeps every recorded weight within [0, 1] and per-view cash consistent", (t) => {
    let exp: HoldingsExport;
    try {
      exp = JSON.parse(readFileSync(new URL("../src/data/holdings/candidates/2026-10-30.json", import.meta.url), "utf8"));
    } catch {
      t.skip("no local candidate export");
      return;
    }
    assert.equal(exp.data.portfolios.length, 4);
    for (const p of exp.data.portfolios) {
      const tickers = p.holdings.map((r) => r.ticker);
      assert.equal(new Set(tickers).size, tickers.length);
      for (const r of p.holdings) assert.ok(r.target_weight >= 0 && r.risk_adjusted_weight >= 0);
      for (const v of ["target", "risk_adjusted"] as const) {
        const sum = p.holdings.reduce((a, r) => a + (v === "target" ? r.target_weight : r.risk_adjusted_weight), 0);
        assert.ok(Math.abs(sum + p.cash_allocation[v] - 1) < 1e-9);
      }
      assert.equal(p.executed.status, "not_available");
    }
  });
});

describe("the company-name revision, when present", () => {
  const read = (file: string): HoldingsExport | null => {
    try {
      return JSON.parse(readFileSync(new URL(`../src/data/holdings/candidates/${file}`, import.meta.url), "utf8"));
    } catch {
      return null;
    }
  };
  for (const revision of ["2026-10-30.r2.json", "2026-10-30.r3.json"]) {
    it(`${revision} changes names only: tickers, weights and every other portfolio field equal the original candidate`, (t) => {
      const [r1, r2] = [read("2026-10-30.json"), read(revision)];
      if (!r1 || !r2) {
        t.skip("no local candidates");
        return;
      }
      assert.equal(new Set(r2.data.portfolios.flatMap((p) => p.holdings.map((r) => r.ticker))).size, 106);
      r2.data.portfolios.forEach((p, i) => {
        const o = r1.data.portfolios[i];
        assert.deepEqual(p.holdings.map((r) => [r.ticker, r.target_weight, r.risk_adjusted_weight]), o.holdings.map((r) => [r.ticker, r.target_weight, r.risk_adjusted_weight]));
        assert.deepEqual({ ...p, holdings: null }, { ...o, holdings: null });
      });
      const unmapped = new Set(r2.meta.company_names_unmapped);
      for (const p of r2.data.portfolios) for (const r of p.holdings) assert.equal(r.company === null, unmapped.has(r.ticker));
      assert.match(r2.meta.company_name_basis ?? "", /not a historical issuer identity/);
    });
  }
  it("r3 names every ticker, with issuer-filing sources for the four reviewed names", (t) => {
    const r3 = read("2026-10-30.r3.json");
    if (!r3) {
      t.skip("no r3 candidate");
      return;
    }
    assert.deepEqual(r3.meta.company_names_unmapped, []);
    for (const p of r3.data.portfolios) for (const r of p.holdings) assert.ok(r.company && r.issuer_cik);
    const reviewed = r3.meta.company_names_reviewed ?? {};
    assert.deepEqual(Object.keys(reviewed).sort(), ["HON", "IBM", "JPM", "SLB"]);
    for (const r of Object.values(reviewed)) {
      assert.equal(r.basis, "issuer_verified");
      assert.ok(r.reviewed_on && r.ambiguity && r.sources?.every((s) => s.url.startsWith("https://")));
    }
  });
});

describe("the prospective dataset candidate, when present", () => {
  it("separates recorded decisions from ledger events, simulated fills and performance", (t) => {
    let d: { meta: { classification: string }; data: { status: string; prospective_records: number; record: Record<string, unknown> } };
    try {
      d = JSON.parse(readFileSync(new URL("../src/data/candidates/prospective.json", import.meta.url), "utf8"));
    } catch {
      t.skip("no local dataset candidate");
      return;
    }
    assert.equal(d.data.status, "decisions_recorded");
    assert.equal(d.data.record.decisions, 4);
    assert.equal(d.data.record.ledger_events, 8);
    assert.equal(d.data.prospective_records, 8);
    assert.equal(d.data.record.simulated_fills, 0);
    assert.equal(d.data.record.performance, "not_available");
    assert.match(d.meta.classification, /no simulated fills or performance yet/);
  });
});
