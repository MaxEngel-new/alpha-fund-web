# Alpha Fund — research website

The public website of Alpha Fund, an independent quantitative research initiative. It presents the research honestly,
including rejected and inconclusive results. It is a static Next.js site: every page is prerendered at build time from
approved JSON exports in `src/data/`, and nothing reads the research repository at runtime.

> Alpha Fund is an independent research project. All published results are for educational and research purposes only and
> do not constitute investment advice. Historical backtests are exploratory and are not indicative of future performance.
> No investment returns are guaranteed.

## Stack

Next.js 16.4.3 (App Router, Cache Components, fully static output), React 19.3, TypeScript 5.9, Tailwind CSS 4.3,
Recharts 3.10 and Lucide icons. All dependency versions are pinned exactly in `package.json`, and `npm audit` reports
0 vulnerabilities.

## Pages

| Route | Content | Data |
|---|---|---|
| `/` | Mission, research philosophy, capabilities, universe, prospective status, milestones | `platform.json`, `research.json`, `prospective.json`, `roadmap.json` |
| `/analytics` | Equity curves, drawdowns, risk and return tables, rebalancing and cost study, SPY benchmark | `analytics.json` |
| `/research` | Pipeline, features, models, purged walk-forward, inference simulation, B- and A-series results, exploratory leads | `research.json` |
| `/roadmap` | Sprints 1–17 timeline | `roadmap.json` |
| `/prospective` | The four frozen portfolios, P001, recording windows, integrity safeguards, approved holdings decisions | `prospective.json`, `holdings/*.json` |
| `/methodology` | Data, accounting, costs, survivorship bias, backtests, validation, statistics, risk, prospective integrity | `methodology.json`, `platform.json` |

## Local development

Requires Node.js 20.9 or later (developed with 24.21.0).

```bash
npm ci
npm run dev          # http://localhost:3000
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build        # production build (all routes static)
npm start            # serve the production build
```

## Updating the data

The datasets in `src/data/` come from the research repository via `exporter/export_data.py`. It expects that repository
next to this one (`../alpha-fund`), or pass `--backend PATH`. It needs that repository's Python environment and research
data, because the equity curves are regenerated and verified against the committed results.

```bash
npm run export-data        # = python3 exporter/export_data.py
```

The exporter refuses to run if the research files differ from their commit, refuses to publish prospective records, never
reads practice (BACKFILL) records, and scans every output for local paths and secrets. **Each new export must be reviewed
and approved by the project owner before it is published;** approvals are recorded in a register kept outside this
repository.

## Prospective holdings (monthly, approval required)

The Prospective Monitor shows each month's recorded portfolio decisions only after the project owner approves that
month's export. Nothing is published automatically.

1. **Export a candidate** (read-only; refuses unless the ledger is committed, identical at the GitHub remote head,
   hash-chain valid, and every decision matches the frozen portfolio definitions and was recorded on time):
   ```bash
   npm run export-holdings -- --session 2026-10-30
   ```
   This writes a new candidate in `src/data/holdings/candidates/` (git-ignored, never published): `<session>.json`, or
   `<session>.r2.json`, `.r3.json` … if one exists. Existing candidates are never overwritten; each revision has its own
   SHA-256 and its own Pending entry in the owner's private approval register.
2. **Review it locally:** `PREVIEW_CANDIDATES=1 npm run dev`. Unapproved candidates appear under an "Unapproved preview"
   banner. Production builds never include them.
3. **Publish after approval** (owner only):
   ```bash
   python3 exporter/publish_holdings.py --candidate 2026-10-30.r3.json --approved-by "Name"
   ```
   This checks that the file is unchanged since export (SHA-256), re-checks the anchoring, copies it unchanged to
   `src/data/holdings/<session>.json` and records the approval. Then commit and deploy as usual.

Weights are copied exactly as recorded; nothing is recomputed. Simulated fills are shown only once they exist in the
ledger and have a reviewed export step (not built yet).

**Company names** come from `exporter/company_names.json`, built from free public sources:
```bash
python3 exporter/build_company_names.py --session 2026-10-30
```
It reads the Nasdaq Trader symbol directory (official exchange listing names) and a fixed revision of Wikipedia's
S&P 500 list (an independent cross-check, with SEC CIK numbers), and records each source's SHA-256. A name is published
only when both agree; otherwise the ticker is shown and the entry is flagged `needs_review` with the reason. The owner
can resolve a flagged ticker in `exporter/company_name_overrides.json`
(`{"IBM": {"company": "…", "reviewed_by": "…", "evidence": "…"}}`); with `"status": "issuer_verified"` the name is
taken from the issuer's own SEC filings or site and must also give `reviewed_on`, the matching `issuer_cik` and
`sources`, with any naming ambiguity in `ambiguity`. These details are published with the export. Names are the issuers listed on the retrieval
date, not historical issuer identities. Optional: `--sec-contact "Name address"` adds each issuer's SEC former names
(the SEC requires a contact address in the request). Changing names means a new holdings candidate and a new approval.

## Dataset re-exports (approval required)

`python3 exporter/export_data.py --only prospective` re-exports one dataset as a candidate in `src/data/candidates/`
(git-ignored, never overwritten) with a Pending register entry. Review it with `PREVIEW_CANDIDATES=1 npm run dev`, then
publish it after approval:
```bash
python3 exporter/publish_dataset.py --candidate prospective.json --approved-by "Name"
```

## Tests

```bash
npm test                 # unit tests for the holdings view logic and CSV (node:test)
npm run test:exporter    # exporter and publish-step tests (pytest; reads the research repository read-only)
SITE_TEST_URL=http://localhost:3000 SITE_TEST_EXPECT=none npm test   # rendered-page checks against a running build
```

## Deploying to Vercel

1. Put this directory in its own Git repository (it is deliberately separate from the research repository) and push it to
   GitHub, after review.
2. In Vercel: **Add New → Project**, import the repository. The framework preset (Next.js) is detected automatically;
   leave the build command (`next build`) and output settings at their defaults. If the site lives in a subdirectory of a
   larger repository, set **Root Directory** to that subdirectory.
3. Set the environment variable `SITE_URL` to the production URL (for example `https://alpha-fund.example`). It is used
   for canonical metadata, `sitemap.xml` and `robots.txt`. It is not secret.
4. Set the Node.js version to 24.x (or 20.x/22.x) in **Settings → General**.
5. Deploy. No other environment variables, secrets, databases or serverless functions are needed: every route is
   prerendered static content.

Vercel never runs the exporter. It builds from the committed, approved JSON only.

## Security

- No secrets, credentials, private paths, raw ledgers, market-data files, snapshots or model artifacts are in this
  repository; `exporter/export_data.py` enforces this for the data it writes.
- Security headers (`next.config.ts`): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  `Permissions-Policy`, HSTS; the `X-Powered-By` header is disabled.
- Fonts are self-hosted at build time, so visitors make no third-party requests.
