// «New» over the whole of Solana and «Маяк» (CITY-142): the engine's three Pulse feeds as three rings, the launches
// that stand in the Docks, the city with them laid in, and the one coin the beacon names.
//   node --test city/lib/lens/launches.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { changeOf, DOCK_QUOTA, dockLaunches, EMPTY_RINGS, feedLaunches, launchOf, mintTail, padsOf, pulseUrl, ringsOf, shownLaunches, stagesOf, towerOfLaunch, twinsOf, volumeOf, withDockLaunches } from "./launches.ts";
import { buyersOf, flowCandidates, LIGHTHOUSE_MIN, lighthouseOf } from "./lighthouse.ts";
import { EMPTY_CONTEXT, inLens, newStage } from "./lens.ts";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const MIN = 60_000;
const mint = (n) => `${"Mint".repeat(8)}${String(n).padStart(4, "1")}`.replace(/0/g, "z").slice(0, 44);
const row = (n, extra = {}) => ({
  mint: mint(n),
  symbol: `COIN${n}`,
  name: `Coin ${n}`,
  icon: `https://cdn.example/${n}.png`,
  launchpad: "pump.fun",
  verified: false,
  graduated: false,
  price: 0.0001,
  marketCapUsd: 9_000 + n,
  liquidityUsd: 4_000,
  holders: 40,
  windows: { m5: { changePct: 3, volumeUsd: 100 }, h1: { changePct: 9, volumeUsd: 900 }, h6: { changePct: null, volumeUsd: null }, h24: { changePct: 12, volumeUsd: 2_000 } },
  firstPoolAt: new Date(NOW - n * MIN).toISOString(),
  graduatedAt: null,
  curve: null,
  ryntra: null,
  ...extra,
});
const ryntra = (extra = {}) => ({ preset: "classic", technicalValidation: false, launchedAt: new Date(NOW - 20 * MIN).toISOString(), traded24h: true, daysSinceDex: null, dollarPair: true, ...extra });

test("the three rings read the engine's three feeds of the whole network", () => {
  assert.equal(pulseUrl("fresh"), "/api/spot/pulse?feed=new");
  assert.equal(pulseUrl("near"), "/api/spot/pulse?feed=soon");
  assert.equal(pulseUrl("graduated"), "/api/spot/pulse?feed=dex");
  // Every launchpad, not cut to three: Bags and the newer pads stay in.
  assert.doesNotMatch(pulseUrl("fresh"), /mode=meme/);
});

test("a row becomes a launch: same-origin icons only, Ryntra by the engine's mark, a held or borrowed ticker unsaid", () => {
  const plain = launchOf(row(1), "fresh");
  assert.equal(plain.symbol, "COIN1");
  assert.equal(plain.launchpad, "pump.fun");
  assert.equal(plain.ryntra, false);
  assert.match(plain.icon, /^\/api\/spot\/icon\?mint=/);
  assert.equal(plain.bornAt, NOW - MIN);

  const own = launchOf(row(2, { launchpad: "Ryntra", icon: "/api/launch/image/" + "a".repeat(64), ryntra: ryntra() }), "fresh");
  assert.equal(own.ryntra, true);
  assert.equal(own.launchpad, "Ryntra");
  assert.equal(own.icon, "/api/launch/image/" + "a".repeat(64));

  // A launchpad named Ryntra is not Ryntra's: only the engine's own record marks a coin born here.
  assert.equal(launchOf(row(3, { launchpad: "Ryntra" }), "fresh").ryntra, false);

  // A ticker passing for a famous coin on another mint is not said, and no logo is drawn for it.
  const fake = launchOf(row(4, { symbol: "USDC", name: "USD Coin" }), "fresh");
  assert.equal(fake.symbol, null);
  assert.equal(fake.icon, null);
  // A ticker with hidden direction characters is cleaned or held, never drawn as given.
  const hidden = launchOf(row(5, { symbol: "‮evil" }), "fresh");
  assert.notEqual(hidden?.symbol, "‮evil");

  assert.equal(launchOf({ mint: "not-a-mint" }, "fresh"), null);
  assert.equal(launchOf(null, "fresh"), null);
  // A javascript: or http icon is never drawn.
  assert.equal(launchOf(row(6, { icon: "http://x/1.png" }), "fresh").icon, null);
});

test("a feed keeps the engine's order and each mint once; anything not an answer is no launch", () => {
  const body = { rows: [row(3), row(1), row(3), row(2)] };
  assert.deepEqual(feedLaunches(body, "fresh").map((l) => l.symbol), ["COIN3", "COIN1", "COIN2"]);
  assert.deepEqual(feedLaunches({ error: { code: "X" } }, "fresh"), []);
  assert.deepEqual(feedLaunches(null, "fresh"), []);
});

test("each coin stands on its furthest ring; Ryntra's curves keep everyone's line; a silent feed keeps its last ring", () => {
  const fast = row(1, { curve: { venue: "pump", progressPct: 81, complete: false } });
  const left = row(2, { graduated: true, graduatedAt: new Date(NOW - 5 * MIN).toISOString() });
  const ownEarly = row(3, { launchpad: "Ryntra", curve: { venue: "meteora-dbc", progressPct: 8, complete: false }, ryntra: ryntra() });
  const rings = ringsOf({
    fresh: { rows: [fast, left, ownEarly, row(4)] },
    near: { rows: [fast, ownEarly] },
    graduated: { rows: [left] },
  });
  assert.deepEqual(rings.fresh.map((l) => l.symbol), ["COIN3", "COIN4"]);
  assert.deepEqual(rings.near.map((l) => l.symbol), ["COIN1"]);
  assert.deepEqual(rings.graduated.map((l) => l.symbol), ["COIN2"]);
  assert.equal(rings.near[0].progress, 81);

  const later = ringsOf({ fresh: { rows: [row(9)] } }, rings);
  assert.deepEqual(later.near.map((l) => l.symbol), ["COIN1"]);
  assert.deepEqual(later.fresh.map((l) => l.symbol), ["COIN9"]);

  const stages = stagesOf(rings);
  assert.equal(stages.get(mint(1)), "near");
  assert.equal(stages.get(mint(2)), "graduated");
  assert.equal(stages.get(mint(4)), "fresh");
});

test("«New» reads the rings first: a coin of any launchpad, wherever its tower stands", () => {
  const rings = ringsOf({ fresh: { rows: [row(1)] }, near: { rows: [row(2, { curve: { venue: "pump", progressPct: 60, complete: false } })] }, graduated: { rows: [] } });
  const ctx = { ...EMPTY_CONTEXT, now: NOW, stages: stagesOf(rings) };
  const placed = (id, district) => ({ tower: { id, district, launchedAt: null }, x: 50, z: 0, height: 6, width: 2, kind: 3, seed: 1 });
  assert.equal(newStage(placed(mint(1), "strip"), ctx), "fresh");
  assert.equal(newStage(placed(mint(2), "docks"), ctx), "near");
  assert.equal(inLens("new", placed(mint(1), "strip"), ctx), true);
  // A tower the rings do not name keeps the city's own reading: a dock is new, an old strip coin is not.
  assert.equal(newStage(placed("OTHERDOCK", "docks"), ctx), "fresh");
  assert.equal(newStage(placed("OLDSTRIP", "strip"), ctx), null);
});

test("the Docks take a handful: near first, then graduated, then the freshest above the city's cap", () => {
  const near = Array.from({ length: 8 }, (_, i) => row(10 + i, { curve: { venue: "pump", progressPct: 90 - i, complete: false } }));
  const gone = Array.from({ length: 5 }, (_, i) => row(30 + i, { graduated: true, graduatedAt: new Date(NOW - i * MIN).toISOString() }));
  const fresh = [row(50, { marketCapUsd: 1_200 }), row(51, { ryntra: ryntra() }), row(52, { symbol: "USDT" }), ...Array.from({ length: 9 }, (_, i) => row(60 + i))];
  const rings = ringsOf({ fresh: { rows: fresh }, near: { rows: near }, graduated: { rows: gone } });
  const present = new Set([mint(10)]);
  const docks = dockLaunches(rings, present);
  assert.equal(docks.filter((l) => l.stage === "near").length, DOCK_QUOTA.near);
  assert.equal(docks.filter((l) => l.stage === "graduated").length, DOCK_QUOTA.graduated);
  assert.equal(docks.filter((l) => l.stage === "fresh").length, DOCK_QUOTA.fresh);
  assert.ok(!docks.some((l) => l.mint === mint(10)), "a coin the city already stands is not laid in twice");
  assert.ok(!docks.some((l) => l.mint === mint(50)), "a fresh coin under the city's cap stands no tower");
  assert.ok(!docks.some((l) => l.ryntra), "Ryntra's own launches are the Launch district's towers");
  assert.ok(!docks.some((l) => l.symbol === null), "a held ticker stands no tower");
});

test("a launch as a Docks tower: the engine's figures, the rest said unread, never verified on a guess", () => {
  const tower = towerOfLaunch(launchOf(row(7, { holders: null }), "fresh"));
  assert.equal(tower.district, "docks");
  assert.equal(tower.mcap, 9_007);
  assert.equal(tower.verified, false);
  assert.equal(tower.icon, null);
  assert.ok(tower.unread.includes("holders"));
  assert.ok(tower.unread.includes("traders1h"));
  assert.ok(tower.unread.includes("organic"));
  assert.ok(!tower.unread.includes("mcap"));
});

test("the city with the Docks laid in: its own towers untouched, the same snapshot when the look would not change", () => {
  const ours = new WeakSet();
  const make = (launch) => {
    const tower = towerOfLaunch(launch);
    ours.add(tower);
    return tower;
  };
  const isOurs = (tower) => ours.has(tower);
  const city = { towers: [{ id: "SOL", district: "core", mcap: 1e11 }, { id: mint(1), district: "docks", mcap: 9_001 }], fetchedAt: "t", source: "live" };
  const rings = ringsOf({ fresh: { rows: [row(1), row(2), row(3)] } });
  const next = withDockLaunches(city, rings, isOurs, make);
  assert.notEqual(next, city);
  assert.deepEqual(next.towers.map((t) => t.id), ["SOL", mint(1), mint(2), mint(3)]);
  assert.equal(next.towers[1], city.towers[1], "the city's own tower of a coin stays its own");
  // Nothing changed: the very same snapshot, no new layout.
  assert.equal(withDockLaunches(next, rings, isOurs, make), next);
  // A coin that left the rings is let go; one that grew is renewed.
  const fewer = withDockLaunches(next, ringsOf({ fresh: { rows: [row(2, { marketCapUsd: 90_000 })] } }), isOurs, make);
  assert.deepEqual(fewer.towers.map((t) => t.id), ["SOL", mint(1), mint(2)]);
  assert.equal(fewer.towers[2].mcap, 90_000);
  // No launches at all: the city as it is.
  assert.equal(withDockLaunches(city, EMPTY_RINGS, isOurs, make), city);
});

test("«Маяк»: the most independent buyers above the floor, read from the flow; never a technical launch, never a guess", () => {
  assert.deepEqual(buyersOf({ rules: { floorUsd: 1 }, buyers: { independent: 17, atLeast: true } }), { independent: 17, atLeast: true, floorUsd: 1 });
  assert.equal(buyersOf({ buyers: { independent: -1 } }), null);
  assert.equal(buyersOf({ error: { code: "LAUNCH_NOT_FOUND" } }), null);

  const own = (n, stage, extra = {}) => row(n, { launchpad: "Ryntra", ryntra: ryntra(extra), ...(stage === "near" ? { curve: { venue: "meteora-dbc", progressPct: 70, complete: false } } : {}) });
  const rings = ringsOf({
    fresh: { rows: [own(1, "fresh"), own(2, "fresh", { technicalValidation: true }), row(3), own(4, "fresh"), own(5, "fresh")] },
    near: { rows: [own(6, "near")] },
  });
  assert.deepEqual(flowCandidates(rings), [mint(6), mint(1), mint(4), mint(5)]);
  assert.equal(flowCandidates(rings, 2).length, 2);

  const counts = new Map([
    [mint(1), { independent: 26, atLeast: false, floorUsd: 1 }],
    [mint(2), { independent: 900, atLeast: false, floorUsd: 1 }],
    [mint(4), { independent: 26, atLeast: true, floorUsd: 1 }],
    [mint(6), { independent: LIGHTHOUSE_MIN - 1, atLeast: false, floorUsd: 1 }],
  ]);
  const beacon = lighthouseOf(rings, counts);
  // Equal counts: the younger coin (row 1 is a minute old, row 4 four minutes).
  assert.equal(beacon.mint, mint(1));
  assert.equal(beacon.independent, 26);
  assert.equal(lighthouseOf(rings, new Map([[mint(6), { independent: 2, atLeast: false, floorUsd: 1 }]])), null);
  assert.equal(lighthouseOf(EMPTY_RINGS, counts), null);
});

test("the window's figures: each ring's own window for volume and change, the ten largest wallets, holders at least", () => {
  const fresh = launchOf(row(1, { holdersAtLeast: true, top10Pct: 31.4 }), "fresh");
  assert.equal(volumeOf(fresh), 100);
  assert.equal(changeOf(fresh), 3);
  assert.equal(fresh.top10Pct, 31.4);
  assert.equal(fresh.holdersAtLeast, true);
  const near = launchOf(row(2, { curve: { venue: "pump", progressPct: 60, complete: false } }), "near");
  assert.equal(volumeOf(near), 900);
  assert.equal(changeOf(near), 9);
  const out = launchOf(row(3, { graduatedAt: new Date(NOW - 5 * MIN).toISOString() }), "graduated");
  assert.equal(volumeOf(out), 2_000);
  assert.equal(changeOf(out), 12);
  // Not read is not zero.
  assert.equal(launchOf(row(4, { top10Pct: undefined }), "fresh").top10Pct, null);
});

test("the window's order and launchpad: the engine's order by default, a figure largest first, unread last", () => {
  const list = [
    launchOf(row(1, { marketCapUsd: 5_000, holders: 10 }), "fresh"),
    launchOf(row(2, { marketCapUsd: null, holders: 90, launchpad: "bags.fun" }), "fresh"),
    launchOf(row(3, { marketCapUsd: 50_000, holders: null }), "fresh"),
  ];
  assert.deepEqual(shownLaunches(list, "feed", null).map((l) => l.symbol), ["COIN1", "COIN2", "COIN3"]);
  assert.deepEqual(shownLaunches(list, "cap", null).map((l) => l.symbol), ["COIN3", "COIN1", "COIN2"]);
  assert.deepEqual(shownLaunches(list, "holders", null).map((l) => l.symbol), ["COIN2", "COIN1", "COIN3"]);
  assert.deepEqual(shownLaunches(list, "feed", "Bags").map((l) => l.symbol), ["COIN2"]);
  assert.deepEqual(shownLaunches(list, "cap", "Pump").map((l) => l.symbol), ["COIN3", "COIN1"]);
  // The engine's list is never changed.
  assert.deepEqual(list.map((l) => l.symbol), ["COIN1", "COIN2", "COIN3"]);
});

test("the launchpads on offer, the busiest first; tickers shared by two coins are told apart", () => {
  const rings = ringsOf({
    fresh: { rows: [row(1, { symbol: "DJT" }), row(2, { symbol: "djt", launchpad: "bags.fun" }), row(3)] },
    near: { rows: [] },
    graduated: { rows: [row(4, { symbol: "DJT", graduatedAt: new Date(NOW - MIN).toISOString() })] },
  });
  assert.deepEqual(padsOf(rings), ["Pump", "Bags"]);
  assert.deepEqual([...twinsOf(rings)], ["djt"]);
  assert.equal(mintTail(mint(1)), `…${mint(1).slice(-4)}`);
  assert.deepEqual(padsOf(EMPTY_RINGS), []);
});
