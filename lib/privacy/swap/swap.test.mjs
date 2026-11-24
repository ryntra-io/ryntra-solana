import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { COMPUTE_MAX, V1_MAX_ADDRESSES, choosePath, computeOf, depositAmount, estimateBytes, oneDoesNotFit, unionAddresses } from "./plan.ts";
import { SOL_FEE_KEEP, factsOf, nextOf, onChainOf, readRecord, surplusOf, whereAreCoins } from "./recover.ts";
import { ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, boughtAccount, routeInstructions, routeOf } from "./route.ts";
import { WSOL, abilities, gateBothEnds, swapPrivately } from "./run.ts";

/* ---------------- fixtures ---------------- */

const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", lastValidBlockHeight: 1000n };

const addresses = async (n) => Promise.all(Array.from({ length: n }, async () => (await generateKeyPairSigner()).address));

function limitIx(units) {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

/** The open swap's exact order as the card holds it: compute budget, the ATA it opens, Jupiter's swap — version 0. */
async function openOrder({ owner, routeAccounts = 12, units = 300_000, table = false, outMint = USDC } = {}) {
  const ata = (await generateKeyPairSigner()).address;
  const pool = await addresses(routeAccounts);
  const instructions = [
    limitIx(units),
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [
        { address: owner, role: AccountRole.WRITABLE_SIGNER },
        { address: ata, role: AccountRole.WRITABLE },
        { address: owner, role: AccountRole.READONLY },
        { address: outMint, role: AccountRole.READONLY },
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: TOKEN, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    { programAddress: JUP, accounts: [{ address: owner, role: AccountRole.WRITABLE_SIGNER }, { address: ata, role: AccountRole.WRITABLE }, ...pool.map((address) => ({ address, role: AccountRole.WRITABLE }))], data: new Uint8Array(60) },
  ];
  let message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  if (table) message = compressTransactionMessageUsingAddressLookupTables(message, { [(await generateKeyPairSigner()).address]: pool.slice(0, 8) });
  return { wire: getBase64EncodedWireTransaction(compileTransaction(message)), ata, pool };
}

const EDGE = (n = 11) => ({ addresses: Array.from({ length: n }, (_, i) => `edge-${i}`), bytes: 1166 });
const ROUTE = (n = 20, over = {}) => ({ addresses: Array.from({ length: n }, (_, i) => `route-${i}`), tables: false, instructions: [{ accounts: n, data: 60 }], signers: ["me"], computeUnits: 300_000, ...over });
const INPUT = (over = {}) => ({ owner: "me", inMint: WSOL, outMint: USDC, inHolding: "native", outHolding: "classic", routeChain: "solana:devnet", ringChain: "solana:devnet", edge: EDGE(), route: ROUTE(), canOne: true, canPack: true, ...over });

/* ---------------- plan ---------------- */

test("a route that fits goes as one transaction: out, route and in land together or not at all", () => {
  const path = choosePath(INPUT());
  assert.equal(path.kind, "one");
  assert.equal(path.addresses, 31);
  assert.equal(path.computeUnits, 450_000 + 300_000 + 200_000);
  assert.ok(path.bytes <= 4096);
});

test("a route that reads lookup tables cannot stand in v1: the pack, or an honest refusal", () => {
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(20, { tables: true }) })), { kind: "pack", why: "TABLES" });
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(20, { tables: true }), canPack: false })), { kind: "refuse", code: "ONE_PROMPT", why: "TABLES" });
});

test("too many addresses, too many bytes, too much compute: the pack", () => {
  // 11 for the ring's sides + 54 for the route = 65 > 64 (the probe: 53 fit beside the edge).
  assert.equal(unionAddresses(EDGE(), ROUTE(53)), V1_MAX_ADDRESSES);
  assert.equal(choosePath(INPUT({ route: ROUTE(53) })).kind, "one");
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(54) })), { kind: "pack", why: "ADDRESSES" });
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(10, { instructions: [{ accounts: 10, data: 3000 }] }) })), { kind: "pack", why: "BYTES" });
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(10, { computeUnits: 800_000 }) })), { kind: "pack", why: "COMPUTE" });
  assert.ok(computeOf(ROUTE(10, { computeUnits: 750_000 })) <= COMPUTE_MAX);
});

test("shared addresses are counted once, and a route that names no limit is counted at a default", () => {
  const route = ROUTE(5, { addresses: ["edge-0", "edge-1", "r"] });
  assert.equal(unionAddresses(EDGE(), route), 12);
  assert.equal(estimateBytes(EDGE(), route), 1166 + 32 + (1 + 2 + 5 + 4 + 60));
  assert.equal(computeOf(ROUTE(5, { computeUnits: null })), 450_000 + 400_000 + 200_000);
  assert.equal(oneDoesNotFit(EDGE(), ROUTE(5)), null);
});

test("a bundle that cannot compile one transaction sends a fitting route by the pack", () => {
  assert.deepEqual(choosePath(INPUT({ canOne: false })), { kind: "pack", why: "NO_ONE" });
  assert.deepEqual(choosePath(INPUT({ canOne: false, canPack: false })), { kind: "refuse", code: "ONE_PROMPT", why: "NO_ONE" });
});

test("refusals come before any way: same coin, another network, Token-2022, a stranger's signature", () => {
  assert.deepEqual(choosePath(INPUT({ outMint: WSOL })), { kind: "refuse", code: "SAME" });
  assert.deepEqual(choosePath(INPUT({ routeChain: "solana:mainnet" })), { kind: "refuse", code: "ELSEWHERE" });
  assert.deepEqual(choosePath(INPUT({ outHolding: "token2022" })), { kind: "refuse", code: "PAIR" });
  assert.deepEqual(choosePath(INPUT({ route: ROUTE(10, { signers: ["me", "someone"] }) })), { kind: "refuse", code: "SIGNER" });
});

test("what goes back into the ring is the route's minimum, never a guess", () => {
  assert.equal(depositAmount("99500000"), 99_500_000n);
  assert.throws(() => depositAmount("0"), RangeError);
});

/* ---------------- route ---------------- */

test("the route is read from the open order's exact bytes: addresses, signer, compute, the account it opens", async () => {
  const owner = (await generateKeyPairSigner()).address;
  const { wire, ata, pool } = await openOrder({ owner, routeAccounts: 12, units: 321_000 });
  const route = routeOf(wire);
  assert.equal(route.tables, false);
  assert.equal(route.computeUnits, 321_000);
  assert.deepEqual(route.signers, [owner]);
  for (const a of [owner, ata, USDC, JUP, ASSOCIATED_TOKEN_PROGRAM, ...pool]) assert.ok(route.addresses.includes(a), a);
  assert.ok(!route.addresses.includes(COMPUTE_BUDGET_PROGRAM), "the compute budget is set by the one transaction itself");
  assert.equal(route.instructions.length, 2);
  assert.deepEqual(boughtAccount(wire, owner, USDC), { account: ata, program: TOKEN });
  assert.equal(boughtAccount(wire, owner, WSOL), null);
  const ixs = routeInstructions(wire);
  assert.deepEqual(ixs.map((ix) => ix.programAddress), [ASSOCIATED_TOKEN_PROGRAM, JUP]);
  assert.equal(ixs[1].data.length, 60);
});

test("an order with lookup tables is marked, and its instructions are never lifted into v1", async () => {
  const owner = (await generateKeyPairSigner()).address;
  const { wire } = await openOrder({ owner, table: true });
  assert.equal(routeOf(wire).tables, true);
  assert.throws(() => routeInstructions(wire), /lookup tables/);
});

/* ---------------- recover: each break ---------------- */

const FACTS = { inMint: WSOL, outMint: USDC, outAmount: 500_000_000n, inAmount: 99_000_000n, solMint: WSOL };
const READ = (over) => ({ kind: "pack", out: { status: "landed" }, swap: { status: "landed" }, in: { status: "landed" }, expired: false, wallet: { inMint: 3_000_000_000n, outMint: 0n }, received: 99_000_000n, ...over });

test("break before out lands: wait while it still can, nothing moved once it cannot", () => {
  assert.deepEqual(whereAreCoins(READ({ out: { status: "missing" } }), FACTS), { place: "landing" });
  assert.deepEqual(whereAreCoins(READ({ out: { status: "missing" }, expired: true }), FACTS), { place: "private", done: false });
  assert.deepEqual(whereAreCoins(READ({ out: { status: "failed" } }), FACTS), { place: "private", done: false });
});

test("out landed, the swap did not: the coin paid with is on the person's own wallet — one action back", () => {
  const failed = whereAreCoins(READ({ swap: { status: "failed" }, wallet: { inMint: 3_000_000_000n, outMint: 0n } }), FACTS);
  assert.deepEqual(failed, { place: "wallet", mint: WSOL, amount: 500_000_000n }, "capped at what left the ring");
  assert.deepEqual(nextOf(failed), { does: "return", mint: WSOL, amount: 500_000_000n });
  assert.deepEqual(whereAreCoins(READ({ swap: { status: "missing" } }), FACTS), { place: "landing" }, "a signed swap is waited for, never sent again");
  const expired = whereAreCoins(READ({ swap: { status: "missing" }, expired: true, wallet: { inMint: 300_000_000n, outMint: 0n } }), FACTS);
  assert.deepEqual(expired, { place: "wallet", mint: WSOL, amount: 300_000_000n - SOL_FEE_KEEP }, "SOL keeps the fees on the wallet");
});

test("the swap landed, the step back did not: the coin bought is on the wallet, by what the chain says it received", () => {
  const where = whereAreCoins(READ({ in: { status: "failed" }, wallet: { inMint: 0n, outMint: 99_400_000n }, received: 99_400_000n }), FACTS);
  assert.deepEqual(where, { place: "wallet", mint: USDC, amount: 99_400_000n });
  const unread = whereAreCoins(READ({ in: { status: "missing" }, expired: true, wallet: { inMint: 0n, outMint: 150_000_000n }, received: null }), FACTS);
  assert.deepEqual(unread, { place: "wallet", mint: USDC, amount: 99_000_000n }, "unreadable received: capped at the minimum");
  assert.deepEqual(whereAreCoins(READ({ in: { status: "missing" } }), FACTS), { place: "landing" });
});

test("all landed: done, and what the route gave above its minimum stays on the wallet, said", () => {
  const where = whereAreCoins(READ({ wallet: { inMint: 0n, outMint: 600_000n }, received: 99_600_000n }), FACTS);
  assert.deepEqual(where, { place: "private", done: true, surplus: 600_000n });
  assert.deepEqual(nextOf(where), { does: "none" });
  assert.equal(surplusOf(READ({ received: 98_000_000n }), FACTS), 0n);
});

test("one transaction lands whole or not at all: never half way", () => {
  const one = (status, expired = false) => ({ kind: "one", out: { status }, expired, wallet: { inMint: 0n, outMint: 0n }, received: null });
  assert.deepEqual(whereAreCoins(one("landed"), FACTS), { place: "private", done: true, surplus: 0n });
  assert.deepEqual(whereAreCoins(one("failed"), FACTS), { place: "private", done: false });
  assert.deepEqual(whereAreCoins(one("missing"), FACTS), { place: "landing" });
  assert.deepEqual(whereAreCoins(one("missing", true), FACTS), { place: "private", done: false });
});

test("the chain's status words, and a kept record read back only when it reads as one", () => {
  assert.equal(onChainOf(null), "missing");
  assert.equal(onChainOf({ err: { InstructionError: [0, "x"] }, confirmationStatus: "confirmed" }), "failed");
  assert.equal(onChainOf({ err: null, confirmationStatus: "processed" }), "missing");
  assert.equal(onChainOf({ err: null, confirmationStatus: "finalized" }), "landed");
  const sig = "5".repeat(87);
  const good = { v: 1, kind: "pack", owner: USDC, signatures: [sig, sig, sig], lastValidBlockHeight: "1000", facts: { inMint: WSOL, outMint: USDC, outAmount: "5", inAmount: "4", solMint: WSOL } };
  const read = readRecord(JSON.stringify(good));
  assert.deepEqual(read, good);
  assert.equal(factsOf(read).outAmount, 5n);
  for (const bad of [null, "", "{", JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, signatures: [sig] }), JSON.stringify({ ...good, facts: { ...good.facts, inAmount: "-1" } })]) assert.equal(readRecord(bad), null);
});

/* ---------------- run: the steps with fakes ---------------- */

const MARK = 0xee;

/** A fake ring SDK and chain: ring transactions are `[MARK, id]`, the order is its real v0 bytes. */
async function fakeWorld({ sendFails = -1, gate = { paused: false }, chain = "solana:devnet" } = {}) {
  const owner = (await generateKeyPairSigner()).address;
  const { wire, ata } = await openOrder({ owner });
  const order = { wireBase64: wire, lastValidBlockHeight: "900", inputMint: WSOL, outputMint: USDC, inAmountRaw: "500000000", minReceivedRaw: "99000000", chain };
  const log = [];
  let ring = 0;
  const ringTx = (kind, params) => {
    ring += 1;
    log.push([kind, params]);
    return { messageBytes: new Uint8Array([MARK, ring]), lifetimeConstraint: { lastValidBlockHeight: 950n } };
  };
  const { getTransactionDecoder } = await import("@solana/kit");
  const kitDecoder = getTransactionDecoder();
  const sent = [];
  const sdk = {
    SOL_MINT: SYSTEM,
    buildWithdrawalTransaction: async (p) => ringTx("withdraw", p),
    buildDepositTransaction: async (p) => ringTx("deposit", p),
    getTransactionEncoder: () => ({ encode: (tx) => tx.messageBytes }),
    getTransactionDecoder: () => ({ decode: (bytes) => (bytes[0] === MARK ? { messageBytes: bytes } : kitDecoder.decode(bytes)) }),
    getSignatureFromTransaction: (tx) => `sig-${Array.from(tx.messageBytes.slice(0, 2)).join("-")}`,
  };
  const status = () => null;
  const client = {
    solanaRpc: {
      getAccountInfo: (mint) => ({ send: async () => ({ value: mint === USDC ? { owner: TOKEN } : null }) }),
      getTokenAccountsByOwner: () => ({ send: async () => ({ value: [{ pubkey: ata, account: { data: { parsed: { info: { tokenAmount: { amount: "0" } } } } } }] }) }),
      sendTransaction: (b64) => ({
        send: async () => {
          sent.push(b64);
          if (sent.length - 1 === sendFails) throw new Error("dropped");
        },
      }),
      getSignatureStatuses: (sigs) => ({ send: async () => ({ value: sigs.map(status) }) }),
      getBlockHeight: () => ({ send: async () => 1200n }),
      getTransaction: () => ({ send: async () => null }),
    },
    getBalance: async () => 3_000_000_000n,
    confirmTransaction: async (sig) => {
      if (onChainOf(status(sig)) !== "landed") throw new Error("not confirmed");
      return 1n;
    },
  };
  const asked = [];
  const ctx = {
    sdk,
    client,
    gate: {
      ask: async (addrs) => {
        asked.push(addrs);
        return { paused: gate.paused, cap: null, marks: Object.fromEntries(addrs.map((a) => [a, "clear"])) };
      },
      landed: (move, lamports) => log.push(["landed", move, lamports]),
    },
  };
  const book = { wallet: {}, keys: { address: () => "shielded" }, owner };
  const signedWires = [];
  const wallet = {
    address: owner,
    signWire: async (w) => w,
    signWires: async (wires) => {
      signedWires.push(wires.length);
      return wires;
    },
  };
  return { ctx, book, wallet, order, log, sent, asked, signedWires, owner };
}

const LANDED = { err: null, confirmationStatus: "confirmed" };
const FAILED = { err: { InstructionError: [2, "x"] }, confirmationStatus: "confirmed" };

test("this build's bundle cannot compile one transaction: a swap goes the pack's way, under one approval", async () => {
  const world = await fakeWorld();
  assert.deepEqual(abilities(world.ctx, world.wallet), { canOne: false, canPack: true });
  assert.deepEqual(abilities(world.ctx, { address: "x", signWire: async (w) => w }), { canOne: false, canPack: false });
});

test("a route on another network is refused before any chain read, proof or signature", async () => {
  const world = await fakeWorld({ chain: "solana:mainnet" });
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet" });
  assert.deepEqual(end.path, { kind: "refuse", code: "ELSEWHERE" });
  assert.equal(world.log.length, 0);
  assert.equal(world.sent.length, 0);
  assert.equal(world.asked.length, 0);
});

test("paused deposits refuse the whole swap before the proof: it never leaves the ring without a way back", async () => {
  const world = await fakeWorld({ gate: { paused: true } });
  await assert.rejects(swapPrivately({ ...world, ringChain: "solana:devnet" }), (e) => e.code === "GATE_PAUSED");
  assert.equal(world.log.filter(([k]) => k === "withdraw").length, 0, "no proof computed");
  assert.equal(world.sent.length, 0);
});

test("the gate is asked at both ends: out to one's own wallet asks nothing, back in asks as a Hide", async () => {
  const world = await fakeWorld();
  await gateBothEnds(world.ctx, world.book, world.owner);
  assert.deepEqual(world.asked, [[world.owner]], "only the step back into the ring asks the list");
});

/** The fake's signature of the open order: its first two message bytes. */
async function orderSigOf(order) {
  const kit = await import("@solana/kit");
  const message = kit.getTransactionDecoder().decode(kit.getBase64Encoder().encode(order.wireBase64)).messageBytes;
  return `sig-${Array.from(message.slice(0, 2)).join("-")}`;
}

test("the pack: one approval for three, the record kept before sending, all land → the new coin is private", async () => {
  const world = await fakeWorld();
  const orderSig = await orderSigOf(world.order);
  const all = { "sig-238-1": LANDED, [orderSig]: LANDED, "sig-238-2": LANDED };
  world.ctx.client.solanaRpc.getSignatureStatuses = (sigs) => ({ send: async () => ({ value: sigs.map((x) => all[x] ?? null) }) });
  world.ctx.client.confirmTransaction = async (x) => (all[x] ? 1n : Promise.reject(new Error("not confirmed")));
  const remembered = [];
  const stages = [];
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet", remember: (r) => remembered.push(r), on: (x) => stages.push(x) });
  assert.equal(end.path.kind, "pack");
  assert.deepEqual(world.signedWires, [3], "three transactions, one approval");
  assert.equal(world.sent.length, 3, "each sent once");
  assert.equal(remembered.length, 1, "the record is kept before anything is sent");
  assert.deepEqual(remembered[0].signatures, ["sig-238-1", orderSig, "sig-238-2"]);
  assert.equal(remembered[0].lastValidBlockHeight, "950");
  assert.deepEqual(stages, ["checking", "proving", "signing", "sending", "reading"]);
  assert.deepEqual(end.where, { place: "private", done: true, surplus: 0n });
  const withdraw = world.log.find(([k]) => k === "withdraw")[1];
  assert.equal(withdraw.recipient, world.owner, "out to the person's own wallet, never another address");
  assert.equal(withdraw.amount, 500_000_000n);
  const deposit = world.log.find(([k]) => k === "deposit")[1];
  assert.equal(deposit.amount, 99_000_000n, "back in: the route's minimum");
  assert.equal(deposit.asset, USDC);
  assert.equal(deposit.recipient, "shielded");
  assert.ok(world.log.some(([k, move, lamports]) => k === "landed" && move === "out" && lamports === 500_000_000n), "SOL out of the ring is counted");
});

test("a swap that fails after out landed: sending stops, the chain says the SOL is on the wallet", async () => {
  const world = await fakeWorld();
  const orderSig = await orderSigOf(world.order);
  const all = { "sig-238-1": LANDED, [orderSig]: FAILED };
  world.ctx.client.solanaRpc.getSignatureStatuses = (sigs) => ({ send: async () => ({ value: sigs.map((x) => all[x] ?? null) }) });
  world.ctx.client.confirmTransaction = async (x) => (all[x] === LANDED ? 1n : Promise.reject(new Error("failed")));
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet" });
  assert.equal(world.sent.length, 2, "the step back is never sent after a failed swap");
  assert.deepEqual(end.where, { place: "wallet", mint: WSOL, amount: 500_000_000n });
});

test("the step back fails after the swap: the USDC is on the wallet, one action returns it", async () => {
  const world = await fakeWorld();
  const orderSig = await orderSigOf(world.order);
  const all = { "sig-238-1": LANDED, [orderSig]: LANDED, "sig-238-2": FAILED };
  world.ctx.client.solanaRpc.getSignatureStatuses = (sigs) => ({ send: async () => ({ value: sigs.map((x) => all[x] ?? null) }) });
  world.ctx.client.confirmTransaction = async (x) => (all[x] === LANDED ? 1n : Promise.reject(new Error("failed")));
  world.ctx.client.solanaRpc.getTokenAccountsByOwner = () => ({ send: async () => ({ value: [{ pubkey: "acct", account: { data: { parsed: { info: { tokenAmount: { amount: "99200000" } } } } } }] }) });
  world.ctx.client.solanaRpc.getTransaction = () => ({
    send: async () => ({ meta: { fee: 5000, preBalances: [0], postBalances: [0], preTokenBalances: [], postTokenBalances: [{ owner: world.owner, mint: USDC, uiTokenAmount: { amount: "99200000" } }] } }),
  });
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet" });
  assert.equal(world.sent.length, 3);
  assert.deepEqual(end.where, { place: "wallet", mint: USDC, amount: 99_200_000n });
  assert.deepEqual(nextOf(end.where), { does: "return", mint: USDC, amount: 99_200_000n });
});

test("the network drops the first step: nothing is sent again, and once expired the coins never left", async () => {
  const world = await fakeWorld({ sendFails: 0 });
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet" });
  assert.equal(world.sent.length, 1);
  assert.deepEqual(end.where, { place: "private", done: false }, "height 1200 > 950: it can no longer land");
});

test("a wallet that refuses or changes the bytes: nothing is sent", async () => {
  const refused = await fakeWorld();
  refused.wallet.signWires = async () => {
    throw new Error("User rejected");
  };
  await assert.rejects(swapPrivately({ ...refused, ringChain: "solana:devnet" }), (e) => e.code === "WALLET_REFUSED");
  assert.equal(refused.sent.length, 0);
  const changed = await fakeWorld();
  changed.wallet.signWires = async (wires) => wires.map((w, i) => (i === 2 ? new Uint8Array([MARK, 99]) : w));
  await assert.rejects(swapPrivately({ ...changed, ringChain: "solana:devnet" }), (e) => e.code === "WALLET_CHANGED_MESSAGE");
  assert.equal(changed.sent.length, 0);
});

test("a wallet that cannot sign three at once: refused before the proof, honestly", async () => {
  const world = await fakeWorld();
  delete world.wallet.signWires;
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet" });
  assert.deepEqual(end.path, { kind: "refuse", code: "ONE_PROMPT", why: "NO_ONE" });
  assert.equal(world.log.filter(([k]) => k === "withdraw").length, 0);
});

test("after the proof the card's freshest order of the same pair and amount is taken; another amount is not", async () => {
  const world = await fakeWorld();
  const fresher = { ...world.order, minReceivedRaw: "99300000" };
  let sentOrder = null;
  world.wallet.signWires = async (wires) => {
    sentOrder = wires[1];
    return wires;
  };
  await swapPrivately({ ...world, ringChain: "solana:devnet", fresh: () => fresher });
  assert.equal(world.log.find(([k]) => k === "deposit")[1].amount, 99_300_000n, "the fresh minimum goes back in");
  assert.ok(sentOrder, "the fresh order's bytes are the ones signed");
  const other = await fakeWorld();
  await swapPrivately({ ...other, ringChain: "solana:devnet", fresh: () => ({ ...other.order, inAmountRaw: "1", minReceivedRaw: "5" }) });
  assert.equal(other.log.find(([k]) => k === "deposit")[1].amount, 99_000_000n, "another amount is never swapped in");
});

test("one transaction: out, route and in compiled together under one signature; it lands whole", async () => {
  const world = await fakeWorld();
  const { sdk, client } = world.ctx;
  let compiled = null;
  sdk.decompileTransactionMessage = () => ({ instructions: [{ programAddress: "ring", accounts: [], data: new Uint8Array() }] });
  sdk.getCompiledTransactionMessageDecoder = () => ({ decode: () => ({ staticAccounts: Array.from({ length: 11 }, (_, i) => `edge-${i}`) }) });
  sdk.compileUnsignedTransaction = (opts) => {
    compiled = opts;
    return { messageBytes: new Uint8Array([MARK, 77]) };
  };
  sdk.partiallySignTransactionWithSigners = async (_s, tx) => tx;
  client.solanaRpc.getLatestBlockhash = () => ({ send: async () => ({ value: { blockhash: "x", lastValidBlockHeight: 2000n } }) });
  client.solanaRpc.simulateTransaction = () => ({ send: async () => ({ value: { err: null } }) });
  client.solanaRpc.getSignatureStatuses = (sigs) => ({ send: async () => ({ value: sigs.map((x) => (x === "sig-238-77" ? LANDED : null)) }) });
  client.confirmTransaction = async () => 1n;
  const remembered = [];
  delete world.wallet.signWires;
  const end = await swapPrivately({ ...world, ringChain: "solana:devnet", remember: (r) => remembered.push(r) });
  assert.equal(end.path.kind, "one");
  assert.equal(compiled.computeUnitLimit, 450_000 + 300_000 + 200_000, "the compute of all three, not the deposit's 200 000");
  assert.equal(compiled.instructions.length, 1 + 2 + 1, "withdrawal · the route's two (compute budget left out) · deposit");
  assert.equal(world.sent.length, 1, "one transaction, sent once");
  assert.equal(remembered[0].kind, "one");
  assert.equal(remembered[0].lastValidBlockHeight, "2000", "its own blockhash's life, never zero");
  assert.deepEqual(end.where, { place: "private", done: true, surplus: 0n });
});
