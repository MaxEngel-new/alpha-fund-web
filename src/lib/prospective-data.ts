/**
 * Build-time loading of the Prospective Monitor dataset: the APPROVED src/data/prospective.json, or, only in
 * a local review build with PREVIEW_CANDIDATES=1, the latest unapproved re-export in src/data/candidates/
 * (git-ignored), which the page then marks as a preview.
 */
import fs from "node:fs";
import path from "node:path";
import type { Dataset, Prospective } from "./data";
import { previewCandidates } from "./holdings-data";

const DATA = path.join(process.cwd(), "src", "data");

export function loadProspective(): { dataset: Dataset<Prospective>; preview: boolean } {
  const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Dataset<Prospective>;
  const dir = path.join(DATA, "candidates");
  if (previewCandidates() && fs.existsSync(dir)) {
    const candidates = fs
      .readdirSync(dir)
      .map((file) => ({ file, match: /^prospective(?:\.r(\d+))?\.json$/.exec(file) }))
      .filter((c) => c.match)
      .sort((a, b) => Number(b.match![1] ?? 1) - Number(a.match![1] ?? 1));
    if (candidates.length) return { dataset: read(path.join(dir, candidates[0].file)), preview: true };
  }
  return { dataset: read(path.join(DATA, "prospective.json")), preview: false };
}
