import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { TRACK_BADGE_IDS, trackBadgeSvg } from "./badges.ts";
import { leaderboardsView, LeagueRowSchema } from "./league-view.ts";
import {
  countedPositions,
  DAYS_KEPT,
  emptyLiquidityRecord,
  LIQUIDITY_BADGE_IDS,
  liquidityTrack,
  liquidityView,
  MIN_POSITION_USD,
  observeLiquidity,
  poolLive,
  publicLiquidity,
  sightingOf,
  STEWARD_DAYS,
  STRATEGIST_DAYS,
  topLiquidityBadge,
} from "./liquidity.ts";
import { LIQUIDITY_COLLECTION, liquidityKey, readLiquidity, readPublicLiquidity, recordLiquiditySighting, setLiquidityShown } from "./liquidity-store.ts";

const WALLET = "LiqWa11et111111111111111111111111111111111";
const OTHER = "0therWa11et11111111111111111111111111111111";

const position = (over = {}) => ({ pool: "Pool1111111111111111111111111111111111111111", valueUsd: 50, lockedBps: 0, inRange: true, concentrated: false, poolLive: true, ...over });
const dayAt = (n) => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString();

function observeDays(record, n, sighting, from = 0) {
  let current = record;
  for (let i = from; i < from + n; i += 1) current = observeLiquidity(current, sighting, dayAt(i)) ?? current;
  return current;
}

test("the three liquidity badges are track badges, drawn in the one medallion language", () => {
  for (const id of LIQUIDITY_BADGE_IDS) {
    assert.ok(TRACK_BADGE_IDS.includes(id), id);
    assert.match(trackBadgeSvg(id, { earned: true, id: `t-${id}` }), /<svg[\s\S]*<\/svg>$/);
    assert.match(trackBadgeSvg(id, { earned: false }), /<svg[\s\S]*<\/svg>$/);
    /* No orange marks: those are the partner levels' alone. */
    assert.doesNotMatch(trackBadgeSvg(id, { earned: true }), /data-mark=""/);
  }
});

test("a position counts from the minimum, on its withdrawable part, and never without a price", () => {
  assert.equal(countedPositions([position({ valueUsd: MIN_POSITION_USD })]).length, 1);
  assert.equal(countedPositions([position({ valueUsd: MIN_POSITION_USD - 0.01 })]).length, 0);
  /* A launch's locked liquidity was nobody's choice: the locked part does not count. */
  assert.equal(countedPositions([position({ valueUsd: 1_000_000, lockedBps: 10_000 })]).length, 0);
  assert.equal(countedPositions([position({ valueUsd: 15, lockedBps: 5_000 })]).length, 0);
  assert.equal(countedPositions([position({ valueUsd: 30, lockedBps: 5_000 })]).length, 1);
  assert.equal(countedPositions([position({ valueUsd: null })]).length, 0);
  assert.equal(countedPositions([position({ valueUsd: Number.NaN })]).length, 0);
  /* A pool that is not live — blacklisted, too little in verified tokens, or untraded — counts for nothing. */
  assert.equal(countedPositions([position({ valueUsd: 1_000_000, poolLive: false })]).length, 0);
});

test("value is only what sits in verified tokens, and a pool is live only with real verified reserves and a day's trading", async () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const OWN = "OwnToken11111111111111111111111111111111111";
  const record = (over = {}) => ({
    kind: "dlmm", address: "P", name: "OWN-SOL", price: 1, tvlUsd: 1e9, volume24hUsd: 0, fees24hUsd: 0, baseFeePct: null, dynamicFeePct: null, maxFeePct: null,
    protocolSharePct: null, binStepBps: null, range: null, compounding: false, hasFarm: false, blacklisted: false, createdAt: null, launchpad: null, source: { api: "", page: "" },
    x: { mint: OWN, symbol: "OWN", name: "Own", decimals: 6, verified: false, priceUsd: 1 },
    y: { mint: SOL, symbol: "SOL", name: "Solana", decimals: 9, verified: true, priceUsd: 200 },
    xAmount: 1_000_000_000, yAmount: 0.01, ...over,
  });
  const view = (over = {}) => ({
    kind: "dlmm", address: "Pos", pool: "P", name: "OWN-SOL", rangeState: "in_range", lower: 1, upper: 2, valueUsd: 1e6, unclaimedUsd: 0, lockedBps: 0, feesElsewhere: false, hasRewards: false, slot: 1, at: 0, pricesAt: null,
    x: { mint: OWN, symbol: "OWN", amount: 1_000_000, unclaimed: 0, priceUsd: 1 },
    y: { mint: SOL, symbol: "SOL", amount: 0, unclaimed: 0, priceUsd: 200 },
    ...over,
  });
  /* A million of a token the depositor priced: worth nothing here, and its untraded pool is not live. */
  const self = sightingOf(view(), record());
  assert.equal(self.valueUsd, 0);
  assert.equal(self.poolLive, false);
  assert.equal(countedPositions([self]).length, 0);
  /* Real SOL beside it, in a pool with $10 000 of SOL that traded today: counted on the SOL side alone. */
  const live = record({ yAmount: 60, volume24hUsd: 5 });
  assert.equal(poolLive(live), true);
  const real = sightingOf(view({ y: { mint: SOL, symbol: "SOL", amount: 0.1, unclaimed: 0, priceUsd: 200 } }), live);
  assert.equal(real.valueUsd, 20);
  assert.equal(real.concentrated, true, "a DLMM position's bins are its owner's");
  assert.equal(countedPositions([real]).length, 1);
  assert.equal(poolLive(record({ yAmount: 60, volume24hUsd: 5, blacklisted: true })), false);
  assert.equal(poolLive(null), false);
  /* No record, or a record that names other tokens: unpriced, not zero. */
  assert.equal(sightingOf(view(), null).valueUsd, null);
  assert.equal(sightingOf(view(), record({ x: { ...record().y }, y: { ...record().x } })).valueUsd, null);
  /* DAMM v2: the pool sets the range — never Strategist. */
  assert.equal(sightingOf(view({ kind: "damm-v2" }), live).concentrated, false);
});

test("Pool Contributor from the first counted position; nothing counted writes nothing", () => {
  const empty = emptyLiquidityRecord(WALLET);
  assert.equal(observeLiquidity(empty, [], dayAt(0)), null);
  assert.equal(observeLiquidity(empty, [position({ valueUsd: 1 })], dayAt(0)), null);
  assert.equal(observeLiquidity(empty, [position({ valueUsd: null })], dayAt(0)), null);
  const outOfRange = observeLiquidity(empty, [position({ inRange: false })], dayAt(0));
  assert.equal(outOfRange.earned.POOL_CONTRIBUTOR, dayAt(0));
  assert.deepEqual(outOfRange.days, [], "out of range: held, but not a day in range");
  /* The same read again changes nothing. */
  assert.equal(observeLiquidity(outOfRange, [position({ inRange: false })], dayAt(0)), null);
});

test("Steward: in range on seven different days — the same day twice is one", () => {
  let record = emptyLiquidityRecord(WALLET);
  record = observeLiquidity(record, [position()], dayAt(0));
  assert.equal(observeLiquidity(record, [position()], new Date(Date.parse(dayAt(0)) + 3_600_000).toISOString()), null);
  record = observeDays(record, STEWARD_DAYS - 2, [position()], 1);
  assert.equal(record.days.length, STEWARD_DAYS - 1);
  assert.equal(record.earned.STEWARD, undefined);
  /* Days need not follow one another. */
  record = observeLiquidity(record, [position()], dayAt(40));
  assert.equal(record.earned.STEWARD, dayAt(40));
  assert.equal(record.earned.STRATEGIST, undefined, "the whole curve is always in range: never Strategist");
});

test("Strategist: a narrow range in range on thirty days; the whole curve never counts for it", () => {
  let record = observeDays(emptyLiquidityRecord(WALLET), STRATEGIST_DAYS, [position()]);
  assert.equal(record.rangedDays.length, 0);
  assert.equal(record.earned.STRATEGIST, undefined);
  record = observeDays(emptyLiquidityRecord(WALLET), STRATEGIST_DAYS - 1, [position({ concentrated: true })]);
  assert.equal(record.earned.STRATEGIST, undefined);
  /* A narrow range out of range that day adds nothing to it. */
  assert.equal(observeLiquidity(record, [position({ concentrated: true, inRange: false })], dayAt(STRATEGIST_DAYS)), null);
  record = observeLiquidity(record, [position({ concentrated: true })], dayAt(STRATEGIST_DAYS + 1));
  assert.equal(record.earned.STRATEGIST, dayAt(STRATEGIST_DAYS + 1));
  assert.equal(topLiquidityBadge(record), "STRATEGIST");
});

test("the record stays bounded, and a badge once earned stays when the position is gone", () => {
  let record = observeDays(emptyLiquidityRecord(WALLET), DAYS_KEPT + 20, [position({ concentrated: true })]);
  assert.equal(record.days.length, DAYS_KEPT);
  assert.equal(record.rangedDays.length, DAYS_KEPT);
  assert.deepEqual(record.days, [...record.days].sort());
  assert.equal(observeLiquidity(record, [], dayAt(200)), null, "withdrawn: nothing taken back");
  const track = liquidityTrack(record);
  assert.deepEqual(track.map((badge) => [badge.id, badge.earned]), [["POOL_CONTRIBUTOR", true], ["STEWARD", true], ["STRATEGIST", true]]);
});

test("the track shows how far along, never past the count", () => {
  const record = observeDays(emptyLiquidityRecord(WALLET), 3, [position()]);
  const [contributor, steward, strategist] = liquidityTrack(record);
  assert.deepEqual(contributor, { id: "POOL_CONTRIBUTOR", earned: true, at: dayAt(0), have: 1, need: 1 });
  assert.deepEqual(steward, { id: "STEWARD", earned: false, at: null, have: 3, need: STEWARD_DAYS });
  assert.deepEqual(strategist, { id: "STRATEGIST", earned: false, at: null, have: 0, need: STRATEGIST_DAYS });
});

test("the view says what today's read found, and nothing when Solana did not answer", () => {
  const record = emptyLiquidityRecord(WALLET);
  assert.equal(liquidityView(record, null).read, null);
  const view = liquidityView(record, { partial: true, positions: [position(), position({ valueUsd: null }), position({ inRange: false })], unpriced: 1, at: dayAt(0) });
  assert.deepEqual(view.read, { partial: true, positions: 3, counted: 2, inRange: 1, unpriced: 1, at: dayAt(0) });
  assert.equal(view.public, false);
  assert.equal(view.minUsd, MIN_POSITION_USD);
});

test("public only by choice: the boards' map holds wallets that turned it on and hold a badge", () => {
  const held = observeLiquidity(emptyLiquidityRecord(WALLET), [position()], dayAt(0));
  const other = observeLiquidity(emptyLiquidityRecord(OTHER), [position()], dayAt(0));
  assert.deepEqual(publicLiquidity([held, other]), {});
  assert.deepEqual(publicLiquidity([{ ...held, public: true }, other]), { [WALLET]: "POOL_CONTRIBUTOR" });
  assert.deepEqual(publicLiquidity([{ ...emptyLiquidityRecord(OTHER), public: true }]), {}, "shown, but nothing held: nothing to show");
});

test("the store adds a day once, keeps the wallet's choice and reads the boards' map", async () => {
  const store = createMemoryGuardStore();
  assert.equal((await readLiquidity(store, WALLET)).public, false);
  await recordLiquiditySighting(store, WALLET, [position()], dayAt(0));
  await Promise.all([recordLiquiditySighting(store, WALLET, [position()], dayAt(1)), recordLiquiditySighting(store, WALLET, [position()], dayAt(1))]);
  let record = await readLiquidity(store, WALLET);
  assert.deepEqual(record.days, [dayAt(0).slice(0, 10), dayAt(1).slice(0, 10)]);
  assert.deepEqual(await readPublicLiquidity(store, [WALLET, OTHER]), {});
  await setLiquidityShown(store, WALLET, true, dayAt(1));
  await recordLiquiditySighting(store, WALLET, [position()], dayAt(2));
  record = await readLiquidity(store, WALLET);
  assert.equal(record.public, true, "a later read keeps the choice");
  assert.equal(record.publicAt, dayAt(1));
  assert.deepEqual(await readPublicLiquidity(store, [WALLET, OTHER]), { [WALLET]: "POOL_CONTRIBUTOR" });
  await setLiquidityShown(store, WALLET, false, dayAt(3));
  assert.deepEqual(await readPublicLiquidity(store, [WALLET, OTHER]), {});
  assert.equal((await readLiquidity(store, WALLET)).earned.POOL_CONTRIBUTOR, dayAt(0), "taking the choice back changes nothing earned");
});

test("a row this store cannot read never blocks a write — with a version or without one", async () => {
  const store = createMemoryGuardStore();
  await store.collection(LIQUIDITY_COLLECTION).set(liquidityKey(WALLET), { version: 4, wallet: WALLET, broken: true });
  const record = await recordLiquiditySighting(store, WALLET, [position()], dayAt(0));
  assert.equal(record.version, 5);
  assert.equal((await readLiquidity(store, WALLET)).earned.POOL_CONTRIBUTOR, dayAt(0));
  await store.collection(LIQUIDITY_COLLECTION).set(liquidityKey(OTHER), { wallet: OTHER, version: "x" });
  await setLiquidityShown(store, OTHER, true, dayAt(0));
  assert.equal((await readLiquidity(store, OTHER)).public, true);
});

test("a board row carries a liquidity badge only from the shown map", () => {
  const week = { start: "2026-10-19T00:00:00.000Z", end: "2026-10-26T00:00:00.000Z" };
  const metrics = { week, traders: [], friends: [{ wallet: WALLET, active: 3, at: week.start }, { wallet: OTHER, active: 2, at: week.start }], creators: [] };
  const base = { kind: "current", week, metrics, ranks: {}, computedAt: week.start, final: false, exclude: new Set(), season: null, creators: false, viewer: null };
  const plain = leaderboardsView(base);
  assert.equal("liquidity" in plain.boards.FRIENDS.rows[0], false);
  const shown = leaderboardsView({ ...base, liquidity: { [WALLET]: "STEWARD" } });
  assert.equal(shown.boards.FRIENDS.rows[0].liquidity, "STEWARD");
  assert.equal("liquidity" in shown.boards.FRIENDS.rows[1], false);
  /* A name the map does not hold cannot borrow a prototype's property. */
  assert.equal("liquidity" in leaderboardsView({ ...base, liquidity: Object.create({ [OTHER]: "STRATEGIST" }) }).boards.FRIENDS.rows[1], false);
  assert.throws(() => LeagueRowSchema.parse({ place: 1, name: "abcd…wxyz", face: 1, rank: null, value: 1, you: false, liquidity: "WHALE" }));
});

test("the routes read only behind the wallet's own proof, and nothing in them moves money", () => {
  const strip = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const read = strip("../../app/api/growth/liquidity/route.ts");
  const choice = strip("../../app/api/growth/liquidity/visibility/route.ts");
  for (const route of [read, choice]) {
    assert.match(route, /proof\.address !== /);
    assert.doesNotMatch(route, /payRewardClaim|sendTransaction|Keypair|signTransaction|treasury|reserve/i);
  }
  assert.match(choice, /mutationOriginAllowed/);
  /* A day is written only from this site's own page: a link elsewhere gets the view, unwritten. */
  assert.match(read, /const ownPage =\s+mutationOriginAllowed\(/);
  assert.match(read, /logoutNavigationAllowed\(req\.url, req\.headers\.get\("sec-fetch-site"\), req\.headers\.get\("referer"\)\)/);
  assert.match(read, /read\.ok && ownPage \? await recordLiquiditySighting/);
  const reader = strip("./liquidity-read.server.ts");
  assert.doesNotMatch(reader, /build|sign|Transaction\(/);
});
