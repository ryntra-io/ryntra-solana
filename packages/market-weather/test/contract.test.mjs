/* The contract's rules: source and time, the liquidity floor, two reads, «data delayed», and «not measured» ≠ zero. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_POLICY,
  authorityReadsFromChain,
  createWeatherStream,
  judgeAuthority,
  judgeLifecycle,
  judgeSignal,
  judgeWeather,
  measure,
  safeTicker,
  shown,
} from "../src/index.ts";

const NOW = Date.parse("2026-09-21T12:01:00Z");
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();
const read = (source, value, secondsAgo = 10) => ({ source, url: `https://example.org/${source}`, observedAt: at(secondsAgo), timeFrom: "read", value: measure(value) });
const deep = measure(1_000_000);
const signal = (reads, liquidityUsd = deep, kind = "price") => judgeSignal({ asset: "A", kind, reads, liquidityUsd, now: NOW });

test("a figure nobody measured is «not measured», a measured zero is a zero", () => {
  for (const raw of [undefined, null, "1", Number.NaN, Number.POSITIVE_INFINITY, {}]) assert.equal(measure(raw).state, "not_measured", String(raw));
  assert.deepEqual(measure(0), { state: "measured", value: 0 });
  assert.equal(shown(measure(undefined), String), "Not measured");
  assert.equal(shown(measure(undefined), String, "uk"), "Не виміряно");
  assert.equal(shown(measure(0), String), "0");
});

test("no measured read: the signal is not measured, with no source and no time", () => {
  const result = signal([read("jupiter-price-v3", undefined)]);
  assert.equal(result.status, "not_measured");
  assert.equal(result.source, null);
  assert.equal(result.at, null);
});

test("every signal names the source and the time of its freshest reading", () => {
  const result = signal([read("jupiter-price-v3", 10, 30), read("meteora-dlmm", 10.05, 5)]);
  assert.equal(result.source, "meteora-dlmm");
  assert.equal(result.at, at(5));
  assert.equal(result.reads.length, 2);
});

test("below the liquidity floor, or with depth unmeasured, a market is thin whatever its reads say", () => {
  const reads = [read("jupiter-price-v3", 10), read("meteora-dlmm", 10)];
  assert.equal(signal(reads, measure(DEFAULT_POLICY.minLiquidityUsd - 1)).status, "thin");
  const unknown = signal(reads, measure(undefined));
  assert.equal(unknown.status, "thin");
  assert.equal(unknown.why, "liquidity not measured");
  assert.equal(signal(reads, measure(DEFAULT_POLICY.minLiquidityUsd)).status, "live");
});

test("two reads from two sources that agree are live, at their mean", () => {
  const result = signal([read("jupiter-price-v3", 100), read("meteora-dlmm", 101)]);
  assert.equal(result.status, "live");
  assert.deepEqual(result.value, { state: "measured", value: 100.5 });
});

test("one source is a single read — even when it answered twice", () => {
  assert.equal(signal([read("jupiter-price-v3", 100)]).status, "single_read");
  assert.equal(signal([read("jupiter-price-v3", 100, 20), read("jupiter-price-v3", 100, 5)]).status, "single_read");
});

test("two sources that differ beyond the tolerance disagree", () => {
  const result = signal([read("jupiter-price-v3", 100), read("meteora-dlmm", 103)]);
  assert.equal(result.status, "disagree");
  assert.equal(result.why, "sources disagree");
});

test("moves agree only in the same direction and close in size", () => {
  const move = (a, b) => signal([read("jupiter-price-v3", a), read("jupiter-tokens-v2", b)], deep, "change24h").status;
  assert.equal(move(4, 4.8), "live");
  assert.equal(move(4, 6), "disagree");
  assert.equal(move(0.6, -0.6), "live", "both flat within the tolerance");
  assert.equal(move(2, -2), "disagree");
});

test("when the freshest read is late, or the second source is late, the signal is delayed", () => {
  const late = DEFAULT_POLICY.maxAgeMs / 1000 + 1;
  assert.equal(signal([read("jupiter-price-v3", 100, late), read("meteora-dlmm", 100, late)]).status, "delayed");
  const second = signal([read("jupiter-price-v3", 100, 5), read("meteora-dlmm", 100, late)]);
  assert.equal(second.status, "delayed", "a late second read does not count as a read, and is not silence either");
  assert.equal(second.why, "a second read is late");
  assert.equal(signal([{ ...read("jupiter-price-v3", 100), observedAt: "not a time" }]).status, "delayed");
});

test("issuer badges: agreement, dispute, silence", () => {
  const authority = (source, state) => ({ authority: "mint", source, url: "https://example.org", observedAt: at(1), state });
  assert.equal(judgeAuthority("mint", []).state, "not_measured");
  assert.equal(judgeAuthority("mint", [authority("jupiter-tokens-v2", "not_measured")]).state, "not_measured");
  assert.equal(judgeAuthority("mint", [authority("jupiter-tokens-v2", "revoked"), authority("solana-rpc", "revoked")]).state, "revoked");
  assert.equal(judgeAuthority("mint", [authority("jupiter-tokens-v2", "revoked"), authority("solana-rpc", "active")]).state, "disputed");
  assert.equal(judgeAuthority("freeze", [authority("jupiter-tokens-v2", "active")]).state, "not_measured", "a mint read says nothing of freeze");
});

test("issuer badges from a chain read: an empty slot is revoked, an address is active, an unread slot is silence", () => {
  const reads = authorityReadsFromChain({ mintAuthority: null, freezeAuthority: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", observedAt: at(1), url: "https://example.org/rpc" });
  assert.deepEqual(reads.map((r) => [r.authority, r.state, r.source]), [["mint", "revoked", "solana-rpc"], ["freeze", "active", "solana-rpc"]]);
  assert.equal(authorityReadsFromChain({ observedAt: at(1), url: "x" })[0].state, "not_measured");
});

test("a DBC launch: curve, then graduated; survival checks wait for their day and need the pool's figures", () => {
  const base = { asset: "A", launchpad: "met-dbc", now: NOW };
  assert.equal(judgeLifecycle({ ...base, launchpad: "pump.fun", graduatedPool: null, graduatedAt: null, pool: null }), null, "not a DBC launch");
  const curve = judgeLifecycle({ ...base, graduatedPool: null, graduatedAt: null, pool: null });
  assert.equal(curve.stage, "curve");
  assert.equal(curve.curveProgressPct.state, "not_measured");
  const address = "MWDemoPoo1Graduated1111111111111111111111111";
  const pool = { address, confirmed: true, tvlUsd: measure(80_000), volume24hUsd: measure(1_000), url: "https://example.org/pool" };
  const graduatedAt = new Date(NOW - 31 * 86_400_000).toISOString();
  const alive = judgeLifecycle({ ...base, graduatedPool: address, graduatedAt, pool });
  assert.deepEqual(alive.survival.map((check) => check.state), ["alive", "alive", "pending"]);
  const quiet = judgeLifecycle({ ...base, graduatedPool: address, graduatedAt, pool: { ...pool, volume24hUsd: measure(0) } });
  assert.deepEqual(quiet.survival.map((check) => check.state), ["quiet", "quiet", "pending"]);
  const unconfirmed = judgeLifecycle({ ...base, graduatedPool: address, graduatedAt, pool: null });
  assert.equal(unconfirmed.pool.confirmed, false);
  assert.deepEqual(unconfirmed.survival.map((check) => check.state), ["not_measured", "not_measured", "pending"]);
});

const asset = (id, change, { liquidity = 1_000_000, secondsAgo = 10, verified = true, symbol = id } = {}) => ({
  asset: id,
  symbol,
  verified,
  liquidityUsd: measure(liquidity),
  priceReads: [read("jupiter-price-v3", 1, secondsAgo), read("meteora-dlmm", 1, secondsAgo)],
  moveReads: [read("jupiter-price-v3", change, secondsAgo), read("jupiter-tokens-v2", change, secondsAgo)],
  authorityReads: [],
  lifecycle: null,
});

test("the sky follows the depth-weighted move of the live assets", () => {
  const sky = (...changes) => judgeWeather(changes.map((change, index) => asset(`A${index}`, change)), NOW).state;
  assert.equal(sky(3, 4, 2.5), "sun");
  assert.equal(sky(0.5, 0.2, -0.1), "clear");
  assert.equal(sky(-0.5, -0.2, 0.1), "cloud");
  assert.equal(sky(-3, -2.5, -4), "rain");
  assert.equal(sky(-9, -8, -10), "storm");
});

test("too few live assets is not measured; half the assets late is fog with «data delayed»", () => {
  const few = judgeWeather([asset("A", 3), asset("B", 3)], NOW);
  assert.equal(few.state, "not_measured");
  assert.equal(few.move.state, "not_measured");
  const late = DEFAULT_POLICY.maxAgeMs / 1000 + 5;
  const fog = judgeWeather([asset("A", 3), asset("B", 3, { secondsAgo: late }), asset("C", 3, { secondsAgo: late }), asset("D", 3)], NOW);
  assert.equal(fog.state, "fog");
  assert.equal(fog.delayed, true);
  const thin = judgeWeather([asset("A", 3), asset("B", 3), asset("C", 3, { liquidity: 10 })], NOW);
  assert.equal(thin.counted, 2, "a thin market does not move the sky");
});

test("a ticker is shown only when the token is verified and the ticker is plain", () => {
  assert.equal(safeTicker("SOL"), "SOL");
  assert.equal(safeTicker("‮CDSU"), null);
  assert.equal(safeTicker("US​DC"), null);
  assert.equal(safeTicker("UЅDC"), null, "a Cyrillic letter");
  assert.equal(safeTicker("A_VERY_LONG_TICKER"), null);
  const weather = judgeWeather([asset("A", 1, { verified: false, symbol: "MOON" }), asset("B", 1), asset("C", 1)], NOW);
  assert.equal(weather.assets[0].label, null);
  assert.equal(weather.assets[1].label, "B");
});

test("the stream: a move fires on the second weather that shows it, then waits out the cooldown", () => {
  const stream = createWeatherStream();
  /* A weather judged `seconds` after NOW, from reads taken five seconds before it. */
  const weatherAt = (seconds, change) => {
    const secondsAgo = 5 - seconds;
    return judgeWeather([asset("A", change, { secondsAgo }), asset("B", 0.1, { secondsAgo }), asset("C", 0.1, { secondsAgo })], NOW + seconds * 1000);
  };
  const first = stream.push(weatherAt(0, 9));
  assert.deepEqual(first.map((event) => event.type), ["weather"], "one read of a spike is not an event");
  const second = stream.push(weatherAt(60, 9));
  assert.deepEqual(second.map((event) => [event.type, event.asset, event.direction]), [["move", "A", "up"]]);
  assert.deepEqual(stream.push(weatherAt(120, 9)), [], "inside the cooldown");
  const later = stream.push(weatherAt(60 + DEFAULT_POLICY.cooldownMs / 1000, 9));
  assert.equal(later.filter((event) => event.type === "move").length, 1, "after the cooldown");
});

test("the stream says when the data turns late and when it recovers", () => {
  const stream = createWeatherStream();
  const late = DEFAULT_POLICY.maxAgeMs / 1000 + 5;
  const fresh = judgeWeather([asset("A", 1), asset("B", 1), asset("C", 1)], NOW);
  const stale = judgeWeather([asset("A", 1, { secondsAgo: late }), asset("B", 1, { secondsAgo: late }), asset("C", 1)], NOW);
  stream.push(fresh);
  assert.deepEqual(stream.push(stale).map((event) => event.type), ["weather", "delayed"]);
  assert.deepEqual(stream.push(fresh).map((event) => event.type), ["weather", "recovered"]);
});
