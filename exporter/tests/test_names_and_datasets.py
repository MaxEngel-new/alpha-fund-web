"""Tests for the company-name mapping, the prospective dataset re-export and the dataset publish step (offline)."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import pytest

EXPORTER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPORTER))

import build_company_names as bn  # noqa: E402
import export_data as ed  # noqa: E402
import export_holdings as eh  # noqa: E402
import publish_dataset as pd_  # noqa: E402

BACKEND = EXPORTER.parents[1] / "alpha-fund"
HAS_BACKEND = (BACKEND / eh.LEDGER).exists()

NASDAQ = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
ZZZT|Test Corp - Common Stock|Q|Y|N|100|N|N
File Creation Time: 1102202614:01|||||||
"""
OTHER = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. New Common Stock|N|BRK.B|N|40|N|BRK.B
AMT|American Tower Corporation (REIT) Common Stock|N|AMT|N|100|N|AMT
KO|Coca-Cola Company (The) Common Stock|N|KO|N|100|N|KO
V|Visa Inc.|N|V|N|100|N|V
SLB|SLB Limited Common Shares|N|SLB|N|100|N|SLB
ODD|Odd Thing Units|N|ODD|N|100|N|ODD
File Creation Time: 1102202614:01||||||
"""
REFERENCE = {
    "AAPL": {"security": "Apple Inc.", "cik": "0000320193", "founded": "1977"},
    "BRK.B": {"security": "Berkshire Hathaway", "cik": "0001067983", "founded": "1839"},
    "AMT": {"security": "American Tower", "cik": "0001053507", "founded": "1995"},
    "KO": {"security": "Coca-Cola Company (The)", "cik": "0000021344", "founded": "1886"},
    "V": {"security": "Visa Inc.", "cik": "0001403161", "founded": "1958"},
    "SLB": {"security": "Schlumberger", "cik": "0000087347", "founded": "1926"},
    "ODD": {"security": "Odd Thing", "cik": "0000000009", "founded": "2015 (1869)"},
}


@pytest.fixture()
def listings():
    return bn.parse_listings(NASDAQ, OTHER)


class TestIssuerNames:
    @pytest.mark.parametrize("listing,expected", [
        ("Apple Inc. - Common Stock", "Apple Inc."),
        ("Berkshire Hathaway Inc. New Common Stock", "Berkshire Hathaway Inc."),
        ("Alphabet Inc. - Class A Common Stock", "Alphabet Inc."),
        ("American Tower Corporation (REIT) Common Stock", "American Tower Corporation"),
        ("Coca-Cola Company (The) Common Stock", "The Coca-Cola Company"),
        ("Medtronic plc. Ordinary Shares", "Medtronic plc."),
        ("Visa Inc.", "Visa Inc."),
        ("Odd Thing Units", None),
    ])
    def test_security_description_is_removed_or_not_recognized(self, listing, expected) -> None:
        assert bn.issuer_name(listing) == expected

    def test_names_must_agree_on_distinctive_words(self) -> None:
        assert bn.names_agree("The Coca-Cola Company", "Coca-Cola Company (The)")
        assert bn.names_agree("Berkshire Hathaway Inc.", "Berkshire Hathaway")
        assert not bn.names_agree("SLB Limited", "Schlumberger")
        assert not bn.names_agree("Honeywell International Inc.", "Honeywell Technologies")


class TestMapping:
    def test_verified_when_listing_and_reference_agree(self, listings) -> None:
        e = bn.map_ticker("AAPL", listings, REFERENCE)
        assert (e["status"], e["company"], e["issuer_cik"], e["exchange"]) == ("verified", "Apple Inc.", "0000320193", "NASDAQ")

    def test_ticker_is_kept_and_only_the_class_separator_is_translated(self, listings) -> None:
        e = bn.map_ticker("BRK-B", listings, REFERENCE)
        assert e["exchange_symbol"] == "BRK.B" and e["company"] == "Berkshire Hathaway Inc." and e["status"] == "verified"

    @pytest.mark.parametrize("ticker,reason", [
        ("SLB", "do not agree"),
        ("ODD", "not recognized"),
        ("ZZZT", "test issue"),
        ("NOPE", "not in the exchange symbol directory"),
    ])
    def test_uncertain_mappings_are_flagged_and_unnamed(self, listings, ticker, reason) -> None:
        e = bn.map_ticker(ticker, listings, REFERENCE)
        assert e["status"] == "needs_review" and e["company"] is None and reason in e["review_reason"]

    def test_no_independent_reference_is_flagged(self, listings) -> None:
        e = bn.map_ticker("AAPL", listings, {})
        assert e["status"] == "needs_review" and "no independent source" in e["review_reason"]

    def test_successor_entity_is_informational_only(self, listings) -> None:
        reference = dict(REFERENCE, V={**REFERENCE["V"], "founded": "2015 (1958)"})
        e = bn.map_ticker("V", listings, reference)
        assert e["successor_entity"] is True and e["status"] == "verified"

    def test_owner_overrides_resolve_only_flagged_tickers_with_evidence(self, listings) -> None:
        names = {t: bn.map_ticker(t, listings, REFERENCE) for t in ("AAPL", "SLB")}
        with pytest.raises(SystemExit, match="only tickers flagged"):
            bn.apply_overrides(names, {"AAPL": {"company": "X", "reviewed_by": "o", "evidence": "e"}})
        with pytest.raises(SystemExit, match="all required"):
            bn.apply_overrides(names, {"SLB": {"company": "SLB Limited"}})
        bn.apply_overrides(names, {"SLB": {"company": "SLB Limited", "reviewed_by": "Owner", "evidence": "SEC filing"}})
        assert names["SLB"]["status"] == "owner_reviewed" and names["SLB"]["company"] == "SLB Limited"

    def test_issuer_verified_overrides_need_sources_date_and_the_same_cik(self, listings) -> None:
        base = {"company": "SLB N.V. (SLB Limited)", "status": "issuer_verified", "reviewed_by": "r", "evidence": "10-K cover",
                "reviewed_on": "2026-11-02", "issuer_cik": "0000087347", "ambiguity": "formerly Schlumberger",
                "sources": [{"name": "SEC 10-K", "url": "https://www.sec.gov/x"}]}
        def fresh():
            return {"SLB": bn.map_ticker("SLB", listings, REFERENCE)}
        for broken, reason in (({"sources": []}, "sources"), ({"sources": [{"name": "x", "url": "http://insecure"}]}, "https URL"),
                               ({"reviewed_on": ""}, "reviewed_on"), ({"issuer_cik": "0000000001"}, "differs from the reference"),
                               ({"status": "guessed"}, "unknown status")):
            with pytest.raises(SystemExit, match=reason):
                bn.apply_overrides(fresh(), {"SLB": {**base, **broken}})
        names = fresh()
        bn.apply_overrides(names, {"SLB": base})
        e = names["SLB"]
        assert (e["status"], e["company"], e["issuer_cik"]) == ("issuer_verified", "SLB N.V. (SLB Limited)", "0000087347")
        assert e["verification"]["ambiguity"] == "formerly Schlumberger" and e["verification"]["sources"][0]["url"] == "https://www.sec.gov/x"

    def test_build_records_source_hashes(self, tmp_path) -> None:
        (tmp_path / "nasdaqlisted.txt").write_text(NASDAQ)
        (tmp_path / "otherlisted.txt").write_text(OTHER)
        rows = "".join(f"<tr><td>{s}</td><td>{r['security']}</td><td>{int(r['cik'])}</td><td>{r['founded']}</td></tr>" for s, r in REFERENCE.items())
        (tmp_path / "sp500_wikipedia.html").write_text(
            f'<table id="constituents"><tr><th>Symbol</th><th>Security</th><th>CIK</th><th>Founded</th></tr>{rows}</table>')
        mapping = bn.build(["AAPL", "BRK-B", "SLB"], tmp_path, "123")
        assert mapping["meta"]["verified"] == 2 and mapping["meta"]["needs_review"] == ["SLB"]
        assert mapping["meta"]["sources"][0]["sha256"] == hashlib.sha256(NASDAQ.encode()).hexdigest()
        assert mapping["meta"]["sources"][2]["revision"] == "123" and "oldid=123" in mapping["meta"]["sources"][2]["url"]


@pytest.mark.skipif(not bn.OUT.exists(), reason="no company-name mapping built")
def test_the_built_mapping_keeps_tickers_and_flags_review_items() -> None:
    mapping = json.loads(bn.OUT.read_text())
    for ticker, e in mapping["names"].items():
        assert e["exchange_symbol"] == ticker.replace("-", ".")
        assert (e["status"] in ("verified", "owner_reviewed", "issuer_verified")) == (e["company"] is not None)
        if e["status"] == "issuer_verified":
            assert e["verification"]["sources"] and e["verification"]["reviewed_on"] and e["issuer_cik"]
        assert e["status"] != "needs_review" or e["review_reason"]
    assert mapping["meta"]["needs_review"] == sorted(t for t, e in mapping["names"].items() if e["status"] == "needs_review")


# --- the prospective dataset (counts only, verified and anchored) ----------------------------------


@pytest.mark.skipif(not HAS_BACKEND, reason="research repository not present")
class TestProspectiveSummary:
    @pytest.fixture()
    def summary(self, monkeypatch):
        monkeypatch.setattr(eh, "check_anchored", lambda backend: {"remote_head": "c9f1797" + "0" * 33, "ledger_commit": "x"})
        lines = [l for l in (BACKEND / eh.LEDGER).read_text().splitlines() if l.strip()]
        ProspectiveConfig, _ = eh.load_backend(BACKEND)
        _, config_hash = ProspectiveConfig.load(BACKEND / "configs/prospective.yaml")
        return ed.ledger_summary(BACKEND, lines, config_hash), len(lines)

    def test_decisions_events_fills_and_performance_are_distinguished(self, summary) -> None:
        s, n = summary
        assert s["ledger_events"] == n == s["decisions"] + s["observations"] + s["other_events"]
        assert s["decisions"] == 4 * len(s["decision_sessions"])
        assert s["simulated_fills"] == 0 and s["observations_with_simulated_holdings"] == 0 and s["performance"] == "not_available"
        assert "not a trade" in s["explanation"] and "Investment performance: none yet" in s["explanation"]

    def test_only_counts_are_exported(self, summary) -> None:
        s, _ = summary
        text = json.dumps(s)
        for forbidden in ("payload", "target_weights", "prev_hash", "event_id", "snapshot", "fingerprint", "git"):
            assert forbidden not in text

    def test_unanchored_ledger_is_refused(self, monkeypatch) -> None:
        def refuse(backend):
            raise eh.ExportRefused("not pushed")
        monkeypatch.setattr(eh, "check_anchored", refuse)
        with pytest.raises(SystemExit, match="not externally anchored"):
            ed.ledger_summary(BACKEND, ["{}"], "c")


# --- the dataset publish step ------------------------------------------------------------------------


@pytest.fixture()
def dataset_staged(tmp_path, monkeypatch):
    out, candidates, register = tmp_path / "data", tmp_path / "data" / "candidates", tmp_path / "APPROVAL.md"
    candidates.mkdir(parents=True)
    (out / "prospective.json").write_text('{"old": true}\n')
    text = '{"new": true}\n'
    (candidates / "prospective.json").write_text(text)
    sha = hashlib.sha256(text.encode()).hexdigest()
    register.write_text(
        "| `src/data/prospective.json` | PROSPECTIVE | p | s | `04923fa07f80983e…` | **Approved (project owner, 2026-10-26)** |\n"
        f"| `src/data/prospective.json` | `src/data/candidates/prospective.json` | c | `c9f1797` | `{sha}` | **Pending owner approval** |\n")
    monkeypatch.setattr(pd_, "OUT", out)
    monkeypatch.setattr(pd_, "CANDIDATES", candidates)
    monkeypatch.setattr(pd_, "REGISTER", register)
    return out, candidates, register, text


class TestPublishDataset:
    def test_publish_copies_unchanged_and_supersedes_the_old_approval(self, dataset_staged) -> None:
        out, _, register, text = dataset_staged
        pd_.publish("prospective.json", "Project owner", today=date(2026, 11, 3))
        assert (out / "prospective.json").read_text() == text
        old, new = register.read_text().splitlines()
        assert "superseded by prospective.json (2026-11-03)" in old and "**Approved (Project owner, 2026-11-03)**" in new

    def test_an_owner_approved_unpublished_row_can_be_published(self, dataset_staged) -> None:
        out, _, register, text = dataset_staged
        register.write_text(register.read_text().replace("**Pending owner approval**", "**Approved (project owner, 2026-11-02); not yet published**"))
        pd_.publish("prospective.json", "Project owner", today=date(2026, 11, 3))
        assert (out / "prospective.json").read_text() == text
        assert "**Approved (project owner, 2026-11-02); published by Project owner 2026-11-03**" in register.read_text()

    def test_changed_candidate_or_missing_entry_is_refused(self, dataset_staged) -> None:
        out, candidates, _, _ = dataset_staged
        (candidates / "prospective.json").write_text('{"edited": true}\n')
        with pytest.raises(pd_.PublishRefused, match="changed after export"):
            pd_.publish("prospective.json", "Project owner")
        assert (out / "prospective.json").read_text() == '{"old": true}\n'
        with pytest.raises(pd_.PublishRefused, match="no candidate"):
            pd_.publish("prospective.r2.json", "Project owner")
        with pytest.raises(pd_.PublishRefused, match="not a dataset candidate"):
            pd_.publish("secrets.json", "Project owner")
        with pytest.raises(pd_.PublishRefused, match="approver"):
            pd_.publish("prospective.json", "")


def test_dataset_candidates_are_never_overwritten(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(ed, "CANDIDATES", tmp_path)
    (tmp_path / "prospective.json").write_text("reviewed")
    assert ed.next_candidate("prospective").name == "prospective.r2.json"
