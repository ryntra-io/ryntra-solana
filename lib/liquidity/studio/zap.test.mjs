import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { reviewZapAction, parseZapInput, submitLiquidityAction } from "./actions.ts";
import { DLMM_PROGRAM } from "./dlmm.ts";
import { checkSigned, issueTicket, messageDigest, readTicket } from "./ticket.ts";
import { createZapVenue, packZap, ZAP_SWAP_SLIPPAGE_BPS } from "./zap.ts";
import { againstReference, DLMM_INIT_BIN_ARRAY, DLMM_SWAP2, JUPITER_PROGRAM, ledgerOf, ownAccountOf, ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2, ZAP_IX, ZAP_PROGRAM, zapCallsOnly } from "./zap-check.ts";
import { fixedKeypair } from "./fixtures/scenarios.mjs";
import { jupiterBuild, jupiterDown, ROUTE_TABLE, SOL, tokenAccount, USDC, ZAP_DLMM_SDK, ZAP_POOL, ZAP_SDK, ZAP_TAPE, zapTapeConnection } from "./fixtures/zap-tape.mjs";

const KEY = "a-test-key-that-is-long-enough";
const open = { RYNTRA_LIQUIDITY_ACTIONS: "OPEN", BETA_TOKEN_SECRET: KEY };
const OWNER = Keypair.fromSeed(createHash("sha256").update("ryntra-zap-owner").digest());
const OWNER_ADDRESS = OWNER.publicKey.toBase58();
const STRANGER = Keypair.generate().publicKey;
const FEE_ACCOUNT = getAssociatedTokenAddressSync(NATIVE_MINT, Keypair.generate().publicKey, true).toBase58();
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const POSITION = Keypair.generate();
/** SOL at the tape's own pool price, in USDC base units per lamport: the stand-in route's rate. */
const POOL_PRICE = 104.1474453;
const OUT_PER_IN = (POOL_PRICE * 1e6) / 1e9;

const own = (mint) => new PublicKey(ownAccountOf(OWNER_ADDRESS, mint, TOKEN));
const WSOL = own(SOL);
const OWN_USDC = own(USDC);
const LEDGER = new PublicKey(ledgerOf(OWNER_ADDRESS));
const POOL = new PublicKey(ZAP_POOL);

const ctx = (patch = {}) => ({
  owner: OWNER_ADDRESS,
  pool: ZAP_POOL,
  mintX: SOL,
  mintY: USDC,
  programX: TOKEN,
  programY: TOKEN,
  action: "zap_in",
  position: POSITION.publicKey.toBase58(),
  fee: { bps: 10, account: FEE_ACCOUNT },
  swap: { maxIn: 50_000_000n, floor: 5_000_000n },
  ...patch,
});

const meta = (pubkey, isSigner = false, isWritable = true) => ({ pubkey: typeof pubkey === "string" ? new PublicKey(pubkey) : pubkey, isSigner, isWritable });
const filler = (n) => Array.from({ length: n }, () => meta(Keypair.generate().publicKey));

/** A `route_v2` (or `shared_accounts_route_v2`) of Jupiter in its on-chain layout. */
function route({ shared = false, authority = OWNER.publicKey, source = WSOL, destination = OWN_USDC, receiver = null, feeBps = 10, feeAccount = FEE_ACCOUNT, positive = 0, inAmount = 50_000_000n, quoted = 5_200_000n, slippage = 50, discriminator = null } = {}) {
  const at = shared ? { inAmount: 9, quoted: 17, slippage: 25, fee: 27, positive: 29, size: 35 } : { inAmount: 8, quoted: 16, slippage: 24, fee: 26, positive: 28, size: 34 };
  const data = Buffer.alloc(at.size);
  (discriminator ?? (shared ? SHARED_ACCOUNTS_ROUTE_V2 : ROUTE_V2)).copy(data, 0);
  data.writeBigUInt64LE(inAmount, at.inAmount);
  data.writeBigUInt64LE(quoted, at.quoted);
  data.writeUInt16LE(slippage, at.slippage);
  data.writeUInt16LE(feeBps, at.fee);
  data.writeUInt16LE(positive, at.positive);
  const keys = shared
    ? [meta(TOKEN, false, false), meta(authority, true, false), meta(source), ...filler(2), meta(destination), ...filler(6), meta(feeAccount), ...filler(4)]
    : [meta(authority, true, false), meta(source), meta(destination), ...filler(4), meta(receiver ?? JUPITER_PROGRAM, false, false), ...filler(2), meta(feeAccount), ...filler(4)];
  return new TransactionInstruction({ programId: new PublicKey(JUPITER_PROGRAM), keys, data });
}

const zapIx = (discriminator, keys, args = Buffer.alloc(0)) => new TransactionInstruction({ programId: new PublicKey(ZAP_PROGRAM), keys, data: Buffer.concat([discriminator, args]) });
const ledgerInit = (owner = OWNER.publicKey) => zapIx(ZAP_IX.initializeLedger, [meta(ledgerOf(owner.toBase58())), meta(owner, true, false), meta(owner, true), meta(SystemProgram.programId, false, false)]);
const ledgerClose = (receiver = OWNER.publicKey) => zapIx(ZAP_IX.closeLedger, [meta(LEDGER), meta(OWNER.publicKey, true, false), meta(receiver, true)]);
const ledgerSet = () => zapIx(ZAP_IX.setLedgerBalance, [meta(LEDGER), meta(OWNER.publicKey, true, false)], Buffer.alloc(9));
const ledgerAfterSwap = (account = OWN_USDC) => zapIx(ZAP_IX.updateLedgerAfterSwap, [meta(LEDGER), meta(account, false, false), meta(OWNER.publicKey, true, false)], Buffer.alloc(17));
function zapIn({ pool = POOL, x = WSOL, y = OWN_USDC, rentPayer = OWNER.publicKey, position = POSITION.publicKey } = {}) {
  return zapIx(ZAP_IX.zapInDlmmNew, [
    meta(LEDGER),
    meta(pool),
    meta(position, true),
    meta(ZAP_PROGRAM, false, false),
    meta(x),
    meta(y),
    ...filler(2),
    meta(SOL, false, false),
    meta(USDC, false, false),
    meta(DLMM_PROGRAM, false, false),
    meta(OWNER.publicKey, true, false),
    meta(rentPayer, true),
    ...filler(5),
  ]);
}

/** DLMM's `swap2` on a pool, in its order: pool, bitmap, reserves, the wallet's in and out, mints, oracle, host fee, user, … */
function swap2({ pool = POOL, source = WSOL, receiver = OWN_USDC, hostFee = DLMM_PROGRAM, user = OWNER.publicKey, inAmount = 50_000_000n, minOut = 5_100_000n } = {}) {
  const data = Buffer.alloc(8 + 8 + 8 + 4);
  DLMM_SWAP2.copy(data, 0);
  data.writeBigUInt64LE(inAmount, 8);
  data.writeBigUInt64LE(minOut, 16);
  return { keys: [meta(pool), ...filler(3), meta(source), meta(receiver), ...filler(3), meta(hostFee, false, false), meta(user, true, false), ...filler(5)], data };
}
const dlmmSwap = (args) => {
  const { keys, data } = swap2(args);
  return new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys, data });
};

/** Zap Out: `user_token_in_account`, the AMM, then the AMM's own accounts; params with the inner swap's bytes. */
function zapOut({ tokenIn = OWN_USDC, amm = DLMM_PROGRAM, inner = swap2({ source: OWN_USDC, receiver: WSOL, inAmount: 0n, minOut: 40_000_000n }), percentage = 100, maxSwap = 5_000_000n } = {}) {
  const params = Buffer.alloc(1 + 2 + 8 + 8 + 4);
  params.writeUInt8(percentage, 0);
  params.writeUInt16LE(8, 1);
  params.writeBigUInt64LE(0n, 3);
  params.writeBigUInt64LE(maxSwap, 11);
  params.writeUInt32LE(inner.data.length, 19);
  return zapIx(ZAP_IX.zapOut, [meta(tokenIn), meta(amm, false, false), ...inner.keys], Buffer.concat([params, inner.data]));
}

const plumbing = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
  createAssociatedTokenAccountIdempotentInstruction(OWNER.publicKey, WSOL, OWNER.publicKey, NATIVE_MINT),
  createAssociatedTokenAccountIdempotentInstruction(OWNER.publicKey, OWN_USDC, OWNER.publicKey, new PublicKey(USDC)),
  SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: WSOL, lamports: 100_000_000 }),
  createSyncNativeInstruction(WSOL),
];
const zapInSequence = (swap = route()) => [...plumbing(), swap, ledgerInit(), ledgerSet(), ledgerAfterSwap(), zapIn(), ledgerClose(), createCloseAccountInstruction(WSOL, OWNER.publicKey, OWNER.publicKey)];
const check = (instructions, patch) => zapCallsOnly(instructions, OWNER_ADDRESS, ctx(patch));
const refused = (result, pattern) => {
  assert.equal(result.ok, false, "refused");
  assert.match(result.reason, pattern);
};

/* ------------------------------------------------------------ the rules */

test("a Zap in: the wallet's plumbing, a Jupiter route_v2 with Ryntra's fee, the ledger and the deposit — all the wallet's own", () => {
  assert.deepEqual(check(zapInSequence()), { ok: true, zapCalls: 5, swaps: 1 });
  assert.deepEqual(check(zapInSequence(route({ shared: true }))), { ok: true, zapCalls: 5, swaps: 1 }, "shared_accounts_route_v2, fee in slot 12");
  assert.deepEqual(check(zapInSequence(route({ receiver: OWN_USDC }))), { ok: true, zapCalls: 5, swaps: 1 }, "route_v2's optional destination, when set, is the wallet's");
  assert.deepEqual(check(zapInSequence(dlmmSwap()), { fee: null }), { ok: true, zapCalls: 5, swaps: 1 }, "the pool's own swap carries no fee");
  refused(zapCallsOnly(zapInSequence(), STRANGER.toBase58(), ctx()), /paid by someone other/);
});

test("Jupiter: only route_v2 and shared_accounts_route_v2, the wallet's authority, its own accounts, the fee exactly as reviewed", () => {
  refused(check(zapInSequence(route({ discriminator: createHash("sha256").update("global:route").digest().subarray(0, 8) }))), /other than route_v2/);
  refused(check(zapInSequence(route({ authority: STRANGER }))), /not the wallet's own/);
  refused(check(zapInSequence(route({ source: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER, true) }))), /spends from an account/);
  refused(check(zapInSequence(route({ destination: getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true) }))), /output does not land/);
  refused(check(zapInSequence(route({ receiver: getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true) }))), /output does not land/, "the optional destination is a stranger's");
  refused(check(zapInSequence(route({ feeBps: 9 }))), /Ryntra's fee as reviewed/);
  refused(check(zapInSequence(route({ feeAccount: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER, true) }))), /Ryntra's fee as reviewed/, "the fee into a stranger's account");
  refused(check(zapInSequence(route({ positive: 50 }))), /positive slippage/);
  refused(check(zapInSequence(route({ feeBps: 10 })), { fee: null }), /fee nobody reviewed/);
  refused(check(zapInSequence(route({ inAmount: 50_000_001n }))), /spends more than the Review/);
  refused(check(zapInSequence(route({ quoted: 5_000_000n, slippage: 100 }))), /less than the Review's floor/);
});

test("DLMM: swap2 on the pier's own pool between the wallet's accounts, no host fee; bin arrays of the pier on the wallet's rent", () => {
  refused(check(zapInSequence(dlmmSwap({ hostFee: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER, true) })), { fee: null }), /host fee/);
  refused(check(zapInSequence(dlmmSwap({ pool: Keypair.generate().publicKey })), { fee: null }), /another pool/);
  refused(check(zapInSequence(dlmmSwap({ receiver: getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true) })), { fee: null }), /outside the wallet's own/);
  const binArray = (pool, funder) => new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: [meta(pool), meta(Keypair.generate().publicKey), meta(funder, true), meta(SystemProgram.programId, false, false)], data: Buffer.concat([DLMM_INIT_BIN_ARRAY, Buffer.alloc(8)]) });
  assert.equal(check([binArray(POOL, OWNER.publicKey), ...zapInSequence()]).ok, true);
  refused(check([binArray(Keypair.generate().publicKey, OWNER.publicKey), ...zapInSequence()]), /bin array of another pool/);
  refused(check([new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: [], data: Buffer.alloc(8, 1) }), ...zapInSequence()]), /DLMM swap other than swap2/);
});

test("the Zap program: the wallet's own ledger, its own accounts into the pier's pool and the fresh position — nothing else of it", () => {
  refused(check([...zapInSequence().slice(0, 6), ledgerInit(STRANGER)]), /ledger that is not the wallet's/);
  refused(check([...zapInSequence(), ledgerClose(STRANGER)]), /ledger closed to someone else/);
  refused(check([ledgerAfterSwap(getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true))]), /counted from an account that is not the wallet's/);
  refused(check([zapIn({ pool: Keypair.generate().publicKey })]), /another pool or position/);
  refused(check([zapIn({ position: Keypair.generate().publicKey })]), /another pool or position/);
  refused(check([zapIn({ y: getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true) })]), /accounts that are not the wallet's/);
  refused(check([zapIn({ rentPayer: STRANGER })]), /owned or paid by someone else/);
  const damm = zapIx(createHash("sha256").update("global:zap_in_damm_v2").digest().subarray(0, 8), [meta(LEDGER)]);
  refused(check([damm]), /Zap instruction the Review does not take/);
  refused(check([zapOut()]), /Zap Out inside the deposit/);
});

test("Zap Out: the program does not check who owns user_token_in_account — the Review does", () => {
  const rest = (patch = {}) => ctx({ action: "zap_rest", position: null, fee: null, swap: { maxIn: 5_000_000n, floor: 40_000_000n }, ...patch });
  assert.deepEqual(zapCallsOnly([ledgerClose(), createAssociatedTokenAccountIdempotentInstruction(OWNER.publicKey, WSOL, OWNER.publicKey, NATIVE_MINT), zapOut(), createCloseAccountInstruction(WSOL, OWNER.publicKey, OWNER.publicKey)], OWNER_ADDRESS, rest()), { ok: true, zapCalls: 2, swaps: 1 });
  const strangers = getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true);
  refused(zapCallsOnly([zapOut({ tokenIn: strangers })], OWNER_ADDRESS, rest()), /Zap Out from an account that is not the wallet's/, "a stranger's account counted");
  refused(zapCallsOnly([zapOut({ tokenIn: strangers, inner: swap2({ source: strangers, receiver: WSOL, inAmount: 0n, minOut: 40_000_000n }) })], OWNER_ADDRESS, rest()), /not the wallet's/, "a stranger's account counted and spent");
  refused(zapCallsOnly([zapOut({ tokenIn: WSOL })], OWNER_ADDRESS, rest()), /counts one account and spends another/, "counted on one of the wallet's accounts, spent from another");
  refused(zapCallsOnly([zapOut({ inner: swap2({ source: OWN_USDC, receiver: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER, true), inAmount: 0n, minOut: 40_000_000n }) })], OWNER_ADDRESS, rest()), /outside the wallet's own/, "the swap pays a stranger");
  refused(zapCallsOnly([zapOut({ inner: swap2({ source: OWN_USDC, receiver: WSOL, user: STRANGER, inAmount: 0n, minOut: 40_000_000n }) })], OWNER_ADDRESS, rest()), /not the wallet's own/);
  refused(zapCallsOnly([zapOut({ maxSwap: 5_000_001n })], OWNER_ADDRESS, rest()), /larger than the Review/);
  refused(zapCallsOnly([zapOut({ percentage: 101 })], OWNER_ADDRESS, rest()), /odd share/);
  refused(zapCallsOnly([zapOut({ amm: Keypair.generate().publicKey.toBase58() })], OWNER_ADDRESS, rest()), /through another program/);
  refused(zapCallsOnly([zapOut({ inner: swap2({ source: OWN_USDC, receiver: WSOL, inAmount: 0n, minOut: 39_999_999n }) })], OWNER_ADDRESS, rest()), /floor/);
  refused(zapCallsOnly([route()], OWNER_ADDRESS, rest()), /Jupiter swap outside the deposit/);
});

test("anything else is refused: a stranger's transfer, an unwrap to a stranger, an assertion nobody wrote, another program", () => {
  refused(check([SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: STRANGER, lamports: 1 })]), /instruction of 11111111111111111111111111111111/);
  refused(check([createCloseAccountInstruction(WSOL, STRANGER, OWNER.publicKey)]), /instruction of Tokenkeg/);
  refused(check([createAssociatedTokenAccountIdempotentInstruction(OWNER.publicKey, getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true), STRANGER, new PublicKey(USDC))]), /instruction of ATokenGP/);
  refused(check([new TransactionInstruction({ programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"), keys: [], data: Buffer.from([9]) })]), /assertion the Review did not write/);
  refused(check([new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })]), /instruction of/);
});

test("the reference price: the swap's floor within the fee, the slippage and 1 % of the venue's prices — never without both prices", () => {
  const leg = { inAmount: 50_000_000n, inDecimals: 9, inUsd: 104, floor: 5_150_000n, outDecimals: 6, outUsd: 1, feeBps: 10, slippageBps: ZAP_SWAP_SLIPPAGE_BPS };
  const fair = againstReference(leg);
  assert.equal(fair.ok, true);
  assert.equal(fair.referenceOut, 5_200_000n);
  assert.equal(fair.shortBps, 96);
  assert.deepEqual(againstReference({ ...leg, floor: 5_110_000n }).ok, false, "1.73 % short is more than 0.1 + 0.5 + 1 %");
  assert.equal(againstReference({ ...leg, floor: 5_110_000n }).code, "ZAP_PRICE");
  assert.equal(againstReference({ ...leg, inUsd: null }).code, "ZAP_UNPRICED");
  assert.equal(againstReference({ ...leg, outUsd: 0 }).code, "ZAP_UNPRICED");
});

/* ------------------------------------------------------------ v0 bytes */

const TABLE_KEYS = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
const TABLE = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { addresses: TABLE_KEYS, deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0 } });
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const v0 = (instructions, tables = [TABLE]) => new VersionedTransaction(new TransactionMessage({ payerKey: OWNER.publicKey, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message(tables));
const wired = (tx) => Buffer.from(tx.serialize()).toString("base64");
const reading = () => new TransactionInstruction({ programId: new PublicKey(ZAP_PROGRAM), keys: [meta(OWNER.publicKey, true, false), ...TABLE_KEYS.map((key) => meta(key))], data: Buffer.from([1, 2, 3]) });

test("the ticket seals version-0 bytes with their lookup tables: the same digest from the tables, and no table it did not seal", () => {
  const unsigned = v0([reading()]);
  assert.ok(unsigned.message.addressTableLookups.length === 1, "the accounts come through the table");
  const digest = messageDigest(wired(unsigned), [TABLE]);
  assert.ok(digest);
  assert.equal(messageDigest(wired(unsigned)), null, "without its table a version-0 message is not read");
  const sealed = issueTicket({ owner: OWNER_ADDRESS, venue: "meteora-dlmm", action: "zap_in", pool: ZAP_POOL, position: ZAP_POOL, messages: [digest], cosign: null, lookups: [TABLE.key.toBase58()] }, open);
  const ticket = readTicket(sealed, open).ticket;
  assert.deepEqual(ticket.lookups, [TABLE.key.toBase58()]);
  unsigned.sign([OWNER]);
  const good = checkSigned(ticket, [wired(unsigned)], [], [TABLE]);
  assert.equal(good.ok, true);

  const legacyOnly = readTicket(issueTicket({ ...ticket, lookups: undefined }, open), open).ticket;
  assert.equal(checkSigned(legacyOnly, [wired(unsigned)], [], [TABLE]).code, "SIGNED_MISMATCH", "a ticket with no tables takes legacy bytes only");

  const other = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: TABLE.state });
  const elsewhere = v0([reading()], [other]);
  elsewhere.sign([OWNER]);
  assert.equal(checkSigned(ticket, [wired(elsewhere)], [], [TABLE, other]).code, "SIGNED_MISMATCH", "a table the Review did not seal");

  const changed = v0([new TransactionInstruction({ ...reading(), data: Buffer.from([1, 2, 4]) })]);
  changed.sign([OWNER]);
  assert.equal(checkSigned(ticket, [wired(changed)], [], [TABLE]).code, "SIGNED_MISMATCH", "other bytes than reviewed");
  const unsignedAgain = v0([reading()]);
  assert.equal(checkSigned(ticket, [wired(unsignedAgain)], [], [TABLE]).code, "NOT_SIGNED");
});

test("packing: the instructions in their order, each transaction under Solana's packet, never more than three", () => {
  const big = (keys = 20) => new TransactionInstruction({ programId: new PublicKey(ZAP_PROGRAM), keys: filler(keys), data: Buffer.alloc(40) });
  const instructions = [big(12), big(12), big(12), big(12)];
  const groups = packZap(instructions, OWNER.publicKey, BLOCKHASH, []);
  assert.ok(groups.length >= 2 && groups.length <= 3);
  assert.deepEqual(groups.flat(), instructions, "order kept");
  assert.throws(() => packZap([big(), big(), big(), big(), big(), big(), big(), big()], OWNER.publicKey, BLOCKHASH, []), (error) => error.code === "ZAP_NO_ROUTE");
});

test("the browser's body: a Zap in or the rest, field by field", () => {
  const body = { action: "zap_in", venue: "meteora-dlmm", request: { pool: ZAP_POOL, owner: OWNER_ADDRESS, amountIn: "100000000", half: 16, slippageBps: 100 } };
  assert.deepEqual(parseZapInput(body).request, body.request);
  assert.equal(parseZapInput({ ...body, request: { ...body.request, half: 35 } }), null, "at most 69 bins");
  assert.equal(parseZapInput({ ...body, request: { ...body.request, amountIn: "1.5" } }), null);
  assert.equal(parseZapInput({ ...body, venue: "meteora-damm2" }), null);
  assert.deepEqual(parseZapInput({ action: "zap_rest", venue: "meteora-dlmm", request: { pool: ZAP_POOL, owner: OWNER_ADDRESS, otherBefore: "0" } }).request.otherBefore, "0");
});

/* --------------------------------------------- the SDK on recorded state */

const chainAt = (blocksLeft) => () => ({
  epochInfo: async () => ({ blockHeight: 1_000n - BigInt(blocksLeft), absoluteSlot: 9_000_000n }),
  performanceSamples: async () => [{ numSlots: 300n, samplePeriodSecs: 60 }],
});

function zapDeps({ connection = zapTapeConnection(), fee = { bps: 10, account: FEE_ACCOUNT, mint: SOL }, prices = { x: POOL_PRICE, y: 1 }, env = open } = {}) {
  const venue = createZapVenue({ connection, sdk: ZAP_SDK, dlmm: ZAP_DLMM_SDK, jupiter: { apiUrl: "https://api.jup.ag", apiKey: "test" }, newKeypair: () => fixedKeypair("ryntra-zap-position"), now: () => ZAP_TAPE.scenario.now });
  return {
    env,
    connections: [connection],
    venuesFor: () => ({}),
    pricesOf: async () => ({ ...prices, xMint: SOL, yMint: USDC }),
    forget: () => undefined,
    zapVenueFor: () => venue,
    zapFeeFor: async () => fee,
    takeFreshKey: (publicKey) => (publicKey === fixedKeypair("ryntra-zap-position").publicKey.toBase58() ? fixedKeypair("ryntra-zap-position") : null),
    chainReader: chainAt(100),
    now: () => 50_000,
    pollMs: 1,
    relayMs: 2_000,
  };
}

const zapBody = (amountIn = "100000000") => ({ action: "zap_in", venue: "meteora-dlmm", request: { pool: ZAP_POOL, owner: OWNER_ADDRESS, amountIn, half: 16, slippageBps: 100 } });

async function withFetch(fetchImpl, run) {
  const kept = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = kept;
  }
}

test("on recorded mainnet state: Jupiter's leg carries Ryntra's 0.1 % into the fee account, in version-0 bytes the Review seals with their table", async () => {
  const jupiter = jupiterBuild({ outPerIn: OUT_PER_IN });
  const reviewed = await withFetch(jupiter.fetchImpl, () => reviewZapAction(zapBody(), zapDeps()));
  assert.equal(reviewed.ok, true, reviewed.reason);
  const { preview } = reviewed.value;
  assert.ok(jupiter.asked.length > 0);
  assert.ok(jupiter.asked.every((query) => query.platformFeeBps === "10" && query.feeAccount === FEE_ACCOUNT), "every quote asked with Ryntra's fee");
  assert.equal(preview.swap.route, "jupiter");
  assert.equal(preview.swap.fee.bps, 10);
  assert.equal(preview.swap.fee.amount, ((BigInt(preview.swap.inAmount) * 10n) / 10_000n).toString(), "the fee is exact: a tenth of a per cent of the swap's input");
  assert.deepEqual(preview.fees, [{ who: "ryntra", applies_to: "swap", bps: 10 }]);
  assert.ok(BigInt(preview.swap.inAmount) > 0n && BigInt(preview.swap.inAmount) < 100_000_000n, "part of the SOL is swapped, the rest goes in as SOL");
  assert.equal(BigInt(preview.deposit.x.units) + BigInt(preview.swap.inAmount), 100_000_000n, "nothing of the SOL is lost between the swap and the deposit");
  assert.ok(reviewed.value.referenceOut && BigInt(preview.swap.floor) <= BigInt(reviewed.value.referenceOut));
  assert.ok(preview.transactions >= 2 && preview.transactions <= 3);
  for (const tx of reviewed.value.transactions) assert.ok(Buffer.from(tx.wireBase64, "base64").length <= 1232);
  const ticket = readTicket(reviewed.value.ticket, open, 50_000).ticket;
  assert.equal(ticket.action, "zap_in");
  assert.deepEqual(ticket.lookups, [ROUTE_TABLE.key.toBase58()], "the route's lookup table is sealed in the ticket");
  assert.ok(ticket.cosign, "the fresh position key is held for the relay, not signed in the wallet's bytes");

  /* The wallet signs every transaction in one approval; the relay adds the position's key and sends each once. */
  const signed = reviewed.value.transactions.map((tx) => {
    const exact = VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64"));
    exact.sign([OWNER]);
    return Buffer.from(exact.serialize()).toString("base64");
  });
  const sent = [];
  const relayConnection = {
    async sendRawTransaction(bytes) {
      sent.push(Buffer.from(bytes));
      return "sig";
    },
    async getSignatureStatuses() {
      return { value: [{ confirmationStatus: "confirmed", err: null }] };
    },
  };
  const relayDeps = { ...zapDeps(), connections: [relayConnection], lookupTables: async () => [ROUTE_TABLE] };
  const relayed = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed }, relayDeps);
  assert.equal(relayed.ok, true, relayed.reason);
  assert.equal(relayed.value.settled, true);
  assert.equal(sent.length, reviewed.value.transactions.length);
  const withPosition = sent.map((bytes) => VersionedTransaction.deserialize(bytes)).find((tx) => tx.message.header.numRequiredSignatures === 2);
  assert.ok(withPosition, "the deposit's transaction carries the position key's signature");
  assert.ok(withPosition.signatures.every((signature) => signature.some((byte) => byte !== 0)));

  const noTables = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed }, { ...relayDeps, lookupTables: async () => null });
  assert.equal(noTables.code, "UNAVAILABLE", "without the sealed tables nothing is sent");
});

test("on recorded mainnet state: a route that pays someone else never reaches the wallet", async () => {
  const strangers = getAssociatedTokenAddressSync(new PublicKey(USDC), STRANGER, true);
  for (const tamper of [{ receiver: strangers }, { feeAccount: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER, true).toBase58() }, { positiveSlippageBps: 100 }]) {
    const jupiter = jupiterBuild({ outPerIn: OUT_PER_IN, tamper });
    const reviewed = await withFetch(jupiter.fetchImpl, () => reviewZapAction(zapBody(), zapDeps()));
    assert.equal(reviewed.ok, false, JSON.stringify(tamper));
    assert.equal(reviewed.code, "BUILD_REFUSED");
  }
});

test("on recorded mainnet state: a swap far under the venue's prices is refused before anything is sealed", async () => {
  /* Jupiter quotes 5 % under, and the venue says SOL is worth 10 % more than the pool's price: both legs are off. */
  const jupiter = jupiterBuild({ outPerIn: OUT_PER_IN * 0.95 });
  const reviewed = await withFetch(jupiter.fetchImpl, () => reviewZapAction(zapBody(), zapDeps({ prices: { x: POOL_PRICE * 1.1, y: 1 } })));
  assert.deepEqual([reviewed.ok, reviewed.code], [false, "ZAP_PRICE"]);
  const poorRoute = await withFetch(jupiter.fetchImpl, () => reviewZapAction(zapBody(), zapDeps()));
  assert.equal(poorRoute.value.preview.swap.route, "pool", "a poor Jupiter quote loses to the pool's own swap");
  const unpriced = await withFetch(jupiterBuild({ outPerIn: OUT_PER_IN }).fetchImpl, () => reviewZapAction(zapBody(), zapDeps({ prices: { x: null, y: 1 } })));
  assert.equal(unpriced.code, "ZAP_UNPRICED");
});

test("on recorded mainnet state: when the pool's own swap is the better one, the Zap carries no Ryntra fee", async () => {
  const reviewed = await withFetch(jupiterDown, () => reviewZapAction(zapBody(), zapDeps()));
  assert.equal(reviewed.ok, true, reviewed.reason);
  assert.equal(reviewed.value.preview.swap.route, "pool");
  assert.equal(reviewed.value.preview.swap.fee, null);
  assert.deepEqual(reviewed.value.preview.fees, []);
  assert.equal(readTicket(reviewed.value.ticket, open, 50_000).ticket.lookups, undefined, "no table: nothing is looked up");
});

test("the gate and the canary hold a Zap as they hold a pool add", async () => {
  const closed = await withFetch(jupiterDown, () => reviewZapAction(zapBody(), zapDeps({ env: { BETA_TOKEN_SECRET: KEY } })));
  assert.equal(closed.code, "ACTIONS_CLOSED");
  const canary = { RYNTRA_LIQUIDITY_ACTIONS: "CANARY", RYNTRA_LIQUIDITY_CANARY_WALLET: OWNER_ADDRESS, BETA_TOKEN_SECRET: KEY };
  const over = await withFetch(jupiterDown, () => reviewZapAction(zapBody("100000000"), zapDeps({ env: canary })));
  assert.equal(over.code, "CANARY_LIMIT", "0.1 SOL at $104 is over the canary's $5");
  const under = await withFetch(jupiterDown, () => reviewZapAction(zapBody("40000000"), zapDeps({ env: canary })));
  assert.equal(under.ok, true, under.reason);
  assert.ok(Math.abs(under.value.depositUsd - 0.04 * POOL_PRICE) < 1e-6);
});

test("«Take the rest»: the ledger back to the wallet, only what the Zap brought swapped to SOL in the pool, the wrapped SOL unwrapped", async () => {
  const before = 1_000_000n;
  const brought = 5_000_000n;
  const extra = {
    [OWN_USDC.toBase58()]: tokenAccount(USDC, OWNER_ADDRESS, before + brought),
    [WSOL.toBase58()]: tokenAccount(SOL, OWNER_ADDRESS, 49_000_000n, { native: true, lamports: 51_039_280 }),
    [LEDGER.toBase58()]: { data: [Buffer.alloc(56).toString("base64"), "base64"], executable: false, lamports: 1_280_000, owner: ZAP_PROGRAM, rentEpoch: 0, space: 56 },
  };
  const deps = zapDeps({ connection: zapTapeConnection(extra) });
  const reviewed = await reviewZapAction({ action: "zap_rest", venue: "meteora-dlmm", request: { pool: ZAP_POOL, owner: OWNER_ADDRESS, otherBefore: before.toString() } }, deps);
  assert.equal(reviewed.ok, true, reviewed.reason);
  const { preview } = reviewed.value;
  assert.equal(preview.swap.route, "pool");
  assert.equal(preview.swap.inAmount, brought.toString(), "only what the Zap brought, never what the wallet held before");
  assert.equal(preview.swap.fee, null);
  assert.equal(preview.unwrapLamports, "51039280");
  assert.deepEqual(preview.rent, [{ what: "ledger", direction: "return", lamports: "1280000", refundable: true }]);
  const tx = VersionedTransaction.deserialize(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  const programs = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
  assert.ok(programs.includes(ZAP_PROGRAM));
  assert.equal(readTicket(reviewed.value.ticket, open, 50_000).ticket.action, "zap_rest");

  const nothing = await reviewZapAction({ action: "zap_rest", venue: "meteora-dlmm", request: { pool: ZAP_POOL, owner: OWNER_ADDRESS, otherBefore: "0" } }, zapDeps());
  assert.equal(nothing.code, "NOTHING_TO_WITHDRAW");
});
