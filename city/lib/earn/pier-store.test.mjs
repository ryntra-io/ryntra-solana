import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { addReview, clock, no, ok, positionView, scriptedEngine, wire } from "../districts/harbor/test-fixtures.mjs";
import { useEarn } from "./open.ts";
import { pierCosts, pierOf, STYLE_HALF } from "./pier.ts";
import { pierChoice, pierFailure, setPierEnv, usePier } from "./pier-store.ts";
import { JITOSOL, SOL, lstPool } from "./pier-fixtures.mjs";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const connection = { wallet: "Phantom", address: OWNER };
const holdings = (sol, jito) => ({
  owner: OWNER,
  sol: { spendableRaw: String(sol), decimals: 9 },
  tokens: new Map([[JITOSOL, { spendableRaw: String(jito), decimals: 9 }]]),
  complete: true,
  at: 1,
});
const rich = holdings(10e9, 10e9);
const ADMITTED = { add: "on", exit: "on", ceilingUsd: 1000, stopped: false };
const reset = () => usePier.setState({ pool: null, copy: null, boat: null, style: "balanced", typed: "1", states: null, reviewed: null, costs: null, target: null, phase: "idle", outcome: null, sent: null, notice: null, candles: {} });

function setup(script) {
  const harness = scriptedEngine({ candles: [ok({ timeframe: "4h", candles: [] })], admit: [ok(ADMITTED)], ...script });
  harness.engine.admit = (owner) => {
    harness.calls.push({ route: "admit", args: [owner] });
    return Promise.resolve(structuredClone(script.admit?.[0] ?? ok(ADMITTED)));
  };
  harness.engine.candles = () => Promise.resolve(ok({ timeframe: "4h", candles: [] }));
  const time = clock();
  const after = [];
  const signs = [];
  const reports = [];
  setPierEnv({
    report: (landed) => reports.push(landed),
    engine: harness.engine,
    now: time.now,
    sleep: time.sleep,
    sign: () => async (unsigned) => {
      signs.push(unsigned);
      return { ok: true, signed: unsigned.map((_, i) => wire(i + 1)) };
    },
    after: (owner) => after.push(owner),
  });
  return { ...harness, time, after, signs, reports };
}

beforeEach(() => {
  reset();
  useEarn.setState({ busy: false });
});

test("the choice: half SOL, the rest JitoSOL, the live minimum, the ceiling and the key", () => {
  const pier = pierOf(lstPool());
  const choice = pierChoice(pier, "calm", "1", rich, OWNER, 1000, null);
  assert.equal(choice.problem, null);
  assert.equal(choice.split.solLamports, 500_000_000n);
  assert.equal(choice.key, `add:${OWNER}:${pier.pool.address}:calm:1000000000`);
  assert.equal(pierChoice(pier, "calm", "abc", rich, OWNER, 1000, null).problem, "format");
  assert.equal(pierChoice(pier, "calm", "0.01", rich, OWNER, 1000, null).problem, "min");
  // $5 at SOL's price is under 0.05 SOL: the canary's minimum stays within half its ceiling.
  const canary = pierChoice(pier, "calm", "0.03", rich, OWNER, 5, null);
  assert.ok(canary.minimum <= canary.ceiling / 2n);
  assert.equal(canary.problem, null);
  assert.equal(pierChoice(pier, "calm", "1", rich, OWNER, 5, null).problem, "ceiling");
  assert.equal(pierChoice(pier, "calm", "1", holdings(10e9, 0), OWNER, 1000, null).problem, "other");
  assert.equal(pierChoice(pier, "calm", "1", holdings(0.3e9, 10e9), OWNER, 1000, null).problem, "sol");
  // Costs from a Review that opens the pool's shared accounts raise the minimum.
  assert.equal(pierChoice(pier, "calm", "1", rich, OWNER, 1000, pierCosts(addReview())).problem, "min");
  assert.equal(pierChoice(pier, "calm", "1", rich, null, 1000, null).key, null);
});

test("an add: the Review of the style's bins, one signature, the relay, done — the window held only while signing", async () => {
  const h = setup({ review: [ok(addReview({ preview: { ...addReview().preview, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }] } }))], submit: [ok({ results: [{ signature: "sig1", state: "LANDED", reason: null }], settled: true })] });
  usePier.getState().openPier(lstPool());
  await usePier.getState().loadStates(OWNER);
  usePier.getState().setStyle("dense");
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  const [review] = h.routes("review");
  assert.equal(review.args[0].venue, "meteora-dlmm");
  assert.deepEqual(review.args[0].range, { place: "around", half: STYLE_HALF.dense });
  assert.equal(review.args[0].request.shape, "spot");
  assert.ok(usePier.getState().reviewed);
  let held = false;
  const stop = useEarn.subscribe((st) => (held ||= st.busy));
  await usePier.getState().confirm(connection, rich);
  stop();
  assert.equal(held, true);
  assert.equal(useEarn.getState().busy, false);
  assert.equal(usePier.getState().phase, "done");
  assert.equal(h.signs.length, 1);
  assert.deepEqual(h.after, [OWNER]);
});

test("nothing is asked without the city's word for this wallet", async () => {
  const h = setup({ admit: [ok({ add: "off", exit: "off", ceilingUsd: null, stopped: false })], review: [ok(addReview())] });
  usePier.getState().openPier(lstPool());
  await usePier.getState().loadStates(OWNER);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(h.routes("review").length, 0);
});

test("a refusal at the door is said in the window's words and nothing is signed", async () => {
  const h = setup({ review: [no("PIER_CEILING")] });
  usePier.getState().openPier(lstPool());
  await usePier.getState().loadStates(OWNER);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(usePier.getState().notice.text, pierFailure("PIER_CEILING"));
  assert.equal(h.signs.length, 0);
  assert.equal(pierFailure("POOL_DISABLED").length > 0, true);
});

test("a Review whose own costs lift the minimum over the amount is not offered, and is not asked again", async () => {
  const h = setup({ review: [ok(addReview())] });
  usePier.getState().openPier(lstPool());
  await usePier.getState().loadStates(OWNER);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(usePier.getState().reviewed, null);
  assert.ok(usePier.getState().costs);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(h.routes("review").length, 1);
});

test("a boat: leave builds the full exit for its venue", async () => {
  const h = setup({ review: [ok({ ...addReview(), preview: { ...addReview().preview, action: "remove", expected: { x: { units: "1", decimals: 9 }, y: { units: "1", decimals: 9 } }, minimum: null, feesClaimed: { x: { units: "0", decimals: 9 }, y: { units: "0", decimals: 9 } }, rewardsClaimed: [], closesPosition: true } })] });
  const boat = positionView({ x: { mint: JITOSOL, symbol: "JitoSOL", amount: 1, unclaimed: 0, priceUsd: 200 }, y: { mint: SOL, symbol: "SOL", amount: 1, unclaimed: 0, priceUsd: 160 } });
  usePier.getState().openBoat(boat);
  await usePier.getState().prepare(connection, { kind: "exit", position: boat }, rich);
  const [review] = h.routes("review");
  assert.equal(review.args[0].action, "remove");
  assert.equal(review.args[0].request.shareBps, 10_000);
  assert.equal(review.args[0].request.close, true);
  assert.ok(usePier.getState().reviewed);
});

test("back never leaves a signature behind", async () => {
  setup({});
  usePier.getState().openPier(lstPool());
  usePier.setState({ phase: "wallet" });
  usePier.getState().back();
  assert.ok(usePier.getState().pool);
  usePier.setState({ phase: "idle" });
  usePier.getState().back();
  assert.equal(usePier.getState().pool, null);
});

test("a copy is the strategy's recipe: its style fixed, and the landed add told to the ledger", async () => {
  const h = setup({ review: [ok(addReview({ position: "PoSiTion1111111111111111111111111111111111" , preview: { ...addReview().preview, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }] } }))], submit: [ok({ results: [{ signature: "sig1", state: "LANDED", reason: null }], settled: true })] });
  const pool = lstPool();
  usePier.getState().openCopy(pool, { strategy: `${pool.address}:calm`, style: "calm" });
  assert.equal(usePier.getState().style, "calm");
  usePier.getState().setStyle("dense");
  assert.equal(usePier.getState().style, "calm", "a copy's style is the strategy's own");
  await usePier.getState().loadStates(OWNER);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  const [review] = h.routes("review");
  assert.deepEqual(review.args[0].range, { place: "around", half: STYLE_HALF.calm });
  await usePier.getState().confirm(connection, rich);
  assert.equal(usePier.getState().phase, "done");
  assert.deepEqual(h.reports, [{ owner: OWNER, position: "PoSiTion1111111111111111111111111111111111", pool: pool.address, style: "calm" }]);
  usePier.getState().again();
  assert.equal(usePier.getState().copy, null);
  assert.equal(usePier.getState().pool, null);
});

test("an add from the Piers is a position of its recipe too; a refused one is never told", async () => {
  const h = setup({ review: [ok(addReview({ preview: { ...addReview().preview, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }] } }))], submit: [ok({ results: [{ signature: "sig1", state: "FAILED", reason: "x" }], settled: false })] });
  usePier.getState().openPier(lstPool());
  await usePier.getState().loadStates(OWNER);
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  await usePier.getState().confirm(connection, rich);
  assert.notEqual(usePier.getState().phase, "done");
  assert.deepEqual(h.reports, []);
});
