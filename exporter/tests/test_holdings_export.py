"""Tests for the read-only prospective holdings exporter and the owner-run publish step (offline)."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

EXPORTER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPORTER))

import export_holdings as eh  # noqa: E402
import publish_holdings as ph  # noqa: E402

BACKEND = EXPORTER.parents[1] / "alpha-fund"
HAS_BACKEND = (BACKEND / eh.LEDGER).exists()


# --- synthetic decision records ------------------------------------------------------------------


def decision(book: str, weights: dict, adjusted: dict | None = None, book_hash: str = "h", config_hash: str = "c",
             session: str = "2026-10-30", created: str = "2026-11-02T07:37:10+00:00") -> dict:
    return {"record_type": "DECISION", "mode": "PROSPECTIVE", "book": book, "created_at": created, "record_hash": "r" * 64,
            "payload": {"book_hash": book_hash, "config_hash": config_hash, "target_weights": weights,
                        "risk_adjusted_weights_indicative": adjusted if adjusted is not None else dict(weights),
                        "timing": {"signal_session": session, "data_cutoff": "2026-10-30T20:00:00+00:00",
                                   "earliest_execution": "2026-11-02T21:00:00+00:00"}}}


class TestDecisionSelection:
    def test_one_valid_decision_per_book_is_selected(self) -> None:
        records = [decision("a", {"X": 1.0}, book_hash="ha"), decision("b", {"Y": 1.0}, book_hash="hb")]
        chosen = eh.select_decisions(records, "2026-10-30", {"a": "ha", "b": "hb"}, "c")
        assert set(chosen) == {"a", "b"}

    def test_portfolio_hash_mismatch_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="book hash"):
            eh.select_decisions([decision("a", {"X": 1.0}, book_hash="changed")], "2026-10-30", {"a": "ha"}, "c")

    def test_config_hash_mismatch_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="config hash"):
            eh.select_decisions([decision("a", {"X": 1.0}, book_hash="ha", config_hash="other")], "2026-10-30", {"a": "ha"}, "c")

    def test_missing_or_duplicate_decisions_are_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="found 0"):
            eh.select_decisions([], "2026-10-30", {"a": "ha"}, "c")
        two = [decision("a", {"X": 1.0}, book_hash="ha"), decision("a", {"X": 1.0}, book_hash="ha")]
        with pytest.raises(eh.ExportRefused, match="found 2"):
            eh.select_decisions(two, "2026-10-30", {"a": "ha"}, "c")

    def test_backfill_and_other_sessions_are_ignored(self) -> None:
        backfill = decision("a", {"X": 1.0}, book_hash="ha")
        backfill["mode"] = "BACKFILL"
        other = decision("a", {"X": 1.0}, book_hash="ha", session="2026-09-30")
        with pytest.raises(eh.ExportRefused, match="found 0"):
            eh.select_decisions([backfill, other], "2026-10-30", {"a": "ha"}, "c")

    def test_decision_recorded_after_the_deadline_is_refused(self) -> None:
        late = decision("a", {"X": 1.0}, book_hash="ha", created="2026-11-02T21:00:01+00:00")
        with pytest.raises(eh.ExportRefused, match="earliest execution"):
            eh.select_decisions([late], "2026-10-30", {"a": "ha"}, "c")


class TestHoldingsRows:
    def test_weights_are_copied_exactly(self) -> None:
        w = {"AAA": 1 / 106, "BBB": 0.045454545454545456}
        rows = eh.holdings_rows(w, dict(w), {})
        assert [(r["ticker"], r["target_weight"], r["risk_adjusted_weight"]) for r in rows] == [
            ("AAA", 1 / 106, 1 / 106), ("BBB", 0.045454545454545456, 0.045454545454545456)]
        assert all(r["target_weight"] is w[r["ticker"]] for r in rows)  # the same float objects, untouched

    def test_missing_company_names_stay_null(self) -> None:
        names = {"AAA": {"company": "Alpha Corp", "issuer_cik": "0000000001"}}
        rows = eh.holdings_rows({"AAA": 0.5, "BBB": 0.5}, {"AAA": 0.5, "BBB": 0.5}, names)
        assert {r["ticker"]: (r["company"], r["issuer_cik"]) for r in rows} == {"AAA": ("Alpha Corp", "0000000001"), "BBB": (None, None)}

    def test_names_never_change_weights_or_tickers(self) -> None:
        w = {"BRK-B": 0.25, "AAA": 0.75}
        plain = eh.holdings_rows(w, dict(w), {})
        named = eh.holdings_rows(w, dict(w), {"BRK-B": {"company": "Berkshire Hathaway Inc.", "issuer_cik": "0001067983"}})
        strip = lambda rows: [(r["ticker"], r["target_weight"], r["risk_adjusted_weight"]) for r in rows]
        assert strip(plain) == strip(named) and [r["ticker"] for r in named] == ["AAA", "BRK-B"]

    def test_only_verified_or_owner_reviewed_names_are_published(self, tmp_path) -> None:
        mapping = {"meta": {"built_at": "2026-11-02T00:00:00+00:00", "sources": []}, "names": {
            "AAA": {"company": "Alpha Inc.", "issuer_cik": "1", "status": "verified"},
            "BBB": {"company": "Beta Inc.", "issuer_cik": "2", "status": "owner_reviewed"},
            "CCC": {"company": None, "issuer_cik": "3", "status": "needs_review"}}}
        (tmp_path / "names.json").write_text(json.dumps(mapping))
        names, meta = eh.load_names(tmp_path / "names.json")
        assert set(names) == {"AAA", "BBB"}
        info = eh.name_meta(names, meta, {"AAA", "BBB", "CCC"})
        assert info["company_names_unmapped"] == ["CCC"] and "not a historical issuer identity" in info["company_name_basis"]
        assert set(info["company_names_reviewed"]) == {"BBB"} and info["company_names_reviewed"]["BBB"]["basis"] == "owner_reviewed"
        assert eh.load_names(tmp_path / "missing.json") == ({}, None)

    def test_duplicate_tickers_after_normalization_are_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="duplicate"):
            eh.holdings_rows({"AAPL": 0.5, "aapl ": 0.5}, {}, {})

    def test_negative_weight_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="invalid weight"):
            eh.holdings_rows({"AAA": -0.1}, {"AAA": 0.0}, {})

    def test_nan_weight_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="invalid weight"):
            eh.holdings_rows({"AAA": float("nan")}, {"AAA": 0.1}, {})

    def test_zero_rows_are_dropped_but_a_zero_target_with_a_risk_weight_is_kept(self) -> None:
        rows = eh.holdings_rows({"AAA": 0.0, "BBB": 0.0, "CCC": 0.3}, {"AAA": 0.0, "BBB": 0.2, "CCC": 0.3}, {})
        assert [r["ticker"] for r in rows] == ["BBB", "CCC"]

    def test_malformed_ticker_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="malformed"):
            eh.holdings_rows({"/etc/x": 0.1}, {}, {})


class TestCashAccounting:
    def test_cash_is_the_unallocated_remainder_per_view(self) -> None:
        rows = eh.holdings_rows({"A": 0.5, "B": 0.3}, {"A": 0.25, "B": 0.15}, {})
        stocks, cash = eh.allocations("x", rows)
        assert stocks == {"target": 0.8, "risk_adjusted": 0.4}
        assert cash["target"] == pytest.approx(0.2) and cash["risk_adjusted"] == pytest.approx(0.6)

    def test_gross_above_100_percent_is_refused(self) -> None:
        with pytest.raises(eh.ExportRefused, match="above 100%"):
            eh.allocations("x", eh.holdings_rows({"A": 0.7, "B": 0.4}, {"A": 0.7, "B": 0.4}, {}))


class TestExecutedView:
    def obs(self, as_of: str, fills: list) -> dict:
        return {"record_type": "OBSERVATION", "mode": "PROSPECTIVE", "book": "a",
                "payload": {"book_hash": "ha", "as_of_session": as_of, "fills_since_previous": fills}}

    def test_no_fills_means_not_available(self) -> None:
        view = eh.executed_view([self.obs("2026-10-30", [])], "a", "ha", "2026-10-30")
        assert view["status"] == "not_available" and "No simulated fills" in view["note"]

    def test_fills_before_or_at_the_decision_do_not_count(self) -> None:
        view = eh.executed_view([self.obs("2026-10-30", [{"symbol": "X"}])], "a", "ha", "2026-10-30")
        assert view["status"] == "not_available"

    def test_later_fills_are_reported_but_not_published(self) -> None:
        view = eh.executed_view([self.obs("2026-11-02", [{"symbol": "X"}, {"symbol": "Y"}])], "a", "ha", "2026-10-30")
        assert view == {"status": "recorded", "fills": 2, "note": view["note"]} and "not implemented" in view["note"]


class TestSanitization:
    @pytest.mark.parametrize("text", ['{"p": "/Users/someone/x"}', '{"snapshot": "x"}', '{"prev_hash": "0"}', '{"e": "a@b.com"}'])
    def test_forbidden_content_is_refused(self, text) -> None:
        with pytest.raises(eh.ExportRefused, match="forbidden"):
            eh.sanitize_check(text)

    def test_clean_text_passes(self) -> None:
        eh.sanitize_check(json.dumps({"ticker": "AAPL", "target_weight": 0.01}))


# --- anchoring: temporary git repositories with a local bare "remote" -----------------------------


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture()
def repo(tmp_path):
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    _git(tmp_path, "clone", "-q", str(remote), str(work))
    (work / "data/prospective").mkdir(parents=True)
    (work / "configs").mkdir()
    (work / eh.LEDGER).write_text('{"record": 1}\n')
    (work / "configs/prospective.yaml").write_text("x: 1\n")
    _git(work, "add", ".")
    _git(work, "commit", "-q", "-m", "ledger")
    _git(work, "push", "-q", "origin", "main")
    return work


class TestAnchoring:
    def test_committed_and_pushed_ledger_is_anchored(self, repo) -> None:
        result = eh.check_anchored(repo)
        assert len(result["remote_head"]) == 40 and result["ledger_commit"] == result["remote_head"]

    def test_uncommitted_ledger_change_is_refused(self, repo) -> None:
        (repo / eh.LEDGER).write_text('{"record": 1}\n{"record": 2}\n')
        with pytest.raises(eh.ExportRefused, match="differs from the last commit"):
            eh.check_anchored(repo)

    def test_committed_but_not_pushed_is_refused(self, repo) -> None:
        (repo / eh.LEDGER).write_text('{"record": 1}\n{"record": 2}\n')
        _git(repo, "commit", "-q", "-am", "new record")
        with pytest.raises(eh.ExportRefused, match="not \\(yet\\) externally anchored"):
            eh.check_anchored(repo)

    def test_unreachable_remote_is_refused(self, repo) -> None:
        _git(repo, "remote", "set-url", "origin", str(repo.parent / "missing.git"))
        with pytest.raises(eh.ExportRefused):
            eh.check_anchored(repo)


# --- the real October 30 decisions (read-only; skipped without the research repository) -----------


@pytest.fixture(scope="module")
def exported():
    return eh.build_export(BACKEND, "2026-10-30", anchoring={"remote_head": "0" * 40, "ledger_commit": "0" * 40})


@pytest.mark.skipif(not HAS_BACKEND, reason="research repository not present")
class TestRealExport:

    def test_every_weight_equals_the_recorded_decision(self, exported) -> None:
        records = [json.loads(l) for l in (BACKEND / eh.LEDGER).read_text().splitlines() if l.strip()]
        decisions = {r["book"]: r["payload"] for r in records if r["record_type"] == "DECISION"
                     and r["payload"]["timing"]["signal_session"] == "2026-10-30"}
        for p in exported["data"]["portfolios"]:
            recorded = decisions[p["id"]]
            assert {r["ticker"]: r["target_weight"] for r in p["holdings"]} == recorded["target_weights"]
            assert {r["ticker"]: r["risk_adjusted_weight"] for r in p["holdings"]} == recorded["risk_adjusted_weights_indicative"]
            assert p["book_hash"] == recorded["book_hash"]

    def test_four_frozen_portfolios_with_hashes_and_classification(self, exported) -> None:
        assert [p["id"] for p in exported["data"]["portfolios"]] == [
            "equal_weight", "equal_weight_adaptive", "momentum_12_1", "momentum_12_1_adaptive"]
        assert exported["meta"]["config_sha256"].startswith("d7134a1a")
        assert exported["meta"]["classification"].startswith("PROSPECTIVE")
        assert all(p["executed"]["status"] == "not_available" for p in exported["data"]["portfolios"])

    def test_public_fields_only(self, exported) -> None:
        text = json.dumps(exported)
        eh.sanitize_check(text)
        names = {"company_name_basis", "company_name_sources", "company_names_unmapped"} if eh.NAMES_FILE.exists() else set()
        if "company_names_reviewed" in exported["meta"]:
            names.add("company_names_reviewed")
        assert set(exported["meta"]) == {"source_report", "generated_at", "classification", "period", "methodology_ref", "backend_commit",
                                         "ledger_head_hash", "anchored_at_remote_head", "config_sha256", "decision_code_commit",
                                         "company_names"} | names
        for p in exported["data"]["portfolios"]:
            assert set(p) == {"id", "label", "version", "overlay", "book_hash", "decision_record_hash", "risk_state",
                              "permitted_exposure", "holdings", "stock_allocation", "cash_allocation", "executed"}
            assert all(set(r) == {"ticker", "company", "issuer_cik", "target_weight", "risk_adjusted_weight"} for r in p["holdings"])
        for forbidden in ("fingerprint", "event_id", "git", "dirty", "positions", "fills_since_previous", "downloaded_at"):
            assert f'"{forbidden}"' not in text


# --- the publish step ------------------------------------------------------------------------------


@pytest.fixture()
def staged(tmp_path, monkeypatch):
    candidates, register = tmp_path / "holdings" / "candidates", tmp_path / "APPROVAL.md"
    candidates.mkdir(parents=True)
    text = '{"meta": {}, "data": {}}\n'
    (candidates / "2026-10-30.json").write_text(text)
    (candidates / "2026-10-30.r2.json").write_text(text.replace("{}}", '{"r": 2}}'))
    sha = hashlib.sha256(text.encode()).hexdigest()
    sha2 = hashlib.sha256((candidates / "2026-10-30.r2.json").read_bytes()).hexdigest()
    register.write_text(f"| 2026-10-30 | `src/data/holdings/candidates/2026-10-30.json` | `h` | `c9f1797` | `{sha}` | **Pending owner approval** |\n"
                        f"| 2026-10-30 | `src/data/holdings/candidates/2026-10-30.r2.json` | `h` | `c9f1797` | `{sha2}` | **Pending owner approval** |\n")
    monkeypatch.setattr(ph, "CANDIDATES", candidates)
    monkeypatch.setattr(ph, "PUBLISHED", candidates.parent)
    monkeypatch.setattr(ph, "REGISTER", register)
    monkeypatch.setattr(ph, "check_anchored", lambda backend: {"remote_head": "x", "ledger_commit": "x"})
    return candidates, register, text


class TestPublish:
    def test_publish_copies_unchanged_and_records_the_approval(self, staged, tmp_path) -> None:
        candidates, register, text = staged
        target = ph.publish("2026-10-30.json", "Project owner", tmp_path, today=date(2026, 11, 3))
        assert target.name == "2026-10-30.json" and target.read_text() == text
        lines = register.read_text().splitlines()
        assert "**Approved (Project owner, 2026-11-03)**" in lines[0] and "Pending" not in register.read_text()
        assert "Not published (2026-10-30 was published from 2026-10-30.json, 2026-11-03)" in lines[1]

    def test_a_specific_revision_is_published_unchanged(self, staged, tmp_path) -> None:
        candidates, register, _ = staged
        target = ph.publish("2026-10-30.r2.json", "Project owner", tmp_path, today=date(2026, 11, 3))
        assert target.name == "2026-10-30.json" and target.read_bytes() == (candidates / "2026-10-30.r2.json").read_bytes()
        assert "**Approved" in register.read_text().splitlines()[1]

    def test_superseded_revision_cannot_be_published(self, staged, tmp_path) -> None:
        candidates, register, _ = staged
        register.write_text(register.read_text().replace("**Pending owner approval**", "Superseded (project owner, 2026-11-02); not to be published", 1))
        with pytest.raises(eh.ExportRefused, match="no Pending register entry"):
            ph.publish("2026-10-30.json", "Project owner", tmp_path)
        assert not (candidates.parent / "2026-10-30.json").exists()

    def test_bad_candidate_name_is_refused(self, staged, tmp_path) -> None:
        with pytest.raises(eh.ExportRefused, match="not a candidate file name"):
            ph.publish("../2026-10-30.json", "Project owner", tmp_path)

    def test_changed_candidate_is_refused(self, staged, tmp_path) -> None:
        candidates, _, _ = staged
        (candidates / "2026-10-30.json").write_text('{"meta": {}, "data": {"edited": true}}\n')
        with pytest.raises(eh.ExportRefused, match="changed after export"):
            ph.publish("2026-10-30.json", "Project owner", tmp_path)

    def test_no_approver_or_no_pending_entry_is_refused(self, staged, tmp_path) -> None:
        with pytest.raises(eh.ExportRefused, match="approver"):
            ph.publish("2026-10-30.json", " ", tmp_path)
        with pytest.raises(eh.ExportRefused, match="no candidate|no Pending"):
            ph.publish("2026-11-30.json", "Project owner", tmp_path)

    def test_already_published_session_is_refused(self, staged, tmp_path) -> None:
        ph.publish("2026-10-30.json", "Project owner", tmp_path)
        with pytest.raises(eh.ExportRefused, match="already published"):
            ph.publish("2026-10-30.r2.json", "Project owner", tmp_path)


class TestCandidateRevisions:
    def test_existing_candidates_are_never_overwritten(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(eh, "CANDIDATES", tmp_path)
        assert eh.next_candidate("2026-10-30").name == "2026-10-30.json"
        (tmp_path / "2026-10-30.json").write_text("reviewed")
        assert eh.next_candidate("2026-10-30").name == "2026-10-30.r2.json"
        (tmp_path / "2026-10-30.r2.json").write_text("x")
        assert eh.next_candidate("2026-10-30").name == "2026-10-30.r3.json"
        assert (tmp_path / "2026-10-30.json").read_text() == "reviewed"

    def test_register_keeps_earlier_revisions(self, tmp_path, monkeypatch) -> None:
        register = tmp_path / "APPROVAL.md"
        monkeypatch.setattr(eh, "REGISTER", register)
        export = {"meta": {"ledger_head_hash": "f" * 64, "backend_commit": "c9f1797"}, "data": {"decision_session": "2026-10-30"}}
        eh.register_pending(tmp_path / "2026-10-30.json", "a" * 64, export)
        eh.register_pending(tmp_path / "2026-10-30.r2.json", "b" * 64, export)
        rows = [l for l in register.read_text().splitlines() if l.startswith("| 2026-10-30 |")]
        assert len(rows) == 2 and "a" * 64 in rows[0] and "candidates/2026-10-30.r2.json" in rows[1]
        assert all("**Pending owner approval**" in r for r in rows)
