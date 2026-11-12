// Run from repo root: node --test city/lib/bots/take-back.test.mjs
//
// CITY-231 — the person can always take back what is theirs.
//
// Flaw 2: the ladder used to be kept only after a successful `/submit`. The relay then waited ~25 s for confirmations;
// a 504, a dropped connection or a closed tab left orders on the chain the window never knew of, and one more «Place»
// put a second ladder beside them. Now the ladder is kept the moment its legs are signed — every leg `sent`, its order
// account and its signature read from the signed bytes — before the relay is asked; the relay answers on sending, and
// the window's own reading of the order accounts and the signatures says what landed.
//
// Flaw 3: a ladder could be taken back only from the browser that placed it (its rows live in that browser). Now a
// DLMM bot read from the chain carries «Cancel», built from the bot's own order accounts — no browser storage needed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { binOfPrice, chunkRungs, planLeg } from "../../../lib/bots/ladder/plan.ts";
import { ladderCosts } from "../../../lib/bots/ladder/costs.ts";
import { DLMM_DISCRIMINATOR } from "../../../lib/solana/limits/dlmm-tx.ts";
import { base58, DLMM_PROGRAM } from "../../../lib/solana/limits/model.ts";
import { defaultDraft } from "./draft.ts";
import { createLadderStore, LADDER_NET, liveKey, useLadder } from "./ladder.ts";
import { cancelChainBot, chainCancellable, inFlight, placeDraft, readLive, SENT_SETTLE_MS, settleLeg, takeBack } from "./ladder-actions.ts";
import { ladderWords } from "./ladder-words.ts";
import { placeLadder, sentNothing, signatureOfWire } from "./ladder-sign.ts";
import { useBots } from "./store.ts";
import { WORDS } from "./words.ts";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL = "So11111111111111111111111111111111111111112";
const owner = Keypair.generate();
const OWNER = owner.publicKey.toBase58();
const WHO = { wallet: "Phantom", owner: OWNER };
const POOL = Keypair.generate().publicKey.toBase58();
const facts = { pool: POOL, binStep: 10, activeId: 0, baseIsX: true, baseMint: SOL, quoteMint: USDC, baseDecimals: 9, quoteDecimals: 6 };
facts.activeId = binOfPrice(150, false, facts);
const pool = { facts, activePrice: 150, takesLimitOrders: true, existingArrays: [Math.floor(facts.activeId / 70), Math.floor(facts.activeId / 70) - 1], bitmapExtension: true };
const pair = { mint: SOL, symbol: "SOL" };
const draft = defaultDraft("buyLadder", pair, 150, null, 100);

const { createProgram } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const anchor = createProgram(new Connection("http://127.0.0.1:1"), { cluster: "devnet" });
const unsigned = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
const firstSignature = (wire) => base58(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).signatures[0]);

async function placeIx(order, rungs) {
  return anchor.methods
    .placeLimitOrder({ isAskSide: false, relativeBin: null, bins: rungs.map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) })), padding: new Array(16).fill(0) }, { slices: [] })
    .accountsPartial({
      lbPair: new PublicKey(POOL),
      binArrayBitmapExtension: anchor.programId,
      reserve: Keypair.generate().publicKey,
      tokenMint: new PublicKey(USDC),
      tokenProgram: TOKEN_PROGRAM_ID,
      limitOrder: new PublicKey(order),
      userToken: getAssociatedTokenAddressSync(new PublicKey(USDC), owner.publicKey),
      sender: owner.publicKey,
      payer: owner.publicKey,
      owner: owner.publicKey,
    })
    .instruction();
}

/** What the review route answers for a buy leg: the plan cut by bin array, one transaction per order key. */
async function review(leg, orderKeys, network = "devnet") {
  const plan = planLeg(leg, facts);
  const transactions = [];
  for (const [i, rungs] of chunkRungs(plan.rungs).entries()) {
    const tx = new Transaction({ feePayer: owner.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(await placeIx(orderKeys[i], rungs));
    transactions.push({ side: "buy", wireBase64: unsigned(tx), limitOrder: orderKeys[i], rungs, depositLamports: null });
  }
  return { network, pool: facts, activePrice: 150, plans: [plan], transactions, costs: ladderCosts([plan], { existingArrays: new Set(pool.existingArrays), bitmapExtension: true }), canDo: [] };
}

/** A cancellation the cancel route answers for one order: the program's close, the wallet the only signer. */
function cancelWire(order) {
  const program = new PublicKey(DLMM_PROGRAM);
  const key = new PublicKey(order);
  const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const close = new TransactionInstruction({ programId: program, keys: [meta(key, false, true), meta(owner.publicKey, true), meta(owner.publicKey, false, true)], data: Buffer.from(DLMM_DISCRIMINATOR.close, "hex") });
  return unsigned(new Transaction({ feePayer: owner.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(close));
}

/** The person's wallet: it signs exactly what it was shown, on the chain it was asked for. */
function wallet() {
  const calls = [];
  const sign = async (args) => {
    calls.push(args);
    return {
      ok: true,
      signedWireBase64: args.unsignedWireBase64.map((wire) => {
        const exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
        exact.sign([owner]);
        return Buffer.from(exact.serialize()).toString("base64");
      }),
    };
  };
  return { sign, calls };
}

/**
 * The engine's routes, faked: review and cancel as the engine answers; `/submit` as `submit` says — the relay's answer,
 * a 504 with no body, a refusal, or no answer at all; `/orders` reads the accounts as `chain` holds them.
 */
function routes({ submit = "ok", chain = {}, landed = {} } = {}) {
  const log = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    log.push({ url, body });
    if (url.endsWith("/review")) return Response.json(await review(body.legs[0], body.orderKeys, body.network ?? "devnet"));
    if (url.endsWith("/cancel")) return Response.json({ network: body.network, transactions: body.orders.map((order) => ({ limitOrder: order, wireBase64: cancelWire(order) })) });
    if (url.endsWith("/orders")) {
      const orders = body.orders.map((order) => ({ limitOrder: order, pool: POOL, state: chain[order] ?? "closed", rungs: 1, filled: 0, partial: 0 }));
      return Response.json({ network: body.network, orders, prices: {}, landed: Object.fromEntries((body.signatures ?? []).filter((sig) => sig in landed).map((sig) => [sig, landed[sig]])) });
    }
    if (url.endsWith("/submit")) {
      if (submit === "timeout") return new Response("An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", { status: 504 });
      if (submit === "dropped") throw new TypeError("Failed to fetch");
      if (submit === "refused") return Response.json({ error: { code: "PROMISE_BROKEN", message: "-" } }, { status: 422 });
      if (submit === "unreachable") return Response.json({ error: { code: "UNREACHABLE", message: "-" } }, { status: 503 });
      return Response.json({ network: body.network, legs: body.items.map((item) => ({ limitOrder: item.limitOrder, signature: firstSignature(item.wireBase64), state: "sent", reason: null })) });
    }
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  return { fetch, log, calls: (end) => log.filter((entry) => entry.url.endsWith(end)) };
}

/** The window's store as a fresh page has it; `storage` — the browser's, or none (forgotten, another device). */
function freshWindow(storage = null) {
  if (storage) globalThis.window = { localStorage: storage };
  else delete globalThis.window;
  useLadder.setState({ ladders: [], reads: {}, prices: {}, busy: null, note: null, shownCosts: null, hydrated: true });
}

function memoryStorage() {
  const kept = new Map();
  return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, String(value)), removeItem: (key) => void kept.delete(key) };
}

const noLater = () => {};

/* ---------------------------------------------------------------- flaw 2 */

test("the ladder is the window's before the relay is asked: every leg «sent», its signature from the signed bytes", async () => {
  const api = routes();
  const order = [];
  const result = await placeLadder(
    { wallet: "Phantom", owner: OWNER, pool: POOL, legs: composedLegs(), shown: await shown(), network: "devnet" },
    {
      fetch: async (url, init) => {
        order.push(url.split("/").pop());
        return api.fetch(url, init);
      },
      sign: wallet().sign,
      onSigned: (rev, legs) => {
        order.push("kept");
        assert.equal(legs.length, rev.transactions.length);
        assert.ok(legs.every((leg) => leg.state === "sent" && typeof leg.signature === "string"));
      },
    },
  );
  assert.equal(result.kind, "placed");
  assert.deepEqual(order, ["review", "kept", "submit"], "kept after the wallet, before the relay");
  const sent = api.calls("/submit")[0].body.items;
  assert.deepEqual(result.legs.map((leg) => leg.signature), sent.map((item) => firstSignature(item.wireBase64)), "the signature is the signed transaction's own id");
  assert.equal(signatureOfWire(sent[0].wireBase64), firstSignature(sent[0].wireBase64));
});

test("a relay that times out after sending: the ladder stays with its legs «sent»; one more «Place» does not place a second", async () => {
  freshWindow();
  const api = routes({ submit: "timeout" });
  const person = wallet();
  await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: person.sign, later: noLater });
  const [ladder] = useLadder.getState().ladders;
  assert.equal(useLadder.getState().ladders.length, 1, "the window knows the ladder");
  assert.ok(ladder.legs.length > 0 && ladder.legs.every((leg) => leg.state === "sent" && leg.signature && typeof leg.sentAt === "number"));
  assert.deepEqual(ladder.legs.map((leg) => leg.signature), api.calls("/submit")[0].body.items.map((item) => firstSignature(item.wireBase64)));
  assert.equal(useLadder.getState().note.kind, "checking", "not «try again»: the legs may be on the chain");
  assert.ok(inFlight(useLadder.getState().ladders, OWNER, "devnet", Date.now()));
  /* The person taps «Place» again: nothing is built, nothing signed, no second ladder. */
  await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: person.sign, later: noLater });
  assert.equal(api.calls("/review").length, 1);
  assert.equal(person.calls.length, 1);
  assert.equal(useLadder.getState().ladders.length, 1);
  /* The chain's reading: the accounts are there and the signatures confirmed — the legs landed. */
  const orders = Object.fromEntries(ladder.legs.map((leg) => [leg.limitOrder, "open"]));
  const landed = Object.fromEntries(ladder.legs.map((leg) => [leg.signature, "confirmed"]));
  const chain = routes({ chain: orders, landed });
  await readLive(OWNER, chain.fetch, "devnet");
  assert.deepEqual(chain.calls("/orders")[0].body.signatures, ladder.legs.map((leg) => leg.signature), "the confirmation is asked of the chain by signature");
  assert.ok(useLadder.getState().ladders[0].legs.every((leg) => leg.state === "confirmed"));
});

test("a dropped connection mid-send is the same: kept, «sent», settled by the chain — a signature that failed there is «failed»", async () => {
  freshWindow();
  await placeDraft(draft, pool, WHO, 150, { fetch: routes({ submit: "dropped" }).fetch, sign: wallet().sign, later: noLater });
  const [ladder] = useLadder.getState().ladders;
  assert.ok(ladder && ladder.legs.every((leg) => leg.state === "sent"));
  const [first, ...rest] = ladder.legs;
  const chain = routes({ chain: Object.fromEntries(rest.map((leg) => [leg.limitOrder, "open"])), landed: { [first.signature]: "failed" } });
  await readLive(OWNER, chain.fetch, "devnet");
  const legs = useLadder.getState().ladders[0].legs;
  assert.equal(legs[0].state, "failed");
  assert.ok(legs.slice(1).every((leg) => leg.state === "confirmed"));
});

test("a leg the chain never shows, long after it was sent, never landed; one still young waits", () => {
  const leg = { limitOrder: "o", side: "buy", state: "sent", signature: "s", rungs: [], sentAt: 0 };
  const gone = { limitOrder: "o", pool: null, state: "closed", rungs: 0, filled: 0, partial: 0 };
  assert.equal(settleLeg(leg, gone, {}, false).state, "sent");
  assert.equal(settleLeg(leg, gone, {}, true).state, "failed");
  assert.equal(settleLeg(leg, gone, { s: "confirmed" }, true).state, "confirmed", "landed and taken back since: the signature says it landed");
  assert.equal(settleLeg(leg, { ...gone, state: "open" }, {}, false).state, "confirmed");
  assert.equal(SENT_SETTLE_MS, 120_000);
});

test("the relay refused before sending anything: the ladder kept a moment ago is dropped", async () => {
  for (const submit of ["refused", "unreachable"]) {
    freshWindow();
    await placeDraft(draft, pool, WHO, 150, { fetch: routes({ submit }).fetch, sign: wallet().sign, later: noLater });
    assert.equal(useLadder.getState().ladders.length, 0, submit);
    assert.equal(useLadder.getState().note.kind, submit);
  }
  assert.equal(sentNothing({ status: 422, ours: true, reason: "PROMISE_BROKEN" }), true);
  assert.equal(sentNothing({ status: 503, ours: true, reason: "UNREACHABLE" }), true, "the relay's own word: the network could not be reached before the first send");
  assert.equal(sentNothing({ status: 503, ours: false, reason: "REFUSED" }), false, "a proxy's 503 says nothing of what was sent");
  assert.equal(sentNothing({ status: 504, ours: false, reason: "REFUSED" }), false);
  assert.equal(sentNothing({ status: 0, ours: false, reason: "UNREACHABLE" }), false);
});

test("the tab closes while the relay is asked: the ladder is already in this browser's storage, and the next page reads it", async () => {
  const storage = memoryStorage();
  freshWindow(storage);
  let keptWhenAsked = null;
  const api = routes();
  const fetch = async (url, init) => {
    if (url.endsWith("/submit")) {
      keptWhenAsked = JSON.parse(storage.getItem(liveKey("devnet")) ?? "[]");
      throw new TypeError("Failed to fetch");
    }
    return api.fetch(url, init);
  };
  try {
    await placeDraft(draft, pool, WHO, 150, { fetch, sign: wallet().sign, later: noLater });
    assert.equal(keptWhenAsked.length, 1, "kept before the request left");
    assert.ok(keptWhenAsked[0].legs.every((leg) => leg.state === "sent" && leg.signature));
    const nextPage = createLadderStore({ storage: () => storage, network: "devnet" });
    nextPage.getState().hydrate();
    assert.equal(nextPage.getState().ladders.length, 1);
    assert.doesNotMatch(storage.getItem(liveKey("devnet")), /secret/i);
  } finally {
    delete globalThis.window;
  }
});

test("«Cancel orders» with the relay answering on sending: the ladder closes when the chain shows the orders gone, not before", async () => {
  freshWindow();
  await placeDraft(draft, pool, WHO, 150, { fetch: routes().fetch, sign: wallet().sign, later: noLater });
  const [placed] = useLadder.getState().ladders;
  const open = Object.fromEntries(placed.legs.map((leg) => [leg.limitOrder, "open"]));
  await readLive(OWNER, routes({ chain: open }).fetch, "devnet");
  const ladder = useLadder.getState().ladders[0];
  assert.ok(ladder.legs.every((leg) => leg.state === "confirmed"));
  /* The cancellation is sent; the chain has not caught up yet. */
  const api = routes({ chain: open });
  await takeBack(ladder, WHO, "none", { fetch: api.fetch, sign: wallet().sign, later: noLater });
  assert.equal(api.calls("/submit")[0].body.kind, "cancel");
  assert.equal(useLadder.getState().note.kind, "checking", "sent, not yet taken back: the chain has not said so (review 9.11)");
  assert.equal(useLadder.getState().ladders[0].closedAt, null, "not closed on the relay's word alone");
  assert.equal(typeof useLadder.getState().ladders[0].cancelSentAt, "number");
  /* The chain now holds none of them. */
  await readLive(OWNER, routes().fetch, "devnet");
  assert.equal(typeof useLadder.getState().ladders[0].closedAt, "number");
  assert.equal(useLadder.getState().note.kind, "cancelled", "said once the chain shows the orders gone");
});

/* ---------------------------------------------------------------- flaw 3 */

const BOT = (orders, extra = {}) => ({ id: `ladder:${orders[0]}`, kind: "ladder", venue: "meteora_dlmm", status: "partial", refs: { orders, pool: POOL }, ...extra });

test("«Cancel» belongs to a DLMM order or ladder read from the chain, while the window's ladder lives on mainnet", () => {
  const orders = [Keypair.generate().publicKey.toBase58()];
  assert.equal(chainCancellable(BOT(orders), "mainnet"), true);
  assert.equal(chainCancellable(BOT(orders, { kind: "limit" }), "mainnet"), true);
  assert.equal(chainCancellable(BOT(orders, { status: "closed" }), "mainnet"), false, "nothing left to take back");
  assert.equal(chainCancellable(BOT(orders, { venue: "jupiter_trigger_v1", kind: "limit" }), "mainnet"), false, "Jupiter's orders are the limits lane's");
  assert.equal(chainCancellable(BOT(orders, { kind: "range_lp" }), "mainnet"), false, "a pool position is not an order");
  assert.equal(chainCancellable(BOT([]), "mainnet"), false);
  assert.equal(chainCancellable(BOT(orders), "devnet"), false, "the Hangar reads mainnet: a devnet window has no road to it");
  assert.equal(chainCancellable(BOT(orders), null), false);
  assert.equal(LADDER_NET, null, "in the tests no deployment names a network: the button hides by default");
});

test("«Cancel» on a chain bot with nothing kept in this browser: read, one mainnet prompt for the orders still there, relayed", async () => {
  freshWindow();
  assert.equal(globalThis.window, undefined, "no browser storage at all — another device, the app, a cleared browser");
  const [a, b, gone] = [0, 1, 2].map(() => Keypair.generate().publicKey.toBase58());
  const api = routes({ chain: { [a]: "partial", [b]: "filled" } });
  const person = wallet();
  const later = [];
  await cancelChainBot(BOT([a, b, gone]), WHO, { fetch: api.fetch, sign: person.sign, later: (run, ms) => later.push(ms) });
  const read = api.calls("/orders")[0].body;
  assert.deepEqual([read.network, read.owner, read.orders], ["mainnet", OWNER, [a, b, gone]], "the bot's own order accounts, read on mainnet");
  assert.deepEqual(api.calls("/cancel")[0].body, { network: "mainnet", owner: OWNER, orders: [a, b] }, "only what is still on the chain");
  assert.equal(person.calls.length, 1, "one prompt");
  assert.equal(person.calls[0].chain, "solana:mainnet");
  const sent = api.calls("/submit")[0].body;
  assert.deepEqual([sent.network, sent.kind, sent.items.map((item) => item.limitOrder)], ["mainnet", "cancel", [a, b]]);
  assert.ok(sent.items.every((item) => Transaction.from(Buffer.from(item.wireBase64, "base64")).verifySignatures(true)), "signed by the wallet alone, before it left");
  assert.deepEqual(useLadder.getState().note, { kind: "checking", at: useLadder.getState().note.at, bot: `ladder:${a}` }, "sent — the chain is checked under that bot; it leaves «My bots» once its orders are gone (review 9.11)");
  assert.equal(useLadder.getState().ladders.length, 0, "nothing was needed from — or written to — this browser");
  assert.ok(later.length > 0, "the Hangar is read again soon");
  assert.equal(useLadder.getState().busy, null);
});

test("a chain bot whose orders are already gone, a wallet that says no, a closed route: nothing signed, said under the bot", async () => {
  const order = Keypair.generate().publicKey.toBase58();
  freshWindow();
  const loads = [];
  const loadChain = useBots.getState().loadChain;
  useBots.setState({ loadChain: async (...args) => void loads.push(args) });
  try {
    const empty = routes();
    const person = wallet();
    await cancelChainBot(BOT([order]), WHO, { fetch: empty.fetch, sign: person.sign, later: noLater });
    assert.equal(person.calls.length, 0);
    assert.equal(empty.calls("/cancel").length, 0);
    assert.equal(useLadder.getState().note.kind, "cancelled");
    assert.deepEqual(loads[0], [OWNER, true], "read again: the bot leaves «My bots»");
    const no = { sign: async () => ({ ok: false, reason: "closed" }) };
    await cancelChainBot(BOT([order]), WHO, { fetch: routes({ chain: { [order]: "open" } }).fetch, sign: no.sign, later: noLater });
    assert.equal(useLadder.getState().note.kind, "walletNo");
    const closed = async () => Response.json({ error: { code: "LADDER_CLOSED" } }, { status: 404 });
    await cancelChainBot(BOT([order]), WHO, { fetch: closed, sign: wallet().sign, later: noLater });
    assert.equal(useLadder.getState().note.kind, "refused");
    assert.equal(useLadder.getState().note.bot, `ladder:${order}`);
  } finally {
    useBots.setState({ loadChain });
  }
});

test("the words: «Cancel» and «sent — checking» in both languages", () => {
  assert.equal(WORDS.en.chainCancel, "Cancel");
  assert.equal(WORDS.uk.chainCancel, "Скасувати");
  for (const lang of ["en", "uk"]) {
    for (const network of ["devnet", "mainnet"]) assert.ok(ladderWords(lang, network, WORDS[lang]).note.checking, `${lang} ${network}`);
    assert.doesNotMatch(WORDS[lang].ladderNote.checking, /try again|спробуй/i, "a lost answer is not «try again»: that is how a second ladder gets placed");
  }
});

/* ---------------------------------------------------------------- helpers */

function composedLegs() {
  return [{ side: "buy", steps: 5, firstPct: 1, lastPct: 10, shape: "even", amountRaw: "100000000" }];
}

async function shown() {
  return (await review(composedLegs()[0], Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58()))).costs;
}
