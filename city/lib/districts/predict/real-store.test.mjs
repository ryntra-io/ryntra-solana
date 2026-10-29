import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { realBusy, setRealDeps, useReal } from "./real-store.ts";
import { setPredictEnv } from "./store.ts";
import { fundingBody, liveBody, quoteBody } from "./test-fixtures.mjs";

// Real money in the window, against an engine of fixtures and a wallet that answers as told. Nothing here reaches a
// network or a wallet: the point is what the window does with each answer the engine can give.

const A = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";
const B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ok = (value, status = 200) => ({ ok: true, status, value });
const no = (code) => ({ ok: false, failure: { code, message: "x" } });

let calls = [];
let answers = {};
const answer = (name, ...args) => {
  calls.push(name);
  const a = answers[name];
  return Promise.resolve(typeof a === "function" ? a(...args) : (a ?? no("PROVIDER_UNAVAILABLE")));
};
const engine = new Proxy({}, { get: (_, name) => (...args) => answer(name, ...args) });

const ask = { eventId: "ev-btc", marketId: "ev-btc-m", outcomeId: "ev-btc-yes", side: "buy", spendUsd: 10 };
const connection = { wallet: "Stand", address: A };

beforeEach(() => {
  calls = [];
  answers = { live: ok(liveBody(A)), funding: ok(fundingBody(A)), quote: ok(quoteBody(A, { spend: 10 })) };
  setPredictEnv({ engine, now: () => Date.now() });
  setRealDeps({ prove: async () => ({ ok: true }), sign: async () => ({ ok: true, signature: "c2ln" }) });
  useReal.getState().forget();
});

async function reviewed() {
  await useReal.getState().refresh(A);
  await useReal.getState().quote(connection, ask, "k");
  assert.equal(useReal.getState().trade.step, "review");
}

test("the account reads for the connected wallet only; another wallet's answer draws nothing", async () => {
  await useReal.getState().refresh(A);
  let st = useReal.getState();
  assert.equal(st.live.available, 1240);
  assert.equal(st.funding.deposit.state, "ready");
  answers.live = ok(liveBody(B));
  await useReal.getState().refresh(A);
  st = useReal.getState();
  assert.equal(st.live, null, "the proof is another wallet's: neither account is shown");
  assert.equal(st.funding, null);
  answers.live = no("UNAUTHORIZED");
  await useReal.getState().refresh(A);
  assert.equal(useReal.getState().live, null, "not signed in is no account");
});

test("a Review priced for another wallet is never offered to confirm", async () => {
  await useReal.getState().refresh(A);
  answers.quote = ok(quoteBody(B, { spend: 10 }));
  await useReal.getState().quote(connection, ask, "k");
  assert.equal(useReal.getState().trade.step, "failed");
  answers.quote = ok(quoteBody(A, { spend: 10, mode: "paper" }));
  await useReal.getState().quote(connection, ask, "k");
  assert.equal(useReal.getState().trade.step, "failed", "a paper Review is never shown as real money");
});

test("an order the engine refused before sending fails plainly; nothing is read back", async () => {
  await reviewed();
  answers.place = no("ORDER_REFUSED");
  await useReal.getState().place();
  assert.equal(useReal.getState().trade.step, "failed");
  assert.ok(!calls.includes("order"));
});

test("an order whose answer was lost is read back by its quote, never offered again as nothing happened", async () => {
  await reviewed();
  answers.place = no("TIMEOUT");
  answers.order = ok({ order: { quoteId: "q_live_1", state: "filled" } });
  await useReal.getState().place();
  const st = useReal.getState().trade;
  assert.equal(st.step, "done");
  assert.equal(st.state, "filled", "the fill the engine recorded");
  assert.ok(calls.includes("order"));
});

test("a lost answer read back as still reviewed means nothing was sent", async () => {
  await reviewed();
  answers.place = no("NETWORK");
  answers.order = ok({ order: { quoteId: "q_live_1", state: "reviewed" } });
  await useReal.getState().place();
  assert.equal(useReal.getState().trade.step, "failed");
});

test("only a Review that may place is placed, and while it is placed the window holds", async () => {
  await useReal.getState().refresh(A);
  answers.quote = ok(quoteBody(A, { canPlace: false }));
  await useReal.getState().quote(connection, ask, "k");
  await useReal.getState().place();
  assert.ok(!calls.includes("place"), "a Review that refuses is never sent");
  answers.quote = ok(quoteBody(A, { spend: 10 }));
  await useReal.getState().quote(connection, ask, "k");
  let release;
  answers.place = () => new Promise((r) => (release = r));
  const placing = useReal.getState().place();
  assert.equal(realBusy(), true);
  useReal.getState().resetTrade();
  assert.equal(useReal.getState().trade.step, "placing", "an order on its way is never put away");
  release(ok({ order: { quoteId: "q_live_1", state: "filled" } }));
  await placing;
  assert.equal(realBusy(), false);
});

test("a withdrawal the engine recorded as refused says so; one still unknown is asked about again", async () => {
  await useReal.getState().refresh(A);
  const preview = { preview: { status: "quoted", amountRaw: "10000000", receiveRaw: "9770000", feeRaw: "230000", reason: null } };
  answers.withdrawPreview = ok(preview);
  await useReal.getState().previewWithdraw({ amountRaw: "10000000" });
  assert.equal(useReal.getState().withdraw.step, "review");
  answers.withdraw = ok({ outcome: "recorded", withdrawal: { requestId: "r", phase: "refused" } }, 202);
  await useReal.getState().confirmWithdraw();
  assert.equal(useReal.getState().withdraw.step, "failed");

  await useReal.getState().previewWithdraw({ amountRaw: "10000000" });
  answers.withdraw = no("TIMEOUT");
  await useReal.getState().confirmWithdraw();
  assert.deepEqual({ step: useReal.getState().withdraw.step, phase: useReal.getState().withdraw.phase }, { step: "sent", phase: "unknown" }, "a lost answer is not a refusal");

  const id = "0b6a0b8e-6f5c-4f7e-9d3a-1c2b3a4d5e6f";
  answers.funding = ok({ ...fundingBody(A), withdrawals: [{ requestId: id, phase: "unknown", amountUsd: 10, aged: false, createdAt: new Date().toISOString() }] });
  answers.withdrawal = ok({ withdrawal: { requestId: id, phase: "in_flight" } });
  calls = [];
  await useReal.getState().refresh(A);
  assert.ok(calls.includes("withdrawal"), "the unknown one is checked under its own id");
  assert.equal(useReal.getState().funding.withdrawals[0].phase, "in_flight");
});

test("opening the account: proof, then the provider's sign-in; a wallet switched mid-way frees the window", async () => {
  answers.live = ok(liveBody(A, { linked: false }));
  answers.linkStart = ok({ message: "ryntra.io wants you to sign in with your Solana account:\n" + A });
  answers.linkVerify = () => {
    answers.live = ok(liveBody(A));
    return ok({ wallet: A, link: { state: "active" } });
  };
  assert.equal(await useReal.getState().start(connection), true);
  assert.equal(useReal.getState().live.linked, true);
  assert.equal(useReal.getState().opening, null);
  assert.deepEqual(calls.filter((c) => c.startsWith("link")), ["linkStart", "linkVerify"]);

  useReal.getState().forget();
  answers.live = ok(liveBody(A, { linked: false }));
  setRealDeps({ sign: async () => (await useReal.getState().refresh(B), { ok: true, signature: "c2ln" }) });
  assert.equal(await useReal.getState().start(connection), false);
  assert.equal(useReal.getState().opening, null, "never stuck on «Confirm in your wallet»");
  assert.equal(realBusy(), false);

  setRealDeps({ prove: async () => ({ ok: false, state: "declined", message: "Nothing was signed." }) });
  assert.equal(await useReal.getState().start(connection), false);
  assert.equal(useReal.getState().openError, null, "saying no is an answer, not an error");
  assert.equal(useReal.getState().opening, null);
});

test("a wallet switched while a withdrawal is priced or an order is out leaves the new wallet's window clean", async () => {
  await useReal.getState().refresh(A);
  answers.withdrawPreview = () => {
    // The person switches to another wallet while the engine prices the withdrawal.
    useReal.getState().forget();
    return ok({ wallet: A, outcome: "quoted", amountRaw: "1000000", receiveRaw: "990000", feeRaw: "10000" });
  };
  await useReal.getState().previewWithdraw({ amountRaw: "1000000" });
  assert.equal(useReal.getState().withdraw.step, "idle", "the old account's price is not shown");

  await reviewed();
  answers.place = () => {
    useReal.getState().forget();
    return ok({ order: { state: "filled" } });
  };
  await useReal.getState().place();
  assert.equal(useReal.getState().trade.step, "idle", "the old wallet's order is not drawn on the new wallet's ticket");
  assert.equal(realBusy(), false);
});
