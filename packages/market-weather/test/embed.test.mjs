/* The city embed: the layout in Node, the input gate, and the one-file build that a WebView loads. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { acceptWeather, judgeWeather, layoutCity, measure, towerAt, STALE_MS } from "../src/index.ts";

const NOW = Date.parse("2026-09-21T12:01:00Z");
const read = (source, value) => ({ source, url: "https://example.org", observedAt: new Date(NOW - 10_000).toISOString(), timeFrom: "read", value: measure(value) });
const authority = (kind, state) => ({ authority: kind, source: "jupiter-tokens-v2", url: "https://example.org", observedAt: new Date(NOW).toISOString(), state });
const asset = (id, change, liquidity, extra = {}) => ({
  asset: id,
  symbol: id,
  verified: true,
  liquidityUsd: measure(liquidity),
  priceReads: [read("jupiter-price-v3", 2), read("meteora-dlmm", 2)],
  moveReads: [read("jupiter-price-v3", change), read("jupiter-tokens-v2", change)],
  authorityReads: [authority("mint", "revoked"), authority("freeze", "revoked")],
  lifecycle: null,
  ...extra,
});

const weather = judgeWeather(
  [
    asset("DEEP", 4, 1e9),
    asset("MID", -6, 1e6),
    asset("SMALL", 0.1, 1e5, { authorityReads: [authority("mint", "active"), authority("freeze", "not_measured")] }),
    asset("ANON", 3, 2e5, { verified: false }),
    asset("UNREAD", 3, undefined),
  ],
  NOW,
);
const size = { width: 800, height: 500 };

test("the deepest tower stands in the middle and is the tallest", () => {
  const scene = layoutCity(weather, size);
  const tallest = [...scene.towers].sort((a, b) => b.h - a.h)[0];
  assert.equal(tallest.asset, "DEEP");
  const middle = scene.towers[Math.floor(scene.towers.length / 2)];
  assert.equal(middle.asset, "DEEP");
  for (const tower of scene.towers) assert.ok(tower.x >= 0 && tower.x + tower.w <= size.width && tower.h > 0 && tower.h < scene.ground);
});

test("windows burn by direction; a tower without a live move is lit neither way", () => {
  const byId = new Map(layoutCity(weather, size).towers.map((tower) => [tower.asset, tower]));
  assert.equal(byId.get("DEEP").tone, "up");
  assert.equal(byId.get("MID").tone, "down");
  assert.equal(byId.get("SMALL").tone, "flat");
  assert.equal(byId.get("UNREAD").tone, "unknown", "unmeasured depth is thin: no live move");
  assert.ok(byId.get("MID").intensity > byId.get("DEEP").intensity, "a bigger move burns brighter");
});

test("unverified or unmeasured: a scaffold without a name; badges carry the issuer's powers", () => {
  const byId = new Map(layoutCity(weather, size).towers.map((tower) => [tower.asset, tower]));
  assert.deepEqual([byId.get("ANON").scaffold, byId.get("ANON").label], [true, null]);
  assert.deepEqual([byId.get("UNREAD").scaffold, byId.get("UNREAD").label], [true, null]);
  assert.deepEqual([byId.get("DEEP").scaffold, byId.get("DEEP").label], [false, "DEEP"]);
  assert.deepEqual(byId.get("SMALL").badges, { mint: "active", freeze: "not_measured" });
  assert.deepEqual(byId.get("DEEP").badges, { mint: "revoked", freeze: "revoked" });
});

test("a tap finds the tower under the finger, and the sky is nobody's", () => {
  const scene = layoutCity(weather, size);
  const tower = scene.towers[0];
  assert.equal(towerAt(scene, tower.x + tower.w / 2, scene.ground - 2).asset, tower.asset);
  assert.equal(towerAt(scene, 1, 1), null);
});

test("a weather that is old when drawn is fog with «data delayed», whatever sky it carried", () => {
  assert.equal(layoutCity(weather, { ...size, now: NOW + 1_000 }).state, weather.state);
  const old = layoutCity(weather, { ...size, now: NOW + STALE_MS + 1 });
  assert.deepEqual([old.state, old.delayed], ["fog", true]);
});

test("the input gate: plain JSON weather passes, anything else does not", () => {
  const plain = JSON.parse(JSON.stringify(weather));
  assert.equal(acceptWeather(plain).assets.length, 5);
  assert.equal(acceptWeather(null), null);
  assert.equal(acceptWeather({ ...plain, schemaVersion: "2" }), null);
  assert.equal(acceptWeather({ ...plain, state: "hurricane" }), null);
  const badLabel = { ...plain, assets: [{ ...plain.assets[0], label: "<img src=x onerror=alert(1)>" }] };
  assert.equal(acceptWeather(badLabel), null, "a label that is not a plain ticker is refused, not escaped");
  const badFigure = { ...plain, assets: [{ ...plain.assets[0], liquidityUsd: { state: "measured", value: "1e9" } }] };
  assert.equal(acceptWeather(badFigure), null);
  const badBadge = { ...plain, assets: [{ ...plain.assets[0], badges: { ...plain.assets[0].badges, mint: { state: "fine" } } }] };
  assert.equal(acceptWeather(badBadge), null, "a badge state the city does not know is refused");
});

test("the one-file build parses, and loads where there is no DOM without doing anything", () => {
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(new URL("../scripts/build.mjs", import.meta.url))], { stdio: "pipe" });
  const bundle = readFileSync(new URL("../dist/market-weather-city.js", import.meta.url), "utf8");
  assert.ok(bundle.length < 40_000, `light: ${bundle.length} bytes`);
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m);
  vm.runInNewContext(bundle, {});
});
