// Run from repo root: node --test lib/venues/hyperliquid/adapter.test.mjs
// Fixtures mirror the OFFICIAL docs examples (hyperliquid.gitbook.io, fetched 2026-07-12), so
// these tests pin the doc-verified wire shapes, not our wishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHyperliquidVenue } from "./index.ts";
import { venueExecutionAvailable } from "../types.ts";

const META = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 50 },
    { name: "ETH", szDecimals: 4, maxLeverage: 50 },
    { name: "OLD", szDecimals: 2, maxLeverage: 10, isDelisted: true },
  ],
};

const CTXS = [
  { funding: "0.0000125", markPx: "113377.0", midPx: "113376.5", oraclePx: "113300.0", openInterest: "688.11", premium: "0.00031774", dayNtlVlm: "1169046.2", prevDayPx: "111000.0", impactPxs: ["113370", "113380"] },
  { funding: "-0.0000042", markPx: "2986.3", midPx: null, oraclePx: "2990.0", openInterest: "100.0", premium: null, dayNtlVlm: "5.0", prevDayPx: "3000.0", impactPxs: null },
  { funding: "0", markPx: "1.0", midPx: null, oraclePx: "1.0", openInterest: "0", premium: null, dayNtlVlm: "0", prevDayPx: "1", impactPxs: null },
];

const CLEARINGHOUSE = {
  assetPositions: [
    { type: "oneWay", position: { coin: "ETH", szi: "0.0335", entryPx: "2986.3", positionValue: "100.02", unrealizedPnl: "-0.0134", liquidationPx: "2866.26936529", marginUsed: "4.96", maxLeverage: 50, leverage: { type: "isolated", value: 20 } } },
    { type: "oneWay", position: { coin: "BTC", szi: "-0.5", entryPx: "113000", positionValue: "56500", unrealizedPnl: "12.5", liquidationPx: null, marginUsed: "100", maxLeverage: 50, leverage: { type: "cross", value: 10 } } },
  ],
  marginSummary: { accountValue: "13104.5", totalMarginUsed: "104.9", totalNtlPos: "56600", totalRawUsd: "13000" },
  withdrawable: "13104.514502",
  time: 1708622398623,
};

const FILLS = [
  { coin: "AVAX", px: "18.435", sz: "93.53", side: "B", time: 1681222254710, closedPnl: "0.0", dir: "Open Long", hash: "0xabc", oid: 90542681, tid: 118906512037719, fee: "0.01", feeToken: "USDC", builderFee: "0.005" },
  { coin: "ETH", px: "2990.0", sz: "1.0", side: "A", time: 1681222254999, closedPnl: "15.75", dir: "Close Long", hash: "0xdef", oid: 90542682, tid: 118906512037720, fee: "-0.002", feeToken: "USDC" },
];

const OPEN_ORDERS = [
  { coin: "BTC", side: "A", limitPx: "29792.0", sz: "3.0", origSz: "5.0", oid: 91490942, timestamp: 1681247412573, orderType: "Limit", reduceOnly: false, isTrigger: false, triggerPx: "0.0", triggerCondition: "N/A" },
];

const CANDLES = [
  { t: 1681923600000, T: 1681924499999, s: "BTC", i: "15m", o: "29295.0", c: "29258.0", h: "29309.0", l: "29250.0", v: "0.98639", n: 189 },
];

function fixtureTransport(log = []) {
  return async (body) => {
    log.push(body);
    switch (body.type) {
      case "meta": return META;
      case "metaAndAssetCtxs": return [META, CTXS];
      case "clearinghouseState": return CLEARINGHOUSE;
      case "userFills": return FILLS;
      case "frontendOpenOrders": return OPEN_ORDERS;
      case "candleSnapshot": return CANDLES;
      default: throw new Error(`unexpected info type ${body.type}`);
    }
  };
}

test("READ-ONLY INVARIANT: no exec port, no withdrawal authority, wallet-signed only", () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  assert.equal(v.exec, undefined);
  assert.equal(v.capabilities.withdrawals, false);
  assert.equal(v.capabilities.walletSignedExec, true);
  assert.equal(v.economics.earnsToday, false); // no approval flow shipped → no revenue claim
  // capabilities describe ADAPTER coverage, not the venue brochure: no spot reads → no spot claim
  assert.equal(v.capabilities.spot, false);
  assert.equal(v.capabilities.spotModel, null);
  // shipped execution is signaled ONLY by the exec port — walletSignedExec is a non-custody
  // invariant, not an availability claim
  assert.equal(venueExecutionAvailable(v), false);
});

test("HYPERCORE MODEL: settlement is HyperCore (no fake EVM id); HyperEVM 999 never borrowed", () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  assert.equal(v.meta.chainId, null); // HyperCore is not an EVM chain — no numeric id
  assert.equal(v.meta.chainName, "HyperCore");
  assert.equal(v.meta.signingFamily, "evm"); // wallets sign EVM-style — a SEPARATE concept
});

test("catalog: szDecimals→stepSize, delisted→offline, no fabricated tick/minNotional", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const ms = await v.catalog.listMarkets();
  assert.equal(ms.length, 3);
  const btc = ms.find((m) => m.symbol === "BTC");
  assert.equal(btc.stepSize, "0.00001");
  assert.equal(btc.maxLeverage, 50);
  assert.equal(btc.tickSize, null);
  assert.equal(btc.minNotional, null);
  assert.equal(btc.quoteModel, "clob");
  assert.equal(ms.find((m) => m.symbol === "OLD").online, false);
  assert.equal((await v.catalog.getMarket("ETH")).symbol, "ETH");
  assert.equal(await v.catalog.getMarket("NOPE"), null);
});

test("candles: epoch ms → unix seconds, string numerics → numbers", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const cs = await v.data.candles("BTC", "15m", 24);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].time, 1681923600); // seconds, not ms
  assert.equal(cs[0].open, 29295);
  assert.equal(cs[0].volume, 0.98639);
});

test("positions: signed szi → side/size; null liquidation stays null", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const ps = await v.account.positions("0x" + "1".repeat(40));
  const eth = ps.find((p) => p.symbol === "ETH");
  assert.equal(eth.side, "long");
  assert.equal(eth.size, 0.0335);
  assert.equal(eth.liquidationPrice, 2866.26936529);
  assert.equal(eth.markPrice, null); // not in payload — never guessed
  const btc = ps.find((p) => p.symbol === "BTC");
  assert.equal(btc.side, "short");
  assert.equal(btc.size, 0.5);
  assert.equal(btc.liquidationPrice, null);
});

test("fills: B/A → buy/sell; fee passes through including rebates (negative)", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const fs = await v.account.fills("0x" + "1".repeat(40));
  assert.equal(fs[0].side, "buy");
  assert.equal(fs[0].fee, 0.01);
  assert.equal(fs[1].side, "sell");
  assert.equal(fs[1].fee, -0.002); // rebate stays negative — never clamped to 0
  assert.equal(fs[1].realizedPnl, 15.75);
  assert.equal(fs[0].createdAt, 1681222254710);
});

test("orders: filled = origSz − remaining", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const os = await v.account.orders("0x" + "1".repeat(40));
  assert.equal(os[0].size, 5);
  assert.equal(os[0].remaining, 3);
  assert.equal(os[0].filled, 2);
  assert.equal(os[0].side, "sell");
  assert.equal(os[0].status, "open");
});

test("risk snapshot: premium from mark/oracle, hourly funding, 1/maxLeverage margin; unexposed signals stay null", async () => {
  const v = makeHyperliquidVenue(fixtureTransport());
  const s = await v.risk.snapshot("BTC");
  assert.equal(s.assetType, "crypto");
  assert.equal(s.fundingRateHourly, 0.0000125);
  assert.ok(Math.abs(s.premiumPct - ((113377 / 113300 - 1) * 100)) < 1e-9);
  assert.equal(s.initialMarginFraction, 1 / 50);
  assert.equal(s.oracleFresh, null); // not exposed by the venue → unknown, never a fake healthy
  assert.equal(s.oraclePaused, null);
  assert.equal(s.sequencerUp, null);
  assert.equal(s.offHours, false);
  assert.equal(await v.risk.snapshot("NOPE"), null);
});
