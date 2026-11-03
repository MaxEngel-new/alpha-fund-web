"""Exports one month's PROSPECTIVE holdings decisions as a sanitized candidate for owner approval (read-only).

    python3 exporter/export_holdings.py --session 2026-10-30 [--backend ../alpha-fund]

Writes a NEW candidate file (git-ignored, never published) and appends a Pending entry to the private
approval register: ``src/data/holdings/candidates/<session>.json`` for the first export of a session,
then ``<session>.r2.json``, ``<session>.r3.json`` ... An existing candidate is never overwritten, so a
reviewed file cannot change silently; each revision has its own SHA-256 and needs its own approval. Publication is a separate, explicit owner step:
``exporter/publish_holdings.py``. Nothing is ever published automatically, and every month needs its
own approval.

Refuses to export unless ALL of these hold:
* the prospective ledger in the working tree is byte-identical to the committed version, and the
  commit containing it is the head of the GitHub remote (externally anchored; checked read-only
  with ``git ls-remote``);
* the ledger's hash chain verifies (the research repository's own integrity code);
* exactly one PROSPECTIVE DECISION per frozen portfolio exists for the session, its book and config
  hashes equal the frozen definitions, and its timing proves it was recorded after the data cutoff
  and before the earliest execution;
* weights are non-negative, tickers are well formed and unique, and gross exposure is at most 100%.

Weights are copied exactly as recorded; nothing is recomputed, rounded or substituted. Simulated
fills are included only if OBSERVATION records after the decision contain them. Company names come only
from ``exporter/company_names.json`` (built by build_company_names.py from public listings) and only where
an entry is verified or owner-reviewed; otherwise they are null and the site shows the ticker. Names are
the issuers listed on the mapping's retrieval date, not historical issuer identities. No raw ledger records, paths, git working-tree details or snapshot references are exported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
DEFAULT_BACKEND = WEB.parent / "alpha-fund"
CANDIDATES = WEB / "src" / "data" / "holdings" / "candidates"
REGISTER = WEB / "exporter" / "APPROVAL.md"
NAMES_FILE = WEB / "exporter" / "company_names.json"  # optional (build_company_names.py); absent = tickers only
PUBLISHABLE_NAME_STATUS = ("verified", "owner_reviewed", "issuer_verified")
LEDGER = "data/prospective/ledger.jsonl"
CLASSIFICATION = "PROSPECTIVE — hypothetical research decisions, not real-money positions"
LABELS = {"equal_weight": "Equal Weight", "equal_weight_adaptive": "Equal Weight + Adaptive Risk",
          "momentum_12_1": "12-1 Momentum", "momentum_12_1_adaptive": "12-1 Momentum + Adaptive Risk"}
TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
FORBIDDEN = [r"/Users/", r"/private/", r"/var/folders", r"/home/", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|org|net|io)",
             r"(?i)api[_-]?key", r"(?i)passw", r"AKIA[0-9A-Z]{12}", r"BEGIN (RSA|OPENSSH|PRIVATE)", r"snapshot", r"prev_hash"]


class ExportRefused(Exception):
    pass


def git(backend: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(backend), *args], capture_output=True, text=True, timeout=60)
    if check and result.returncode != 0:
        raise ExportRefused(f"git {' '.join(args)} failed: {result.stderr.strip()[:200]}")
    return result.stdout


def check_anchored(backend: Path) -> dict[str, str]:
    """The ledger must be committed, unchanged in the working tree, and identical at the GitHub remote's head."""
    if git(backend, "status", "--porcelain", "--", LEDGER, "configs/prospective.yaml").strip():
        raise ExportRefused("the prospective ledger or config differs from the last commit: commit (and push) it first")
    remote = git(backend, "ls-remote", "origin", "refs/heads/main").split()
    if not remote:
        raise ExportRefused("cannot read the remote head (offline?): the ledger's external anchoring cannot be confirmed")
    remote_sha = remote[0]
    if git(backend, "cat-file", "-t", remote_sha, check=False).strip() != "commit":
        raise ExportRefused(f"remote head {remote_sha[:12]} is not in the local history: fetch and compare before exporting")
    local = (backend / LEDGER).read_text()
    anchored = git(backend, "show", f"{remote_sha}:{LEDGER}", check=False)
    if anchored != local:
        raise ExportRefused("the ledger at the remote head differs from the local ledger: the decisions are not (yet) externally anchored")
    ledger_commit = git(backend, "log", "-1", "--format=%H", remote_sha, "--", LEDGER).strip()
    return {"remote_head": remote_sha, "ledger_commit": ledger_commit}


def load_backend(backend: Path):
    sys.path.insert(0, str(backend))
    from app.utils.logger import logger

    logger.remove()  # nothing is written inside the research repository
    from app.prospective.config import ProspectiveConfig
    from app.prospective.integrity import verify_lines

    return ProspectiveConfig, verify_lines


def select_decisions(records: list[dict], session: str, book_hashes: dict[str, str], config_hash: str) -> dict[str, dict]:
    """Exactly one valid PROSPECTIVE decision per frozen book for ``session``; raises ExportRefused otherwise."""
    found: dict[str, list[dict]] = {name: [] for name in book_hashes}
    for record in records:
        if record.get("record_type") != "DECISION" or record.get("mode") != "PROSPECTIVE":
            continue
        if record["payload"].get("timing", {}).get("signal_session") != session:
            continue
        if record["book"] not in found:
            raise ExportRefused(f"decision for an unknown book {record['book']!r}")
        found[record["book"]].append(record)
    for book, items in found.items():
        if len(items) != 1:
            raise ExportRefused(f"{book}: expected exactly one PROSPECTIVE decision for {session}, found {len(items)}")
        payload = items[0]["payload"]
        if payload.get("book_hash") != book_hashes[book]:
            raise ExportRefused(f"{book}: recorded book hash differs from the frozen definition")
        if payload.get("config_hash") != config_hash:
            raise ExportRefused(f"{book}: recorded config hash differs from configs/prospective.yaml")
        timing = payload["timing"]
        cutoff, created, earliest = (datetime.fromisoformat(timing["data_cutoff"]), datetime.fromisoformat(items[0]["created_at"]),
                                     datetime.fromisoformat(timing["earliest_execution"]))
        if not cutoff < created < earliest:
            raise ExportRefused(f"{book}: not recorded between the data cutoff and the earliest execution")
    return {book: items[0] for book, items in found.items()}


def load_names(path: Path) -> tuple[dict[str, dict], dict | None]:
    """Publishable names (verified or owner-reviewed) and the mapping's provenance; ({}, None) without a mapping."""
    if not path.exists():
        return {}, None
    mapping = json.loads(path.read_text())
    names = {t: {"company": e["company"], "issuer_cik": e["issuer_cik"], "status": e["status"], "verification": e.get("verification")}
             for t, e in mapping["names"].items() if e["status"] in PUBLISHABLE_NAME_STATUS and e["company"]}
    return names, mapping["meta"]


def name_meta(names: dict[str, dict], mapping_meta: dict | None, tickers: set[str]) -> dict:
    if mapping_meta is None:
        return {"company_names": "not mapped: tickers only"}
    unmapped = sorted(t for t in tickers if t not in names)
    built = mapping_meta["built_at"][:10]
    reviewed = {t: names[t] for t in sorted(tickers) if t in names and names[t]["status"] != "verified"}
    listed = len(tickers) - len(unmapped) - len(reviewed)
    summary = (f"{listed} of {len(tickers)} tickers named from public exchange listings retrieved {built}, cross-checked against an "
               f"independent list")
    if reviewed:
        summary += f"; {len(reviewed)} ({', '.join(reviewed)}) from the issuers' SEC filings and own sources, after review"
    summary += f"; {len(unmapped)} shown as tickers pending review"
    return {
        "company_names": summary,
        "company_name_basis": "Issuer listed under each ticker on the retrieval date; not a historical issuer identity.",
        "company_name_sources": [{k: s[k] for k in ("name", "url", "sha256", "revision") if k in s} for s in mapping_meta["sources"]],
        "company_names_unmapped": unmapped,
        **({"company_names_reviewed": {t: {"company": e["company"], "basis": e["status"], **(e["verification"] or {})} for t, e in reviewed.items()}}
           if reviewed else {}),
    }


def holdings_rows(weights: dict[str, float], adjusted: dict[str, float], names: dict[str, dict]) -> list[dict]:
    """Exact recorded weights per ticker; validates sign, format and uniqueness."""
    tickers = set(weights) | set(adjusted)
    normalized = [t.strip().upper() for t in tickers]
    if len(set(normalized)) != len(normalized):
        raise ExportRefused("duplicate tickers after normalization")
    rows = []
    for ticker in sorted(tickers):
        if not TICKER.match(ticker):
            raise ExportRefused(f"malformed ticker {ticker!r}")
        target, risk = weights.get(ticker, 0.0), adjusted.get(ticker, 0.0)
        for value in (target, risk):
            if not isinstance(value, (int, float)) or value != value or value < 0:
                raise ExportRefused(f"{ticker}: invalid weight {value!r} (a cash-only book holds no negative weights)")
        if target == 0 and risk == 0:
            continue
        name = names.get(ticker) or {}
        rows.append({"ticker": ticker, "company": name.get("company"), "issuer_cik": name.get("issuer_cik"),
                     "target_weight": target, "risk_adjusted_weight": risk})
    return rows


def allocations(book: str, rows: list[dict]) -> tuple[dict, dict]:
    """Stock and cash allocation per view; cash is what the recorded weights leave unallocated."""
    stocks = {"target": sum(r["target_weight"] for r in rows), "risk_adjusted": sum(r["risk_adjusted_weight"] for r in rows)}
    if any(v > 1 + 1e-9 for v in stocks.values()):
        raise ExportRefused(f"{book}: gross weight above 100% in a cash-only book")
    return stocks, {k: max(0.0, 1.0 - v) for k, v in stocks.items()}


def executed_view(records: list[dict], book: str, book_hash: str, session: str) -> dict:
    """Simulated fills recorded in OBSERVATIONs after the decision session, if any (never recomputed)."""
    fills = []
    for record in records:
        payload = record["payload"]
        if (record.get("record_type") == "OBSERVATION" and record.get("mode") == "PROSPECTIVE" and record["book"] == book
                and payload.get("book_hash") == book_hash and payload.get("as_of_session", "") > session):
            fills += payload.get("fills_since_previous", [])
    if not fills:
        return {"status": "not_available",
                "note": "No simulated fills have been recorded yet. Target weights are decisions; fills appear only in a later recording."}
    return {"status": "recorded", "fills": len(fills),
            "note": "Simulated fills exist but publishing them needs a reviewed export step (not implemented)."}


def build_export(backend: Path, session: str, anchoring: dict[str, str] | None = None) -> dict:
    anchoring = anchoring or check_anchored(backend)
    ProspectiveConfig, verify_lines = load_backend(backend)
    lines = [line for line in (backend / LEDGER).read_text().splitlines() if line.strip()]
    report = verify_lines(lines)
    if not report.ok:
        raise ExportRefused(f"ledger integrity check failed: {report.problems[:3]}")
    records = [json.loads(line) for line in lines]
    config, config_hash = ProspectiveConfig.load(backend / "configs/prospective.yaml")
    book_hashes = {b.name: config.book_hash(b) for b in config.books}
    decisions = select_decisions(records, session, book_hashes, config_hash)
    names, mapping_meta = load_names(NAMES_FILE)
    first = next(iter(decisions.values()))
    timing = first["payload"]["timing"]
    portfolios = []
    for book in config.books:
        record = decisions[book.name]
        payload = record["payload"]
        rows = holdings_rows(payload["target_weights"], payload["risk_adjusted_weights_indicative"], names)
        stocks, cash = allocations(book.name, rows)
        portfolios.append({
            "id": book.name, "label": LABELS.get(book.name, book.name), "version": book.version, "overlay": book.overlay,
            "book_hash": book_hashes[book.name], "decision_record_hash": record["record_hash"],
            "risk_state": payload["risk_state"], "permitted_exposure": payload["permitted_exposure"],
            "holdings": rows,
            "stock_allocation": stocks,
            "cash_allocation": cash,
            "executed": executed_view(records, book.name, book_hashes[book.name], session),
        })
    head = records[-1]["record_hash"]
    tickers = {r["ticker"] for p in portfolios for r in p["holdings"]}
    exclusions = first["payload"]["data"].get("excluded", {})
    return {
        "meta": {
            "source_report": ["data/prospective/ledger.jsonl (PROSPECTIVE DECISION records)", "configs/prospective.yaml"],
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "classification": CLASSIFICATION,
            "period": f"decision session {session}",
            "methodology_ref": "/methodology#prospective",
            "backend_commit": anchoring["ledger_commit"][:7],
            "ledger_head_hash": head,
            "anchored_at_remote_head": anchoring["remote_head"][:7],
            "config_sha256": config_hash,
            "decision_code_commit": (first["payload"].get("git") or {}).get("commit"),
            **name_meta(names, mapping_meta, tickers),
        },
        "data": {
            "decision_session": session,
            "recorded_at": first["created_at"],
            "data_cutoff": timing["data_cutoff"],
            "intended_execution": timing["earliest_execution"],
            "intended_execution_date": timing["earliest_execution"][:10],
            "execution_rule": "close of the first trading session after the decision session",
            "universe_exclusions": exclusions,
            "portfolios": portfolios,
        },
    }


def sanitize_check(text: str) -> None:
    for pattern in FORBIDDEN:
        hit = re.search(pattern, text)
        if hit:
            raise ExportRefused(f"output contains a forbidden pattern ({pattern!r} matched {hit.group(0)!r})")


def next_candidate(session: str) -> Path:
    """The first unused candidate path for a session: <session>.json, then <session>.r2.json, ..."""
    first = CANDIDATES / f"{session}.json"
    if not first.exists():
        return first
    revision = 2
    while (CANDIDATES / f"{session}.r{revision}.json").exists():
        revision += 1
    return CANDIDATES / f"{session}.r{revision}.json"


def register_pending(candidate: Path, sha: str, export: dict) -> None:
    text = REGISTER.read_text() if REGISTER.exists() else "# Dataset approval register\n"
    marker = "\n## Prospective holdings exports\n"
    if marker not in text:
        text = text.rstrip("\n") + "\n" + marker + (
            "\nEach monthly holdings export needs its own explicit owner approval before `exporter/publish_holdings.py` "
            "may publish it. Publishing copies the candidate unchanged; its SHA-256 must match the entry below.\n\n"
            "| Session | Candidate file | Ledger head | Source commit | SHA-256 | Status |\n|---|---|---|---|---|---|\n")
    session = export["data"]["decision_session"]
    row = (f"| {session} | `src/data/holdings/candidates/{candidate.name}` | `{export['meta']['ledger_head_hash'][:16]}…` | "
           f"`{export['meta']['backend_commit']}` | `{sha}` | **Pending owner approval** |")
    REGISTER.write_text(text.rstrip("\n") + "\n" + row + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, help="decision session to export, e.g. 2026-10-30")
    parser.add_argument("--backend", type=Path, default=DEFAULT_BACKEND)
    args = parser.parse_args()
    try:
        export = build_export(args.backend.resolve(), args.session)
        text = json.dumps(export, indent=2) + "\n"
        sanitize_check(text)
    except ExportRefused as exc:
        raise SystemExit(f"EXPORT REFUSED: {exc}")
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    out = next_candidate(args.session)
    with out.open("x") as handle:  # never overwrite a candidate
        handle.write(text)
    sha = hashlib.sha256(text.encode()).hexdigest()
    register_pending(out, sha, export)
    print(f"candidate written: src/data/holdings/candidates/{out.name} (sha256 {sha}); register entry: Pending owner approval")


if __name__ == "__main__":
    main()
