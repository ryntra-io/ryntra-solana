// Run from repo root: node --test lib/markets/radar.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ABSENT_ANALYTICS, buildRadar, classOfVenueCategory, isTradable, summarise, unknown } from "./radar.ts";

/**
 * The universe is 231 instruments and 3 of them are executable here.
 *
 * Every rule below exists because of that ratio. On the only surface where a
 * person can move real funds, the failure mode is not a wrong number — it is a
 * row that looks tradable because it has a price, a name and a logo, which
 * every one of the 231 has.
 */

const TOKENS = [
  { symbol: "TSLA", name: "Tesla", address: "0xa", category: "stock", verified: true },
  { symbol: "NVDA", name: "NVIDIA", address: "0xb", category: "stock", verified: true },
  { symbol: "USDG", name: "Global Dollar", address: "0xc", category: "crypto", verified: true },
  { symbol: "CASHCAT", name: "Cash Cat", address: "0xd", category: "meme", verified: false },
  { symbol: "GOAT", name: "Goat", address: "0xe", category: "meme", verified: false },
];

const OVERVIEW = [
  { ticker: "TSLA", category: "EQUITIES", quote: { price: 401.2, changePercent24h: -1.1, volume24h: 9_000_000 } },
  { ticker: "NVDA", category: "EQUITIES", quote: { price: 219.1, changePercent24h: -2.6, volume24h: 102_376_166 } },
  { ticker: "USDG", category: "CRYPTO", quote: {} },
  { ticker: "CASHCAT", category: "CRYPTO", quote: { price: 0.0004, changePercent24h: 12, volume24h: 1_200 } },
  { ticker: "GOAT", category: "MEME", quote: { price: 0.02, changePercent24h: 3, volume24h: 500 } },
];

const EXECUTABLE = ["TSLA", "AAPL", "AMD"];

test("tradability cannot be asserted, only derived from evidence", () => {
  /*
   * The rule the whole surface rests on. There is no `tradable` field to set,
   * so the only way a row can claim it is by having an executable route *and*
   * a live price. `RadarRow` is checked for the absence of such a field too,
   * because a future edit that adds one would make every other assertion here
   * decorative.
   */
  const source = readFileSync(new URL("./radar.ts", import.meta.url), "utf8");
  const rowType = /export type RadarRow = Readonly<\{([\s\S]*?)\}>;/.exec(source);
  assert.ok(rowType, "RadarRow must stay a readable type");
  assert.doesNotMatch(rowType[1], /\btradable\b|\bisTradable\b/, "RadarRow must not carry a tradability field");

  const rows = buildRadar(TOKENS, OVERVIEW, EXECUTABLE);
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));

  assert.equal(isTradable(bySymbol.get("TSLA").tradability), true, "a route and a price is tradable");
  assert.equal(isTradable(bySymbol.get("NVDA").tradability), false, "a price without a route is not");
  assert.equal(isTradable(bySymbol.get("USDG").tradability), false, "no price is not tradable");

  /* And a route with no price is not tradable either — the half nobody thinks
     of, because the allowlist feels like the authoritative half. */
  assert.equal(
    isTradable({ executableRoutes: ["TSLA"], price: unknown("the venue returned nothing") }),
    false,
    "an executable route without a live price is not tradable",
  );
});

test("an absent number is Unknown with a reason, never zero", () => {
  const rows = buildRadar(TOKENS, OVERVIEW, EXECUTABLE);
  const usdg = rows.find((row) => row.symbol === "USDG");

  assert.equal(usdg.price.known, false);
  assert.ok(usdg.price.reason.length > 10, "an absence states why");
  assert.equal("value" in usdg.price, false, "an unknown carries no value at all, not even zero");

  /* The concrete failure: `USDG` is the quote asset and the venue prices no
     quote for it. A `0` there reads as "worthless" on a stablecoin. */
  assert.equal(usdg.changePercent24h.known, false);
  assert.equal(usdg.volume24h.known, false);
});

test("a disagreement between venue endpoints is carried, and the safest class wins", () => {
  /*
   * `CASHCAT` is `meme` in the token list and `CRYPTO` in the overview. Real,
   * live, today. Silently taking either one loses information; taking the
   * generic one also loses the caution the community class carries, which is
   * the direction that costs something.
   */
  const rows = buildRadar(TOKENS, OVERVIEW, EXECUTABLE);
  const cashcat = rows.find((row) => row.symbol === "CASHCAT");

  assert.equal(cashcat.origin.agreed, false, "the conflict must be visible on the row");
  assert.equal(cashcat.origin.tokenCategory, "meme");
  assert.equal(cashcat.origin.overviewCategory, "CRYPTO");
  assert.equal(cashcat.instrumentClass, "COMMUNITY_TOKEN", "the safer class wins");

  const agreed = rows.find((row) => row.symbol === "TSLA");
  assert.equal(agreed.origin.agreed, true);
  assert.equal(agreed.origin.venueCategory, "stock");
});

test("the venue's own verification flag survives to the row", () => {
  /* Thirty-one live tokens carry `verified: false` and every one is a meme.
     It is the strongest safety signal this surface has, it comes from the
     venue rather than from us, and a Radar that drops it is worse than one
     that never listed those tokens. */
  const rows = buildRadar(TOKENS, OVERVIEW, EXECUTABLE);
  assert.equal(rows.find((row) => row.symbol === "GOAT").venueVerified, false);
  assert.equal(rows.find((row) => row.symbol === "TSLA").venueVerified, true);

  /* Absent flag is not treated as verified. */
  const [row] = buildRadar([{ symbol: "X", address: "0x1", category: "meme" }], [], []);
  assert.equal(row.venueVerified, false, "a missing flag is not a verified one");
});

test("a category this product has no class for is not invented into one", () => {
  const rows = buildRadar(
    [{ symbol: "WAT", address: "0x9", category: "structured-note", verified: true }],
    [],
    [],
  );
  assert.deepEqual([...rows], [], "an unmapped venue category produces no row rather than a guessed class");
  assert.equal(classOfVenueCategory("structured-note"), null);
});

test("the summary counts what the surface has to state", () => {
  const summary = summarise(buildRadar(TOKENS, OVERVIEW, EXECUTABLE));
  assert.equal(summary.listed, 5);
  assert.equal(summary.executable, 1, "only TSLA has both a route and a price");
  assert.equal(summary.unverified, 2);
  assert.equal(summary.withoutPrice, 1);
  assert.equal(summary.conflicted, 1);
  assert.deepEqual(summary.byClass, { STOCK_TOKEN: 2, GENERIC_ERC20: 1, COMMUNITY_TOKEN: 2 });
});

test("the analytics this Radar does not have are named, with what would end each", () => {
  /* Kept as data so the surface states them. Omitting them is what makes a
     discovery page read as a finished scanner. */
  assert.ok(ABSENT_ANALYTICS.length >= 4);
  for (const item of ABSENT_ANALYTICS) {
    assert.ok(item.name.length > 3, "an absence needs a name");
    assert.ok(item.gate.length >= 40, `${item.name}: the gate must be specific`);
    assert.doesNotMatch(item.gate, /soon|shortly|next (week|month|quarter)|20\d\d|Q[1-4]/i, `${item.name} states a date`);
  }
});
