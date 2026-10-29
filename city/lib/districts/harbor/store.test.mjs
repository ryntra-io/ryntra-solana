import { test } from "node:test";
import assert from "node:assert/strict";

import { signatureOfWire } from "./flow.ts";
import { harborPools } from "./pools.ts";
import { ownHoldings, setHarborEnv, useHarbor } from "./store.ts";
import { addReview, CATALOG, clock, no, ok, OWNER, positionView, scriptedEngine, wire } from "./test-fixtures.mjs";

const [SOL_USDC] = harborPools(CATALOG);
const CONNECTION = { wallet: "Phantom", address: OWNER };
const SIG = signatureOfWire(wire(9));
const OPEN = { add: { status: "on" }, remove: { status: "on" }, claim: { status: "on" }, maxDepositUsd: null };

function setup(script, sign = async (unsigned) => ({ ok: true, signed: unsigned.map(() => wire(9)) })) {
  const time = clock();
  const run = scriptedEngine({ actions: [ok(OPEN)], positions: [ok({ owner: OWNER, positions: [positionView()], venues: {}, at: 1 })], ...script });
  const refreshed = [];
  setHarborEnv({ engine: run.engine, sign: () => sign, now: time.now, sleep: time.sleep, refreshHoldings: (delays) => refreshed.push(delays) });
  useHarbor.setState({ open: true, view: "pools", list: { status: "idle" }, pool: null, tile: 0, states: null, reviewed: null, target: null, phase: "idle", outcome: null, notice: null, positions: { status: "idle" } });
  return { ...run, time, refreshed };
}

test("the card's Review is built for the chosen amount, and the tap signs exactly that", async () => {
  const { routes, refreshed } = setup({ review: [ok(addReview())], submit: [ok({ results: [{ signature: SIG, state: "LANDED", reason: null }], settled: true })] });
  const st = useHarbor.getState();
  await st.loadStates(OWNER);
  st.choose(SOL_USDC, null);
  assert.equal(useHarbor.getState().view, "add");
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, null);
  const reviewed = useHarbor.getState().reviewed;
  assert.ok(reviewed);
  assert.equal(routes("review")[0].args[0].request.pool, SOL_USDC.address);
  assert.deepEqual(routes("review")[0].args[0].range, { place: "around", half: 34 });
  await useHarbor.getState().confirm(CONNECTION, null);
  assert.equal(useHarbor.getState().phase, "done");
  assert.deepEqual(useHarbor.getState().outcome, { kind: "done", signatures: [SIG] });
  assert.deepEqual(routes("submit")[0].args[0], "ticket-1");
  // The wallet's coins and positions are read again after it landed.
  assert.equal(refreshed.length, 1);
  assert.deepEqual(routes("positions").at(-1).args, [OWNER, true]);
});

test("a tap on a Review too old to sign builds it again and shows it first", async () => {
  const { routes, time } = setup({ review: [ok(addReview())], submit: [ok({ results: [], settled: true })] });
  useHarbor.getState().choose(SOL_USDC, null);
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, null);
  time.advance(30_000);
  await useHarbor.getState().confirm(CONNECTION, null);
  assert.equal(routes("review").length, 2);
  assert.equal(routes("submit").length, 0);
  assert.equal(useHarbor.getState().phase, "idle");
  assert.equal(useHarbor.getState().notice.tone, "warn");
});

test("an engine refusal leaves the card with the reason and no Review", async () => {
  setup({ review: [no("ACTIONS_CLOSED")] });
  useHarbor.getState().choose(SOL_USDC, null);
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, null);
  assert.equal(useHarbor.getState().reviewed, null);
  assert.match(useHarbor.getState().notice.text, /live check/);
});

test("an amount the wallet cannot cover is never sent to the engine", async () => {
  const { routes } = setup({ review: [ok(addReview())] });
  const empty = { owner: OWNER, sol: { spendableRaw: "0", decimals: 9 }, tokens: new Map(), complete: true };
  useHarbor.getState().choose(SOL_USDC, empty);
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, empty);
  assert.equal(routes("review").length, 0);
});

test("taking fees reviews the position's claim; the wallet saying no keeps the Review", async () => {
  const { routes } = setup({ review: [ok(addReview())] }, async () => ({ ok: false }));
  await useHarbor.getState().loadPositions(OWNER);
  const [position] = useHarbor.getState().positions.positions;
  await useHarbor.getState().prepare(CONNECTION, { kind: "claim", position }, null);
  assert.deepEqual(routes("review")[0].args[0], { action: "claim", venue: "meteora-dlmm", request: { position: position.address, owner: OWNER } });
  await useHarbor.getState().confirm(CONNECTION, null);
  assert.equal(useHarbor.getState().phase, "idle");
  assert.ok(useHarbor.getState().reviewed);
  assert.match(useHarbor.getState().notice.text, /did not sign/);
});

test("another wallet's positions answer is not kept for this one", async () => {
  setup({ positions: [ok({ owner: "someone-else", positions: [positionView()], venues: {}, at: 1 })] });
  await useHarbor.getState().loadPositions(OWNER);
  assert.equal(useHarbor.getState().positions.status, "error");
});

test("a Review being built never holds the sheet: Close, Back and the tabs work, and its late answer is dropped", async () => {
  setup({});
  await useHarbor.getState().loadStates(OWNER);
  useHarbor.getState().choose(SOL_USDC, null);
  // The engine is slow: the Review stays out while the person leaves.
  let answer;
  const gate = new Promise((resolve) => (answer = resolve));
  const slow = scriptedEngine({ review: [ok(addReview())] });
  setHarborEnv({ engine: { ...slow.engine, review: async (body) => (await gate, slow.engine.review(body)) } });
  const building = useHarbor.getState().prepare(CONNECTION, { kind: "add" }, null);
  assert.equal(useHarbor.getState().phase, "reviewing");
  useHarbor.getState().setView("pools");
  assert.equal(useHarbor.getState().view, "pools", "Back works while the Review builds");
  useHarbor.getState().setView("mine");
  assert.equal(useHarbor.getState().view, "mine", "the tabs work too");
  useHarbor.getState().hide();
  assert.equal(useHarbor.getState().open, false, "Close works while the Review builds");
  answer();
  await building;
  assert.equal(slow.routes("review").length, 1);
  assert.equal(useHarbor.getState().reviewed, null, "the late Review is dropped by its ticket");
  assert.equal(useHarbor.getState().phase, "idle");
});

test("the wallet signing or the bytes going out still hold the sheet", async () => {
  setup({});
  for (const phase of ["wallet", "sending"]) {
    useHarbor.setState({ open: true, view: "add", pool: SOL_USDC, phase });
    useHarbor.getState().hide();
    useHarbor.getState().setView("pools");
    assert.equal(useHarbor.getState().open, true);
    assert.equal(useHarbor.getState().view, "add");
  }
});

test("another wallet's coins never size a Review", async () => {
  const { routes } = setup({ review: [ok(addReview())] });
  assert.equal(ownHoldings(CONNECTION, { owner: "someone-else", sol: null, tokens: new Map(), complete: true }), null);
  assert.equal(ownHoldings(null, { owner: OWNER, sol: null, tokens: new Map(), complete: true }), null);
  const theirs = { owner: "someone-else", sol: { spendableRaw: "0", decimals: 9 }, tokens: new Map(), complete: true };
  useHarbor.getState().choose(SOL_USDC, null);
  // Their empty wallet would refuse the amount; this wallet's unknown balance lets the engine judge it.
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, theirs);
  assert.equal(routes("review").length, 1);
});

test("a partly landed add goes to the positions, read again, and never builds a second Review", async () => {
  const { routes } = setup({ review: [ok(addReview())], submit: [ok({ results: [{ signature: SIG, state: "LANDED", reason: null }, { signature: "x", state: "FAILED", reason: "slippage" }], settled: true })] });
  await useHarbor.getState().loadStates(OWNER);
  useHarbor.getState().choose(SOL_USDC, null);
  await useHarbor.getState().prepare(CONNECTION, { kind: "add" }, null);
  await useHarbor.getState().confirm(CONNECTION, null);
  assert.equal(useHarbor.getState().outcome.kind, "partial");
  const reads = routes("positions").length;
  useHarbor.getState().again();
  const st = useHarbor.getState();
  assert.equal(st.view, "mine");
  assert.equal(st.target, null);
  assert.equal(st.pool, null);
  assert.equal(st.outcome, null);
  assert.ok(routes("positions").length > reads, "the positions are read again");
  assert.deepEqual(routes("positions").at(-1).args, [OWNER, true]);
  assert.equal(routes("review").length, 1, "no second Review of the whole amount");

  // A failed add keeps its retry on the card.
  setup({});
  useHarbor.setState({ view: "add", pool: SOL_USDC, target: { kind: "add" }, phase: "failed", outcome: { kind: "failed", signature: SIG } });
  useHarbor.getState().again();
  assert.equal(useHarbor.getState().view, "add");
  assert.deepEqual(useHarbor.getState().target, { kind: "add" });
});
