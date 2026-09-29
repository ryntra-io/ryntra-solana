// Run from repo root: node --test lib/domain/instrument-registry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstrumentRegistry } from "./instrument-registry.ts";
import { instrumentId } from "./instrument.ts";

const NVDA = { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 };
const BTC = { symbol: "BTC", address: "0x" + "1".repeat(40), decimals: 8, category: "CRYPTO" };
const USDG = { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 };
const FEEDS = { NVDA: { proxy: "0x" + "a".repeat(40), decimals: 8, heartbeat: 86400 } };

test("builds records with verified metadata, oracle feed joined by symbol", () => {
  const reg = buildInstrumentRegistry([NVDA, BTC], FEEDS, "2026-07-12");
  assert.equal(reg.length, 2);
  const nvda = reg.find((r) => r.key.base === "NVDA");
  assert.equal(nvda.key.kind, "spot-tokenized-equity");
  assert.equal(nvda.address, NVDA.address);
  assert.equal(nvda.oracleFeed, FEEDS.NVDA.proxy);
  assert.equal(nvda.hasUiMultiplier, true);
  assert.equal(nvda.marketHours, "equities-rth");
  assert.equal(nvda.source, "live-probe");
  assert.equal(nvda.verifiedAt, "2026-07-12");
  assert.equal(instrumentId(nvda.key), "robinhood-chain:spot-tokenized-equity:NVDA/USDG");
});

test("crypto category maps to spot-crypto with 24/7 hours and no multiplier expectation", () => {
  const reg = buildInstrumentRegistry([BTC], {}, "2026-07-12");
  assert.equal(reg[0].key.kind, "spot-crypto");
  assert.equal(reg[0].marketHours, "24-7");
  assert.equal(reg[0].hasUiMultiplier, false);
});

test("INVARIANT: missing feed stays null (unknown downstream), never a fabricated address", () => {
  const reg = buildInstrumentRegistry([NVDA], {}, "2026-07-12");
  assert.equal(reg[0].oracleFeed, null);
});

test("quote asset, bad addresses and duplicates are excluded", () => {
  const reg = buildInstrumentRegistry(
    [USDG, NVDA, { ...NVDA }, { symbol: "BAD", address: "not-an-address", decimals: 18 }, { symbol: "", address: NVDA.address, decimals: 18 }],
    {},
    "2026-07-12"
  );
  assert.equal(reg.length, 1);
  assert.equal(reg[0].key.base, "NVDA");
});
