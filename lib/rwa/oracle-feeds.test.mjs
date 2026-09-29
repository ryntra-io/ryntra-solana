import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOracleFeeds, classifyOracleFresh } from "./oracle-feeds.ts";

const SAMPLE = [
  { name: "Robinhood TSLA / USD", proxyAddress: "0x4A1166a659A55625345e9515b32adECea5547C38", decimals: 8, heartbeat: 86400, docs: { baseAssetEntityId: "crypto-RHTSLA" } },
  { name: "Robinhood SGOV-USD", proxyAddress: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", decimals: 8, heartbeat: 86400, docs: { baseAssetEntityId: "crypto-RHSGOV" } },
  { name: "USDG / USD", proxyAddress: "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2", decimals: 8, heartbeat: 86400, docs: {} },
  { name: "junk", proxyAddress: "not-an-address" }, // dropped
  { name: "Robinhood NVDA / USD", proxyAddress: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", decimalPlaces: 8, docs: { baseAssetEntityId: "crypto-RHNVDA" } },
];

test("parseOracleFeeds maps stock symbols to feed proxies", () => {
  const m = parseOracleFeeds(SAMPLE);
  assert.equal(m.TSLA.proxy, "0x4A1166a659A55625345e9515b32adECea5547C38");
  assert.equal(m.TSLA.decimals, 8);
  assert.equal(m.TSLA.heartbeat, 86400);
  assert.equal(m.SGOV.proxy, "0xa0DF4ee0fFf975306345875E3548Fcc519577A11"); // name form "X-USD"
  assert.equal(m.USDG.proxy, "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2"); // no baseAssetEntityId → name
  assert.equal(m.NVDA.decimals, 8); // falls back to decimalPlaces
  assert.ok(!("junk" in m)); // invalid address dropped
});

test("parseOracleFeeds tolerates garbage input", () => {
  assert.deepEqual(parseOracleFeeds(null), {});
  assert.deepEqual(parseOracleFeeds({}), {});
  assert.deepEqual(parseOracleFeeds("nope"), {});
});

test("classifyOracleFresh: fresh within heartbeat", () => {
  const now = 1_000_000;
  assert.equal(classifyOracleFresh({ price: 403.5, updatedAt: now - 3600 }, 86400, now), true);
});

test("classifyOracleFresh: stale beyond heartbeat → false (avoid)", () => {
  const now = 1_000_000;
  assert.equal(classifyOracleFresh({ price: 403.5, updatedAt: now - 90000 }, 86400, now), false);
});

test("classifyOracleFresh: non-positive answer → false", () => {
  const now = 1_000_000;
  assert.equal(classifyOracleFresh({ price: 0, updatedAt: now - 10 }, 86400, now), false);
});

test("classifyOracleFresh: unreadable → null (unknown, never fake healthy)", () => {
  const now = 1_000_000;
  assert.equal(classifyOracleFresh(null, 86400, now), null);
  assert.equal(classifyOracleFresh({ price: null, updatedAt: null }, 86400, now), null);
  assert.equal(classifyOracleFresh({ price: 100, updatedAt: null }, 86400, now), null);
});
