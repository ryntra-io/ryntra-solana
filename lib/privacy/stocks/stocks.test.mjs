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
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { STOCK_BAND, amountSeenOnExit, stockSeen } from "./band.ts";
import { USDC_MINTS, WSOL, backCoinOf, buyCompute, buyWithdrawal, chooseBuyPath, chooseIncomePath, incomeCompute, misfitOf, splitIncome } from "./plan.ts";
import { INCOME_MOST, SOL_FEE_KEEP, buyFactsOf, incomeFactsOf, nextAfter, readStockRecord, whereAfterBuy, whereAfterIncome } from "./recover.ts";
import { RING_NEVER, STOCK_EXTENSIONS, ringAdmits, stockAsk } from "./ring-admits.ts";
import { associatedAccount, buyStockPrivately, claimShapeOf, claimUnwrapsSol, incomeToPrivate, issuerOf } from "./run.ts";
import { bandOf } from "../exposure.ts";
import { COMPUTE_MAX, V1_MAX_ADDRESSES } from "../swap/plan.ts";
import { ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM } from "../swap/route.ts";

/* ---------------- fixtures ---------------- */

const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const USDC = USDC_MINTS[0];
/** A stock's mint, by shape only (xStocks' NVDAx). */
const STOCK = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const BLOCKHASH = { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", lastValidBlockHeight: 1000n };

const addresses = async (n) => Promise.all(Array.from({ length: n }, async () => (await generateKeyPairSigner()).address));

function limitIx(units) {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

function wireOf(owner, instructions, table = null) {
  let message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  if (table) message = compressTransactionMessageUsingAddressLookupTables(message, table);
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

/** The stock ticket's exact order: compute budget, the stock's account opened under Token-2022, Jupiter's swap. */
async function stockOrder({ owner, routeAccounts = 12, units = 300_000, table = false } = {}) {
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
        { address: STOCK, role: AccountRole.READONLY },
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: TOKEN22, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    { programAddress: JUP, accounts: [{ address: owner, role: AccountRole.WRITABLE_SIGNER }, { address: ata, role: AccountRole.WRITABLE }, ...pool.map((address) => ({ address, role: AccountRole.WRITABLE }))], data: new Uint8Array(60) },
  ];
  const tableOf = table ? { [(await generateKeyPairSigner()).address]: pool.slice(0, 8) } : null;
  return { wire: wireOf(owner, instructions, tableOf), ata };
}

/** The engine's claim of a DLMM position's fees: the USDC account opened, the claim, and — for SOL — the unwrap. */
async function claimTx({ owner, quote = USDC, unwrap = false, units = 200_000 } = {}) {
  const ata = (await generateKeyPairSigner()).address;
  const wsolAta = (await generateKeyPairSigner()).address;
  const pool = await addresses(8);
  const instructions = [
    limitIx(units),
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [
        { address: owner, role: AccountRole.WRITABLE_SIGNER },
        { address: ata, role: AccountRole.WRITABLE },
        { address: owner, role: AccountRole.READONLY },
        { address: quote, role: AccountRole.READONLY },
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: TOKEN, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    { programAddress: DLMM, accounts: [{ address: owner, role: AccountRole.WRITABLE_SIGNER }, { address: ata, role: AccountRole.WRITABLE }, ...pool.map((address) => ({ address, role: AccountRole.WRITABLE }))], data: new Uint8Array(8) },
  ];
  if (unwrap) {
    instructions.push({ programAddress: TOKEN, accounts: [{ address: wsolAta, role: AccountRole.WRITABLE }, { address: owner, role: AccountRole.WRITABLE }, { address: owner, role: AccountRole.READONLY_SIGNER }], data: new Uint8Array([9]) });
  }
  return { wire: wireOf(owner, instructions), ata };
}

const EDGE = (n = 9) => ({ addresses: Array.from({ length: n }, (_, i) => `edge-${i}`), bytes: 900 });
const ROUTE = (n = 20, over = {}) => ({ addresses: Array.from({ length: n }, (_, i) => `route-${i}`), tables: false, instructions: [{ accounts: n, data: 60 }], signers: ["me"], computeUnits: 300_000, ...over });
const BUY = (over = {}) => ({ owner: "me", payMint: USDC, payHolding: "classic", stockMint: STOCK, routeChain: "solana:devnet", ringChain: "solana:devnet", edge: EDGE(), route: ROUTE(), issuer: { paused: false, frozenByDefault: false }, canOne: true, canPack: true, ...over });

/* ---------------- the ring and a stock ---------------- */

test("a stock token does not sit in the ring: default account state and pausable are refused, exactly", () => {
  const stock = ringAdmits(STOCK_EXTENSIONS);
  assert.equal(stock.admitted, false);
  assert.deepEqual(stock.refused, ["defaultAccountState", "pausableConfig"]);
  assert.deepEqual(stockAsk(), ["defaultAccountState", "pausableConfig"], "the one sentence to Helius");
  assert.deepEqual(ringAdmits(STOCK_EXTENSIONS, "live").refused, ["permanentDelegate", "defaultAccountState", "pausableConfig", "transferHook"]);
  assert.equal(ringAdmits([]).admitted, true, "SOL and a classic token: no extensions");
  for (const never of RING_NEVER) assert.equal(ringAdmits([never]).admitted, false, never);
});

test("the issuer's state from the mint's parsed extensions", () => {
  assert.deepEqual(issuerOf([{ extension: "pausableConfig", state: { paused: false } }, { extension: "defaultAccountState", state: { accountState: "initialized" } }]), { paused: false, frozenByDefault: false });
  assert.deepEqual(issuerOf([{ extension: "pausableConfig", state: { paused: true } }]), { paused: true, frozenByDefault: false });
  assert.deepEqual(issuerOf([{ extension: "defaultAccountState", state: { accountState: "frozen" } }]), { paused: false, frozenByDefault: true });
});

/* ---------------- what others see ---------------- */

test("the band: a buy stands under the route swap's band, income under Hide — all four seen, said honestly", () => {
  assert.equal(STOCK_BAND.buy, "routeSwap");
  assert.equal(STOCK_BAND.income, "hide");
  assert.equal(bandOf(STOCK_BAND.buy).allSeen, true);
  assert.equal(bandOf(STOCK_BAND.income).allSeen, true);
  assert.equal(bandOf(STOCK_BAND.buy, "open").mode, "private", "crossing the ring's edge has no open twin");
  assert.equal(amountSeenOnExit("buy"), true, "the sum is seen on the way out");
  assert.deepEqual(stockSeen("buy").steps.map((s) => s.step), ["out", "route", "lands"]);
  assert.deepEqual(stockSeen("income").steps.map((s) => s.step), ["claim", "in"]);
  for (const flow of ["buy", "income"]) {
    assert.deepEqual(stockSeen(flow).hidden, ["rest", "later"]);
    assert.equal(stockSeen(flow).checked, "local", "not checked on devnet until the stock pass runs");
  }
});

/* ---------------- buy: the way ---------------- */

test("a route that fits goes as one transaction: out of the ring and into the stock, together or not at all", () => {
  const path = chooseBuyPath(BUY());
  assert.equal(path.kind, "one");
  assert.equal(path.computeUnits, 450_000 + 300_000, "no deposit: the stock does not go back into the ring");
  assert.equal(path.addresses, 29);
  assert.equal(buyCompute(ROUTE(5, { computeUnits: null })), 450_000 + 400_000);
});

test("the pack: lookup tables, too many addresses or bytes, too much compute, or a bundle without the v1 compiler", () => {
  assert.deepEqual(chooseBuyPath(BUY({ route: ROUTE(20, { tables: true }) })), { kind: "pack", why: "TABLES" });
  assert.equal(chooseBuyPath(BUY({ route: ROUTE(V1_MAX_ADDRESSES - 9) })).kind, "one");
  assert.deepEqual(chooseBuyPath(BUY({ route: ROUTE(V1_MAX_ADDRESSES - 8) })), { kind: "pack", why: "ADDRESSES" });
  assert.deepEqual(chooseBuyPath(BUY({ route: ROUTE(10, { instructions: [{ accounts: 10, data: 3200 }] }) })), { kind: "pack", why: "BYTES" });
  assert.deepEqual(chooseBuyPath(BUY({ route: ROUTE(10, { computeUnits: 1_000_000 }) })), { kind: "pack", why: "COMPUTE" });
  assert.deepEqual(chooseBuyPath(BUY({ canOne: false })), { kind: "pack", why: "NO_ONE" });
  assert.deepEqual(chooseBuyPath(BUY({ canOne: false, canPack: false })), { kind: "refuse", code: "ONE_PROMPT", why: "NO_ONE" });
  assert.equal(misfitOf(EDGE(), ROUTE(5), COMPUTE_MAX + 1), "COMPUTE");
});

test("refusals before any way: the same coin, another network, a Token-2022 coin to pay, the issuer's stop, a stranger's signature", () => {
  assert.deepEqual(chooseBuyPath(BUY({ payMint: STOCK })), { kind: "refuse", code: "SAME" });
  assert.deepEqual(chooseBuyPath(BUY({ routeChain: "solana:mainnet" })), { kind: "refuse", code: "ELSEWHERE" });
  assert.deepEqual(chooseBuyPath(BUY({ payHolding: "token2022" })), { kind: "refuse", code: "PAY" });
  assert.deepEqual(chooseBuyPath(BUY({ issuer: { paused: true, frozenByDefault: false } })), { kind: "refuse", code: "ISSUER" });
  assert.deepEqual(chooseBuyPath(BUY({ issuer: { paused: false, frozenByDefault: true } })), { kind: "refuse", code: "ISSUER" });
  assert.deepEqual(chooseBuyPath(BUY({ route: ROUTE(10, { signers: ["me", "someone"] }) })), { kind: "refuse", code: "SIGNER" });
  assert.equal(buyWithdrawal("25000000"), 25_000_000n);
  assert.throws(() => buyWithdrawal("0"), RangeError);
});

/* ---------------- income: the split and the way ---------------- */

test("income: the SOL or USDC side goes back, the stock's side stays on the wallet", () => {
  assert.equal(backCoinOf(WSOL), "sol");
  assert.equal(backCoinOf(USDC), "usdc");
  assert.equal(backCoinOf(STOCK), null);
  const split = splitIncome({ x: { mint: STOCK, amount: 1_200n }, y: { mint: USDC, amount: 3_400_000n } });
  assert.deepEqual(split.back, { mint: USDC, coin: "usdc", amount: 3_400_000n });
  assert.deepEqual(split.stays, [{ mint: STOCK, amount: 1_200n }]);
  assert.equal(splitIncome({ x: { mint: STOCK, amount: 5n }, y: { mint: USDC, amount: 0n } }).back, null, "nothing to take");
  assert.equal(splitIncome({ x: { mint: STOCK, amount: 5n }, y: { mint: "SomeOtherCoin1111111111111111111111111111111", amount: 9n } }).back, null);
});

const CLAIM = (over = {}) => ({ route: ROUTE(12, { computeUnits: 200_000 }), count: 1, presigned: [], unwrapsSol: false, ...over });
const INCOME = (over = {}) => ({
  owner: "me",
  split: splitIncome({ x: { mint: STOCK, amount: 1n }, y: { mint: USDC, amount: 3_000_000n } }),
  claim: CLAIM(),
  claimChain: "solana:devnet",
  ringChain: "solana:devnet",
  edge: EDGE(),
  canOne: true,
  canPack: true,
  ...over,
});

test("income goes as one transaction when the claim fits; several claim transactions go as a pack", () => {
  const one = chooseIncomePath(INCOME());
  assert.equal(one.kind, "one");
  assert.equal(one.computeUnits, 200_000 + 200_000, "the claim and the deposit");
  assert.equal(incomeCompute(ROUTE(1, { computeUnits: null })), 400_000 + 200_000);
  assert.deepEqual(chooseIncomePath(INCOME({ claim: CLAIM({ count: 2 }) })), { kind: "pack", why: "SPLIT" });
  assert.deepEqual(chooseIncomePath(INCOME({ claim: CLAIM({ count: 2 }), canPack: false })), { kind: "refuse", code: "ONE_PROMPT", why: "SPLIT" });
});

test("income refusals: another network, no SOL or USDC side, SOL that would arrive wrapped, a stranger's signature", () => {
  assert.deepEqual(chooseIncomePath(INCOME({ claimChain: "solana:mainnet" })), { kind: "refuse", code: "ELSEWHERE" });
  assert.deepEqual(chooseIncomePath(INCOME({ split: { back: null, stays: [] } })), { kind: "refuse", code: "COIN" });
  const sol = splitIncome({ x: { mint: STOCK, amount: 1n }, y: { mint: WSOL, amount: 9_000_000n } });
  assert.deepEqual(chooseIncomePath(INCOME({ split: sol })), { kind: "refuse", code: "COIN" }, "wrapped SOL is not the ring's SOL");
  assert.equal(chooseIncomePath(INCOME({ split: sol, claim: CLAIM({ unwrapsSol: true }) })).kind, "one");
  assert.deepEqual(chooseIncomePath(INCOME({ claim: CLAIM({ presigned: ["fresh"] }) })), { kind: "refuse", code: "SIGNER" });
});

test("the claim's bytes: its shape, and whether it closes wrapped SOL into the person's wallet", async () => {
  const owner = (await generateKeyPairSigner()).address;
  const usdc = await claimTx({ owner });
  const sol = await claimTx({ owner, quote: WSOL, unwrap: true });
  assert.equal(claimUnwrapsSol([usdc.wire], owner), false);
  assert.equal(claimUnwrapsSol([sol.wire], owner), true);
  const shape = claimShapeOf({ transactions: [{ wireBase64: sol.wire, presigned: [] }], shown: { x: { mint: STOCK, amount: 0n }, y: { mint: WSOL, amount: 1n } }, chain: "solana:devnet" }, owner);
  assert.equal(shape.count, 1);
  assert.equal(shape.unwrapsSol, true);
  assert.equal(shape.route.computeUnits, 200_000);
  assert.deepEqual(shape.route.signers, [owner]);
});

test("the associated account is derived the chain's way", async () => {
  // Circle's USDC account of a known wallet, as explorers list it.
  const account = await associatedAccount("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", USDC, TOKEN);
  assert.match(account, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.notEqual(account, await associatedAccount("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", USDC, TOKEN22));
});

/* ---------------- recover ---------------- */

const BFACTS = { payMint: USDC, stockMint: STOCK, outAmount: 25_000_000n, minStock: 140_000n, paySol: false };
const BREAD = (over) => ({ kind: "pack", out: { status: "landed" }, route: { status: "landed" }, expired: false, walletPay: 0n, received: 141_000n, ...over });

test("buy, each break: nothing moved, the coin paid with on the wallet, or the stock bought", () => {
  assert.deepEqual(whereAfterBuy(BREAD({ out: { status: "missing" } }), BFACTS), { place: "landing" });
  assert.deepEqual(whereAfterBuy(BREAD({ out: { status: "missing" }, expired: true }), BFACTS), { place: "private" });
  assert.deepEqual(whereAfterBuy(BREAD({ route: { status: "missing" } }), BFACTS), { place: "landing" }, "a signed route is waited for, never sent again");
  const failed = whereAfterBuy(BREAD({ route: { status: "failed" }, walletPay: 30_000_000n }), BFACTS);
  assert.deepEqual(failed, { place: "wallet", mint: USDC, amount: 25_000_000n }, "capped at what left the ring");
  assert.deepEqual(nextAfter(failed), { does: "return", mint: USDC, amount: 25_000_000n });
  const sol = whereAfterBuy(BREAD({ route: { status: "missing" }, expired: true, walletPay: 300_000_000n }), { ...BFACTS, payMint: WSOL, outAmount: 500_000_000n, paySol: true });
  assert.deepEqual(sol, { place: "wallet", mint: WSOL, amount: 300_000_000n - SOL_FEE_KEEP }, "SOL keeps the fees on the wallet");
  const done = whereAfterBuy(BREAD(), BFACTS);
  assert.deepEqual(done, { place: "bought", received: 141_000n });
  assert.deepEqual(nextAfter(done), { does: "none" });
  const one = (status, expired = false) => ({ kind: "one", out: { status }, expired, walletPay: 0n, received: null });
  assert.deepEqual(whereAfterBuy(one("landed"), BFACTS), { place: "bought", received: null });
  assert.deepEqual(whereAfterBuy(one("failed"), BFACTS), { place: "private" });
  assert.deepEqual(whereAfterBuy(one("missing", true), BFACTS), { place: "private" });
});

const IFACTS = { mint: USDC, amount: 3_000_000n, isSol: false };

test("income, each break: still in the pool, on the wallet, or in the private balance", () => {
  const pack = (claims, deposit, over = {}) => ({ kind: "pack", claims: claims.map((status) => ({ status })), deposit: deposit ? { status: deposit } : undefined, expired: false, walletHeld: 3_100_000n, ...over });
  assert.deepEqual(whereAfterIncome(pack(["missing"], "missing"), IFACTS), { place: "landing" });
  assert.deepEqual(whereAfterIncome(pack(["failed"], "missing", { expired: true }), IFACTS), { place: "pool" });
  assert.deepEqual(whereAfterIncome(pack(["landed"], "missing"), IFACTS), { place: "landing" });
  assert.deepEqual(whereAfterIncome(pack(["landed"], "failed"), IFACTS), { place: "wallet", mint: USDC, amount: 3_000_000n });
  assert.deepEqual(whereAfterIncome(pack(["landed", "failed"], "missing", { expired: true }), IFACTS), { place: "wallet", mint: USDC, amount: 3_000_000n }, "half the claim landed");
  assert.deepEqual(whereAfterIncome(pack(["landed"], "landed"), IFACTS), { place: "private" });
  const one = (status, expired = false) => ({ kind: "one", claims: [{ status }], expired, walletHeld: 0n });
  assert.deepEqual(whereAfterIncome(one("landed"), IFACTS), { place: "private" });
  assert.deepEqual(whereAfterIncome(one("failed"), IFACTS), { place: "pool" });
  assert.deepEqual(whereAfterIncome(one("missing"), IFACTS), { place: "landing" });
});

test("a kept record reads back only when it reads as one", () => {
  const sig = "5".repeat(87);
  const buy = { v: 1, flow: "buy", kind: "pack", owner: USDC, signatures: [sig, sig], lastValidBlockHeight: "1000", facts: { payMint: USDC, stockMint: STOCK, outAmount: "5", minStock: "4", paySol: false } };
  assert.deepEqual(readStockRecord(JSON.stringify(buy)), buy);
  assert.equal(buyFactsOf(readStockRecord(JSON.stringify(buy))).outAmount, 5n);
  const income = { v: 1, flow: "income", kind: "pack", owner: USDC, signatures: [sig, sig, sig], lastValidBlockHeight: "9", facts: { mint: USDC, amount: "7", isSol: false } };
  assert.equal(incomeFactsOf(readStockRecord(JSON.stringify(income))).amount, 7n);
  const bad = [
    null,
    "{",
    JSON.stringify({ ...buy, v: 2 }),
    JSON.stringify({ ...buy, flow: "swap" }),
    JSON.stringify({ ...buy, signatures: [sig, sig, sig] }),
    JSON.stringify({ ...buy, facts: { ...buy.facts, paySol: "no" } }),
    JSON.stringify({ ...income, signatures: Array(INCOME_MOST + 1).fill(sig) }),
    JSON.stringify({ ...income, kind: "one" }),
  ];
  for (const text of bad) assert.equal(readStockRecord(text), null, text);
});

/* ---------------- run: the steps with fakes ---------------- */

const MARK = 0xee;
const LANDED = { err: null, confirmationStatus: "confirmed" };
const FAILED = { err: { InstructionError: [2, "x"] }, confirmationStatus: "confirmed" };
const kitDecoder = getTransactionDecoder();
const sigOfWire = (wire) => `sig-${Array.from(kitDecoder.decode(getBase64Encoder().encode(wire)).messageBytes.slice(0, 2)).join("-")}`;

/** A fake ring SDK and chain: ring transactions are `[MARK, n]`, the order and the claim their real v0 bytes. */
async function fakeWorld({ chain = "solana:devnet", stockExt = [{ extension: "pausableConfig", state: { paused: false } }, { extension: "defaultAccountState", state: { accountState: "initialized" } }], gate = { paused: false } } = {}) {
  const owner = (await generateKeyPairSigner()).address;
  const { wire } = await stockOrder({ owner });
  const order = { wireBase64: wire, lastValidBlockHeight: "900", inputMint: USDC, outputMint: STOCK, inAmountRaw: "25000000", minReceivedRaw: "140000", chain };
  const log = [];
  let ring = 0;
  const ringTx = (kind, params) => {
    ring += 1;
    log.push([kind, params]);
    return { messageBytes: new Uint8Array([MARK, ring]), lifetimeConstraint: { lastValidBlockHeight: 950n } };
  };
  const sent = [];
  const statuses = {};
  const sdk = {
    SOL_MINT: SYSTEM,
    buildWithdrawalTransaction: async (p) => ringTx("withdraw", p),
    buildDepositTransaction: async (p) => ringTx("deposit", p),
    getTransactionEncoder: () => ({ encode: (tx) => tx.messageBytes }),
    getTransactionDecoder: () => ({ decode: (bytes) => (bytes[0] === MARK ? { messageBytes: bytes } : kitDecoder.decode(bytes)) }),
    getSignatureFromTransaction: (tx) => `sig-${Array.from(tx.messageBytes.slice(0, 2)).join("-")}`,
  };
  const accountInfo = (mint, opts) => {
    if (mint === USDC) return { owner: TOKEN, data: opts?.encoding === "jsonParsed" ? { parsed: { info: {} } } : null };
    if (mint === STOCK) return { owner: TOKEN22, data: { parsed: { info: { extensions: stockExt } } } };
    return null;
  };
  const client = {
    solanaRpc: {
      getAccountInfo: (mint, opts) => ({ send: async () => ({ value: accountInfo(mint, opts) }) }),
      getTokenAccountsByOwner: () => ({ send: async () => ({ value: [{ pubkey: "acct", account: { data: { parsed: { info: { tokenAmount: { amount: "0" } } } } } }] }) }),
      sendTransaction: (b64) => ({ send: async () => void sent.push(b64) }),
      getSignatureStatuses: (sigs) => ({ send: async () => ({ value: sigs.map((x) => statuses[x] ?? null) }) }),
      getBlockHeight: () => ({ send: async () => 1200n }),
      getTransaction: () => ({ send: async () => null }),
    },
    getBalance: async () => 3_000_000_000n,
    confirmTransaction: async (sig) => (statuses[sig] === LANDED ? 1n : Promise.reject(new Error("not confirmed"))),
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
      landed: (move, amount) => log.push(["landed", move, amount]),
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
  return { ctx, book, wallet, order, log, sent, asked, signedWires, owner, statuses };
}

test("buy, the pack: one approval for two, out to one's own wallet, the stock lands there — nothing goes back into the ring", async () => {
  const world = await fakeWorld();
  Object.assign(world.statuses, { "sig-238-1": LANDED, [sigOfWire(world.order.wireBase64)]: LANDED });
  const remembered = [];
  const stages = [];
  const end = await buyStockPrivately({ ...world, ringChain: "solana:devnet", remember: (r) => remembered.push(r), on: (s) => stages.push(s) });
  assert.equal(end.path.kind, "pack");
  assert.deepEqual(world.signedWires, [2], "two transactions, one approval");
  assert.equal(world.sent.length, 2, "each sent once");
  assert.equal(remembered.length, 1, "the record is kept before anything is sent");
  assert.equal(remembered[0].flow, "buy");
  assert.deepEqual(stages, ["checking", "proving", "signing", "sending", "reading"]);
  assert.deepEqual(end.where, { place: "bought", received: null });
  assert.deepEqual(end.ring, { admitted: false, refused: ["pausableConfig", "defaultAccountState"] }, "read from the stock's own mint");
  const withdraw = world.log.find(([k]) => k === "withdraw")[1];
  assert.equal(withdraw.recipient, world.owner, "out to the person's own wallet, never another address");
  assert.equal(withdraw.amount, 25_000_000n, "the route's input, exactly");
  assert.equal(withdraw.asset, USDC);
  assert.equal(world.log.filter(([k]) => k === "deposit").length, 0, "no step back into the ring");
  assert.deepEqual(world.asked, [], "out to one's own wallet asks the list nothing");
});

test("buy: the route fails after out landed — the USDC is on the wallet, one action returns it", async () => {
  const world = await fakeWorld();
  Object.assign(world.statuses, { "sig-238-1": LANDED, [sigOfWire(world.order.wireBase64)]: FAILED });
  world.ctx.client.solanaRpc.getTokenAccountsByOwner = () => ({ send: async () => ({ value: [{ pubkey: "acct", account: { data: { parsed: { info: { tokenAmount: { amount: "25000000" } } } } } }] }) });
  const end = await buyStockPrivately({ ...world, ringChain: "solana:devnet" });
  assert.deepEqual(end.where, { place: "wallet", mint: USDC, amount: 25_000_000n });
});

test("buy refusals come before any proof: another network, a paused stock, a wallet that cannot sign two at once", async () => {
  const elsewhere = await fakeWorld({ chain: "solana:mainnet" });
  assert.deepEqual((await buyStockPrivately({ ...elsewhere, ringChain: "solana:devnet" })).path, { kind: "refuse", code: "ELSEWHERE" });
  assert.equal(elsewhere.log.length, 0);
  const paused = await fakeWorld({ stockExt: [{ extension: "pausableConfig", state: { paused: true } }] });
  assert.deepEqual((await buyStockPrivately({ ...paused, ringChain: "solana:devnet" })).path, { kind: "refuse", code: "ISSUER" });
  assert.equal(paused.log.filter(([k]) => k === "withdraw").length, 0, "no proof computed");
  const single = await fakeWorld();
  delete single.wallet.signWires;
  assert.deepEqual((await buyStockPrivately({ ...single, ringChain: "solana:devnet" })).path, { kind: "refuse", code: "ONE_PROMPT", why: "NO_ONE" });
  assert.equal(single.sent.length, 0);
});

test("buy: a wallet that refuses or changes the bytes — nothing is sent", async () => {
  const refused = await fakeWorld();
  refused.wallet.signWires = async () => {
    throw new Error("User rejected");
  };
  await assert.rejects(buyStockPrivately({ ...refused, ringChain: "solana:devnet" }), (e) => e.code === "WALLET_REFUSED");
  assert.equal(refused.sent.length, 0);
  const changed = await fakeWorld();
  changed.wallet.signWires = async (wires) => wires.map((w, i) => (i === 0 ? new Uint8Array([MARK, 99]) : w));
  await assert.rejects(buyStockPrivately({ ...changed, ringChain: "solana:devnet" }), (e) => e.code === "WALLET_CHANGED_MESSAGE");
  assert.equal(changed.sent.length, 0);
});

test("buy, one transaction: the withdrawal and the route under one signature, the compute of both", async () => {
  const world = await fakeWorld();
  const { sdk, client } = world.ctx;
  let compiled = null;
  sdk.decompileTransactionMessage = () => ({ instructions: [{ programAddress: "ring", accounts: [], data: new Uint8Array() }] });
  sdk.getCompiledTransactionMessageDecoder = () => ({ decode: () => ({ staticAccounts: Array.from({ length: 9 }, (_, i) => `edge-${i}`) }) });
  sdk.compileUnsignedTransaction = (opts) => {
    compiled = opts;
    return { messageBytes: new Uint8Array([MARK, 77]) };
  };
  client.solanaRpc.getLatestBlockhash = () => ({ send: async () => ({ value: { blockhash: "x", lastValidBlockHeight: 2000n } }) });
  client.solanaRpc.simulateTransaction = () => ({ send: async () => ({ value: { err: null } }) });
  world.statuses["sig-238-77"] = LANDED;
  delete world.wallet.signWires;
  const remembered = [];
  const end = await buyStockPrivately({ ...world, ringChain: "solana:devnet", remember: (r) => remembered.push(r) });
  assert.equal(end.path.kind, "one");
  assert.equal(compiled.computeUnitLimit, 450_000 + 300_000);
  assert.equal(compiled.instructions.length, 1 + 2, "withdrawal · the route's two (compute budget left out)");
  assert.equal(world.sent.length, 1);
  assert.equal(remembered[0].kind, "one");
  assert.equal(remembered[0].lastValidBlockHeight, "2000");
  assert.deepEqual(end.where, { place: "bought", received: null });
});

test("income, the pack: the claim as the engine built it and the deposit, one approval; the USDC lands in the private balance", async () => {
  const world = await fakeWorld();
  const claim = await claimTx({ owner: world.owner });
  Object.assign(world.statuses, { [sigOfWire(claim.wire)]: LANDED, "sig-238-1": LANDED });
  const remembered = [];
  const end = await incomeToPrivate({
    ...world,
    ringChain: "solana:devnet",
    claim: { transactions: [{ wireBase64: claim.wire, presigned: [] }], shown: { x: { mint: STOCK, amount: 1_100n }, y: { mint: USDC, amount: 3_000_000n } }, chain: "solana:devnet" },
    remember: (r) => remembered.push(r),
  });
  assert.equal(end.path.kind, "pack");
  assert.deepEqual(world.signedWires, [2]);
  assert.equal(world.sent.length, 2);
  assert.equal(remembered[0].flow, "income");
  assert.deepEqual(end.where, { place: "private" });
  const deposit = world.log.find(([k]) => k === "deposit")[1];
  assert.equal(deposit.amount, 3_000_000n, "the claimed USDC, named before the signature");
  assert.equal(deposit.asset, USDC);
  assert.equal(deposit.splTokenAccount, claim.ata, "the account the claim opens");
  assert.equal(deposit.recipient, "shielded");
  assert.deepEqual(world.asked, [[world.owner]], "into the ring: asked as a Hide");
});

test("income: paused deposits refuse it before anything is built; a mainnet claim is said to be coming", async () => {
  const world = await fakeWorld({ gate: { paused: true } });
  const claim = await claimTx({ owner: world.owner });
  const ask = { transactions: [{ wireBase64: claim.wire, presigned: [] }], shown: { x: { mint: STOCK, amount: 1n }, y: { mint: USDC, amount: 3n } }, chain: "solana:devnet" };
  await assert.rejects(incomeToPrivate({ ...world, ringChain: "solana:devnet", claim: ask }), (e) => e.code === "GATE_PAUSED");
  assert.equal(world.log.length, 0);
  const elsewhere = await fakeWorld();
  assert.deepEqual((await incomeToPrivate({ ...elsewhere, ringChain: "solana:devnet", claim: { ...ask, chain: "solana:mainnet" } })).path, { kind: "refuse", code: "ELSEWHERE" });
});

test("income: the claim lands, the deposit fails — the USDC is on the wallet, one action returns it", async () => {
  const world = await fakeWorld();
  const claim = await claimTx({ owner: world.owner });
  Object.assign(world.statuses, { [sigOfWire(claim.wire)]: LANDED, "sig-238-1": FAILED });
  world.ctx.client.solanaRpc.getTokenAccountsByOwner = () => ({ send: async () => ({ value: [{ pubkey: "acct", account: { data: { parsed: { info: { tokenAmount: { amount: "3000000" } } } } } }] }) });
  const end = await incomeToPrivate({ ...world, ringChain: "solana:devnet", claim: { transactions: [{ wireBase64: claim.wire, presigned: [] }], shown: { x: { mint: STOCK, amount: 1n }, y: { mint: USDC, amount: 3_000_000n } }, chain: "solana:devnet" } });
  assert.deepEqual(end.where, { place: "wallet", mint: USDC, amount: 3_000_000n });
  assert.deepEqual(nextAfter(end.where), { does: "return", mint: USDC, amount: 3_000_000n });
});
