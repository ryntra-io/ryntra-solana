// Run from repo root: node --test city/lib/bots/ladder.test.mjs
//
// The ladder composer in the window (CITY-135): the plan and its one cost line from the draft, and the browser's part
// of «no path signs for the person» — the wallet is asked once, on devnet, for exactly the reviewed transactions; the
// order accounts' keys never leave the browser; anything changed or unsigned stops before it is sent.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { binOfPrice, chunkRungs, planLeg } from "../../../lib/bots/ladder/plan.ts";
import { ladderCosts } from "../../../lib/bots/ladder/costs.ts";
import { DLMM_DISCRIMINATOR } from "../../../lib/solana/limits/dlmm-tx.ts";
import { DLMM_PROGRAM } from "../../../lib/solana/limits/model.ts";
import { defaultDraft, draftIssues, ladderOf, levelsOf, smartParts } from "./draft.ts";
import { composeLadder, createLadderStore, isLiveLadder, LADDER_NET, LIVE_KEY } from "./ladder.ts";
import { addOrderSignature, cancelLadderOrders, checkCancel, checkUnsigned, placeLadder } from "./ladder-sign.ts";
import { simulate, tradesOf } from "./sim.ts";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL = "So11111111111111111111111111111111111111112";
const owner = Keypair.generate();
const OWNER = owner.publicKey.toBase58();
const POOL = Keypair.generate().publicKey.toBase58();
const facts = { pool: POOL, binStep: 10, activeId: 0, baseIsX: true, baseMint: SOL, quoteMint: USDC, baseDecimals: 9, quoteDecimals: 6 };
facts.activeId = binOfPrice(150, false, facts);
const pool = { facts, activePrice: 150, takesLimitOrders: true, existingArrays: [Math.floor(facts.activeId / 70), Math.floor(facts.activeId / 70) - 1], bitmapExtension: true };
const pair = { mint: SOL, symbol: "SOL" };

test("the composer is closed unless the deployment says devnet", () => {
  assert.equal(LADDER_NET, null, "no switch in the test environment: practice only");
});

test("a draft becomes the engine's legs, plans and exact cost line", () => {
  const buy = composeLadder(defaultDraft("buyLadder", pair, 150, null, 100), pool, 150);
  assert.equal(buy.legs[0].side, "buy");
  assert.equal(buy.legs[0].amountRaw, "100000000", "$100 of USDC");
  assert.equal(buy.plans[0].rungs.length, 5);
  assert.deepEqual(buy.issues, []);
  assert.ok(buy.costs.rentBackLamports > 0 && buy.costs.networkLamports > 0);
  const exit = composeLadder(defaultDraft("exitLadder", pair, 150, null, 150), pool, 150);
  assert.equal(exit.legs[0].side, "exit");
  assert.equal(exit.legs[0].amountRaw, "1000000000", "$150 of SOL at $150 is one SOL");
  const smart = composeLadder(defaultDraft("smartDca", pair, 150, null, 200), pool, 150);
  assert.equal(smart.legs[0].side, "buy");
  assert.equal(smart.amountUsd, 100, "half of Smart DCA's budget is its ladder");
  assert.equal(composeLadder(defaultDraft("grid", pair, 150, null), pool, 150), null, "a grid is not a ladder");
});

test("Smart DCA: a ladder leg and reminders; a draft saved before the ladder reads as reminders only", () => {
  const draft = defaultDraft("smartDca", pair, 150, null, 200);
  assert.deepEqual(draftIssues(draft), []);
  assert.equal(smartParts(draft).ladderPct, 50);
  assert.equal(levelsOf(draft, 150).length, 4);
  const old = { kind: "smartDca", pair, amountUsd: 100, exit: "stop", everyHours: 24, buys: 5 };
  assert.equal(ladderOf(old), null);
  assert.deepEqual(levelsOf(old, 150), []);
  assert.deepEqual(draftIssues(old), []);
  /* On paper: the price falls through the ladder and the reminders keep buying, all inside the budget. */
  const t0 = Date.UTC(2026, 9, 1);
  const bars = Array.from({ length: 120 }, (_, i) => {
    const c = 150 * (1 - 0.25 * Math.min(1, i / 80));
    return { t: t0 + i * 3_600_000, o: c, h: c, l: c, c };
  });
  const run = simulate(draft, bars);
  const ladderFills = tradesOf(run).filter((fill) => fill.note === "level");
  const taps = tradesOf(run).filter((fill) => fill.note === "tap");
  assert.ok(ladderFills.length >= 3, "the ladder filled on the way down");
  assert.ok(taps.length >= 2, "the reminders bought too");
  assert.ok(run.fills.reduce((sum, fill) => sum + (fill.side === "buy" ? fill.usd : 0), 0) <= 200 + 1e-6);
});

/* ------------------------------------------------- the server, faked */

const { createProgram } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const anchor = createProgram(new Connection("http://127.0.0.1:1"), { cluster: "devnet" });

async function placeIx(order, rungs, poolKey = POOL, who = owner.publicKey) {
  return anchor.methods
    .placeLimitOrder({ isAskSide: false, relativeBin: null, bins: rungs.map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) })), padding: new Array(16).fill(0) }, { slices: [] })
    .accountsPartial({
      lbPair: new PublicKey(poolKey),
      binArrayBitmapExtension: anchor.programId,
      reserve: Keypair.generate().publicKey,
      tokenMint: new PublicKey(USDC),
      tokenProgram: TOKEN_PROGRAM_ID,
      limitOrder: new PublicKey(order),
      userToken: getAssociatedTokenAddressSync(new PublicKey(USDC), who),
      sender: who,
      payer: who,
      owner: who,
    })
    .instruction();
}

const unsigned = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

/** What the review route answers for a buy leg: the plan cut by bin array, one transaction per order key. */
async function review(leg, orderKeys, tamper = {}) {
  const plan = planLeg(leg, facts);
  const chunks = chunkRungs(plan.rungs);
  const transactions = [];
  for (const [i, rungs] of chunks.entries()) {
    const shown = tamper.amount && i === 0 ? rungs.map((rung, j) => (j === 0 ? { ...rung, amountRaw: (BigInt(rung.amountRaw) + 1n).toString() } : rung)) : rungs;
    const ix = await placeIx(orderKeys[i], tamper.amount ? shown : rungs);
    const tx = new Transaction({ feePayer: owner.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(ix);
    if (tamper.extra && i === 0) tx.add(new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }));
    transactions.push({ side: "buy", wireBase64: unsigned(tx), limitOrder: orderKeys[i], rungs, depositLamports: null });
  }
  const costs = ladderCosts([plan], { existingArrays: new Set(pool.existingArrays), bitmapExtension: true });
  return { network: "devnet", pool: facts, activePrice: 150, plans: [plan], transactions, costs: tamper.costs ? { ...costs, rentKeptLamports: costs.rentKeptLamports + 71_437_440 } : costs, canDo: [] };
}

const LEG = { side: "buy", steps: 8, firstPct: 1, lastPct: 30, shape: "even", amountRaw: "200000000" };

/** A fetch that plays the engine's routes and keeps every request body. */
function engine(tamper = {}) {
  const bodies = [];
  const submitted = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(init.body);
    if (url.endsWith("/review")) return Response.json(await review(body.legs[0], body.orderKeys, tamper));
    if (url.endsWith("/submit")) {
      submitted.push(body);
      return Response.json({ network: "devnet", legs: body.items.map((item, i) => ({ limitOrder: item.limitOrder, signature: `sig${i}`, state: "confirmed", reason: null })) });
    }
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  return { fetch, bodies, submitted };
}

/** The person's wallet, as Phantom answers: it signs the exact bytes it was shown, with the person's key, and returns them. */
function wallet(options = {}) {
  const calls = [];
  const sign = async (args) => {
    calls.push(args);
    if (options.refuse) return { ok: false, reason: "closed" };
    return {
      ok: true,
      signedWireBase64: args.unsignedWireBase64.map((wire) => {
        let bytes = Buffer.from(wire, "base64");
        if (options.tamper) {
          /* A wallet that moves the first step to another bin before signing. */
          const tx = Transaction.from(bytes);
          tx.instructions[0].data[30] ^= 1;
          bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        }
        const exact = VersionedTransaction.deserialize(bytes);
        exact.sign([owner]);
        return Buffer.from(exact.serialize()).toString("base64");
      }),
    };
  };
  return { sign, calls };
}

const shownFor = async () => (await review(LEG, Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58()))).costs;

test("the server's transactions are read against the plan before the wallet sees them", async () => {
  const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58());
  const good = await review(LEG, keys);
  assert.deepEqual(checkUnsigned(good, { owner: OWNER, pool: POOL, legs: [LEG] }, new Set(keys)), { ok: true });
  assert.equal(checkUnsigned(await review(LEG, keys, { amount: true }), { owner: OWNER, pool: POOL, legs: [LEG] }, new Set(keys)).ok, false, "one lamport more in a bin");
  assert.equal(checkUnsigned(await review(LEG, keys, { extra: true }), { owner: OWNER, pool: POOL, legs: [LEG] }, new Set(keys)).ok, false, "a program outside the order");
  assert.equal(checkUnsigned(good, { owner: OWNER, pool: POOL, legs: [{ ...LEG, amountRaw: "1" }] }, new Set(keys)).ok, false, "another amount than the person set");
  assert.equal(checkUnsigned(good, { owner: OWNER, pool: POOL, legs: [LEG] }, new Set(keys.slice(1))).ok, false, "an order account this tap did not make");
  assert.equal(checkUnsigned(good, { owner: Keypair.generate().publicKey.toBase58(), pool: POOL, legs: [LEG] }, new Set(keys)).ok, false, "another wallet");
});

test("the order account signs only after the wallet, and never in the wallet's place", async () => {
  const order = Keypair.generate();
  const plan = planLeg({ ...LEG, steps: 3, firstPct: 1, lastPct: 3 }, facts);
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(await placeIx(order.publicKey.toBase58(), plan.rungs));
  const wire = unsigned(tx);
  assert.equal(addOrderSignature(wire, order, OWNER).ok, false, "nothing is signed before the wallet signed");
  const exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  exact.sign([owner]);
  const walletSigned = Buffer.from(exact.serialize()).toString("base64");
  assert.equal(addOrderSignature(walletSigned, owner, OWNER).ok, false, "the wallet's own key is never used here");
  assert.equal(addOrderSignature(walletSigned, Keypair.generate(), OWNER).ok, false, "a key the transaction does not ask for");
  const forged = VersionedTransaction.deserialize(Buffer.from(walletSigned, "base64"));
  forged.signatures[0] = Uint8Array.from(forged.signatures[0]).fill(9);
  assert.equal(addOrderSignature(Buffer.from(forged.serialize()).toString("base64"), order, OWNER).ok, false, "a signature not over the message is not the wallet's");
  const done = addOrderSignature(walletSigned, order, OWNER);
  assert.equal(done.ok, true);
  assert.equal(Transaction.from(Buffer.from(done.wireBase64, "base64")).verifySignatures(true), true);
});

test("one tap: the wallet is asked once on devnet; the order accounts' keys never leave the browser", async () => {
  const server = engine();
  const person = wallet();
  const keys = Array.from({ length: 8 }, () => Keypair.generate());
  const result = await placeLadder({ wallet: "Phantom", owner: OWNER, pool: POOL, legs: [LEG], shown: await shownFor() }, { fetch: server.fetch, sign: person.sign, keys: () => keys });
  assert.equal(result.kind, "placed");
  assert.equal(person.calls.length, 1, "one prompt for the whole ladder");
  assert.equal(person.calls[0].chain, "solana:devnet");
  assert.equal(person.calls[0].address, OWNER);
  const reviewed = result.review.transactions.map((tx) => tx.wireBase64);
  assert.deepEqual(person.calls[0].unsignedWireBase64, reviewed, "the wallet sees exactly the reviewed bytes");
  assert.equal(server.submitted.length, 1);
  for (const item of server.submitted[0].items) {
    const tx = Transaction.from(Buffer.from(item.wireBase64, "base64"));
    assert.equal(tx.verifySignatures(true), true);
    assert.equal(tx.signatures[0].publicKey.toBase58(), OWNER, "the first signature is the person's own, from the wallet");
  }
  /* Only public addresses went out: no request carries any order key's secret in any spelling. */
  const sent = server.bodies.join("\n");
  for (const key of keys) {
    const secret = Buffer.from(key.secretKey);
    for (const spelling of [secret.toString("base64"), secret.toString("hex"), secret.subarray(0, 32).toString("base64"), JSON.stringify([...key.secretKey]).slice(1, 60)]) {
      assert.ok(!sent.includes(spelling), "a secret left the browser");
    }
  }
  assert.ok(sent.includes(keys[0].publicKey.toBase58()), "the addresses did go");
});

test("a higher cost line stops before the wallet: shown again, one more tap", async () => {
  const server = engine({ costs: true });
  const person = wallet();
  const result = await placeLadder({ wallet: "Phantom", owner: OWNER, pool: POOL, legs: [LEG], shown: await shownFor() }, { fetch: server.fetch, sign: person.sign });
  assert.equal(result.kind, "costsChanged");
  assert.equal(person.calls.length, 0);
  assert.equal(server.submitted.length, 0);
});

test("a tampered review, a wallet that says no, a wallet that changes the order: nothing is sent", async () => {
  const tampered = engine({ amount: true });
  const first = wallet();
  assert.equal((await placeLadder({ wallet: "Phantom", owner: OWNER, pool: POOL, legs: [LEG], shown: await shownFor() }, { fetch: tampered.fetch, sign: first.sign })).kind, "refused");
  assert.equal(first.calls.length, 0, "the wallet never saw it");
  const server = engine();
  const no = wallet({ refuse: true });
  assert.equal((await placeLadder({ wallet: "Phantom", owner: OWNER, pool: POOL, legs: [LEG], shown: await shownFor() }, { fetch: server.fetch, sign: no.sign })).kind, "walletNo");
  assert.equal(server.submitted.length, 0);
  const changed = wallet({ tamper: true });
  assert.equal((await placeLadder({ wallet: "Phantom", owner: OWNER, pool: POOL, legs: [LEG], shown: await shownFor() }, { fetch: server.fetch, sign: changed.sign })).kind, "refused");
  assert.equal(server.submitted.length, 0);
});

test("«Cancel orders»: read before the wallet, signed by the wallet alone, then relayed", async () => {
  const order = Keypair.generate().publicKey;
  const program = new PublicKey(DLMM_PROGRAM);
  const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const close = new TransactionInstruction({ programId: program, keys: [meta(order, false, true), meta(owner.publicKey, true), meta(owner.publicKey, false, true)], data: Buffer.from(DLMM_DISCRIMINATOR.close, "hex") });
  const cancelWire = unsigned(new Transaction({ feePayer: owner.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(close));
  const items = [{ limitOrder: order.toBase58(), wireBase64: cancelWire }];
  assert.deepEqual(checkCancel(items, OWNER, [order.toBase58()]), { ok: true });
  assert.equal(checkCancel(items, Keypair.generate().publicKey.toBase58(), [order.toBase58()]).ok, false);
  const submitted = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("/cancel")) return Response.json({ network: "devnet", transactions: items });
    submitted.push(body);
    return Response.json({ network: "devnet", legs: body.items.map((item) => ({ limitOrder: item.limitOrder, signature: "sig", state: "confirmed", reason: null })) });
  };
  const person = wallet();
  const result = await cancelLadderOrders({ wallet: "Phantom", owner: OWNER, orders: [order.toBase58()] }, { fetch, sign: person.sign });
  assert.equal(result.kind, "cancelled");
  assert.equal(person.calls.length, 1);
  assert.equal(person.calls[0].chain, "solana:devnet");
  assert.equal(submitted[0].kind, "cancel");
  assert.equal(Transaction.from(Buffer.from(submitted[0].items[0].wireBase64, "base64")).verifySignatures(true), true);
});

test("placed ladders are kept in this browser as public facts; anything else is dropped", () => {
  const kept = new Map();
  const storage = () => ({ getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) });
  const ladder = { id: "a", network: "devnet", owner: OWNER, pool: POOL, baseIsX: true, draft: defaultDraft("buyLadder", pair, 150, null), band: null, legs: [], placedAt: 1, closedAt: null };
  kept.set(LIVE_KEY, JSON.stringify([ladder, { id: "b", network: "mainnet", owner: OWNER, pool: POOL, legs: [], draft: ladder.draft }, "junk"]));
  const store = createLadderStore({ storage });
  store.getState().hydrate();
  assert.deepEqual(store.getState().ladders.map((l) => l.id), ["a"], "a mainnet ladder is not a ladder of this composer");
  store.getState().add({ ...ladder, id: "c" });
  assert.deepEqual(JSON.parse(kept.get(LIVE_KEY)).map((l) => l.id), ["c", "a"]);
  assert.equal(isLiveLadder({ ...ladder, draft: { ...ladder.draft, exit: "auto" } }), false);
  assert.doesNotMatch(kept.get(LIVE_KEY), /secret/i);
});

test("in the browser the only signing call is the order account's own key, made in this tap and never kept", async () => {
  const { readFileSync } = await import("node:fs");
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const sign = strip(readFileSync(new URL("./ladder-sign.ts", import.meta.url), "utf8"));
  assert.deepEqual(sign.match(/\w+\.sign\s*\([^)]*\)/g), ["exact.sign([key])"], "one signing call, the order account's");
  assert.equal((sign.match(/\.sign\s*\(/g) ?? []).length, 1, "and no other .sign( anywhere");
  assert.deepEqual([...new Set(sign.match(/Keypair\.\w+/g))], ["Keypair.generate"], "order keys are only ever made fresh");
  assert.doesNotMatch(sign, /fromSecretKey|fromSeed|secretKey|localStorage|sessionStorage|setItem|indexedDB/, "a key is never read in or kept");
  assert.doesNotMatch(sign, /partialSign|signMessage/);
  for (const file of ["./ladder.ts", "./ladder-actions.ts", "../../components/bots/Ladder.tsx"]) {
    const text = strip(readFileSync(new URL(file, import.meta.url), "utf8"));
    assert.doesNotMatch(text, /\.sign\s*\(|Keypair|secretKey|signTransaction/, `${file} signs nothing`);
  }
});
