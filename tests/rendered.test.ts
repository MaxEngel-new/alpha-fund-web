/**
 * Rendered-page checks for the Prospective Monitor (opt-in: needs a running server).
 *
 *   SITE_TEST_URL=http://localhost:3000 SITE_TEST_EXPECT=holdings npm test   # PREVIEW_CANDIDATES=1 build (or once published)
 *   SITE_TEST_URL=http://localhost:3000 SITE_TEST_EXPECT=none npm test       # nothing published yet
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const base = process.env.SITE_TEST_URL;
const expectHoldings = process.env.SITE_TEST_EXPECT === "holdings";

async function page(path: string): Promise<string> {
  const res = await fetch(new URL(path, base));
  assert.equal(res.status, 200);
  return res.text();
}

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("rendered equity chart", { skip: base ? false : "set SITE_TEST_URL to run" }, () => {
  it("gives every series its own colour and its own line pattern", async () => {
    const html = await page("/analytics");
    const swatches = [...html.matchAll(/<svg width="32" height="6" aria-hidden="true">(<line [^>]*>)/g)].map((m) => ({
      color: /stroke="(#[0-9a-f]{6})"/.exec(m[1])?.[1],
      dash: /stroke-dasharray="([^"]+)"/.exec(m[1])?.[1] ?? "solid",
    }));
    assert.equal(swatches.length, 6);
    assert.equal(new Set(swatches.map((s) => s.color)).size, 6);
    assert.equal(new Set(swatches.map((s) => s.dash)).size, 6);
    for (const old of ["#2ec4b6", "#7aa2d6", "#a77bf3"]) assert.ok(!swatches.some((s) => s.color === old));
  });
});

describe("rendered Prospective Monitor", { skip: base ? false : "set SITE_TEST_URL to run" }, () => {
  it("is responsive and carries the research disclaimer", async () => {
    const html = await page("/prospective");
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
    assert.match(text(html), /independent research project/);
    assert.match(text(html), /Not a hedge fund, investment adviser, broker/);
  });

  it("never presents simulated or target allocations as brokerage positions", async () => {
    const t = text(await page("/prospective"));
    assert.doesNotMatch(t, /brokerage positions? (held|owned)|actual (holdings|positions)|live performance/i);
  });

  if (expectHoldings) {
    it("shows the holdings with classification, disclosures and selectors", async () => {
      const html = await page("/prospective");
      const t = text(html);
      assert.match(t, /Prospective hypothetical portfolio allocations — not real-money positions\./);
      assert.match(t, /PROSPECTIVE — hypothetical research decisions, not real-money positions/);
      for (const d of [/not brokerage holdings/, /do not guarantee execution at those weights/, /No investment performance is implied/, /survivorship-biased/]) {
        assert.match(t, d);
      }
      assert.match(t, /BK .*no data/);
      assert.match(t, /TMUS/);
      assert.equal((html.match(/role="radiogroup" aria-label="Portfolio"/g) ?? []).length, 1);
      assert.equal((html.match(/role="radio" aria-checked="(true|false)"/g) ?? []).length, 4 + 3);
      assert.match(html, /aria-disabled="true"[^>]*disabled=""[^>]*>Simulated execution \(paper portfolio\)/);
      assert.equal((html.match(/aria-sort="(ascending|descending|none)"/g) ?? []).length, 3);
      assert.match(t, /Showing 106 of 106 holdings/);
      assert.match(t, /Download CSV/);
      assert.doesNotMatch(t, /Awaiting first prospective observation\./);
    });

    it("shows verified company names, flags the rest, and never treats names as historical identities", async () => {
      const t = text(await page("/prospective"));
      assert.match(t, /AAPL Apple Inc\./);
      assert.match(t, /BRK-B Berkshire Hathaway Inc\./);
      assert.match(t, /HON Honeywell International Inc\./);
      assert.match(t, /JPM JPMorgan Chase &amp; Co\./);
      assert.match(t, /SLB SLB N\.V\. \(SLB Limited\)/);
      assert.doesNotMatch(t, /Pending review/);
      assert.match(t, /Names verified from issuer filings/);
      assert.match(t, /not historical issuer identities/);
      assert.match(t, /Nasdaq Trader symbol directory/);
    });

    it("separates recorded decisions, ledger events, simulated fills and performance", async () => {
      const t = text(await page("/prospective"));
      assert.match(t, /First prospective decisions recorded on 2026-10-30 ?\./);
      assert.match(t, /Decisions recorded 4 /);
      assert.match(t, /Ledger events 8 4 decisions \+ 4 starting-state observations/);
      assert.match(t, /Simulated fills 0 /);
      assert.match(t, /Investment performance Not yet available/);
      assert.match(t, /Next recording windows/);
      assert.doesNotMatch(t, /Decision session 2026-10-30 Opens/);
    });
  } else {
    it("shows no holdings until an export is approved and published", async () => {
      const t = text(await page("/prospective"));
      assert.match(t, /Awaiting first prospective observation\./);
      assert.doesNotMatch(t, /Portfolio holdings decisions|Download CSV|AAPL/);
    });
  }
});
