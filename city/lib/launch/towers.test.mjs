import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { layoutCity } from "../city/layout.ts";
import { DOCKS_MAX, SKYLINE_MAX, launchesKey, sameOriginImage, shownLaunches, towerOf, withLaunches } from "./towers.ts";

/* The city as last read into the repository: the same towers the first frame paints. */
const BUNDLED_CITY = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const SHA = "a".repeat(64);
let n = 0;
/** A graduation that passed the city's rule (CITY-144): 64 independent buyers after two hours on its curve. */
const PASSED = {
  graduated: true,
  graduatedAt: "2026-10-20T14:00:00Z",
  createdAt: "2026-10-20T12:00:00Z",
  buyers: 64,
  atLeast: false,
  survival: [
    { state: "alive", independent: true },
    { state: "alive", independent: true },
    { state: "alive", independent: true },
  ],
};

/** A launch as the feed gives it; a fresh made-up mint each time. */
function launch(over = {}) {
  n += 1;
  const token = `Launch${String(n).padStart(4, "0")}Mint1111111111111111111111111`.slice(0, 44);
  return {
    token,
    symbol: `L${n}`,
    name: `Launch ${n}`,
    image: null,
    launchedAt: new Date(Date.parse("2026-10-26T12:00:00Z") - n * 60_000).toISOString(),
    creator: null,
    preset: "protected",
    graduationUsd: 75_000,
    progress: 20,
    migrated: false,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    holdersAtLeast: false,
    checks: ["young", "young", "young"],
    phase: "ascent",
    crew: 0,
    ryntraTest: false,
    network: "solana:devnet",
    mine: false,
    hidden: false,
    flow: null,
    awaitingFlow: false,
    ...over,
  };
}

test("a launch on its curve stands in the docks; in its pool past the city's rule, in the skyline; never verified, unread figures zero", () => {
  const rising = towerOf(launch());
  assert.equal(rising.district, "docks");
  assert.equal(rising.verified, false);
  assert.equal(rising.mcap, 0);
  assert.equal(rising.price, 0);
  assert.equal(rising.icon, null);
  const landed = towerOf(launch({ migrated: true, phase: "orbit", marketCapUsd: 120_000, liquidityUsd: 31_000, flow: PASSED }));
  assert.equal(landed.district, "strip");
  assert.equal(landed.mcap, 120_000);
  assert.equal(landed.liquidity, 31_000);
  assert.equal(towerOf(launch({ migrated: true, phase: "orbit", flow: { ...PASSED, buyers: 20 } })).district, "docks", "too few buyers: the Docks");
  assert.equal(towerOf(launch({ migrated: true, phase: "orbit" })).district, "docks", "its graduation not read: the Docks");
});

test("the city's read keeps its time and source, and a launched mint Jupiter also lists stands once, as the launch", () => {
  const base = BUNDLED_CITY;
  const jupiterDock = base.towers.find((tower) => tower.district === "docks") ?? base.towers[base.towers.length - 1];
  const same = launch({ token: jupiterDock.id });
  const fresh = launch();
  const city = withLaunches(base, [same, fresh]);
  assert.equal(city.fetchedAt, base.fetchedAt);
  assert.equal(city.source, base.source);
  assert.equal(city.towers.filter((tower) => tower.id === jupiterDock.id).length, 1);
  assert.equal(city.towers.find((tower) => tower.id === jupiterDock.id).symbol, same.symbol);
  assert.ok(city.towers.some((tower) => tower.id === fresh.token));
  assert.equal(city.towers.length, base.towers.length + 1);
  assert.equal(withLaunches(base, []), base, "no launches: the city's own read, untouched");
});

test("the new towers find their places in the docks and the skyline", () => {
  const rising = launch();
  const landed = launch({ migrated: true, phase: "orbit", marketCapUsd: 90_000, liquidityUsd: 30_000, flow: PASSED });
  const layout = layoutCity(withLaunches(BUNDLED_CITY, [rising, landed]).towers);
  const docks = layout.towers.find((placed) => placed.tower.id === rising.token);
  const skyline = layout.towers.find((placed) => placed.tower.id === landed.token);
  assert.ok(docks && skyline, "both are placed");
  assert.equal(docks.kind, 3, "a scaffold in the docks");
  assert.ok(Math.hypot(skyline.x, skyline.z) < Math.hypot(docks.x, docks.z) + 30, "the skyline is nearer the centre");
});

test("the docks and the skyline keep room for the market: this browser's first, then the newest; a lost signal fades", () => {
  const many = Array.from({ length: DOCKS_MAX + 5 }, () => launch());
  const mine = launch({ mine: true, launchedAt: "2026-01-01T00:00:00Z" });
  const lost = launch({ phase: "lost", checks: ["quiet", "young", "young"] });
  const myLost = launch({ phase: "lost", checks: ["quiet", "young", "young"], mine: true });
  const young = { ...PASSED, survival: PASSED.survival.map(() => ({ state: "young", independent: null })) };
  const stars = Array.from({ length: SKYLINE_MAX + 3 }, () => launch({ migrated: true, phase: "orbit", flow: young }));
  const star = launch({ migrated: true, phase: "star", launchedAt: "2026-01-01T00:00:00Z", checks: ["alive", "alive", "alive"], flow: PASSED });
  const shown = shownLaunches([...many, mine, lost, myLost, ...stars, star]);
  const docks = shown.filter((entry) => !entry.migrated);
  const skyline = shown.filter((entry) => entry.migrated);
  assert.equal(docks.length, DOCKS_MAX);
  assert.equal(skyline.length, SKYLINE_MAX);
  assert.deepEqual(new Set(docks.slice(0, 2).map((entry) => entry.token)), new Set([mine.token, myLost.token]), "this browser's own first, even quiet");
  assert.ok(!shown.some((entry) => entry.token === lost.token), "a lost signal fades from the docks");
  assert.equal(skyline[0].token, star.token, "a day 90 landmark first");
});

test("only a change the eye can see lays the city out again", () => {
  const a = launch({ marketCapUsd: 18_400 });
  const b = launch();
  const key = launchesKey([a, b]);
  assert.equal(launchesKey([{ ...a, marketCapUsd: 18_700, holders: 40 }, b]), key, "a small move and a new holder: the same city");
  assert.notEqual(launchesKey([{ ...a, marketCapUsd: 60_000 }, b]), key, "a tower that grew");
  assert.notEqual(launchesKey([{ ...a, migrated: true, phase: "orbit", flow: PASSED }, b]), key, "a tower that moved into the skyline");
  assert.equal(launchesKey([{ ...a, migrated: true, phase: "orbit", flow: { ...PASSED, buyers: 12 } }, b]), key, "a graduation below the rule keeps its place in the Docks");
  assert.notEqual(launchesKey([a]), key, "a tower that left");
});

test("a picture is drawn only from the engine's own picture route, on this origin", () => {
  assert.equal(sameOriginImage(`https://ryntra.io/api/launch/image/${SHA}`), `/api/launch/image/${SHA}`);
  assert.equal(sameOriginImage(`https://stand.example.org/api/launch/image/${SHA}`), `/api/launch/image/${SHA}`);
  assert.equal(sameOriginImage("https://evil.example/kite.png"), null);
  assert.equal(sameOriginImage(`https://ryntra.io/api/launch/image/${SHA}/../../x`), null);
  assert.equal(sameOriginImage(null), null);
});
