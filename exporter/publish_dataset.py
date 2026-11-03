"""Publishes one APPROVED re-exported dataset (owner-run; never automatic).

    python3 exporter/publish_dataset.py --candidate prospective.json --approved-by "Project owner"

Run only after reviewing the candidate (e.g. with ``PREVIEW_CANDIDATES=1 npm run dev``). This checks the
candidate's SHA-256 equals its register entry (Pending, or already marked "Approved (...); not yet published"), copies it unchanged over
``src/data/<dataset>.json`` and records the approval with the date. The previously approved version is
marked as superseded in the register; its earlier approval does not carry over to the new file.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
from datetime import date
from pathlib import Path

from export_data import CANDIDATES, DATASETS, OUT, REGISTER

CANDIDATE_NAME = re.compile(r"^([a-z]+)(\.r\d+)?\.json$")


class PublishRefused(Exception):
    pass


def publish(candidate_name: str, approved_by: str, today: date | None = None) -> Path:
    if not approved_by.strip():
        raise PublishRefused("an approval needs the approver's name")
    match = CANDIDATE_NAME.match(candidate_name)
    if not match or match.group(1) not in DATASETS:
        raise PublishRefused(f"{candidate_name!r} is not a dataset candidate (e.g. prospective.json or prospective.r2.json)")
    dataset = match.group(1)
    candidate = CANDIDATES / candidate_name
    if not candidate.exists():
        raise PublishRefused(f"no candidate {candidate_name}: run export_data.py first")
    register = REGISTER.read_text()
    row = next((l for l in register.splitlines() if f"`src/data/candidates/{candidate_name}`" in l), None)
    if row is None or not ("**Pending owner approval**" in row or "; not yet published**" in row):
        raise PublishRefused(f"no Pending or approved-unpublished register entry for {candidate_name}")
    sha = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if f"`{sha}`" not in row:
        raise PublishRefused("the candidate changed after export: its SHA-256 no longer matches the register")
    target = OUT / f"{dataset}.json"
    shutil.copyfile(candidate, target)
    stamp = (today or date.today()).isoformat()
    approved = f"**Approved ({approved_by.strip()}, {stamp})**"
    lines = []
    for line in register.splitlines():
        if line == row:
            line = line.replace("**Pending owner approval**", approved).replace("; not yet published**", f"; published by {approved_by.strip()} {stamp}**")
        elif line.startswith(f"| `src/data/{dataset}.json` |") and "**Pending owner approval**" in line:
            line = line.replace("**Pending owner approval**", f"Not published ({candidate_name} was published, {stamp})")
        elif line.startswith(f"| `src/data/{dataset}.json` |") and line.rstrip().endswith("** |") and "superseded" not in line:
            line = line[: -len(" |")] + f" — superseded by {candidate_name} ({stamp}) |"
        lines.append(line)
    REGISTER.write_text("\n".join(lines) + "\n")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, help="candidate file name in src/data/candidates/")
    parser.add_argument("--approved-by", required=True)
    args = parser.parse_args()
    try:
        target = publish(args.candidate, args.approved_by)
    except PublishRefused as exc:
        raise SystemExit(f"PUBLISH REFUSED: {exc}")
    print(f"published src/data/{target.name}; register updated")


if __name__ == "__main__":
    main()
