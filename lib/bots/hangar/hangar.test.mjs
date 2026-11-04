import assert from "node:assert/strict";
import test from "node:test";

import { groupLadders, incompleteBundles, LADDER_WINDOW_MS } from "./bundles.ts";
import { buildHangar } from "./hangar.ts";
import { hangarOrders, orderSide } from "./orders.ts";
import { triggerV1SunsetNote } from "./sunset.ts";
import { BUNDLES, DLMM_ROWS, ENTRIES, GONE_POSITION, GRID_POSITION, GRIDS, JUP, LP_POSITION, NOW, ORDER, POSITIONS, RECORDS, RULES, SIG, SOL, TOKENS, TRIGGER_ROWS, USDC, WALLET } from "./fixtures/wallet.mjs";

const orders = () => hangarOrders({ records: RECORDS, trigger: TRIGGER_ROWS, dlmm: DLMM_ROWS });
const hangar = (over = {}) =>
  buildHangar({ wallet: WALLET, nowMs: NOW, positions: POSITIONS, grids: GRIDS, entries: ENTRIES, orders: orders(), bundles: BUNDLES, rules: RULES, tokens: TOKENS, ...over });
const bot = (answer, id) => answer.bots.find((item) => item.id === id);

test("an order's side is read off its mints, a dollar before SOL", () => {
  assert.deepEqual(orderSide(USDC, SOL), { side: "buy", baseMint: SOL, quoteMint: USDC });
  assert.deepEqual(orderSide(SOL, USDC), { side: "sell", baseMint: SOL, quoteMint: USDC });
  assert.deepEqual(orderSide(JUP, SOL), { side: "sell", baseMint: JUP, quoteMint: SOL });
});

test("the venue says where an order stands; the record adds Ryntra's own signature", () => {
  const list = orders();
  const ladderA = list.find((order) => order.order === ORDER.ladderA);
  assert.equal(ladderA.state, "FILLED", "Jupiter's «Completed» over the record's stale «OPEN»");
  assert.equal(ladderA.placeSignature, SIG.ladderPlace);
  assert.equal(ladderA.throughRyntra, true);
  assert.equal(ladderA.filledOutputRaw, "550000000");
  const dlmm = list.find((order) => order.order === ORDER.dlmm);
  assert.deepEqual([dlmm.state, dlmm.canClaim, dlmm.inputMint, dlmm.filledInputRaw, dlmm.filledOutputRaw], ["FILLED", true, SOL, "500000000", "110000000"]);
  /* A failed placement no venue lists stays, on its record's word. */
  assert.equal(list.find((order) => order.order === ORDER.failed).state, "FAILED");
  assert.equal(list.find((order) => order.order === ORDER.open).throughRyntra, false);
});

test("orders of one pair and side placed within minutes are one ladder", () => {
  const { ladders, singles } = groupLadders(orders());
  const ids = ladders.map((ladder) => ladder.orders.map((order) => order.order));
  assert.deepEqual(
    ids.find((legs) => legs.includes(ORDER.ladderA)),
    [ORDER.ladderA, ORDER.ladderB, ORDER.ladderC],
  );
  assert.ok(ids.some((legs) => legs.includes(ORDER.bundleA) && legs.includes(ORDER.bundleB)), "a week later — another ladder");
  assert.ok(singles.some((order) => order.order === ORDER.expired));
  assert.ok(singles.some((order) => order.order === ORDER.dlmm));
  /* Past the window the run breaks. */
  const far = orders().filter((order) => order.order === ORDER.ladderB).map((order) => ({ ...order, order: "Far", createdAt: new Date(Date.parse(order.createdAt) + LADDER_WINDOW_MS + 4 * 60_000 + 1).toISOString() }));
  const split = groupLadders([...orders().filter((order) => [ORDER.ladderA, ORDER.ladderB, ORDER.ladderC].includes(order.order)), ...far]);
  assert.equal(split.ladders.length, 1);
  assert.equal(split.singles[0].order, "Far");
});

test("every bot carries its status, result against holding, last fill with its receipt, and who fills it", () => {
  const answer = hangar();
  assert.deepEqual(answer.read, { positions: true, orders: true, rules: true });
  assert.ok(answer.bots.every((item) => item.noRyntraSignature === true));

  const grid = bot(answer, `grid:${GRID_POSITION}`);
  assert.deepEqual([grid.kind, grid.status, grid.filler, grid.venue], ["grid", "working", "pool_swaps", "meteora_dlmm"]);
  assert.ok(Math.abs(grid.vsHold.usd - 0.4) < 1e-9, "fees over a hold the price left even");
  assert.equal(grid.vsHold.from, "2026-10-20T00:00:00.000Z");

  const lp = bot(answer, `range_lp:${LP_POSITION}`);
  assert.deepEqual([lp.status, lp.detail, lp.vsHold, lp.feesUsd, lp.venue], ["out_of_range", "above", null, 1.5, "meteora_damm_v2"]);

  assert.equal(bot(answer, `grid:${GONE_POSITION}`).status, "closed", "a grid the chain no longer holds");

  const ladder = answer.bots.find((item) => item.kind === "ladder" && item.refs.orders.includes(ORDER.ladderA));
  assert.deepEqual(ladder.legs, { total: 3, filled: 1, pending: 2, closed: 0 });
  assert.deepEqual([ladder.status, ladder.filler, ladder.venue, ladder.name], ["partial", "jupiter_keeper", "jupiter_trigger_v1", "SOL/USDC"]);
  assert.equal(ladder.lastFill.signature, SIG.ladderFill);
  assert.equal(ladder.lastFill.receipt, `https://explorer.solana.com/tx/${SIG.ladderFill}`);
  /* 0.55 SOL at $200 for $100: +$10 on $300 placed. */
  assert.ok(Math.abs(ladder.vsHold.usd - 10) < 1e-9);
  assert.ok(Math.abs(ladder.vsHold.pct - 10 / 3) < 1e-9);
  assert.equal(ladder.vsHold.from, "2026-10-20T10:00:00.000Z");

  const dlmm = bot(answer, `limit:dlmm:${ORDER.dlmm}`);
  assert.deepEqual([dlmm.status, dlmm.detail, dlmm.filler], ["needs_you", "claim_waiting", "pool_swaps"]);
  /* 0.5 SOL ($100 today) became $110. */
  assert.ok(Math.abs(dlmm.vsHold.usd - 10) < 1e-9);

  const dca = bot(answer, "dca:rule_sol_weekly");
  assert.deepEqual([dca.status, dca.detail, dca.filler, dca.vsHold], ["needs_you", "reminder_open", "you", null]);
  assert.equal(dca.lastFill.signature, SIG.dcaBuy, "the newest purchase");
  assert.equal(bot(answer, "dca:rule_jup_paused").status, "paused");

  /* What needs the person comes first. */
  assert.equal(answer.bots[0].status, "needs_you");
});

test("a bundle whose legs did not all land is incomplete, with the leg that is missing", () => {
  const issues = hangar().issues.filter((issue) => issue.kind === "incomplete_bundle");
  const bundle = issues.find((issue) => issue.bundle === "bundle-dip-3");
  assert.deepEqual([bundle.planned, bundle.placed, bundle.missing.length], [3, 2, 1]);
  assert.deepEqual([...bundle.orders].sort(), [ORDER.bundleA, ORDER.bundleB].sort());
  /* Without a bundle, a ladder tells on itself: a leg failed beside one that landed. */
  const inferred = issues.find((issue) => issue.orders.includes(ORDER.open));
  assert.deepEqual([inferred.planned, inferred.placed, inferred.missing], [2, 1, []]);
  /* Too fresh to tell: the legs may still be on their way. */
  assert.deepEqual(incompleteBundles(BUNDLES, orders(), BUNDLES[0].at + 60_000), []);
  /* All legs there: complete. */
  const whole = { ...BUNDLES[0], legs: BUNDLES[0].legs.slice(0, 2) };
  assert.deepEqual(incompleteBundles([whole], orders(), NOW), []);
});

test("orders that keep the tokens and no longer work are orphans, each with why", () => {
  const found = Object.fromEntries(hangar().issues.filter((issue) => issue.kind === "orphan").map((issue) => [issue.order, issue.reason]));
  assert.deepEqual(found, {
    [ORDER.expired]: "expired_open",
    [ORDER.stale]: "stale_far",
    [ORDER.leftOpen]: "left_behind",
    [ORDER.dlmm]: "unclaimed",
  });
});

test("a placement no venue ever listed is stuck after a quarter of an hour", () => {
  const placing = { ...RECORDS[1], order: "Stuck" + "q".repeat(37), state: "PLACING", createdAt: "2026-10-29T11:00:00.000Z", updatedAt: "2026-10-29T11:00:00.000Z" };
  const list = hangarOrders({ records: [placing], trigger: [], dlmm: [] });
  const answer = hangar({ orders: list, bundles: [] });
  assert.deepEqual(answer.issues, [{ kind: "orphan", venue: "trigger", order: placing.order, reason: "stuck_placing" }]);
  assert.equal(hangar({ orders: list, bundles: [], nowMs: Date.parse("2026-10-29T11:05:00.000Z") }).issues.length, 0);
});

test("a source that did not answer is not read — never an empty hangar", () => {
  const answer = hangar({ positions: null, orders: null, rules: null });
  assert.deepEqual(answer.read, { positions: false, orders: false, rules: false });
  assert.deepEqual([answer.bots, answer.issues, answer.sunset], [[], [], null]);
});

test("the Trigger V1 sunset watcher: no date — watch; a date — how close, and what outlives it", () => {
  const list = orders();
  const watch = triggerV1SunsetNote(list, NOW);
  assert.equal(watch.level, "watch");
  assert.equal(watch.open, 8);
  assert.equal(hangar().sunset.level, "watch");

  const urgent = triggerV1SunsetNote(list, NOW, "2026-11-05T00:00:00.000Z");
  assert.equal(urgent.level, "urgent");
  assert.match(urgent.line.uk, /7 дн/);
  /* The expired order's own end came before the sunset; every other open one outlives it. */
  assert.ok(!urgent.outlive.includes(ORDER.expired));
  assert.equal(urgent.outlive.length, 7);
  assert.equal(triggerV1SunsetNote(list, NOW, "2027-03-01T00:00:00.000Z").level, "plan");
  assert.equal(triggerV1SunsetNote(list, NOW, "2026-10-01T00:00:00.000Z").level, "past");
  assert.equal(triggerV1SunsetNote(list.filter((order) => order.venue === "dlmm"), NOW), null, "nothing on V1 — no note");
});
