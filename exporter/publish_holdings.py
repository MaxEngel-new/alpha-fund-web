"""Publishes one APPROVED holdings candidate (owner-run; never automatic).

    python3 exporter/publish_holdings.py --candidate 2026-10-30.r2.json --approved-by "Project owner"

Run only after reviewing the candidate (e.g. with ``PREVIEW_CANDIDATES=1 npm run dev``). This:
1. checks the candidate's SHA-256 equals its Pending entry written by export_holdings.py, so the
   file reviewed is the file published;
2. re-checks that the ledger is still externally anchored and unchanged;
3. copies the candidate unchanged to ``src/data/holdings/<session>.json`` (the only folder the
   public site reads) and records the approval, with the date, in the private register. Any other
   Pending revision of the same session is marked as not published.

It refuses if the session is already published: corrections are a new, separately approved export.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
from datetime import date
from pathlib import Path

from export_holdings import CANDIDATES, DEFAULT_BACKEND, REGISTER, ExportRefused, check_anchored

PUBLISHED = CANDIDATES.parent
CANDIDATE_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})(\.r\d+)?\.json$")


def publish(candidate_name: str, approved_by: str, backend: Path, today: date | None = None) -> Path:
    if not approved_by.strip():
        raise ExportRefused("an approval needs the approver's name")
    match = CANDIDATE_NAME.match(candidate_name)
    if not match:
        raise ExportRefused(f"{candidate_name!r} is not a candidate file name (e.g. 2026-10-30.json or 2026-10-30.r2.json)")
    session = match.group(1)
    candidate = CANDIDATES / candidate_name
    target = PUBLISHED / f"{session}.json"
    if target.exists():
        raise ExportRefused(f"{session} is already published; a correction needs a new, separately approved export")
    if not candidate.exists():
        raise ExportRefused(f"no candidate {candidate_name}: run export_holdings.py first")
    register = REGISTER.read_text()
    row = next((l for l in register.splitlines() if l.startswith(f"| {session} |") and f"candidates/{candidate_name}`" in l), None)
    if row is None or "Pending owner approval" not in row:
        raise ExportRefused(f"no Pending register entry for {candidate_name}")
    sha = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if f"`{sha}`" not in row:
        raise ExportRefused("the candidate changed after export: its SHA-256 no longer matches the register")
    check_anchored(backend)
    shutil.copyfile(candidate, target)
    stamp = (today or date.today()).isoformat()
    lines = []
    for line in register.splitlines():
        if line == row:
            line = line.replace("**Pending owner approval**", f"**Approved ({approved_by.strip()}, {stamp})**")
        elif line.startswith(f"| {session} |") and "**Pending owner approval**" in line:
            line = line.replace("**Pending owner approval**", f"Not published ({session} was published from {candidate_name}, {stamp})")
        lines.append(line)
    REGISTER.write_text("\n".join(lines) + "\n")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, help="candidate file name in src/data/holdings/candidates/")
    parser.add_argument("--approved-by", required=True)
    parser.add_argument("--backend", type=Path, default=DEFAULT_BACKEND)
    args = parser.parse_args()
    try:
        target = publish(args.candidate, args.approved_by, args.backend.resolve())
    except ExportRefused as exc:
        raise SystemExit(f"PUBLISH REFUSED: {exc}")
    print(f"published {target.relative_to(PUBLISHED.parents[2])}; register updated")


if __name__ == "__main__":
    main()
