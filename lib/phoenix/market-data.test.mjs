// Run from repo root: node --test lib/phoenix/market-data.test.mjs
//
// B7 — Phoenix's public answers as «Торгівля → Ф'ючерси» draws them. The fixtures follow the SDK's own schemas
// (`@ellipsis-labs/rise` 0.6.2: api/exchange/types.ts, api/markets/types.ts, api/orderbook/types.ts,
// api/candles/types.ts, api/traders/traderState.ts); every field the page prints is checked, none is trusted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SYMBOL,
  WALLET,
  accountFrom,
  bookFrom,
  candlesFrom,
  candlesQuery,
  dayChange,
  fundingFrom,
  fundingPayer,
  groupOf,
  markIndexGap,
  marketMatches,
  marketStateOf,
  marketsFrom,
  nextFundingAt,
  stateOf,
  lotUnits,
  noAccount,
  num,
  symbolKey,
  tickUsd,
  ticksToUsd,
  unrealisedPnl,
} from "./market-data.ts";

const tier = (maxLeverage, maxSizeBaseLots) => ({ maxLeverage, maxSizeBaseLots, limitOrderRiskFactor: 60 });
const CONFIG = [
  { symbol: "ETH", assetId: 2, marketStatus: "active", tickSize: 100, baseLotsDecimals: 4, takerFee: 0, makerFee: 0, leverageTiers: [tier(20, 1000), tier(10, 5000)], isolatedOnly: false },
  { symbol: "SOL", assetId: 1, marketStatus: "Active", tickSize: 10, baseLotsDecimals: 3, takerFee: 0, makerFee: 0, leverageTiers: [tier(20, 1000)], isolatedOnly: false },
  { symbol: "NVDA", assetId: 40, marketStatus: "postOnly", commodityMetadata: { isCommodity: true, status: "closed" }, tickSize: 1, baseLotsDecimals: 2, leverageTiers: [tier(10, 100)], isolatedOnly: true },
  { symbol: "OLD", assetId: 9, marketStatus: "tombstoned", tickSize: 1, baseLotsDecimals: 0, leverageTiers: [] },
  { symbol: "../etc", assetId: 10, marketStatus: "active" },
  { symbol: "SOL", assetId: 1, marketStatus: "active" },
];
const STATS = {
  markets: [
    { symbol: "SOL", mark_price: 180.5, oracle_price: 180.4, prev_day_mark_price: 172, open_interest: 1, day_volume_usd: 9_000_000, current_funding_rate: 0.0001 },
    { symbol: "ETH", mark_price: "4100", oracle_price: 4099, prev_day_mark_price: 4200, day_volume_usd: 12_000_000 },
    { symbol: "NVDA", mark_price: null, oracle_price: "x", day_volume_usd: -5 },
    { symbol: "GHOST", mark_price: 1, day_volume_usd: 99_000_000 },
  ],
};

test("the market list joins the configuration and the stats, busiest first, and drops what cannot be opened", () => {
  const { markets, observedAt } = marketsFrom(CONFIG, STATS, 1_000);
  assert.equal(observedAt, 1_000);
  /* A closed or tombstoned market, a symbol that is a path, a second SOL and stats without a market are left out. */
  assert.deepEqual(markets.map((market) => market.symbol), ["ETH", "SOL", "NVDA"]);
  const [eth, sol, nvda] = markets;
  assert.equal(sol.status, "active");
  assert.equal(sol.maxLeverage, 20);
  assert.equal(eth.maxLeverage, 20, "the highest tier is the market's leverage");
  assert.equal(eth.markPrice, 4100, "a decimal string is a number");
  assert.equal(sol.dayVolumeUsd, 9_000_000);
  /* A calendar market with a status word other than `active` is gated; its session travels with it. */
  assert.equal(nvda.status, "gated");
  assert.equal(nvda.calendar, true);
  assert.equal(nvda.session, "closed");
  assert.equal(nvda.isolatedOnly, true);
  /* A price that is not a number, or a negative volume, is no number — never a zero. */
  assert.equal(nvda.markPrice, null);
  assert.equal(nvda.oraclePrice, null);
  assert.equal(nvda.dayVolumeUsd, null);
  assert.ok(Math.abs(dayChange(sol) - (180.5 / 172 - 1)) < 1e-12);
  assert.equal(dayChange(nvda), null);
});

test("Phoenix's own spelling travels on, and matching is case-blind", () => {
  const { markets } = marketsFrom([{ symbol: "kBONK", marketStatus: "active", leverageTiers: [] }], { markets: [{ symbol: "KBONK", mark_price: 0.02 }] }, 1);
  assert.equal(markets[0].symbol, "kBONK");
  assert.equal(markets[0].markPrice, 0.02);
  assert.equal(symbolKey("kBONK"), symbolKey("KBONK"));
  for (const name of ["book", "candles"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../app/api/solana/futures/${name}/route.ts`, import.meta.url), "utf8"), /toUpperCase/, `${name} changes Phoenix's spelling`);
  }
});

test("stats that failed leave the markets without prices rather than without markets", () => {
  const { markets } = marketsFrom(CONFIG, null, 1);
  assert.deepEqual(markets.map((market) => market.symbol), ["ETH", "SOL", "NVDA"]);
  assert.ok(markets.every((market) => market.markPrice === null && market.dayVolumeUsd === null));
  assert.deepEqual(marketsFrom({ not: "a list" }, STATS, 1).markets, []);
});

test("the book keeps valid levels only, bids from the best down and asks from the best up", () => {
  const book = bookFrom({ slot: 42, symbol: "SOL", bids: [[179, 2], [180, 1], [0, 5], ["x", 1], [178, -1]], asks: [[182, 1], [181, 3], [183]] }, "SOL", 7);
  assert.equal(book.slot, 42);
  assert.deepEqual(book.bids, [{ price: 180, size: 1 }, { price: 179, size: 2 }]);
  assert.deepEqual(book.asks, [{ price: 181, size: 3 }, { price: 182, size: 1 }]);
  assert.equal(book.observedAt, 7);
  assert.deepEqual(bookFrom(null, "SOL", 1).bids, []);
});

test("candles carry the traded price's bars and the mark price's, oldest first, never inside out", () => {
  const T = 1_792_000_800_000;
  const bars = [
    { time: T + 3_600_000, open: 10, high: 12, low: 9, close: 11, markOpen: 10, markHigh: 11, markLow: 9.5, markClose: 10.5, volume: 5, isFinal: true },
    { time: T, open: 9, high: 8, low: 10, close: 9.5, markOpen: 9, markHigh: 10, markLow: 8.5, markClose: 9.4, volume: null, isFinal: true },
    { time: T + 7_200_000, open: 11, high: 11, low: 11, close: 11, markOpen: null, markHigh: 1, markLow: 1, markClose: 1, isFinal: false },
    { time: "bad", open: 1, high: 1, low: 1, close: 1 },
  ];
  const read = candlesFrom({ symbol: "SOL", timeframe: "1h", bars, page: { hasMore: false } }, "SOL", "1h", 9);
  assert.deepEqual(read.last.map((bar) => bar.t), [T, T + 3_600_000, T + 7_200_000]);
  assert.deepEqual(read.mark.map((bar) => bar.t), [T, T + 3_600_000], "a bar without a mark price has no mark bar");
  /* A broken print with the high under the low keeps the bar's shape. */
  assert.equal(read.last[0].h, 10);
  assert.equal(read.last[0].l, 8);
  assert.equal(read.last[0].v, null);
  assert.equal(read.last[1].v, 5);
  assert.equal(read.last[2].final, false);
  assert.ok(read.mark.every((bar) => bar.v === null), "the mark price's bars carry no volume");
});

test("one candles read asks for the newest bars up to now, the open one included", () => {
  const now = Date.UTC(2026, 9, 20, 12, 30);
  const query = new URLSearchParams(candlesQuery("1h", now));
  assert.equal(query.get("timeframe"), "1h");
  assert.equal(query.get("includePartial"), "true");
  assert.equal(query.get("limit"), "500");
  const from = Number(query.get("from"));
  const to = Number(query.get("to"));
  assert.ok(to > now && to - 3_600_000 <= now, "the window ends with the open bar");
  assert.equal((to - from) / 3_600_000, 500, "exactly `limit` buckets, so a page never drops the open one");
  assert.equal(from % 3_600_000, 0);
  /* On a bucket's boundary the open bar is the one just starting. */
  const edge = new URLSearchParams(candlesQuery("1h", Date.UTC(2026, 9, 20, 12)));
  assert.equal(Number(edge.get("to")), Date.UTC(2026, 9, 20, 13));
});

test("the trader state: collateral across subaccounts, positions with their side, resting orders, closed rows left out", () => {
  const { markets } = marketsFrom(CONFIG, STATS, 1);
  const state = {
    authority: "W",
    traderPdaIndex: 0,
    slot: 1,
    slotIndex: 0,
    snapshot: {
      version: 1,
      capabilities: { flags: 0, state: "active", capabilities: {} },
      makerFeeOverrideMultiplier: 1,
      takerFeeOverrideMultiplier: 1,
      subaccounts: [
        {
          subaccountIndex: 0,
          sequence: 1,
          collateral: "1250500000",
          spotCollaterals: [{ assetIndex: 0, symbol: "SOL", balance: "2500000000", decimals: 9 }],
          positions: [
            { symbol: "kBONK", positionSequenceNumber: "4", basePositionLots: "-300" },
            {
              symbol: "SOL",
              positionSequenceNumber: "1",
              basePositionLots: "2500",
              entryPriceTicks: "17000",
              entryPriceUsd: "170.25",
              /* TP/SL as Phoenix's conditional orders (B6b): the standing trigger's price, in the market's ticks. */
              conditionalTakeProfitTriggers: [{ conditionalTakeProfitId: "3", status: "active", trigger: { triggerPriceTicks: "19000" } }],
              conditionalStopLossTriggers: [{ conditionalStopLossId: "3", status: "cancelled", trigger: { triggerPriceTicks: "15000" } }],
            },
            { symbol: "ETH", positionSequenceNumber: "2", basePositionLots: "-15000", basePositionUnits: "-1.5", entryPriceTicks: "41000" },
            { symbol: "SOL", positionSequenceNumber: "3", basePositionLots: "0" },
          ],
          orders: [
            {
              symbol: "SOL",
              orders: [
                { orderSequenceNumber: "9", side: "bid", orderType: "limit", priceTicks: "17500", priceUsd: "175", sizeRemainingLots: "1000", reduceOnly: false, status: "open" },
                { orderSequenceNumber: "10", side: "ask", orderType: "limit", priceTicks: "19000", priceUsd: "", sizeRemainingLots: "500", reduceOnly: true, isStopLoss: true, status: "open" },
                { change: "closed", orderSequenceNumber: "11", side: "bid", priceUsd: "1", sizeRemainingLots: "1" },
                { orderSequenceNumber: "12", side: "bid", priceUsd: "170", sizeRemainingLots: "0" },
              ],
            },
          ],
          splines: [],
          triggers: [],
        },
        { subaccountIndex: 1, sequence: 1, collateral: "500000", positions: [], orders: [], splines: [], triggers: [] },
      ],
    },
  };
  const account = accountFrom(state, "W", markets, 5);
  assert.equal(account.state, "active");
  assert.equal(account.collateralUsd, 1251, "quote lots are millionths of a dollar, summed over the subaccounts");
  assert.equal(account.collateralSol, 2.5, "SOL collateral in SOL, never folded into the dollars");
  assert.deepEqual(account.positions, [
    /* A market whose units are not known: the side from the lots' sign, the size unknown — shown, never hidden. */
    { symbol: "kBONK", subaccount: 0, side: "short", size: null, entryPrice: null, tpPrice: null, slPrice: null },
    { symbol: "SOL", subaccount: 0, side: "long", size: 2.5, entryPrice: 170.25, tpPrice: 190, slPrice: null },
    /* No entry in dollars: the ticks by the market's step — 41000 × 100 × 10⁴ / 10⁶ = $41,000. */
    { symbol: "ETH", subaccount: 0, side: "short", size: 1.5, entryPrice: 41_000, tpPrice: null, slPrice: null },
  ]);
  assert.equal(account.orders.length, 2);
  assert.deepEqual(account.orders[0], { id: "0:SOL:9", symbol: "SOL", subaccount: 0, side: "buy", type: "limit", price: 175, size: 1, reduceOnly: false, stop: false, status: "open", sequence: "9" });
  /* No price in dollars: the ticks, 19000 × 10 × 10³ / 10⁶ = $190. */
  assert.equal(account.orders[1].price, 190);
  assert.equal(account.orders[1].side, "sell");
  assert.equal(account.orders[1].stop, true);
  assert.equal(account.orders[1].reduceOnly, true);
});

test("a wallet Phoenix does not know has no account; a state word Phoenix did not send is unknown", () => {
  assert.equal(accountFrom({}, "W", [], 1).state, "none");
  assert.deepEqual(noAccount("W", 3), { wallet: "W", state: "none", collateralUsd: null, collateralSol: null, positions: [], orders: [], observedAt: 3 });
  const odd = accountFrom({ snapshot: { capabilities: { state: "weird" }, subaccounts: [{ subaccountIndex: 0, collateral: "0", positions: [], orders: [] }] } }, "W", [], 1);
  assert.equal(odd.state, "unknown");
  assert.equal(odd.collateralUsd, 0);
});

test("units: ticks in dollars by the market's step, a negative decimals market included; unrealised P&L at the mark", () => {
  assert.equal(ticksToUsd("17000", { tickSize: 10, baseLotsDecimals: 3 }), 170);
  /* PUMP has −2 base decimals (B7a §9): 10^−2 scales the tick down. */
  assert.equal(ticksToUsd(500, { tickSize: 2, baseLotsDecimals: -2 }), 0.00001);
  assert.equal(ticksToUsd("1", undefined), null);
  assert.equal(ticksToUsd("1", { tickSize: null, baseLotsDecimals: 3 }), null);
  assert.equal(unrealisedPnl({ side: "long", size: 2, entryPrice: 100 }, 110), 20);
  assert.equal(unrealisedPnl({ side: "short", size: 2, entryPrice: 100 }, 110), -20);
  assert.equal(unrealisedPnl({ side: "long", size: 2, entryPrice: null }, 110), null);
  assert.equal(unrealisedPnl({ side: "long", size: null, entryPrice: 100 }, 110), null);
  assert.equal(tickUsd({ tickSize: 10, baseLotsDecimals: 3 }), 0.01);
  assert.equal(lotUnits({ baseLotsDecimals: 3 }), 0.001);
  assert.equal(lotUnits({ baseLotsDecimals: -2 }), 100);
  assert.equal(lotUnits({ baseLotsDecimals: null }), null);
  assert.equal(num("1e3"), 1000);
  assert.equal(num(""), null);
  assert.equal(num(Number.NaN), null);
});

test("addresses: a symbol is never a path, a wallet is base58", () => {
  for (const ok of ["SOL", "FARTCOIN", "WTIOIL", "kBONK"]) assert.ok(SYMBOL.test(ok), ok);
  for (const bad of ["", "SOL/../x", "a b", "SOL?x=1", "x".repeat(21)]) assert.ok(!SYMBOL.test(bad), bad);
  assert.ok(WALLET.test("So11111111111111111111111111111111111111112"));
  assert.ok(!WALLET.test("0x0000000000000000000000000000000000000000"));
});

test("the reads are public and read only: no key, no signature, no order is built", () => {
  const server = readFileSync(new URL("./read.server.ts", import.meta.url), "utf8");
  const routes = ["markets", "book", "candles", "account", "funding", "history"].map((name) => readFileSync(new URL(`../../app/api/solana/futures/${name}/route.ts`, import.meta.url), "utf8"));
  for (const source of [server, ...routes]) {
    assert.doesNotMatch(source, /authorization|bearer|api[_-]?key|secret|private[_-]?key|signTransaction|sendTransaction|method:\s*"POST"/i);
  }
  /* Only GET routes; the account is never cached at the edge. */
  for (const source of routes) assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(routes[3], /"private"/);
  /* A wallet's own history is its own: never cached at the edge either (PERP-5). */
  assert.match(routes[5], /"private"/);
  /*
   * The reads the B7a audit named, the margin's view of the trader account (B6), the funding rates (PERP-4), the three
   * histories of one wallet (PERP-5: trades, orders, funding — all three under `/v1/trader/`), and no other host.
   */
  assert.deepEqual([...server.matchAll(/getJson\(`?"?(\/v1\/[^`"?$]*)/g)].map((match) => match[1]).sort(), ["/v1/candles_v2/", "/v1/funding/", "/v1/markets/stats/latest", "/v1/trader/", "/v1/trader/", "/v1/trader/", "/v1/trader/state/", "/v1/view/exchange/markets", "/v1/view/orderbook/", "/v1/view/trader/"]);
  /* The histories' own parser reads nothing: pure, and every field checked rather than trusted. */
  const history = readFileSync(new URL("./history.ts", import.meta.url), "utf8");
  assert.doesNotMatch(history, /fetch\(|authorization|bearer|api[_-]?key|secret|private[_-]?key/i);
  /* The ticket's margin (PERP-4) reads the same public views and the collateral assets; nothing else. */
  const margin = readFileSync(new URL("./margin.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(margin, /authorization|bearer|api[_-]?key|secret|private[_-]?key|signTransaction|sendTransaction|method:\s*"POST"/i);
  assert.deepEqual([...margin.matchAll(/getJson\(`?"?(\/v1\/[^`"?$]*)/g)].map((match) => match[1]).sort(), ["/v1/collateral/assets", "/v1/markets/stats/latest", "/v1/trader/state/", "/v1/view/exchange/markets"]);
});

test("the tiers in the asset, the maintenance share and the open interest from the configuration (PERP-2)", () => {
  const config = [
    { symbol: "SOL", marketStatus: "active", tickSize: 10, baseLotsDecimals: 3, leverageTiers: [tier(10, 50_000_000), tier(20, 1_000_000)], riskFactors: { maintenance: 50, maintenanceBps: 5000 }, statsSnapshot: { openInterestBaseLots: "123456789" } },
    { symbol: "PUMP", marketStatus: "active", tickSize: 1, baseLotsDecimals: -2, leverageTiers: [tier(5, 10)], riskFactors: { maintenance: 40 } },
    { symbol: "ODD", marketStatus: "active", tickSize: 1, baseLotsDecimals: 0, leverageTiers: [{ maxLeverage: 3 }], riskFactors: { maintenance: 400 } },
  ];
  const [sol, pump, odd] = marketsFrom(config, null, 1).markets;
  /* Smallest first: the high leverage holds up to its size, the next tier's beyond it. */
  assert.deepEqual(sol.leverageTiers, [{ maxLeverage: 20, maxSizeUnits: 1_000 }, { maxLeverage: 10, maxSizeUnits: 50_000 }]);
  assert.equal(sol.maintenanceRatio, 0.5, "the basis points first");
  assert.ok(Math.abs(sol.openInterestUnits - 123_456.789) < 1e-9, "base lots by the market's decimals");
  assert.deepEqual(pump.leverageTiers, [{ maxLeverage: 5, maxSizeUnits: 1_000 }], "a lot of a hundred tokens");
  assert.equal(pump.maintenanceRatio, 0.4, "the percentage when no basis points");
  assert.equal(pump.openInterestUnits, null);
  assert.deepEqual(odd.leverageTiers, [{ maxLeverage: 3, maxSizeUnits: null }], "a tier without a bound has no ceiling");
  assert.equal(odd.maintenanceRatio, null, "four hundred per cent is no share");
});

test("where a market stands (PERP-4): trading, its underlying closed, priced by Phoenix itself, paused — or not known", () => {
  assert.equal(marketStateOf("active", false, null), "trading", "a market without a calendar trades around the clock");
  assert.equal(marketStateOf("Active", true, "open"), "trading");
  assert.equal(marketStateOf("active", true, "active"), "trading");
  assert.equal(marketStateOf("active", true, "closed"), "underlyingClosed");
  assert.equal(marketStateOf("active", true, "afterHours"), "internalPricing");
  assert.equal(marketStateOf("active", true, "after-hours"), "internalPricing");
  assert.equal(marketStateOf("active", true, "closed", true), "internalPricing", "Phoenix's own after-hours flag wins");
  assert.equal(marketStateOf("postOnly", true, "open"), "paused", "any listing word but active holds the market");
  assert.equal(marketStateOf("gated", false, null), "paused");
  assert.equal(marketStateOf("active", true, "weekend-maintenance"), "unknown", "a word Ryntra does not know is never «trading» on a guess");
  assert.equal(marketStateOf("active", true, null), "unknown");
  /* An answer read before PERP-4 carried no state: its listing word alone. */
  assert.equal(stateOf({ status: "active" }), "trading");
  assert.equal(stateOf({ status: "gated" }), "paused");
  const { markets } = marketsFrom(CONFIG, STATS, 1_000);
  assert.deepEqual(markets.map((market) => [market.symbol, market.state]), [["ETH", "trading"], ["SOL", "trading"], ["NVDA", "paused"]]);
});

test("the catalog's groups: a class word Phoenix sends, else by the calendar — commodities and equity unsplit when Phoenix does not split them", () => {
  assert.equal(groupOf(["Equity"], true), "equity");
  assert.equal(groupOf(["pre-ipo", "stocks"], true), "equity");
  assert.equal(groupOf(["commodities"], true), "commodity");
  assert.equal(groupOf(["crypto"], false), "crypto");
  /* SDK 0.6.2 has no asset class: `isCommodity` marks gold and Tesla alike; tags like `new-listing` say nothing of it. */
  assert.equal(groupOf(["new-listing"], true), "rwa");
  assert.equal(groupOf(null, true), "rwa");
  assert.equal(groupOf(undefined, false), "crypto");
  const { markets } = marketsFrom(
    [
      { symbol: "TSLA", marketStatus: "active", commodityMetadata: { isCommodity: true, status: "open" }, metadata: { name: "Tesla", searchAliases: ["Tesla Inc", 7, ""], classifications: ["equity"] }, leverageTiers: [] },
      { symbol: "GOLD", marketStatus: "active", commodityMetadata: { isCommodity: true, status: "open" }, leverageTiers: [] },
      { symbol: "BTC", marketStatus: "active", metadata: { name: "Bitcoin" }, leverageTiers: [] },
    ],
    null,
    0,
  );
  assert.deepEqual(markets.map((market) => [market.symbol, market.group, market.name]), [["TSLA", "equity", "Tesla"], ["GOLD", "rwa", null], ["BTC", "crypto", "Bitcoin"]]);
  assert.deepEqual(markets[0].aliases, ["Tesla Inc"], "only words, short and few");
  /* Search finds a market by its symbol, Phoenix's name or an alias, case-blind. */
  assert.ok(marketMatches(markets[0], "tesla"));
  assert.ok(marketMatches(markets[0], "inc"));
  assert.ok(marketMatches(markets[2], "bit"));
  assert.ok(marketMatches(markets[1], " "));
  assert.equal(marketMatches(markets[1], "tesla"), false);
});

test("mark against index, signed; funding from the field that names its unit, with who pays only where the gap agrees", () => {
  assert.deepEqual(markIndexGap({ markPrice: 101, oraclePrice: 100 }), { usd: 1, fraction: 0.010000000000000009 });
  assert.ok(markIndexGap({ markPrice: 99, oraclePrice: 100 }).usd < 0);
  assert.equal(markIndexGap({ markPrice: 99, oraclePrice: null }), null);
  const now = 1_761_400_000_000;
  const funding = fundingFrom({ marketId: 1, symbol: "SOL", rates: [{ timestamp: 1_761_396_400, fundingRatePercentage: "0.0010" }, { timestamp: 1_761_400_000, fundingRatePercentage: "-0.0012" }, { timestamp: "x", fundingRatePercentage: "1" }, { timestamp: 1_761_399_000, fundingRatePercentage: "9" }] }, "SOL", now);
  assert.deepEqual(funding, { symbol: "SOL", ratePercent: -0.0012, at: 1_761_400_000_000, periodSeconds: 3_600, observedAt: now }, "newest first, its period from the spacing; a point past five per cent is a misread");
  assert.equal(fundingFrom({ rates: [] }, "SOL", now), null);
  assert.equal(fundingFrom({ rates: [{ timestamp: (now - 7 * 3_600_000) / 1000, fundingRatePercentage: "0.001" }] }, "SOL", now), null, "a rate older than six hours is history");
  assert.equal(fundingFrom({ rates: [{ timestamp: new Date(now).toISOString(), fundingRatePercentage: "0.001" }] }, "SOL", now).periodSeconds, null, "one point: its period is not known");
  /* Positive and the mark above the index: longs pay. Disagreeing signs: not said. */
  assert.equal(fundingPayer(0.001, { usd: 0.2 }), "long");
  assert.equal(fundingPayer(-0.001, { usd: -0.2 }), "short");
  assert.equal(fundingPayer(0.001, { usd: -0.2 }), null);
  assert.equal(fundingPayer(0.001, null), null);
  /* The next settlement: the interval's start stepped until it is ahead. */
  assert.equal(nextFundingAt("1761400000", 3_600, 1_761_400_000_000 + 10), 1_761_403_600_000);
  assert.equal(nextFundingAt(1_761_400_000_000, 3_600, 1_761_400_000_000 + 2.5 * 3_600_000), 1_761_400_000_000 + 3 * 3_600_000);
  assert.equal(nextFundingAt(null, 3_600, 0), null);
  assert.equal(nextFundingAt("1761400000", null, 0), null);
});
