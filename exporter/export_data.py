"""Builds the website's sanitized static datasets from the Alpha Fund backend (read-only).

    python3 exporter/export_data.py [--backend ../alpha-fund] [--only prospective]

* Reads only committed, git-tracked research outputs and configs from the backend
  (docs/audits/*.json, data/hypotheses/*.json, configs/*.yaml, the sprint reports).
* Equity curves are not stored in any report, so they are REGENERATED with the backend's
  own code on its preserved research data, exactly as scripts/sprint14_research.py does,
  and published only if every regenerated summary statistic equals the committed report
  (docs/audits/sprint14_results.json). Otherwise the export aborts.
* Never publishes ledger contents, market-data files, snapshots, model artifacts, credentials or
  local paths. From the prospective ledger only record COUNTS by type, decision sessions and the
  recorded fill count are exported, and only after its hash chain verifies and it is externally
  anchored (committed and identical at the GitHub remote's head); BACKFILL records are never read.
  Every output is scanned for local paths and secrets before it is written.
* Nothing is written inside the backend (its file logger is disabled before any run).

Each dataset: {"meta": {source_report, generated_at, classification, period, methodology_ref,
backend_commit}, "data": {...}}. Outputs are CANDIDATES: src/data/candidates/<name>.json (git-ignored;
<name>.r2.json etc. if one exists, never overwritten), each with a Pending row in the private approval
register. The site keeps using the approved src/data/<name>.json until the owner runs
exporter/publish_dataset.py for a reviewed candidate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "src" / "data"
CANDIDATES = OUT / "candidates"
REGISTER = WEB / "exporter" / "APPROVAL.md"
REEXPORTS = "\n## Dataset re-exports\n"
DEFAULT_BACKEND = WEB.parent / "alpha-fund"
GENERATED_AT = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

FORBIDDEN = [r"/Users/", r"/private/", r"/var/folders", r"/home/", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|org|net|io)",
             r"(?i)api[_-]?key", r"(?i)secret", r"(?i)passw", r"AKIA[0-9A-Z]{12}", r"BEGIN (RSA|OPENSSH|PRIVATE)"]
VERIFIED_FIELDS = ("cagr", "total_return", "sharpe_ratio", "sortino_ratio", "max_drawdown", "annual_volatility",
                   "annual_turnover", "transaction_costs_per_year", "average_gross_exposure")


def git(backend: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(backend), *args], capture_output=True, text=True, check=True).stdout.strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def meta(backend_commit: str, sources: list[str], classification: str, period: str, methodology: str, **extra) -> dict:
    return {"source_report": sources, "generated_at": GENERATED_AT, "classification": classification,
            "period": period, "methodology_ref": methodology, "backend_commit": backend_commit, **extra}


def r(x, digits: int = 6):
    return None if x is None else round(float(x), digits)


# --- analytics: regenerated, verified equity curves + report tables --------------------------------


def regenerate_curves(backend: Path) -> tuple[dict, dict]:
    """Re-run the Sprint 14 study's backtests with the backend code; verify against the committed report."""
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    from app.utils.logger import logger

    logger.remove()  # no file sink: nothing is written inside the backend
    logger.add(sys.stderr, level="WARNING")
    import yaml

    from app.backtest.analytics import performance_summary
    from app.backtest.assumptions import FinancialAssumptions
    from app.backtest.execution_policy import ExecutionPolicy
    from app.backtest.signal_generator import SignalGenerator
    from app.ml.eligibility import ELIGIBLE_COLUMN
    from app.strategy.buy_and_hold import BuyAndHoldStrategy
    from app.strategy.registry import create_strategy
    from scripts.sprint12_research import _load
    from scripts.sprint13_research import _slice
    from scripts.sprint14_research import _risk_manager

    raw = Path("configs/sprint14_research.yaml").read_bytes()
    stored = json.loads(Path("docs/audits/sprint14_results.json").read_text())
    if hashlib.sha256(raw).hexdigest() != stored["config_sha256"]:
        raise SystemExit("configs/sprint14_research.yaml differs from the config behind the committed results")
    config = yaml.safe_load(raw)
    full_data, full_benchmark, _, _, _ = _load(config)
    period = config["period"]
    data = _slice(full_data, period["start"], period["end"])
    benchmark = _slice({"SPY": full_benchmark}, period["start"], period["end"])["SPY"]
    shared = FinancialAssumptions.from_yaml(config["financial_config"])
    policy = ExecutionPolicy(**{**config["execution"], "mandatory_exit_column": ELIGIBLE_COLUMN})

    curves, checks = {}, {}

    def keep(key, result, reference):
        summary = performance_summary(result)
        diffs = {f: abs(float(summary[f]) - float(reference[f])) for f in VERIFIED_FIELDS}
        worst = max(diffs.values())
        if worst > 1e-12:
            raise SystemExit(f"{key}: regenerated statistics differ from the committed report ({diffs}); not publishing")
        checks[key] = {"fields": list(VERIFIED_FIELDS), "max_abs_difference": worst}
        equity = result.equity_curve / result.equity_curve.iloc[0]
        index = equity.index.tz_localize(None) if equity.index.tz is not None else equity.index
        equity.index = index
        drawdown = equity / equity.cummax() - 1.0
        month_end = equity.groupby(index.to_period("M")).last()
        month_worst = drawdown.groupby(index.to_period("M")).min()
        curves[key] = [{"month": str(m), "equity": r(month_end[m]), "drawdown": r(month_worst[m])} for m in month_end.index]

    spy = shared.build_baseline_engine().simulator.run({"SPY": benchmark}, SignalGenerator(BuyAndHoldStrategy()))
    keep("spy", spy, stored["spy"])
    for name, spec in config["strategies"].items():
        for kind in config["configurations"]:
            manager = _risk_manager(kind, config, full_data, full_benchmark)
            simulator = shared.build_simulator(include_risk_rules=False, execution_policy=policy, risk_manager=manager)
            result = simulator.run(data, SignalGenerator(create_strategy(spec["name"], **spec.get("params", {}))))
            keep(f"{name}|{kind}", result, stored["risk"][f"{name}|{kind}"]["summary"])
    return curves, checks


def analytics(backend: Path, commit: str) -> dict:
    s14 = json.loads((backend / "docs/audits/sprint14_results.json").read_text())
    s13 = json.loads((backend / "docs/audits/sprint13_results_corrected.json").read_text())
    curves, checks = regenerate_curves(backend)

    def row(summary, profile=None, missed=None):
        out = {"cagr": r(summary["cagr"]), "sharpe": r(summary["sharpe_ratio"]), "sortino": r(summary["sortino_ratio"]),
               "max_drawdown": r(summary["max_drawdown"]), "volatility": r(summary["annual_volatility"]),
               "turnover": r(summary["annual_turnover"]), "costs_per_year": r(summary["transaction_costs_per_year"]),
               "average_gross": r(summary["average_gross_exposure"]), "worst_month": r(summary["monthly"]["worst"]),
               "share_months_up": r(summary["monthly"]["share_positive"])}
        if profile is not None:
            out["time_in_cash"] = r(profile["time_in_cash"])
            out["risk_transitions"] = profile["risk_transitions"]
        if missed is not None:
            out["missed_recovery_per_episode"] = r(missed["mean_missed_per_episode"])
        return out

    risk = {key: {"strategy": v["strategy"], "configuration": v["configuration"],
                  **row(v["summary"], v["risk_profile"], v["missed_recovery"])} for key, v in s14["risk"].items()}
    notes = {"rank_composite": "Data-snooped by construction: both inputs were earlier exploratory leads on overlapping data.",
             "momentum_long_short": "MARGIN_RESEARCH account (illustrative 5% financing, 3% borrow fee).",
             "equal_weight_20pct_cash": "Holds 20% cash by design."}
    execution = {}
    for key, v in s13["runs"].items():
        if v["variant"] in ("daily", "monthly", "monthly_band"):
            execution[key] = {"strategy": v["strategy"], "variant": v["variant"], **row(v["summary"]),
                              "sharpe_ci": [r(x, 4) for x in v["sharpe_ci"]], "note": notes.get(v["strategy"])}
    return {
        "meta": meta(commit, ["docs/audits/sprint14_results.json", "docs/audits/sprint13_results_corrected.json",
                              "configs/sprint14_research.yaml", "SPRINT_13_REPORT.md", "SPRINT_14_REPORT.md"],
                     "Exploratory historical backtest on a survivorship-biased universe; every date was examined in earlier research",
                     f"{s14['period']['start']} to {s14['period']['end']}", "/methodology#backtests",
                     universe_size=s14["universe_size"], costs=s14["costs"],
                     curve_note="Equity is the month-end value of each daily backtest, rebased to 1.0; drawdown is the worst daily drawdown within each month.",
                     verification="Every curve was regenerated with the research code and its statistics matched the stored research report exactly (maximum absolute difference 0)."),
        "data": {"curves": curves, "verification": checks, "risk_comparison": risk, "execution_study": execution,
                 "spy": row(s14["spy"])},
    }


# --- research lab --------------------------------------------------------------------------------


def research(backend: Path, commit: str) -> dict:
    s12 = json.loads((backend / "docs/audits/sprint12_results.json").read_text())
    sim = json.loads((backend / "docs/audits/sprint12_inference_simulation.json").read_text())
    hypotheses = {}
    for path in sorted((backend / "data/hypotheses").glob("*.json")):
        h = json.loads(path.read_text())
        revision = next((a for a in h.get("audit_trail", []) if a.get("action") == "verdict_revision"), None)
        notes = [str(a.get("reason") or a.get("note") or "")[:400] for a in h.get("audit_trail", []) if a.get("action") == "annotation"]
        hypotheses[h["hypothesis_id"]] = {
            "statement": h["statement"], "metric": h.get("oos_metric_name"), "value": r(h.get("oos_metric_value"), 4),
            "verdict": h["verdict"], "tier": h.get("evidence_tier") or "exploratory",
            "revision": ({"from": revision.get("previous_verdict"), "to": revision.get("new_verdict"),
                          "reason": str(revision.get("reason", ""))[:400]} if revision else None),
            "replication_of": h.get("replication_of"),
            "notes": notes,
        }
    primary = {}
    for hid, block in s12["primary"].items():
        if "evidence" in block["discovery"]:  # signal hypotheses: rank IC
            d, rep = block["discovery"]["evidence"], block["replication"]["evidence"]
            kind, ci, holm = "Rank IC", [d["ci_low"], d["ci_high"]], d.get("adjusted_p_value")
            disc_est, disc_p, rep_est, rep_p = d["estimate"], d["p_value"], rep["estimate"], rep["p_value"]
        else:  # portfolio hypotheses: Sharpe after costs (bootstrap CI; mean daily return test for p)
            d, rep = block["discovery"]["sharpe"], block["replication"]["sharpe"]
            kind, ci = "Sharpe after costs", [d["ci_low"], d["ci_high"]]
            holm = d["mean_daily_return_test"].get("adjusted_p_value")
            disc_est, disc_p = d["sharpe"], d["mean_daily_return_test"]["p_value"]
            rep_est, rep_p = rep["sharpe"], rep["mean_daily_return_test"]["p_value"]
        primary[hid] = {
            "metric": kind,
            "discovery": {"estimate": r(disc_est, 4), "ci": [r(ci[0], 4), r(ci[1], 4)], "p": r(disc_p, 4), "holm_p": r(holm, 4)},
            "replication": {"estimate": r(rep_est, 4), "p": r(rep_p, 4)},
            "verdict": s12["verdicts"][hid]["verdict"], "reasons": s12["verdicts"][hid]["reasons"],
            "account": block.get("account", "CASH_ONLY")[:40],
        }
    leads = [{"feature": e["feature"], "horizon": e["horizon"], "estimate": r(e["evidence"]["estimate"], 4),
              "p": r(e["evidence"]["p_value"], 4)} for e in s12["exploratory"]["discovery"]]
    scenarios = [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in s.items()} for s in sim["scenarios"]]
    import yaml

    features = yaml.safe_load((backend / "configs/features_us100.yaml").read_text())
    return {
        "meta": meta(commit, ["docs/audits/sprint12_results.json", "data/hypotheses/*.json", "docs/audits/sprint12_inference_simulation.json",
                              "configs/features_us100.yaml", "SPRINT_12_REPORT.md"],
                     "Pre-registered replications (B-series, all failed) and earlier exploratory hypotheses (A-series)",
                     f"discovery {s12['windows']['discovery']['start']} to {s12['windows']['discovery']['end']}; "
                     f"replication {s12['windows']['replication']['start']} to {s12['windows']['replication']['end']}",
                     "/methodology#statistics"),
        "data": {"hypotheses": hypotheses, "primary": primary, "exploratory_leads": leads,
                 "inference_simulation": {"alpha": sim["alpha"], "reps": sim["reps"], "scenarios": scenarios},
                 "features": features.get("features", features), "universe": {k: s12["universe"][k] for k in ("name", "source", "survivorship_bias_free", "n_candidates")}},
    }


# --- prospective monitor -------------------------------------------------------------------------


def ledger_summary(backend: Path, lines: list[str], config_hash: str) -> dict:
    """What the prospective ledger says, as counts: verified and externally anchored first (read-only)."""
    sys.path.insert(0, str(WEB / "exporter"))
    from export_holdings import ExportRefused, check_anchored, load_backend

    try:
        anchoring = check_anchored(backend)
    except ExportRefused as exc:
        raise SystemExit(f"prospective ledger not externally anchored: {exc}")
    _, verify_lines = load_backend(backend)
    report = verify_lines(lines)
    if not report.ok:
        raise SystemExit(f"prospective ledger integrity check failed: {report.problems[:3]}")
    records = [json.loads(line) for line in lines]
    if any(r.get("mode") != "PROSPECTIVE" for r in records):
        raise SystemExit("the prospective ledger contains non-PROSPECTIVE records")
    if any(r["payload"].get("config_hash") != config_hash for r in records):
        raise SystemExit("a prospective record was made under a different configuration")
    decisions = [r for r in records if r["record_type"] == "DECISION"]
    observations = [r for r in records if r["record_type"] == "OBSERVATION"]
    other = len(records) - len(decisions) - len(observations)
    sessions = sorted({d["payload"]["timing"]["signal_session"] for d in decisions})
    fills = sum(len(o["payload"].get("fills_since_previous", [])) for o in observations)
    invested = sum(1 for o in observations if o["payload"]["paper_portfolio"].get("gross_exposure", 0) > 0)
    return {
        "ledger_events": len(records),
        "decisions": len(decisions),
        "observations": len(observations),
        "other_events": other,
        "decision_sessions": sessions,
        "decisions_per_session": {s: sum(d["payload"]["timing"]["signal_session"] == s for d in decisions) for s in sessions},
        "first_recorded_at": min(d["created_at"] for d in decisions)[:19] + "Z",
        "simulated_fills": fills,
        "observations_with_simulated_holdings": invested,
        "performance": "not_available",
        "explanation": (
            f"{len(decisions)} prospective decisions (one per frozen portfolio) are recorded as {len(records)} ledger events: "
            f"{len(decisions)} decisions and {len(observations)} observations of each paper portfolio's starting state. "
            "A decision is a recorded target allocation, not a trade. "
            f"Simulated fills recorded so far: {fills}. Investment performance: none yet; it starts only once the decisions "
            "have been filled in the paper portfolios and observed in a later recording."),
        "head": records[-1]["record_hash"],
        "remote_head": anchoring["remote_head"][:7],
    }


def prospective(backend: Path, commit: str) -> dict:
    import yaml

    os.chdir(backend)
    sys.path.insert(0, str(backend))
    from app.prospective.config import ProspectiveConfig
    from app.prospective.windows import upcoming_windows

    config, config_hash = ProspectiveConfig.load("configs/prospective.yaml")
    ledger_path = Path(config.ledgers.prospective)
    lines = [line for line in ledger_path.read_text().splitlines() if line.strip()] if ledger_path.exists() else []
    summary = ledger_summary(backend, lines, config_hash) if lines else None
    question_path = Path("configs/prospective_research_question.yaml")
    question = yaml.safe_load(question_path.read_text())
    labels = {"equal_weight": "Equal Weight", "equal_weight_adaptive": "Equal Weight + Adaptive Risk",
              "momentum_12_1": "12-1 Momentum", "momentum_12_1_adaptive": "12-1 Momentum + Adaptive Risk"}
    books = [{"id": b.name, "label": labels[b.name], "version": b.version, "overlay": b.overlay,
              "strategy": b.strategy.name, "params": b.strategy.params, "book_hash": config.book_hash(b)[:16]} for b in config.books]
    # The next windows after the latest recorded decision (from the ledger, not the clock).
    start = (datetime.fromisoformat(summary["decision_sessions"][-1]).date() + timedelta(days=1)) if summary else datetime(2026, 10, 30).date()
    windows = [w.describe(config.market_timezone) for w in upcoming_windows(config, start, 3)]
    sources = ["configs/prospective.yaml", "configs/prospective_research_question.yaml", "SPRINT_15_REPORT.md", "SPRINT_16_REPORT.md"]
    if summary:
        dataset_meta = meta(commit, ["data/prospective/ledger.jsonl (record counts only)", *sources],
                            "PROSPECTIVE research: decisions recorded; no simulated fills or performance yet",
                            f"from the first decision session ({summary['decision_sessions'][0]})", "/methodology#prospective",
                            config_sha256=config_hash, question_sha256=sha256(question_path),
                            ledger_head_hash=summary.pop("head"), anchored_at_remote_head=summary.pop("remote_head"))
    else:
        dataset_meta = meta(commit, sources, "PROSPECTIVE research: not started", "from the first recording window (2026-10-30)",
                            "/methodology#prospective", config_sha256=config_hash, question_sha256=sha256(question_path))
    return {
        "meta": dataset_meta,
        "data": {
            "status": "decisions_recorded" if summary else "awaiting_first_observation",
            "prospective_records": len(lines),
            **({"record": summary} if summary else {}),
            "books": books,
            "execution": {k: v for k, v in config.execution.items()},
            "overlays": {"adaptive_drawdown": config.overlays.adaptive_drawdown.policy or "defaults",
                         "volatility_target": config.overlays.volatility_target.policy},
            "question": {"id": question["id"], "registered": question["registered"], "text": question["question"],
                         "pairs": question["pairs"], "minimum_months": question["evaluation"]["minimum_observation_months"],
                         "status": question["status"]},
            "windows": windows,
            "backfill_note": "Practice (BACKFILL) records exist in the backend and are deliberately not published here.",
            **({"anchoring": f"The ledger is committed in {commit}, and that commit is the head of the research repository's GitHub remote "
                             "(a private repository; its ledger head hash is published here)."}
               if summary else {}),
        },
    }


# --- overview / platform -------------------------------------------------------------------------


def platform(backend: Path, commit: str) -> dict:
    s12 = json.loads((backend / "docs/audits/sprint12_results.json").read_text())
    report16 = (backend / "SPRINT_16_REPORT.md").read_text()
    tests = int(re.search(r"(\d+) passed", report16).group(1))
    excluded = s12["universe"]["excluded"]
    return {
        "meta": meta(commit, ["README.md", "PROJECT.md", "ARCHITECTURE.md", "SPRINT_16_REPORT.md", "docs/audits/sprint12_results.json"],
                     "Platform facts (engineering status)", "project history 2026-07-28 to 2026-10-21", "/methodology"),
        "data": {
            "tests_passing": tests, "sprints_complete": 16,
            "capabilities": [
                {"title": "Market data", "text": "Free daily data from Yahoo Finance with batched, cached, retrying ingestion and data-quality checks. The live pipeline also quarantines suspicious rows and logs revisions."},
                {"title": "Portfolio accounting", "text": "Cash-only accounts by default; margin research only when explicitly enabled. Accounting invariants are checked on every simulated bar."},
                {"title": "Execution and costs", "text": "Scheduled rebalancing, no-trade bands, minimum trade sizes, turnover budgets and one explicit transaction-cost convention."},
                {"title": "Machine learning", "text": "Purged walk-forward validation, six model types including XGBoost and LightGBM, and a model store with feature-schema hashes."},
                {"title": "Statistics", "text": "Overlap-robust inference, multiple-testing correction and pre-registered hypotheses with evidence-based verdicts."},
                {"title": "Risk management", "text": "Optional adaptive drawdown and volatility-target overlays; the most restrictive limit always wins."},
                {"title": "Prospective research", "text": "An append-only, hash-chained ledger that labels a decision prospective only when its timestamps prove it."},
                {"title": "Monitoring", "text": "Read-only health checks, ledger diagnosis and an end-to-end reproducibility audit."},
            ],
            "universe": {"name": s12["universe"]["name"], "source": s12["universe"]["source"], "candidates": s12["universe"]["n_candidates"],
                         "usable": s12["universe"]["n_candidates"] - len(excluded), "excluded": excluded, "benchmark": "SPY",
                         "history": "2008-01-02 to 2026-09-30 (research data)", "survivorship_bias_free": s12["universe"]["survivorship_bias_free"]},
        },
    }


def methodology(backend: Path, commit: str) -> dict:
    import yaml

    financial = yaml.safe_load((backend / "configs/financial.yaml").read_text())
    s12config = yaml.safe_load((backend / "configs/sprint12_research.yaml").read_text())
    prospective_cfg = yaml.safe_load((backend / "configs/prospective.yaml").read_text())
    return {
        "meta": meta(commit, ["configs/financial.yaml", "configs/sprint12_research.yaml", "configs/prospective.yaml", "ARCHITECTURE.md"],
                     "Methodology and assumptions", "as configured at the backend commit", "/methodology"),
        "data": {"financial": {k: financial[k] for k in financial if k in ("initial_capital", "costs", "account", "corporate_actions", "risk_rules")},
                 "eligibility": s12config.get("eligibility"),
                 "settle_minutes": prospective_cfg["bar_settle_minutes"], "market_close": prospective_cfg["market_close"]},
    }


# --- main ----------------------------------------------------------------------------------------


def sanitize_check(name: str, text: str) -> None:
    for pattern in FORBIDDEN:
        hit = re.search(pattern, text)
        if hit:
            raise SystemExit(f"{name}: output contains a forbidden pattern ({pattern!r} matched {hit.group(0)!r}); not written")


DATASETS = ("platform", "research", "prospective", "methodology", "roadmap", "analytics")


def next_candidate(name: str) -> Path:
    first = CANDIDATES / f"{name}.json"
    if not first.exists():
        return first
    revision = 2
    while (CANDIDATES / f"{name}.r{revision}.json").exists():
        revision += 1
    return CANDIDATES / f"{name}.r{revision}.json"


def register_pending(name: str, candidate: Path, sha: str, dataset_meta: dict) -> None:
    text = REGISTER.read_text() if REGISTER.exists() else "# Dataset approval register\n"
    if REEXPORTS not in text:
        holdings = "\n## Prospective holdings exports\n"
        section = (REEXPORTS + "\nA re-exported dataset replaces its approved version only after the owner approves it here and runs "
                   "`exporter/publish_dataset.py`, which copies the candidate unchanged; its SHA-256 must match the entry below.\n\n"
                   "| Dataset | Candidate file | Classification | Source commit | SHA-256 | Status |\n|---|---|---|---|---|---|\n")
        text = text.replace(holdings, section + holdings, 1) if holdings in text else text.rstrip("\n") + "\n" + section
    row = (f"| `src/data/{name}.json` | `src/data/candidates/{candidate.name}` | {dataset_meta['classification']} | "
           f"`{dataset_meta['backend_commit']}` | `{sha}` | **Pending owner approval** |")
    lines = text.splitlines()
    header = next(i for i, l in enumerate(lines) if l == REEXPORTS.strip())
    end = header + 1
    while end < len(lines) and not lines[end].startswith("## "):
        end += 1
    while lines[end - 1] == "":
        end -= 1
    lines.insert(end, row)
    REGISTER.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", type=Path, default=DEFAULT_BACKEND)
    parser.add_argument("--only", action="append", choices=DATASETS, help="re-export only these datasets (repeatable)")
    args = parser.parse_args()
    backend = args.backend.resolve()
    commit = git(backend, "rev-parse", "--short", "HEAD")
    dirty = git(backend, "status", "--porcelain", "--", "docs/audits", "data/hypotheses", "configs", "app", "scripts")
    if dirty:
        raise SystemExit(f"the backend's research files differ from commit {commit}; export only from a committed state:\n{dirty}")
    sys.path.insert(0, str(WEB / "exporter"))
    from roadmap_content import ROADMAP

    builders = {
        "platform": lambda: platform(backend, commit),
        "research": lambda: research(backend, commit),
        "prospective": lambda: prospective(backend, commit),
        "methodology": lambda: methodology(backend, commit),
        "roadmap": lambda: {"meta": meta(commit, ["ROADMAP.md", "SPRINT_10_REPORT.md … SPRINT_16_REPORT.md"],
                                         "Development history", "2026-07-28 to 2026-10", "/roadmap",
                                         note="Sprints 1–9 predate version control; their numbering and dates are partly inferred from file dates."),
                            "data": {"sprints": ROADMAP}},
        "analytics": lambda: analytics(backend, commit),
    }
    datasets = {name: builders[name]() for name in (args.only or DATASETS)}
    texts = {name: json.dumps(payload, indent=2, sort_keys=False, default=str) + "\n" for name, payload in datasets.items()}
    for name, text in texts.items():
        sanitize_check(name, text)
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    for name, text in texts.items():
        out = next_candidate(name)
        with out.open("x") as handle:  # never overwrite a candidate
            handle.write(text)
        sha = hashlib.sha256(text.encode()).hexdigest()
        register_pending(name, out, sha, datasets[name]["meta"])
        print(f"candidate src/data/candidates/{out.name} ({len(text) / 1024:.0f} KB, sha256 {sha}): Pending owner approval")
    print(f"backend commit {commit}; generated {GENERATED_AT}")


if __name__ == "__main__":
    main()
