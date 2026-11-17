import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, parse } from "../../city/lib/command/parse.ts";
import { DOORS, run } from "../../city/lib/command/run.ts";
import { CITY_LAUNCH_SWITCH } from "../../city/lib/launch/gate.ts";
import { POOL_DEFAULT } from "../../city/lib/launch/pool.ts";
import { EVERY_GATE, askRows, gatesFor, targetOf } from "../shell/ask-route.ts";
import { engineGates } from "../shell/engine.ts";
import { SHELVES } from "../shell/shelves.ts";
import { crewOpen } from "../agents/read.ts";
import { launchDoors } from "./doors.ts";
import {
  LADDER,
  POOL_COST_ABOUT_LAMPORTS,
  POOL_SPLIT_BPS,
  ageOf,
  ageText,
  clockLeft,
  costOf,
  dayOf,
  fillOf,
  formatOf,
  freshLaunches,
  launchCommandOf,
  lineShareBpsOf,
  measured,
  mineOf,
  problemOf,
  refusalOf,
  shareBpsOf,
  signaturesOf,
  sniperOf,
  solOf,
} from "./launch-view.ts";
import { LAUNCH_SCREEN } from "./words.ts";

/* The Launch screen stands on the city's launch as it is: its presets, its two formats' own terms, its readers and its
   refusals. A sentence fills the form and never launches; the pool's way shows only where its door is open; every
   figure is the engine's. */

const w = LAUNCH_SCREEN.en;
const uk = LAUNCH_SCREEN.uk;

/** A preset as the engine serves it (`GET /api/v1/launch/presets`, mainnet, 16.11.2026). */
const PROTECTED = {
  id: "protected",
  sniperFee: { startBps: 5000, endBps: 100, seconds: 600 },
  graduationMarketCapUsd: 75000,
  pair: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  terms: {
    curveSplit: { creatorBps: 3200, ryntraBps: 4800, meteoraBps: 2000 },
    curveSplitThroughRyntra: { creatorBps: 3200, ryntraBps: 5200, meteoraBps: 1600 },
  },
};

/* ------------------------------------------------------------------ the two ways */

test("the pool's way is chosen only while its door is open; the curve is every deployment's", () => {
  assert.equal(formatOf(null, false), "curve");
  assert.equal(formatOf(null, true), "curve");
  assert.equal(formatOf(POOL_DEFAULT, false), "curve", "a choice left from before never opens a shut door");
  assert.equal(formatOf(POOL_DEFAULT, true), "pool");
});

test("the tiles say the format's own figures: the share, the signatures, the network's deposit", () => {
  assert.equal(signaturesOf("curve"), 1);
  assert.equal(signaturesOf("pool"), 3);
  assert.equal(shareBpsOf("curve", PROTECTED), 3200);
  assert.equal(shareBpsOf("curve", null), null, "no preset read — no figure");
  assert.equal(shareBpsOf("pool", PROTECTED), POOL_SPLIT_BPS.creator);
  assert.equal(POOL_SPLIT_BPS.creator + POOL_SPLIT_BPS.ryntra, 10_000);
  assert.equal(lineShareBpsOf(PROTECTED), 3200);
  // The curve's deposit is said only once Solana simulated it; a pool's is its step's own, or about it before.
  assert.equal(costOf("curve", null, null), null);
  assert.equal(costOf("curve", "21340000", "93868000"), "21340000");
  assert.equal(costOf("pool", "21340000", null), POOL_COST_ABOUT_LAMPORTS);
  assert.equal(costOf("pool", null, "93868000"), "93868000");
  assert.equal(costOf("pool", null, "not a number"), POOL_COST_ABOUT_LAMPORTS);
});

test("SOL is rounded up, never below what the network takes", () => {
  assert.equal(solOf("93868000"), 0.1);
  assert.equal(solOf("90000000"), 0.09);
  assert.equal(solOf("2130000"), 0.0022);
  assert.equal(solOf("0"), 0);
  assert.equal(solOf("x"), 0);
});

test("what the first buyers pay: the curve's falls with time, a pool's with the price", () => {
  assert.deepEqual(sniperOf("curve", PROTECTED), { startBps: 5000, endBps: 100, seconds: 600, multiple: null });
  const pool = sniperOf("pool", null);
  assert.equal(pool.seconds, null);
  assert.ok(pool.multiple > 1);
  assert.ok(pool.startBps > pool.endBps);
  assert.equal(sniperOf("curve", null), null);
});

test("the countdown is a clock, never negative; a day is today, tomorrow or later", () => {
  assert.equal(clockLeft(3 * 3600 + 51 * 60 + 20), "03:51:20");
  assert.equal(clockLeft(59), "00:00:59");
  assert.equal(clockLeft(-5), "00:00:00");
  assert.equal(clockLeft(30 * 3600), "30:00:00");
  const noon = Math.floor(new Date(2026, 10, 16, 12, 0, 0).getTime() / 1000);
  assert.equal(dayOf(noon + 3600, noon), "today");
  assert.equal(dayOf(noon + 20 * 3600, noon), "tomorrow");
  assert.equal(dayOf(noon + 3 * 86400, noon), "later");
});

test("the ladder is the format's own: a share of the supply between two multiples of the first price", () => {
  assert.ok(LADDER.shareBps > 0 && LADDER.shareBps < 10_000);
  assert.ok(LADDER.near > 1 && LADDER.far > LADDER.near);
});

/* ------------------------------------------------------------------ the form */

test("the first thing to fix, in the city's order: a bad name at once, an empty field after a press, then the picture", () => {
  const clean = { problems: {}, hits: [] };
  assert.equal(problemOf(w, clean, { has: true, bad: false }, false, null), null);
  assert.equal(problemOf(w, { problems: { name: "REQUIRED" }, hits: [] }, { has: false, bad: false }, false, null), null, "nothing said before the first press");
  assert.deepEqual(problemOf(w, { problems: { name: "REQUIRED" }, hits: [] }, { has: false, bad: false }, true, null), { field: "name", words: w.nameIt });
  assert.deepEqual(problemOf(w, { problems: { symbol: "SYMBOL_CHARS" }, hits: [] }, { has: true, bad: false }, false, null), { field: "symbol", words: w.tickerChars });
  assert.deepEqual(problemOf(w, { problems: { name: "BORROWED" }, hits: [{ field: "name", label: "Tesla" }] }, { has: true, bad: false }, false, null), { field: "name", words: w.readsAs("Tesla") });
  assert.deepEqual(problemOf(w, clean, { has: false, bad: false }, true, null), { field: "picture", words: w.pictureNeeded });
  assert.deepEqual(problemOf(w, clean, { has: false, bad: true }, false, null), { field: "picture", words: w.pictureKind });
  const refused = { field: "picture", words: "refused" };
  assert.equal(problemOf(w, clean, { has: true, bad: false }, false, refused), refused);
});

/* ------------------------------------------------------------------ the agent's sentence */

test("«launch me a token» opens the Launch shelf, and its doors only fill the form", () => {
  const book = bookOf([]);
  for (const said of ["запусти мені токен Kite $KITE", "launch $KITE", "Запусти мені токен"]) {
    const command = parse(said, book);
    assert.equal(command.kind, "launch", said);
    assert.deepEqual(targetOf(command), { shelf: "launch", mint: null });
    const knocked = [];
    const doors = launchDoors((draft) => knocked.push(draft));
    run(command, doors);
    assert.equal(knocked.length, 1, said);
  }
  const named = [];
  run(parse("запусти мені токен Kite $KITE", book), launchDoors((draft) => named.push(draft)));
  assert.deepEqual(named[0], { symbol: "KITE", name: "Kite" });
  // Every other sentence knocks on nothing here.
  const doors = launchDoors(() => assert.fail("a launch door for another sentence"));
  assert.deepEqual(Object.keys(doors).sort(), [...DOORS].sort());
  run(parse("buy SOL 50", bookOf([{ id: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", icon: null, verified: true, mcap: 1e9, liquidity: 1e6 }])), doors);
});

test("«… в пул о 20:00» is read for the pool only where its door is open: its name stays clean, its time goes to the form", () => {
  const said = "запусти мені токен Kite $KITE в пул о 20:00";
  const plain = parse(said, bookOf([]));
  assert.equal(plain.kind, "launch");
  // A coin's name is on chain for ever: with the door shut the launch goes on its curve, its name without the pool's words.
  const shut = launchCommandOf(said, plain, [], false);
  assert.equal(shut.kind, "launch");
  assert.equal(shut.name, "Kite");
  assert.equal(shut.symbol, "KITE");
  assert.equal(shut.pool, undefined);
  const simple = parse("запусти мені токен Kite $KITE", bookOf([]));
  assert.equal(launchCommandOf("запусти мені токен Kite $KITE", simple, [], true), simple, "no pool's words — the line's own reading");
  const pooled = launchCommandOf(said, plain, [], true);
  assert.equal(pooled.kind, "launch");
  assert.equal(pooled.symbol, "KITE");
  assert.equal(pooled.name, "Kite");
  assert.ok(pooled.pool);
  const at = new Date(2026, 10, 16, 12, 0, 0);
  const fill = fillOf({ symbol: pooled.symbol, name: pooled.name, pool: pooled.pool }, true, at);
  assert.equal(new Date(fill.pool.at * 1000).getHours(), 20);
  assert.equal(fillOf({ symbol: "KITE", name: "Kite", pool: pooled.pool }, false, at).pool, null, "the door shut — no pool choice");
  assert.equal(launchCommandOf("buy SOL", { kind: "ask", question: "buy SOL" }, [], true).kind, "ask");
});

test("the launch gate is the city's own switch, and the launcher's card follows it with the shelf", () => {
  assert.equal(SHELVES.launch.ready, true);
  assert.equal(SHELVES.launch.path, "/launch");
  assert.equal(engineGates().launch, CITY_LAUNCH_SWITCH);
  const on = () => true;
  assert.equal(gatesFor(on, { ...EVERY_GATE, launch: false }).launch, false);
  assert.equal(gatesFor(on, EVERY_GATE).launch, true);
  assert.equal(gatesFor((id) => id !== "launch", EVERY_GATE).launch, false, "the shelf off — no launch sentence");
  // «Launcher»: hired where the agent's launch switch and the launch gate are both open.
  assert.equal(crewOpen(gatesFor(on, EVERY_GATE), true).launcher, true);
  assert.equal(crewOpen(gatesFor(on, { ...EVERY_GATE, launch: false }), true).launcher, false);
  const rows = askRows("запусти мені токен", bookOf([]), { subject: null }, on, EVERY_GATE);
  assert.ok(rows.some((row) => row.target.shelf === "launch"));
  assert.ok(!askRows("запусти мені токен", bookOf([]), { subject: null }, (id) => id !== "launch", EVERY_GATE).some((row) => row.target.shelf === "launch"));
});

/* ------------------------------------------------------------------ a stopped launch */

test("a stopped launch is said in the terminal's words: no city, and the pool's «not enough SOL» tops up", () => {
  const closed = refusalOf(w, { code: "CITY_LAUNCH_CLOSED", stage: "before", message: "", token: null }, null, null);
  assert.equal(closed.what, w.closed);
  const low = refusalOf(w, { code: "LAUNCH_BALANCE_LOW", stage: "before", message: "", token: null }, null, null);
  assert.equal(low.kind, "lowSol");
  assert.equal(low.action, "topUp");
  assert.equal(low.what, w.lowSol);
  const unanswered = refusalOf(w, { code: "UNAVAILABLE", stage: "send", message: "", token: "x" }, null, null);
  assert.equal(unanswered.money, w.maybeLanded);
  const used = refusalOf(w, { code: "LAUNCH_BUILD_USED", stage: "send", message: "", token: "x" }, null, null);
  assert.equal(used.money, w.landing);
  const declined = refusalOf(w, { code: "WALLET_REFUSED", stage: "before", message: "User rejected the request.", token: null }, "Phantom", null);
  assert.equal(declined.kind, "declined");
  assert.equal(declined.action, "retry");
  const half = refusalOf(w, { code: "POOL_HALF_WAY", stage: "send", message: "", token: "mint" }, null, null);
  assert.equal(half.action, "retry");
  assert.equal(half.kind, "poolHalf");
  const halfLow = refusalOf(w, { code: "POOL_HALF_WAY", stage: "send", message: "LAUNCH_BALANCE_LOW: not enough SOL for the supply", token: "mint" }, null, null);
  assert.equal(halfLow.what, w.lowSol, "half-way for SOL says what it needs");
  assert.equal(halfLow.action, "retry", "and still continues, never mints again");
  for (const refusal of [closed, low, unanswered, used, declined, half, halfLow]) {
    assert.doesNotMatch(`${refusal.what} ${refusal.money}`, /\b(city|tower|docks)\b|міст|веж|док/i);
  }
});

/* ------------------------------------------------------------------ the lists */

const NOW = Date.parse("2026-11-16T12:00:00Z");
const launchTower = (id, minutesAgo, extra = {}) => ({
  id,
  symbol: id.toUpperCase(),
  name: id,
  icon: null,
  district: "docks",
  price: 0.00001,
  mcap: 14700,
  liquidity: 5000,
  holders: 60,
  change5m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 0,
  organic: 0,
  verified: false,
  launchedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  ...extra,
});

test("«New on the market» is the market's own new launches, newest first; an unmeasured figure is never a zero", () => {
  const towers = [launchTower("old", 300), launchTower("nifty", 1), { ...launchTower("sol", 1), district: "core", verified: true }, launchTower("mana", 30, { unread: ["holders"] })];
  assert.deepEqual(freshLaunches(towers).map((t) => t.id), ["nifty", "mana", "old"]);
  assert.deepEqual(freshLaunches(towers, 2).map((t) => t.id), ["nifty", "mana"]);
  assert.equal(measured(towers[3], "holders"), null);
  assert.equal(measured(towers[1], "holders"), 60);
  assert.equal(measured({ ...towers[1], mcap: 0 }, "mcap"), null);
  assert.equal(ageText(w, ageOf(towers[1].launchedAt, NOW)), w.justNow);
  assert.equal(ageText(uk, ageOf(towers[3].launchedAt, NOW)), uk.minutesAgo(30));
  assert.equal(ageOf(null, NOW), null);
  assert.equal(ageOf(new Date(NOW - 5 * 3600_000).toISOString(), NOW).unit, "hour");
});

test("«My launches» are this wallet's coins: on the curve and in a pool, newest first, once each", () => {
  const me = "Crea7or1111111111111111111111111111111111111";
  const row = (token, creator, at, progress) => ({ token, creator, name: token, symbol: token, image: null, launchedAt: at, progress, hidden: undefined });
  const rows = [row("A", me, "2026-11-15T10:00:00Z", { bps: 4200, migrated: false }), row("B", "someone", "2026-11-16T10:00:00Z", null), row("C", me, "2026-11-16T09:00:00Z", { bps: 10000, migrated: true })];
  const pools = [{ mint: "P", pool: "pool", creator: me, name: "P", symbol: "P", metadataUri: "", pair: "SOL", opensAt: Math.floor(NOW / 1000) + 600, phase: "COUNTDOWN", createdAt: "2026-11-16T11:00:00Z" }];
  const mine = mineOf(rows, pools, me, NOW);
  assert.deepEqual(mine.map((coin) => coin.token), ["P", "C", "A"]);
  assert.equal(mine[0].kind, "pool");
  assert.equal(mine[0].phase, "COUNTDOWN");
  assert.equal(mine[1].migrated, true);
  assert.equal(mine[2].progressBps, 4200);
  assert.deepEqual(mineOf(rows, pools, null, NOW), [], "no wallet — no list");
});
