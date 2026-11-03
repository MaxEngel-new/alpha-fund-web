"""Builds the ticker -> company-name mapping for the holdings exports from free, public, verifiable sources.

    python3 exporter/build_company_names.py --session 2026-10-30 [--sources-dir exporter/name_sources]

Sources (downloaded once, stored with their SHA-256 in the git-ignored ``exporter/name_sources/`` so the
mapping can be re-derived and checked; nothing is fetched from paid services):
* Nasdaq Trader symbol directory (``nasdaqlisted.txt`` and ``otherlisted.txt``): the official listing
  name of every security on U.S. exchanges. The company name is the listing name with its security
  description removed ("Apple Inc. - Common Stock" -> "Apple Inc.").
* Wikipedia, "List of S&P 500 companies" (a fixed revision): an independent cross-check of the issuer,
  and its SEC CIK (the SEC's permanent issuer identifier).

Optionally (``--sec-contact``, owner-run because the SEC requires the requester's contact address), each
issuer's former names since 2010 are added from SEC EDGAR for reviewers.

A name is ``verified`` only if the ticker is listed (not a test issue), the security description was
recognized and removed, and the issuer name agrees with the independent source. Anything else is
flagged ``needs_review`` with the reason, and the exporter shows the ticker instead (no name is ever
guessed). A flagged ticker can be resolved in ``exporter/company_name_overrides.json`` with the name, the
reviewer and the evidence: ``owner_reviewed``, or ``issuer_verified`` when the name is taken from the
issuer's own SEC filings or site (sources, review date and CIK recorded; any naming ambiguity kept).
Tickers are kept exactly as the research ledger records them; the only lookup rule is that the ledger's
class separator "-" is the exchanges' "." (BRK-B -> BRK.B), which is recorded per entry.

Names describe the issuer listed under each ticker on the retrieval date. They are NOT historical
issuer identities: the same ticker may have been used by a predecessor or a differently named issuer in
earlier years. Where the independent source records a predecessor (a founding date in parentheses,
e.g. "2015 (1869)"), the entry is marked ``successor_entity`` as information for reviewers.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "exporter" / "company_names.json"
OVERRIDES = WEB / "exporter" / "company_name_overrides.json"  # optional: owner resolutions of flagged tickers
SOURCES_DIR = WEB / "exporter" / "name_sources"
WIKI_REVISION = "1382178819"  # the revision reviewed for this mapping; pass --wiki-revision to change it deliberately
SOURCES = {
    "nasdaqlisted.txt": "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "otherlisted.txt": "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
    "sp500_wikipedia.html": "https://en.wikipedia.org/w/index.php?title=List_of_S%26P_500_companies&oldid={revision}",
}
USER_AGENT = "AlphaFund independent research (company-name mapping)"

# The security description that follows the issuer name in an exchange listing name.
SECURITY_DESCRIPTION = re.compile(
    r"\s+-\s+.*$"
    r"|\s+(New\s+)?(Class\s+[A-C]\s+)?(Common Stock|Common Shares|Ordinary Shares|Registered Shares|Capital Stock)\b.*$",
    re.IGNORECASE)
ISSUER_ENDING = re.compile(r"\b(Inc|Corp|Corporation|Company|Co|plc|Ltd|Limited|Group|Incorporated|N\.V|S\.A)\.?$", re.IGNORECASE)
CORPORATE_WORDS = {"inc", "incorporated", "corporation", "corp", "co", "company", "companies", "plc", "ltd", "limited",
                   "the", "and", "group", "holdings", "class", "a", "b", "c", "n", "v", "nv", "sa", "ag", "se", "de", "new"}


def tls_context() -> ssl.SSLContext:
    try:
        import certifi  # some Python installs ship without CA certificates; verification stays on either way

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch_sources(directory: Path, revision: str) -> None:
    context = tls_context()
    directory.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        request = urllib.request.Request(url.format(revision=revision), headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60, context=context) as response:
            (directory / name).write_bytes(response.read())


def parse_listings(nasdaq: str, other: str) -> dict[str, dict]:
    """Exchange symbol -> listing (name, exchange, test issue) from the two pipe-delimited directories."""
    listings: dict[str, dict] = {}
    for text, symbol_col, exchange in ((nasdaq, "Symbol", None), (other, "ACT Symbol", "Exchange")):
        lines = [l for l in text.splitlines() if l.strip() and not l.startswith("File Creation Time")]
        header = lines[0].split("|")
        for line in lines[1:]:
            row = dict(zip(header, line.split("|")))
            listings[row[symbol_col]] = {
                "name": row["Security Name"].strip(),
                "exchange": "NASDAQ" if exchange is None else {"N": "NYSE", "A": "NYSE American", "P": "NYSE Arca", "Z": "Cboe BZX", "V": "IEX"}.get(row[exchange], row[exchange]),
                "test_issue": row.get("Test Issue") == "Y",
            }
    return listings


def parse_wikipedia(html: str) -> dict[str, dict]:
    import pandas as pd

    table = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
    return {str(r["Symbol"]): {"security": str(r["Security"]), "cik": str(int(r["CIK"])).zfill(10), "founded": str(r["Founded"])}
            for _, r in table.iterrows()}


def issuer_name(listing_name: str) -> str | None:
    """The issuer part of an exchange listing name: the security description and listing qualifiers such as
    "(REIT)" are removed. A listing without a security description must already end like an issuer name
    ("Visa Inc."); otherwise None (not recognized)."""
    listed = listing_name.strip()
    name = SECURITY_DESCRIPTION.sub("", listed).strip().rstrip(",")
    if name == listed and not ISSUER_ENDING.search(name):
        return None
    the = re.match(r"^(.*)\s+\(The\)$", name)
    if the:
        return f"The {the.group(1)}"
    return re.sub(r"\s+\((?!The\))[^()]*\)$", "", name)


def tokens(name: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", name.lower().replace("&", " and "))
    return {w for w in words if w not in CORPORATE_WORDS}


def names_agree(listing_issuer: str, reference: str) -> bool:
    """The reference's distinctive words all appear in the listing's issuer name (or the reverse)."""
    a, b = tokens(listing_issuer), tokens(re.sub(r"\(.*?\)", "", reference))
    return bool(a and b) and (b <= a or a <= b)


def map_ticker(ticker: str, listings: dict[str, dict], reference: dict[str, dict]) -> dict:
    symbol = ticker.replace("-", ".")
    entry: dict = {"exchange_symbol": symbol, "company": None, "status": "needs_review", "issuer_cik": None,
                   "listing_name": None, "exchange": None, "reference_name": None, "successor_entity": False, "review_reason": None}
    listing, ref = listings.get(symbol), reference.get(symbol)
    if ref:
        entry.update(issuer_cik=ref["cik"], reference_name=ref["security"], successor_entity="(" in ref["founded"])
    if not listing:
        entry["review_reason"] = "not in the exchange symbol directory"
        return entry
    entry.update(listing_name=listing["name"], exchange=listing["exchange"])
    issuer = issuer_name(listing["name"])
    if listing["test_issue"]:
        entry["review_reason"] = "listed as a test issue"
    elif issuer is None:
        entry["review_reason"] = "security description not recognized in the listing name"
    elif not ref:
        entry["review_reason"] = "no independent source (not in the S&P 500 reference list)"
    elif not names_agree(issuer, ref["security"]):
        entry["review_reason"] = f"listing issuer {issuer!r} and reference {ref['security']!r} do not agree"
    else:
        entry.update(company=issuer, status="verified")
    return entry


def sec_former_names(names: dict[str, dict], contact: str, since: str = "2010-01-01") -> None:
    """Optional historical-identity check: the SEC's record of each issuer's former names (data.sec.gov
    requires a User-Agent with the requester's contact address, so this runs only when the owner supplies
    one). Informational: it never changes a name's verification status."""
    for entry in names.values():
        if not entry["issuer_cik"]:
            continue
        url = f"https://data.sec.gov/submissions/CIK{entry['issuer_cik']}.json"
        request = urllib.request.Request(url, headers={"User-Agent": contact})
        with urllib.request.urlopen(request, timeout=60, context=tls_context()) as response:
            record = json.loads(response.read())
        former = [{"name": f["name"], "until": f.get("to", "")[:10]} for f in record.get("formerNames", []) if f.get("to", "")[:10] >= since]
        entry["sec_former_names_since_2010"] = former


def apply_overrides(names: dict[str, dict], overrides: dict[str, dict]) -> None:
    """Resolutions of flagged tickers, never of verified ones. Each needs the name, who reviewed it and the evidence:
    {"IBM": {"company": "...", "reviewed_by": "...", "evidence": "..."}} -> ``owner_reviewed``.
    With "status": "issuer_verified" the name comes from the issuer's own filings or site and also needs
    "reviewed_on", "issuer_cik" (must equal the reference CIK, so the issuer is the same) and "sources" [{name, url}].
    An optional "ambiguity" note is kept with the entry and published with the export."""
    for ticker, override in overrides.items():
        entry = names.get(ticker)
        if entry is None or entry["status"] == "verified":
            raise SystemExit(f"override for {ticker}: only tickers flagged needs_review can be resolved")
        if not all(str(override.get(k, "")).strip() for k in ("company", "reviewed_by", "evidence")):
            raise SystemExit(f"override for {ticker}: company, reviewed_by and evidence are all required")
        status = override.get("status", "owner_reviewed")
        if status not in ("owner_reviewed", "issuer_verified"):
            raise SystemExit(f"override for {ticker}: unknown status {status!r}")
        if status == "issuer_verified":
            if not override.get("sources") or not all(s.get("name") and s.get("url", "").startswith("https://") for s in override["sources"]):
                raise SystemExit(f"override for {ticker}: issuer_verified needs sources with a name and an https URL")
            if not str(override.get("reviewed_on", "")).strip():
                raise SystemExit(f"override for {ticker}: issuer_verified needs reviewed_on")
            if override.get("issuer_cik") != entry["issuer_cik"]:
                raise SystemExit(f"override for {ticker}: issuer CIK {override.get('issuer_cik')} differs from the reference {entry['issuer_cik']}")
        entry.update(company=override["company"].strip(), status=status,
                     review_reason=f"{entry['review_reason']}; resolved by {override['reviewed_by'].strip()}: {override['evidence'].strip()}",
                     verification={k: override[k] for k in ("reviewed_by", "reviewed_on", "sources", "ambiguity") if k in override})


def build(tickers: list[str], directory: Path, revision: str, overrides: dict | None = None) -> dict:
    texts = {name: (directory / name).read_bytes() for name in SOURCES}
    listings = parse_listings(texts["nasdaqlisted.txt"].decode(), texts["otherlisted.txt"].decode())
    reference = parse_wikipedia(texts["sp500_wikipedia.html"].decode())
    created = re.search(r"File Creation Time: (\d{10})", texts["otherlisted.txt"].decode())
    names = {t: map_ticker(t, listings, reference) for t in sorted(tickers)}
    apply_overrides(names, overrides or {})
    return {
        "meta": {
            "built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "basis": "Current listed issuer names on the retrieval date; not historical issuer identities.",
            "historical_identity_check": "not run (needs --sec-contact)",
            "sources": [
                {"name": "Nasdaq Trader symbol directory", "url": SOURCES["nasdaqlisted.txt"], "sha256": hashlib.sha256(texts["nasdaqlisted.txt"]).hexdigest()},
                {"name": "Nasdaq Trader symbol directory (other exchanges)", "url": SOURCES["otherlisted.txt"], "sha256": hashlib.sha256(texts["otherlisted.txt"]).hexdigest(),
                 "file_created": created.group(1) if created else None},
                {"name": "Wikipedia, List of S&P 500 companies", "url": SOURCES["sp500_wikipedia.html"].format(revision=revision),
                 "revision": revision, "sha256": hashlib.sha256(texts["sp500_wikipedia.html"]).hexdigest()},
            ],
            "rules": [
                "Tickers are kept exactly as recorded; the exchange symbol replaces '-' with '.' (share-class separator).",
                "Company name = exchange listing name with the security description and listing qualifiers such as (REIT) removed.",
                "Verified only if the listing and the independent reference agree on the issuer; otherwise needs_review and not published.",
            ],
            "verified": sum(e["status"] == "verified" for e in names.values()),
            "owner_reviewed": sorted(t for t, e in names.items() if e["status"] == "owner_reviewed"),
            "issuer_verified": sorted(t for t, e in names.items() if e["status"] == "issuer_verified"),
            "needs_review": sorted(t for t, e in names.items() if e["status"] == "needs_review"),
        },
        "names": names,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, help="map the tickers of this session's holdings candidate")
    parser.add_argument("--sources-dir", type=Path, default=SOURCES_DIR)
    parser.add_argument("--wiki-revision", default=WIKI_REVISION)
    parser.add_argument("--refresh", action="store_true", help="download the sources again")
    parser.add_argument("--sec-contact", help='optional: "Name contact@address" User-Agent for the SEC former-name check')
    args = parser.parse_args()
    candidates = sorted((WEB / "src" / "data" / "holdings" / "candidates").glob(f"{args.session}*.json"))
    if not candidates:
        raise SystemExit(f"no holdings candidate for {args.session}: run export_holdings.py first")
    exported = json.loads(candidates[0].read_text())
    tickers = sorted({h["ticker"] for p in exported["data"]["portfolios"] for h in p["holdings"]})
    if args.refresh or not all((args.sources_dir / n).exists() for n in SOURCES):
        fetch_sources(args.sources_dir, args.wiki_revision)
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    mapping = build(tickers, args.sources_dir, args.wiki_revision, overrides)
    if args.sec_contact:
        sec_former_names(mapping["names"], args.sec_contact)
        mapping["meta"]["historical_identity_check"] = "SEC EDGAR former names since 2010 (informational)"
    OUT.write_text(json.dumps(mapping, indent=2) + "\n")
    review = mapping["meta"]["needs_review"]
    resolved = mapping["meta"]["issuer_verified"] + mapping["meta"]["owner_reviewed"]
    print(f"{mapping['meta']['verified']} of {len(tickers)} verified from listings; resolved by review: {', '.join(resolved) or 'none'}; "
          f"needs review: {', '.join(review) or 'none'}")


if __name__ == "__main__":
    main()
