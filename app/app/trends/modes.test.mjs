import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRODUCT_ROUTES } from "../../shell/product-routes.ts";
import { DRAWN_TREND_MODES, isTrendMode, resolveTrendMode, TREND_MODE_SPECS, TREND_MODES } from "./modes.ts";

/**
 * The modes of Trends, as the Owner fixed them on 2026-09-11: five, in order,
 * three backed by the ranked universe Spot reads. Since canon v5.0 (§0.0
 * rule 10, 2026-09-23) only those three are drawn: the two with no list stay
 * registered and reach no screen — no *Soon* tag, no card about a future list.
 */

test("five modes in the Owner's order, three with a source and two with none", () => {
  assert.deepEqual(TREND_MODES, ["trending", "new", "memes", "stocks", "screeners"]);
  assert.deepEqual(TREND_MODE_SPECS.map((spec) => spec.id), TREND_MODES);
  assert.deepEqual(TREND_MODE_SPECS.map((spec) => spec.label.en), ["Trending", "New", "Memes", "Stocks/RWA", "My Screeners"]);
  assert.deepEqual(TREND_MODE_SPECS.map((spec) => spec.source), ["all", null, "meme", "stock", null]);
});

test("the bar draws only the modes with a list, and no mode describes a list it does not have", () => {
  assert.deepEqual(DRAWN_TREND_MODES.map((spec) => spec.id), ["trending", "memes", "stocks"]);
  for (const spec of TREND_MODE_SPECS) {
    for (const locale of ["en", "uk"]) {
      assert.ok(spec.label[locale].length > 0 && spec.lead[locale].length > 0, `${spec.id} is missing ${locale} copy`);
    }
    assert.notEqual(spec.label.uk, spec.label.en, `${spec.id} label is untranslated`);
    assert.equal("holds" in spec, false, `${spec.id} carries a description of a future list`);
  }
});

test("the Stocks/RWA mode leads to the Stocks page, and the page redirects a saved link there", () => {
  /* Canon v4.0 §5.1: Stocks is a page; a saved transition to the old mode
     inside Trends leads into the new context, never into a second screener.
     Since canon v5.3 (В28) the Stocks page is the screener, where the
     registry says it opens. */
  const stocks = PRODUCT_ROUTES.find((route) => route.id === "stocks");
  assert.equal(TREND_MODE_SPECS.find((spec) => spec.id === "stocks").movedTo, stocks.href);
  assert.equal(stocks.href, "/app/stocks/screener");
  for (const spec of TREND_MODE_SPECS) if (spec.id !== "stocks") assert.equal(spec.movedTo, undefined, `${spec.id} moved somewhere`);
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(mode\.movedTo\) redirect\(mode\.movedTo\)/, "a saved ?mode=stocks must open the Stocks page");
  assert.match(source, /spec\.movedTo \?\?/, "the mode bar sends Stocks/RWA to its page");
});

test("an unknown mode opens Trending, and a saved link to a mode with no list is sent on to Trending", () => {
  assert.equal(resolveTrendMode(undefined).id, "trending");
  assert.equal(resolveTrendMode("orderbook").id, "trending");
  assert.equal(resolveTrendMode("screeners").source, null);
  assert.equal(isTrendMode("memes"), true);
  assert.equal(isTrendMode("Memes"), false);
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(mode\.source === null\) redirect\("\/app\/trends"\)/, "?mode=new must open Trending, not a page about a list");
});

test("the page renders the drawn modes and sends every row into Spot, and says nothing about the future", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("DRAWN_TREND_MODES.map("), "the mode bar must come from the drawn list");
  assert.ok(source.includes("listSpotMarkets("), "the rows must come from the ranked universe Spot reads");
  assert.ok(source.includes("/app/spot?mint="), "a row opens Spot");
  assert.doesNotMatch(source, /FEATURED_MINTS/, "the featured list is retired in favour of the ranked universe");
  /* Canon v5.0 §0.0 rule 10: no Soon tag, no coming-soon card, no Being built chip. */
  assert.doesNotMatch(source, /"(Скоро|Незабаром|Розробляється|Soon|Coming soon|Being built)"|<StatusChip/);
});
