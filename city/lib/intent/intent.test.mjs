// Run from repo root: node --test city/lib/intent/intent.test.mjs
//
// The confirm sheet of a prepared action (CITY-161) with the engine's own recorded answers: the swap through the swap
// routes' golden transcripts (signed with their test-only key), the transfer through the Money window's fixtures. No
// network, no wallet, no keys. What these prove: the sheet shows only what the contract gives, the press claims before
// anything is built, what the engine built must be exactly what was prepared or the wallet never opens, a «no» lets
// the intent go, and the signature that went out becomes the intent's receipt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { goneOfCode, orderFitsIntent, planFitsIntent, readIntent, swapLeg } from "./check.ts";
import { __sentBookForTests, isDeadSent, readSent, setIntentEnv, useIntent } from "./store.ts";
import { bundle, FRIEND, memoryStorage, no, ok, OWNER, scriptedFetch, SIGNATURE as SEND_SIGNATURE, USDC } from "../money/test-fixtures.mjs";
import { EXECUTED, memoryAttempts, ORDER, orderWith, QUOTE, RECOVERED, scriptedEngine, signingWallet, signWire, T0, TAKER, USDT, WSOL } from "../trade/test-fixtures.mjs";

const ID = "Q2l0eTE2MV9pbnRlbnRfMQ";
/** A wallet that is neither the transcripts' taker nor the transfer's sender (the two fixtures share one address). */
const STRANGER = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
const DIGEST = "d".repeat(64);
const PATH = `/api/v1/intents/${ID}`;

function served({ spec, status = "OPEN", receipt = null, origin = { kind: "agent", name: "Atlas", verified: false }, bound = null } = {}) {
  return {
    id: ID,
    status,
    network: "solana:mainnet",
    spec,
    origin,
    for: bound,
    createdAt: new Date(T0 - 60_000).toISOString(),
    expiresAt: new Date(T0 + 900_000).toISOString(),
    digest: DIGEST,
    claimedUntil: status === "CLAIMED" ? new Date(T0 + 600_000).toISOString() : null,
    receipt,
    sentSignature: null,
    links: { url: `https://ryntra.io/i/${ID}`, qr: `https://ryntra.io/api/v1/intents/${ID}/qr` },
  };
}

// The transcripts' trade: 0.01 SOL into USDT for their test wallet.
const SWAP = { action: "swap", coin: USDT, side: "buy", pay: "SOL", amountRaw: "10000000" };
const TRANSFER = { action: "transfer", coin: USDC, amountRaw: "2500000", to: FRIEND };

/** The sheet's world for one test: the intent routes, the swap engine and the wallet. */
function world({ intents, engine = {}, wallet, connection = { wallet: "Stub", address: TAKER }, transfer = {}, storage = memoryStorage() }) {
  const routes = scriptedFetch({ ...intents, ...transfer });
  const swap = scriptedEngine(engine);
  const attempts = memoryAttempts();
  const signer = wallet ?? signingWallet(signWire);
  let now = T0 + 1_000;
  setIntentEnv({
    fetch: routes.fetch,
    engine: swap.engine,
    sign: (_connection, wire) => signer.sign(wire),
    connection: () => connection,
    attempts: attempts.store,
    checkReturned: async () => ({ verdict: "BYTES_MATCH", signature: SEND_SIGNATURE }),
    storage: () => storage,
    now: () => now,
    sleep: async (ms) => void (now += ms),
    refreshCity: () => {},
  });
  return { routes, swap, signer, attempts, storage };
}

/** The server's answer to the wallet's signed bytes: the claim, marked with their signature. */
const markedWith = (spec, signature) => ok({ intent: { ...served({ spec, status: "CLAIMED" }), sentSignature: signature } });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the sheet believes only the contract's shape — and only the intent its address names", () => {
  const view = readIntent({ intent: { ...served({ spec: TRANSFER }), message: "Urgent! Send now", redirect: "https://evil.example" } }, ID);
  assert.ok(view);
  assert.equal("message" in view, false);
  assert.equal("redirect" in view, false);
  assert.deepEqual(view.spec, TRANSFER);
  assert.equal(readIntent({ intent: served({ spec: TRANSFER }) }, "A".repeat(22)), null);
  assert.equal(readIntent({ intent: { ...served({ spec: TRANSFER }), status: "SIGNED" } }, ID), null);
  assert.equal(readIntent({ intent: served({ spec: TRANSFER, origin: { kind: "agent", name: "https://evil.example", verified: false } }) }, ID), null);
  // Who prepared it is verified only when the engine says so; a custom-scheme link is not carried.
  assert.equal(view.origin.verified, false);
  assert.equal(readIntent({ intent: { ...served({ spec: TRANSFER }), origin: { kind: "agent", name: "Atlas", verified: "yes" } } }, ID).origin.verified, false);
  assert.equal("deepLink" in view.links, false);
  assert.equal(readIntent({ intent: served({ spec: TRANSFER, bound: "nope" }) }, ID), null);
  assert.equal(goneOfCode("INTENT_CANCELLED"), "cancelled");
  assert.equal(readIntent({ intent: served({ spec: { ...TRANSFER, to: "not an address" } }) }, ID), null);
  assert.equal(readIntent({ intent: served({ spec: { ...SWAP, coin: WSOL } }) }, ID), null);
  assert.equal(goneOfCode("INTENT_USED"), "used");
  assert.equal(goneOfCode("INTENT_EXPIRED"), "expired");
  assert.equal(goneOfCode("INTENT_CHANGED"), "changed");
});

test("tamper: an order that is not the prepared swap does not fit — another coin, another amount, another signer", () => {
  const order = { taker: TAKER, inputMint: WSOL, outputMint: USDT, inAmountRaw: "10000000" };
  assert.deepEqual(swapLeg(SWAP), { inputMint: WSOL, outputMint: USDT, amountRaw: "10000000" });
  assert.equal(orderFitsIntent(order, SWAP, TAKER), true);
  assert.equal(orderFitsIntent({ ...order, outputMint: USDC }, SWAP, TAKER), false);
  assert.equal(orderFitsIntent({ ...order, inAmountRaw: "10000001" }, SWAP, TAKER), false);
  assert.equal(orderFitsIntent({ ...order, inputMint: USDC }, SWAP, TAKER), false);
  assert.equal(orderFitsIntent(order, SWAP, STRANGER), false);
  assert.equal(orderFitsIntent({ ...order, taker: STRANGER }, SWAP, TAKER), false);
  assert.equal(orderFitsIntent({ taker: TAKER, inputMint: USDT, outputMint: WSOL, inAmountRaw: "10000000" }, { ...SWAP, side: "sell" }, TAKER), true);
});

test("tamper: a transfer plan that is not the prepared one does not fit — another recipient, amount, coin or sender", () => {
  const plan = { actionKind: "SPL_TRANSFER", mint: USDC, sender: OWNER, recipient: FRIEND, amountRaw: "2500000" };
  assert.equal(planFitsIntent(plan, TRANSFER, OWNER), true);
  assert.equal(planFitsIntent({ ...plan, recipient: STRANGER }, TRANSFER, OWNER), false);
  assert.equal(planFitsIntent({ ...plan, amountRaw: "25000000" }, TRANSFER, OWNER), false);
  assert.equal(planFitsIntent({ ...plan, mint: USDT }, TRANSFER, OWNER), false);
  assert.equal(planFitsIntent(plan, TRANSFER, STRANGER), false);
  assert.equal(planFitsIntent({ ...plan, sender: STRANGER }, TRANSFER, OWNER), false);
  assert.equal(planFitsIntent({ ...plan, actionKind: "NATIVE_SOL" }, TRANSFER, OWNER), false);
  const sol = { ...TRANSFER, coin: "SOL" };
  assert.equal(planFitsIntent({ ...plan, actionKind: "NATIVE_SOL", mint: "11111111111111111111111111111111" }, sol, OWNER), true);
  assert.equal(planFitsIntent(plan, sol, OWNER), false);
});

test("a swap end to end: the live quote, the press claims first, the exact order is signed in the wallet, sent once, and receipted", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  const { routes, swap, signer } = world({
    intents: {
      [`${PATH}/claim`]: [ok({ intent: claimed })],
      [`${PATH}/signed`]: [markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/receipt`]: [ok({ intent: served({ spec: SWAP, status: "DONE", receipt: { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })],
    },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  assert.equal(useIntent.getState().quoteState, "ready");
  assert.deepEqual(swap.routes("quote")[0].body, { inputMint: WSOL, outputMint: USDT, amountRaw: "10000000" });

  await useIntent.getState().confirm();
  const state = useIntent.getState();
  assert.equal(state.line, null, JSON.stringify(state.line));
  assert.equal(state.done?.signature, EXECUTED.signature);
  assert.equal(state.done?.recorded, true);
  assert.equal(state.view.status, "DONE");
  // The claim came before the engine built anything; the signed bytes marked the claim before the engine sent them;
  // the wallet saw the engine's exact bytes, once.
  assert.deepEqual(routes.calls.map((call) => call.route), [`${PATH}/claim`, `${PATH}/signed`, `${PATH}/receipt`]);
  assert.deepEqual(routes.calls[0].body, { digest: DIGEST, wallet: TAKER });
  assert.deepEqual(routes.calls[1].body, { digest: DIGEST, wallet: TAKER, signedWireBase64: signWire(ORDER.order.transactionBase64).wire, replaces: null });
  assert.deepEqual(routes.calls[2].body, { digest: DIGEST, wallet: TAKER, signature: EXECUTED.signature });
  assert.equal(swap.calls.findIndex((call) => call.route === "execute") >= 0, true);
  // Receipted: this device forgets the mark.
  assert.equal(readSent(ID), null);
  assert.equal(state.done.outRaw, EXECUTED.observation?.actualOutputRaw ?? null);
  assert.equal(swap.routes("execute").length, 1);
  assert.deepEqual(signer.shown, [ORDER.order.transactionBase64]);
});

test("tamper: an order the engine built for another coin never reaches the wallet, and the intent is let go", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  const wrong = orderWith({ outputMint: USDC });
  const { routes, swap, signer } = world({
    intents: { [`${PATH}/claim`]: [ok({ intent: claimed })], [`${PATH}/release`]: [ok({ intent: served({ spec: SWAP }) })] },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: wrong }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(useIntent.getState().line?.tone, "error");
  assert.match(useIntent.getState().line.text, /not what was prepared/);
  assert.deepEqual(signer.shown, []);
  assert.equal(swap.routes("execute").length, 0);
  assert.deepEqual(routes.calls.map((call) => call.route), [`${PATH}/claim`, `${PATH}/release`]);
  assert.equal(useIntent.getState().view.status, "OPEN");
});

test("the wallet said no: nothing was sent, the intent is let go, and the sheet can be pressed again", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  const { routes, swap } = world({
    intents: { [`${PATH}/claim`]: [ok({ intent: claimed })], [`${PATH}/release`]: [ok({ intent: served({ spec: SWAP }) })] },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] },
    wallet: { sign: async () => ({ ok: false, reason: "Phantom refused to sign." }) },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(routes.asked(`${PATH}/release`).length, 1);
  assert.equal(useIntent.getState().phase, "idle");
  assert.equal(useIntent.getState().done, null);
  assert.equal(useIntent.getState().view.status, "OPEN");
});

test("replay: a link already used says so, and nothing is built", async () => {
  const { routes, swap } = world({
    intents: { [`${PATH}/claim`]: [no(409, "INTENT_USED")] },
    engine: { quote: [{ status: 200, body: QUOTE }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(useIntent.getState().gone, "used");
  assert.equal(swap.routes("order").length, 0);
  assert.equal(routes.calls.length, 1);
  // A lapsed or expired intent opens straight onto how it ended; a done one onto its receipt.
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "LAPSED" }), gone: null, coin: null });
  assert.equal(useIntent.getState().gone, "used");
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "EXPIRED" }), gone: null, coin: null });
  assert.equal(useIntent.getState().gone, "expired");
  const receipt = { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "CONFIRMED" };
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "DONE", receipt }), gone: null, coin: null });
  assert.equal(useIntent.getState().done?.signature, EXECUTED.signature);
  // A stranger's read carries no receipt: the sheet says it is done, with no transaction of anybody's to open.
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "DONE" }), gone: null, coin: null });
  assert.equal(useIntent.getState().done?.signature, null);
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "CANCELLED" }), gone: null, coin: null });
  assert.equal(useIntent.getState().gone, "cancelled");
});

test("a request for another wallet is never claimed from this one", async () => {
  const { routes, swap } = world({ intents: {}, engine: { quote: [{ status: 200, body: QUOTE }] } });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, bound: STRANGER }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.match(useIntent.getState().line.text, /another wallet/);
  assert.equal(routes.calls.length, 0);
  assert.equal(swap.routes("order").length, 0);
});

test("tamper: a wallet that signs other bytes than the engine built never gets them sent, and the intent is let go", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  // The wallet changes one byte of the message the person was shown, then signs it.
  const other = (() => {
    const bytes = Buffer.from(ORDER.order.transactionBase64, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    return bytes.toString("base64");
  })();
  const { routes, swap } = world({
    intents: { [`${PATH}/claim`]: [ok({ intent: claimed })], [`${PATH}/release`]: [ok({ intent: served({ spec: SWAP }) })] },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] },
    wallet: { sign: async () => ({ ok: true, signedWireBase64: signWire(other).wire }) },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(useIntent.getState().line?.tone, "error");
  // Refused before the mark: nothing was marked, nothing left, the intent is let go.
  assert.equal(routes.asked(`${PATH}/signed`).length, 0);
  assert.equal(routes.asked(`${PATH}/release`).length, 1);
  assert.equal(useIntent.getState().sent, null);
  assert.equal(useIntent.getState().done, null);
});

test("a slow wallet: its answer after the signing window marks nothing and sends nothing, and the intent is not burnt", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  let advance = () => {};
  const { routes, swap } = world({
    intents: { [`${PATH}/claim`]: [ok({ intent: claimed })], [`${PATH}/release`]: [ok({ intent: served({ spec: SWAP }) })] },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] },
    wallet: {
      sign: async (wire) => {
        advance(40_000);
        return { ok: true, signedWireBase64: signWire(wire).wire };
      },
    },
  });
  setIntentEnv({ now: (() => { let now = T0 + 1_000; advance = (ms) => (now += ms); return () => now; })() });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(routes.asked(`${PATH}/signed`).length, 0);
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(useIntent.getState().sent, null);
  assert.ok(useIntent.getState().line, "the sheet says why");
  // The bytes it signed late were never marked: either fresh figures wait for the next press, or the intent was let go.
  assert.equal(Boolean(useIntent.getState().order) || routes.asked(`${PATH}/release`).length === 1, true);
});

test("refused by the engine before its submit boundary after the mark: those bytes never left, so the next press builds afresh — no read-back wait", async () => {
  const notCrossed = { status: 409, body: { error: { code: "ORDER_EXPIRED", message: "expired", submitBoundary: "NOT_CROSSED" } } };
  const { routes, swap } = world({
    intents: {
      [`${PATH}/claim`]: [ok({ intent: served({ spec: SWAP, status: "CLAIMED" }) }), markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/signed`]: [markedWith(SWAP, EXECUTED.signature), markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/receipt`]: [ok({ intent: served({ spec: SWAP, status: "DONE", receipt: { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })],
    },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }], execute: [notCrossed, { status: 200, body: EXECUTED }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(isDeadSent(ID, EXECUTED.signature), true);
  assert.equal(readSent(ID), null);
  assert.equal(useIntent.getState().sent, null);
  assert.equal(useIntent.getState().done, null);
  // The same wallet presses again: the server answers the old mark, this device knows it is dead — build, sign, send.
  await useIntent.getState().confirm();
  assert.equal(swap.routes("recover").length, 0);
  assert.equal(swap.routes("execute").length, 2);
  assert.equal(useIntent.getState().done?.signature, EXECUTED.signature);
  assert.equal(routes.asked(`${PATH}/signed`).length, 2);
  // The fresh mark replaces exactly the dead one the press began from.
  assert.equal(routes.asked(`${PATH}/signed`)[1].body.replaces, EXECUTED.signature);
});

test("a lost answer to the mark: nothing was sent, this device keeps the signature as dead, and the next press builds afresh", async () => {
  const { routes, swap } = world({
    intents: {
      // The server took the mark, but its answer never arrived.
      [`${PATH}/claim`]: [ok({ intent: served({ spec: SWAP, status: "CLAIMED" }) }), markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/signed`]: [no(503, "UNAVAILABLE"), markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/release`]: [no(409, "INTENT_SENT")],
      [`${PATH}/receipt`]: [ok({ intent: served({ spec: SWAP, status: "DONE", receipt: { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })],
    },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(isDeadSent(ID, EXECUTED.signature), true);
  await useIntent.getState().confirm();
  assert.equal(swap.routes("recover").length, 0);
  assert.equal(swap.routes("execute").length, 1);
  assert.equal(useIntent.getState().done?.signature, EXECUTED.signature);
  assert.equal(routes.asked(`${PATH}/signed`)[1].body.replaces, EXECUTED.signature);
});

test("a mark that could not be recorded sends nothing: the flow hears «nothing signed», and the intent is let go", async () => {
  const claimed = served({ spec: SWAP, status: "CLAIMED" });
  const { routes, swap } = world({
    intents: { [`${PATH}/claim`]: [ok({ intent: claimed })], [`${PATH}/signed`]: [no(503, "UNAVAILABLE")], [`${PATH}/release`]: [ok({ intent: served({ spec: SWAP }) })] },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(routes.asked(`${PATH}/release`).length, 1);
  assert.equal(useIntent.getState().sent, null);
  assert.match(useIntent.getState().line.text, /could not record/);
});

test("replay after a reload: this device marked a signature, so the sheet reads it back and receipts it — it never signs again", async () => {
  const storage = memoryStorage();
  storage.setItem("ryntra.intent.sent.v2", JSON.stringify({ [ID]: { live: { signature: EXECUTED.signature, wallet: TAKER, requestId: ORDER.order.requestId }, dead: [], at: T0 } }));
  const { routes, swap, signer } = world({
    storage,
    intents: { [`${PATH}/receipt`]: [ok({ intent: served({ spec: SWAP, status: "DONE", receipt: { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })] },
    engine: { recover: [{ status: 200, body: RECOVERED }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "CLAIMED" }), gone: null, coin: null });
  for (let i = 0; i < 5 && !useIntent.getState().done; i += 1) await settle();
  assert.equal(useIntent.getState().done?.signature, EXECUTED.signature);
  assert.deepEqual(swap.calls.map((call) => call.route), ["recover"]);
  assert.equal(swap.calls[0].body.requestId, ORDER.order.requestId);
  assert.deepEqual(signer.shown, []);
  assert.deepEqual(routes.calls.map((call) => call.route), [`${PATH}/receipt`]);
  assert.equal(readSent(ID), null);
});

test("replay from another device: the same wallet's claim answers the marked signature, read back by it alone — nothing is built or signed", async () => {
  const { routes, swap, signer } = world({
    intents: {
      [`${PATH}/claim`]: [markedWith(SWAP, EXECUTED.signature)],
      [`${PATH}/receipt`]: [ok({ intent: served({ spec: SWAP, status: "DONE", receipt: { wallet: TAKER, signature: EXECUTED.signature, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })],
    },
    engine: { quote: [{ status: 200, body: QUOTE }], recover: [{ status: 200, body: RECOVERED }] },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "CLAIMED" }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  assert.equal(useIntent.getState().done?.signature, EXECUTED.signature);
  assert.equal(swap.routes("order").length, 0);
  assert.equal(swap.routes("execute").length, 0);
  assert.equal("requestId" in swap.routes("recover")[0].body, false);
  assert.deepEqual(signer.shown, []);
  assert.deepEqual(routes.calls.map((call) => call.route), [`${PATH}/claim`, `${PATH}/receipt`]);
});

test("a transfer end to end: the engine's Review of the real recipient, the press claims, the wallet signs, sent once, receipted", async () => {
  const connection = { wallet: "Stub", address: OWNER };
  const { routes } = world({
    connection,
    intents: {
      [`${PATH}/claim`]: [ok({ intent: served({ spec: TRANSFER, status: "CLAIMED" }) })],
      [`${PATH}/signed`]: [markedWith(TRANSFER, SEND_SIGNATURE)],
      [`${PATH}/receipt`]: [ok({ intent: served({ spec: TRANSFER, status: "DONE", receipt: { wallet: OWNER, signature: SEND_SIGNATURE, at: new Date(T0).toISOString(), chain: "UNCHECKED" } }) })],
    },
    transfer: {
      "/api/v1/research/address-evidence": [ok({ state: "UNAVAILABLE" })],
      "/api/solana/transfer/plan": [ok({ data: bundle() }), ok({ data: bundle({ hash: "bb" }) })],
      "/api/solana/transfer/settle": [ok({ data: { state: "RECEIPTED", signature: SEND_SIGNATURE, observation: { slot: "1", feeLamports: "6000" }, receipt: { id: "receipt-1" } } })],
    },
    wallet: { sign: async () => ({ ok: true, signedWireBase64: "signed-bytes" }) },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: TRANSFER }), gone: null, coin: null });
  await settle();
  await settle();
  assert.equal(useIntent.getState().reviewState, "ready", JSON.stringify(useIntent.getState().line));
  assert.equal(routes.asked("/api/solana/transfer/plan")[0].body.input.recipient, FRIEND);
  await useIntent.getState().confirm();
  const state = useIntent.getState();
  assert.equal(state.line, null, JSON.stringify(state.line));
  assert.equal(state.done?.signature, SEND_SIGNATURE);
  assert.equal(state.view.status, "DONE");
  assert.equal(routes.asked("/api/solana/transfer/settle").length, 1);
  assert.deepEqual(routes.asked(`${PATH}/signed`)[0].body, { digest: DIGEST, wallet: OWNER, signedWireBase64: "signed-bytes", replaces: null });
  assert.deepEqual(routes.asked(`${PATH}/receipt`)[0].body, { digest: DIGEST, wallet: OWNER, signature: SEND_SIGNATURE });
});

test("tamper: a Review for another recipient never opens the wallet, and the intent is let go", async () => {
  const connection = { wallet: "Stub", address: OWNER };
  let signed = 0;
  const { routes } = world({
    connection,
    intents: { [`${PATH}/claim`]: [ok({ intent: served({ spec: TRANSFER, status: "CLAIMED" }) })], [`${PATH}/release`]: [ok({ intent: served({ spec: TRANSFER }) })] },
    transfer: {
      "/api/v1/research/address-evidence": [ok({ state: "UNAVAILABLE" })],
      "/api/solana/transfer/plan": [ok({ data: bundle({ recipient: STRANGER }) }), ok({ data: bundle({ recipient: STRANGER }) })],
    },
    wallet: {
      sign: async () => {
        signed += 1;
        return { ok: true, signedWireBase64: "signed-bytes" };
      },
    },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: TRANSFER }), gone: null, coin: null });
  await settle();
  await settle();
  assert.equal(useIntent.getState().review, null);
  assert.match(useIntent.getState().line.text, /not what was prepared/);
  await useIntent.getState().confirm();
  assert.equal(signed, 0);
  assert.equal(routes.asked("/api/solana/transfer/settle").length, 0);
  assert.equal(routes.asked(`${PATH}/release`).length, 1);
});

test("two failed presses never forget the dead mark the server still holds; a clear refusal marks nothing dead", async () => {
  // The server holds A (dead on this device). The next press signs fresh bytes whose mark gets no answer, the one after
  // that is refused outright. (The golden bytes sign the same as A here; the book keeps every dead signature either way,
  // and the store test of the book below holds two different ones.)
  const A = EXECUTED.signature;
  const storage = memoryStorage();
  storage.setItem("ryntra.intent.sent.v2", JSON.stringify({ [ID]: { live: null, dead: [A], at: T0 } }));
  const other = (() => {
    const bytes = Buffer.from(ORDER.order.transactionBase64, "base64");
    return bytes.toString("base64");
  })();
  const { routes, swap } = world({
    storage,
    intents: {
      [`${PATH}/claim`]: [markedWith(SWAP, A), markedWith(SWAP, A)],
      [`${PATH}/signed`]: [no(504, "TIMEOUT"), no(429, "RATE_LIMITED")],
      [`${PATH}/release`]: [no(409, "INTENT_SENT"), no(409, "INTENT_SENT")],
    },
    engine: { quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] },
    wallet: { sign: async () => ({ ok: true, signedWireBase64: signWire(other).wire }) },
  });
  useIntent.getState().start({ id: ID, view: served({ spec: SWAP, status: "CLAIMED" }), gone: null, coin: null });
  await settle();
  await useIntent.getState().confirm();
  await useIntent.getState().confirm();
  // A is still known dead: neither press read it back (no 150 s wait), both built afresh.
  assert.equal(isDeadSent(ID, A), true);
  assert.equal(swap.routes("recover").length, 0);
  assert.equal(swap.routes("execute").length, 0);
  assert.equal(routes.asked(`${PATH}/signed`).length, 2);
  assert.deepEqual(routes.asked(`${PATH}/signed`).map((call) => call.body.replaces), [A, A]);
});

test("the book of marks keeps every dead signature beside the live one", async () => {
  const storage = memoryStorage();
  world({ storage, intents: {} });
  const A = EXECUTED.signature;
  const B = "4" + A.slice(1);
  storage.setItem("ryntra.intent.sent.v2", JSON.stringify({ [ID]: { live: { signature: B, wallet: TAKER, requestId: null }, dead: [A], at: T0 } }));
  assert.equal(isDeadSent(ID, A), true);
  assert.equal(isDeadSent(ID, B), false);
  assert.equal(readSent(ID).signature, B);
  // Storage that fills up after the first write: later writes still count, read from memory and merged.
  let full = false;
  const filling = { getItem: (key) => storage.getItem(key), setItem: (key, value) => { if (full) throw new Error("quota"); storage.setItem(key, value); }, removeItem: (key) => storage.removeItem(key) };
  setIntentEnv({ storage: () => filling });
  full = true;
  __sentBookForTests.kill(ID, B);
  // Storage still holds the old book; the page reads both.
  assert.equal(JSON.parse(storage.getItem("ryntra.intent.sent.v2"))[ID].live.signature, B);
  assert.equal(readSent(ID), null);
  assert.equal(isDeadSent(ID, A) && isDeadSent(ID, B), true);
  // A row that is not an entry is ignored, never a reason to fail.
  storage.setItem("ryntra.intent.sent.v2", JSON.stringify({ broken: null, [ID]: { live: null, dead: [A], at: T0 } }));
  assert.equal(isDeadSent(ID, A), true);
});
