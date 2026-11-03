/**
 * Build-time loading of APPROVED holdings exports (src/data/holdings/*.json, written only by
 * exporter/publish_holdings.py after owner approval).
 *
 * Unapproved candidates (src/data/holdings/candidates/, git-ignored) are included only in an explicit
 * local review build with PREVIEW_CANDIDATES=1, and are then marked as previews on the page. When a
 * session has several candidate revisions (2026-10-30.json, 2026-10-30.r2.json, ...), the latest is shown.
 */
import fs from "node:fs";
import path from "node:path";
import type { HoldingsExport } from "./holdings";

export interface HoldingsSession {
  session: string;
  preview: boolean;
  /** The source file name (shown for previews, so the reviewer knows which candidate revision is displayed). */
  file: string;
  export: HoldingsExport;
}

const ROOT = path.join(process.cwd(), "src", "data", "holdings");

function readDir(dir: string, revisions: boolean): Map<string, { file: string; export: HoldingsExport }> {
  const out = new Map<string, { file: string; export: HoldingsExport }>();
  if (!fs.existsSync(dir)) return out;
  const latest = new Map<string, { revision: number; file: string }>();
  for (const file of fs.readdirSync(dir)) {
    const match = (revisions ? /^(\d{4}-\d{2}-\d{2})(?:\.r(\d+))?\.json$/ : /^(\d{4}-\d{2}-\d{2})\.json$/).exec(file);
    if (!match) continue;
    const revision = Number(match[2] ?? 1);
    if ((latest.get(match[1])?.revision ?? 0) < revision) latest.set(match[1], { revision, file });
  }
  for (const [session, { file }] of latest) {
    out.set(session, { file, export: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as HoldingsExport });
  }
  return out;
}

export const previewCandidates = () => process.env.PREVIEW_CANDIDATES === "1";

export function loadHoldingsSessions(): HoldingsSession[] {
  const published = readDir(ROOT, false);
  const sessions: HoldingsSession[] = [...published].map(([session, found]) => ({ session, preview: false, ...found }));
  if (previewCandidates()) {
    for (const [session, found] of readDir(path.join(ROOT, "candidates"), true)) {
      if (!published.has(session)) sessions.push({ session, preview: true, ...found });
    }
  }
  return sessions.sort((a, b) => b.session.localeCompare(a.session));
}
