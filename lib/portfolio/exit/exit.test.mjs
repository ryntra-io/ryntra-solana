/**
 * «Вийти з усього» and «Зібрати все», proven without a network and without a wallet's money:
 *
 * - the plan on recorded shapes of the portfolio's read;
 * - the swaps into the target, by arithmetic;
 * - every rule of the bytes on transactions built here — who pays, who signs, where money may go;
 * - the ticket and the wallet's signed bytes;
 * - the Review and the relay on ports and a chain that stand in for the engine and the network.
 */

import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { test } from "node:test";

import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, StakeProgram, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { networkFeeOf } from "../../liquidity/studio/actions.ts";
import { decodeWire } from "../../liquidity/studio/ticket.ts";
import { JUPITER_PROGRAM, ROUTE_V2, ZAP_IX, ZAP_PROGRAM } from "../../liquidity/studio/zap-check.ts";
import { NATIVE_SOL_MINT, NO_REFS, USDC_MINT, exitBlocked, exitWhole, refs } from "../model.ts";
import { lendWithdrawOnly, ownPlumbing, ruleHolds, stakeCallsOnly, venueCallsOnly, zapOutCounts } from "./checks.ts";
import { exitEstimate, exitPlan } from "./model.ts";
import { PORTFOLIO_EXIT_ENV, exitOpen, exitOverview, reviewExit, submitExit, unitPrices } from "./service.ts";
import { stakeWire } from "./stake.ts";
import { sweepsOf } from "./sweeps.ts";
import { MAX_EXIT_STEPS, checkExitSigned, issueExitTicket, lookupsOf, readExitTicket, stepDigest } from "./ticket.ts";

const key = (seed) => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const wallet = key(7);
const OWNER = wallet.publicKey.toBase58();
const STRANGER = key(8).publicKey;
const VENUE = key(9).publicKey;
const BLOCKHASH = key(11).publicKey.toBase58();
const COIN = key(12).publicKey.toBase58();
const LST = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const POOL = key(13).publicKey.toBase58();
const STAKE_ACCOUNT = key(14).publicKey.toBase58();
const ENV = { [PORTFOLIO_EXIT_ENV]: "open", BETA_TOKEN_SECRET: "s".repeat(32) };

/* ── bytes built here ─────────────────────────────────────────────────── */

const venueIx = (tag, extra = []) => new TransactionInstruction({ programId: VENUE, keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }, ...extra], data: Buffer.from([tag & 0xff, (tag >> 8) & 0xff]) });
const v0 = (instructions, payer = wallet.publicKey) => Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message()).serialize()).toString("base64");
const legacy = (instructions, payer = wallet.publicKey) => {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: BLOCKHASH });
  tx.add(...instructions);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
};
const sign = (wire, ...signers) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  tx.sign(signers.length ? signers : [wallet]);
  return Buffer.from(tx.serialize()).toString("base64");
};
const decoded = (wire) => decodeWire(wire, []);
const VENUE_RULE = { kind: "venue", programs: [VENUE.toBase58()] };
let tag = 0;
const venueTx = () => ({ wire: v0([venueIx((tag += 1))]), requestId: null, rule: VENUE_RULE });

/* ── the portfolio's read, as recorded shapes ─────────────────────────── */

const position = (over) => ({
  id: "x:1",
  protocol: "meteora-dlmm",
  platform: null,
  kind: "pool",
  state: "read",
  origin: "chain",
  label: "SOL–COIN",
  value: { usd: 100, sol: 0.5 },
  earned: null,
  tokens: [],
  inRange: true,
  exit: exitWhole("pool-withdraw"),
  refs: NO_REFS,
  readAt: "2026-11-17T08:00:00.000Z",
  ...over,
});
const coin = (mint, role, amountRaw, usd, decimals = 6) => ({ mint, symbol: null, decimals, amountRaw, usd, role });

const POOL_POSITION = position({
  id: "meteora-dlmm:pos1",
  value: { usd: 1_000, sol: 5 },
  earned: { usd: 12, sol: 0.06 },
  tokens: [coin(NATIVE_SOL_MINT, "held", "2500000000", 500, 9), coin(COIN, "held", "500000000", 488), coin(COIN, "fee", "12000000", 12)],
  refs: refs({ program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", pool: POOL, position: key(21).publicKey.toBase58() }),
});
const LOCKED = position({ id: "meteora-damm-v2:pos2", protocol: "meteora-damm-v2", value: { usd: 400, sol: 2 }, exit: exitBlocked("pool-withdraw", "LOCKED", { partBps: 2_500 }), refs: refs({ position: key(22).publicKey.toBase58() }) });
const LOCKED_WHOLE = position({ id: "meteora-damm-v2:pos3", protocol: "meteora-damm-v2", exit: exitBlocked("pool-withdraw", "LOCKED", { partBps: 0 }) });
const LEND = position({ id: `jupiter-lend:${USDC_MINT}`, protocol: "jupiter-lend", kind: "deposit", origin: "provider", label: "USDC", value: { usd: 300, sol: 1.5 }, exit: exitWhole("lend-withdraw"), refs: refs({ market: USDC_MINT }) });
const KAMINO = position({ id: "kamino:obl", protocol: "kamino", kind: "deposit", origin: "provider", exit: exitBlocked("lend-withdraw", "NO_ROUTE") });
const BORROW = position({ id: "kamino:obl:borrow", protocol: "kamino", kind: "borrow", origin: "provider", value: { usd: -50, sol: -0.25 }, exit: exitBlocked("repay", "REPAY") });
const STAKE_FREE = position({ id: `native-stake:${STAKE_ACCOUNT}`, protocol: "native-stake", kind: "stake", label: "SOL", value: { usd: 200, sol: 1 }, tokens: [coin(NATIVE_SOL_MINT, "held", "1000000000", 200, 9)], exit: exitWhole("stake-withdraw"), refs: refs({ position: STAKE_ACCOUNT }) });
const STAKE_ACTIVE = position({ id: "native-stake:active", protocol: "native-stake", kind: "stake", label: "SOL", value: { usd: 600, sol: 3 }, exit: exitBlocked("stake-deactivate", "STAKE_ACTIVE", { untilEpoch: 901 }), refs: refs({ position: key(23).publicKey.toBase58() }) });
const STAKE_COOLING = position({ id: "native-stake:cooling", protocol: "native-stake", kind: "stake", exit: exitBlocked("stake-withdraw", "STAKE_COOLING", { untilEpoch: 900 }) });
const WALLET_SOL = position({ id: "wallet:sol", protocol: "wallet", kind: "coin", label: "SOL", tokens: [coin(NATIVE_SOL_MINT, "held", "3000000000", 600, 9)], exit: exitWhole("swap") });
const WALLET_USDC = position({ id: `wallet:${USDC_MINT}`, protocol: "wallet", kind: "coin", label: "USDC", value: { usd: 50, sol: 0.25 }, tokens: [coin(USDC_MINT, "held", "50000000", 50)], exit: exitWhole("swap") });
const WALLET_LST = position({ id: `wallet:${LST}`, protocol: "wallet", kind: "lst", label: "JitoSOL", value: { usd: 230, sol: 1.15 }, tokens: [coin(LST, "held", "1000000000", 230, 9)], exit: exitWhole("swap") });
const WALLET_COIN = position({ id: `wallet:${COIN}`, protocol: "wallet", kind: "coin", label: "COIN", value: { usd: 40, sol: 0.2 }, tokens: [coin(COIN, "held", "40000000", 40)], exit: exitWhole("swap") });
const PROJECTED = position({ id: "other:proj", protocol: "other", kind: "other", origin: "projection", exit: exitBlocked("none", "PROJECTION") });
const UNREAD = position({ id: "kamino:unread:kamino", protocol: "kamino", kind: "deposit", state: "unread", value: { usd: null, sol: null }, exit: exitBlocked("none", "NOT_READ") });

const ALL = [POOL_POSITION, LOCKED, LOCKED_WHOLE, LEND, KAMINO, BORROW, STAKE_FREE, STAKE_ACTIVE, STAKE_COOLING, WALLET_SOL, WALLET_USDC, WALLET_LST, WALLET_COIN, PROJECTED, UNREAD];
const answerOf = (positions) => ({ owner: OWNER, at: "2026-11-17T08:00:00.000Z", solUsd: 200, totals: { usd: 0, sol: 0, earnedUsd: 0, projectedUsd: 0, complete: true }, positions, sources: [{ source: "wallet", state: "read", reason: null, readAt: null, positions: positions.length }] });

/* ── the plan ─────────────────────────────────────────────────────────── */

test("an exit leaves what one step takes out, and names the rest with the portfolio's reason", () => {
  const plan = exitPlan(answerOf(ALL), "exit", "SOL");
  const byId = new Map(plan.items.map((item) => [item.id, item]));
  assert.deepEqual(byId.get(POOL_POSITION.id), { id: POOL_POSITION.id, protocol: "meteora-dlmm", kind: "pool", label: "SOL–COIN", action: "leave", picked: true, partBps: 10_000, usd: 1_000, untilEpoch: null });
  /* A lock lets a quarter out: the quarter is taken, and counted as a quarter. */
  assert.equal(byId.get(LOCKED.id).partBps, 2_500);
  assert.equal(byId.get(LOCKED.id).usd, 100);
  assert.equal(byId.get(LEND.id).action, "leave");
  assert.equal(byId.get(STAKE_FREE.id).action, "leave");
  /* An active stake is deactivated, and says from which epoch it is free. */
  assert.deepEqual([byId.get(STAKE_ACTIVE.id).action, byId.get(STAKE_ACTIVE.id).untilEpoch, byId.get(STAKE_ACTIVE.id).picked], ["deactivate", 901, true]);
  /* Liquid staking leaves; a plain coin only when the person names it; SOL and wrapped SOL never. */
  assert.equal(byId.get(WALLET_LST.id).picked, true);
  assert.equal(byId.get(WALLET_COIN.id).picked, false);
  assert.equal(byId.has("wallet:sol"), false);
  /* With SOL the target, USDC is a coin like any other: not swapped unless named. */
  assert.equal(byId.get(WALLET_USDC.id).picked, false);

  const reasons = Object.fromEntries(plan.held.map((row) => [row.id, row.reason]));
  assert.deepEqual(reasons, { [LOCKED_WHOLE.id]: "LOCKED", [KAMINO.id]: "NO_ROUTE", [BORROW.id]: "REPAY", [STAKE_COOLING.id]: "STAKE_COOLING", [PROJECTED.id]: "PROJECTION", [UNREAD.id]: "NOT_READ" });
  assert.equal(plan.held.find((row) => row.id === STAKE_COOLING.id).untilEpoch, 900);
});

test("the person's choice is a list: what is on it is in, what is not is out; the target's own coin is never swapped", () => {
  const plan = exitPlan(answerOf(ALL), "exit", "USDC", { only: [WALLET_COIN.id, WALLET_USDC.id, LEND.id, STAKE_ACTIVE.id] });
  const picked = plan.items.filter((item) => item.picked).map((item) => item.id);
  /* A named coin goes in; a position left off the list stays, though one step would take it; USDC, the target, is not a step at all. */
  assert.deepEqual(picked.sort(), [LEND.id, STAKE_ACTIVE.id, WALLET_COIN.id].sort());
  assert.equal(plan.items.find((item) => item.id === POOL_POSITION.id).picked, false);
  assert.equal(plan.items.some((item) => item.id === WALLET_USDC.id), false);
  /* An empty list takes nothing; a position no step takes out cannot be named in. */
  assert.equal(exitPlan(answerOf(ALL), "exit", "SOL", { only: [] }).items.some((item) => item.picked), false);
  const named = exitPlan(answerOf(ALL), "exit", "SOL", { only: [KAMINO.id] });
  assert.equal(named.items.some((item) => item.id === KAMINO.id), false);
  assert.equal(named.held.some((row) => row.id === KAMINO.id), true);
});

test("collecting takes only pools with fees to take, and nothing else", () => {
  const dry = position({ id: "meteora-dlmm:dry", tokens: [coin(COIN, "held", "5", 1)] });
  const rewardsOnly = position({ id: "meteora-dlmm:farm", tokens: [coin(COIN, "reward", "5", 1)] });
  const proRewards = position({ id: "meteora-dlmm-pro:nft", protocol: "meteora-dlmm-pro", tokens: [coin(COIN, "reward", "5000000", 5)] });
  const plan = exitPlan(answerOf([...ALL, dry, rewardsOnly, proRewards]), "collect", "SOL");
  assert.deepEqual(plan.items.map((item) => [item.id, item.action, item.usd]), [[POOL_POSITION.id, "collect", 12], [proRewards.id, "collect", 5]]);
  assert.deepEqual(plan.held, []);
});

test("«≈»: the picked steps in the target's coins; a stake only deactivated is not counted; no price, no figure", () => {
  const items = exitPlan(answerOf([POOL_POSITION, STAKE_ACTIVE, WALLET_LST]), "exit", "SOL").items;
  assert.deepEqual(exitEstimate(items, "SOL", 200), { usd: 1_230, lamports: "6150000000", usdcRaw: "0" });
  assert.deepEqual(exitEstimate(items, "USDC", 200), { usd: 1_230, lamports: "0", usdcRaw: "1230000000" });
  assert.deepEqual(exitEstimate(items, "SPLIT", 200), { usd: 1_230, lamports: "3075000000", usdcRaw: "615000000" });
  assert.deepEqual(exitEstimate(items, "SOL", null), { usd: 1_230, lamports: null, usdcRaw: "0" });
  const unpriced = exitPlan(answerOf([position({ id: "meteora-dlmm:np", value: { usd: null, sol: null } })]), "exit", "SOL").items;
  assert.deepEqual(exitEstimate(unpriced, "SOL", 200), { usd: null, lamports: null, usdcRaw: null });
});

/* ── the swaps into the target ────────────────────────────────────────── */

const bring = (mint, expected, min, decimals = 6) => ({ mint, decimals, expectedRaw: BigInt(expected), minRaw: BigInt(min) });

test("into SOL: every other coin that arrives is swept whole — quoted a little under what is expected, capped a little over, whatever least was named", () => {
  const specs = sweepsOf([[bring(NATIVE_SOL_MINT, 2_500_000_000, 2_475_000_000, 9), bring(COIN, 512_000_000, 507_000_000)], [bring(USDC_MINT, 300_000_000, 299_700_000)], [bring(COIN, 88_000_000, 88_000_000)]], "SOL", 200);
  assert.deepEqual(
    specs.map((spec) => [spec.inMint, spec.outMint, spec.percent, spec.quoteRaw, spec.capRaw, spec.wrapLamports, spec.feeders, spec.after]),
    [
      [COIN, NATIVE_SOL_MINT, 100, 594_000_000n, 612_000_000n, null, [0, 2], null],
      [USDC_MINT, NATIVE_SOL_MINT, 100, 297_000_000n, 306_000_000n, null, [1], null],
    ],
  );
  /* A least far under what is expected does not thin the floor: the route is still quoted for nearly all the swap may take. */
  const [thin] = sweepsOf([[bring(COIN, 1_000_000_000, 50_000_000)]], "SOL", 200);
  assert.deepEqual([thin.quoteRaw, thin.capRaw], [990_000_000n, 1_020_000_000n]);
  /* Dust that quotes to nothing is not swept. */
  assert.deepEqual(sweepsOf([[bring(COIN, 1, 1)]], "SOL", 200), []);
});

test("into USDC: SOL that arrives is a fixed swap of the least that arrives, standing on every position that brings it", () => {
  const specs = sweepsOf([[bring(NATIVE_SOL_MINT, 2_500_000_000, 2_475_000_000, 9), bring(COIN, 500_000_000, 495_000_000)], [bring(NATIVE_SOL_MINT, 1_000_000_000, 1_000_000_000, 9)]], "USDC", 200);
  const sol = specs.find((spec) => spec.inMint === NATIVE_SOL_MINT);
  assert.deepEqual([sol.outMint, sol.wrapLamports, sol.quoteRaw, sol.capRaw, sol.feeders], [USDC_MINT, 3_475_000_000n, 3_475_000_000n, 3_475_000_000n, [0, 1]]);
  assert.deepEqual(specs.filter((spec) => spec.inMint === COIN).map((spec) => [spec.outMint, spec.percent, spec.wrapLamports]), [[USDC_MINT, 100, null]]);
});

test("half and half: another coin goes in two legs, the second standing on the first; SOL and USDC are evened by half their difference", () => {
  const specs = sweepsOf([[bring(NATIVE_SOL_MINT, 4_000_000_000, 4_000_000_000, 9), bring(USDC_MINT, 200_000_000, 200_000_000), bring(COIN, 100_000_001, 99_000_001)]], "SPLIT", 200);
  const legs = specs.filter((spec) => spec.inMint === COIN);
  assert.deepEqual(legs.map((spec) => [spec.outMint, spec.percent, spec.quoteRaw, spec.expectedRaw]), [[NATIVE_SOL_MINT, 50, 49_500_000n, 50_000_000n], [USDC_MINT, 100, 49_500_000n, 50_000_001n]]);
  assert.equal(legs[1].after, specs.indexOf(legs[0]));
  /* $800 of SOL and $200 of USDC: $300 of SOL — 1.5 SOL — goes to USDC. */
  const even = specs.find((spec) => spec.inMint === NATIVE_SOL_MINT);
  assert.deepEqual([even.outMint, even.wrapLamports], [USDC_MINT, 1_500_000_000n]);
  /* The other way: USDC heavier — a share of what arrives goes to SOL. */
  const other = sweepsOf([[bring(NATIVE_SOL_MINT, 1_000_000_000, 1_000_000_000, 9), bring(USDC_MINT, 600_000_000, 600_000_000)]], "SPLIT", 200);
  assert.deepEqual(other.map((spec) => [spec.inMint, spec.outMint, spec.percent, spec.wrapLamports]), [[USDC_MINT, NATIVE_SOL_MINT, 33, null]]);
  /* A fixed swap takes of the least SOL that arrives — nothing, where no least is held. */
  assert.deepEqual(sweepsOf([[bring(NATIVE_SOL_MINT, 4_000_000_000, 0, 9)]], "USDC", 200), []);
  /* Near enough even, or no SOL price: they stay as they came. */
  assert.deepEqual(sweepsOf([[bring(NATIVE_SOL_MINT, 1_000_000_000, 1_000_000_000, 9), bring(USDC_MINT, 199_000_000, 199_000_000)]], "SPLIT", 200), []);
  assert.deepEqual(sweepsOf([[bring(NATIVE_SOL_MINT, 4_000_000_000, 4_000_000_000, 9), bring(USDC_MINT, 1, 1)]], "SPLIT", null), []);
});

/* ── the rules of the bytes ───────────────────────────────────────────── */

const ownAta = (mint) => getAssociatedTokenAddressSync(new PublicKey(mint), wallet.publicKey, true);

test("a venue's bytes: its own program and the wallet's plumbing — and nothing that can pay anyone else", () => {
  const wsol = ownAta(NATIVE_SOL_MINT);
  const good = v0([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ownAta(COIN), wallet.publicKey, new PublicKey(COIN)),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsol, lamports: 5 }),
    venueIx(1),
    createCloseAccountInstruction(wsol, wallet.publicKey, wallet.publicKey),
  ]);
  assert.deepEqual(ruleHolds(VENUE_RULE, good, [], OWNER), { ok: true });

  const refused = (instructions, payer) => ruleHolds(VENUE_RULE, v0(instructions, payer), [], OWNER);
  /* Lamports to a stranger. */
  assert.equal(refused([venueIx(2), SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 5 })]).ok, false);
  /* A coin transferred out of the wallet's account. */
  assert.equal(refused([venueIx(3), createTransferInstruction(ownAta(COIN), getAssociatedTokenAddressSync(new PublicKey(COIN), STRANGER), wallet.publicKey, 1)]).ok, false);
  /* An account closed to a stranger: its rent would leave. */
  assert.equal(refused([venueIx(4), createCloseAccountInstruction(wsol, STRANGER, wallet.publicKey)]).ok, false);
  /* A token account opened for a stranger on the wallet's rent. */
  assert.equal(refused([venueIx(5), createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, getAssociatedTokenAddressSync(new PublicKey(COIN), STRANGER), STRANGER, new PublicKey(COIN))]).ok, false);
  /* Another program beside the venue. */
  assert.equal(refused([venueIx(6), new TransactionInstruction({ programId: key(40).publicKey, keys: [], data: Buffer.alloc(1) })]).ok, false);
  /* Paid by someone else; or a second signer waited for. */
  assert.match(refused([venueIx(7)], STRANGER).reason, /paid by someone other/);
  assert.match(refused([venueIx(8, [{ pubkey: STRANGER, isSigner: true, isWritable: false }])]).reason, /signer other than the wallet/);
  /* Plumbing alone is not the action. */
  assert.match(venueCallsOnly(decoded(v0([ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })])), OWNER, VENUE_RULE.programs).reason, /does not call the venue/);
  /* A priority fee past what a relay accepts. */
  assert.equal(refused([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), venueIx(9)]).ok, false);
  assert.equal(ownPlumbing(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 1 }), OWNER), false);
});

test("the pools engine's bytes are held to the engine's own rule", () => {
  const rule = { kind: "studio", program: VENUE.toBase58() };
  assert.deepEqual(ruleHolds(rule, legacy([venueIx(10)]), [], OWNER), { ok: true });
  assert.equal(ruleHolds(rule, legacy([venueIx(11), SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 9 })]), [], OWNER).ok, false);
});

test("a stake step is one instruction: the named account withdrawn to the wallet, or deactivated, by the wallet", () => {
  const withdraw = stakeWire({ op: "withdraw", owner: OWNER, account: STAKE_ACCOUNT, lamports: 1_000_000_000n, blockhash: BLOCKHASH });
  const deactivate = stakeWire({ op: "deactivate", owner: OWNER, account: STAKE_ACCOUNT, lamports: 0n, blockhash: BLOCKHASH });
  assert.deepEqual(ruleHolds({ kind: "stake", account: STAKE_ACCOUNT, op: "withdraw" }, withdraw, [], OWNER), { ok: true });
  assert.deepEqual(ruleHolds({ kind: "stake", account: STAKE_ACCOUNT, op: "deactivate" }, deactivate, [], OWNER), { ok: true });
  /* The withdraw pays the wallet, the whole of what was read, from the wallet's own fee. */
  const tx = decoded(withdraw);
  const call = tx.instructions.find((instruction) => instruction.programId.equals(StakeProgram.programId));
  assert.equal(call.keys[1].pubkey.toBase58(), OWNER);
  assert.equal(Buffer.from(call.data).readBigUInt64LE(4), 1_000_000_000n);
  assert.equal(tx.feePayer.toBase58(), OWNER);

  const stakePubkey = new PublicKey(STAKE_ACCOUNT);
  const to = (instructions) => decoded(v0(instructions));
  /* To a stranger. */
  assert.equal(stakeCallsOnly(to(StakeProgram.withdraw({ stakePubkey, authorizedPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 5 }).instructions), OWNER, STAKE_ACCOUNT, "withdraw").ok, false);
  /* Another account than the one reviewed. */
  assert.equal(stakeCallsOnly(to(StakeProgram.withdraw({ stakePubkey: STRANGER, authorizedPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 5 }).instructions), OWNER, STAKE_ACCOUNT, "withdraw").ok, false);
  /* A withdraw where a deactivation was reviewed, and the other way. */
  assert.equal(ruleHolds({ kind: "stake", account: STAKE_ACCOUNT, op: "deactivate" }, withdraw, [], OWNER).ok, false);
  assert.equal(ruleHolds({ kind: "stake", account: STAKE_ACCOUNT, op: "withdraw" }, deactivate, [], OWNER).ok, false);
  /* Anything riding beside it. */
  assert.equal(stakeCallsOnly(to([...StakeProgram.deactivate({ stakePubkey, authorizedPubkey: wallet.publicKey }).instructions, SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 1 })]), OWNER, STAKE_ACCOUNT, "deactivate").ok, false);
  /* A change of who may withdraw is not a stake step. */
  assert.equal(stakeCallsOnly(to(StakeProgram.authorize({ stakePubkey, authorizedPubkey: wallet.publicKey, newAuthorizedPubkey: STRANGER, stakeAuthorizationType: { index: 1 } }).instructions), OWNER, STAKE_ACCOUNT, "withdraw").ok, false);
});

test("a lending withdrawal: the market's one withdraw, the wallet's, from its own share into its own account of the asset", () => {
  const SHARE = key(30).publicKey.toBase58();
  const rule = { kind: "lend", programs: [VENUE.toBase58()], assetMint: USDC_MINT, shareMint: SHARE };
  const meta = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
  const anchor = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  const lendIx = (first, second, { signer = wallet.publicKey, name = "withdraw", programId = VENUE } = {}) =>
    new TransactionInstruction({ programId, keys: [meta(signer, signer.equals(wallet.publicKey)), meta(first), meta(second), meta(key(31).publicKey)], data: Buffer.concat([anchor(name), Buffer.alloc(8, 1)]) });
  const withdraw = (first, second, signer) => lendIx(first, second, signer ? { signer } : {});
  assert.deepEqual(ruleHolds(rule, legacy([withdraw(ownAta(SHARE), ownAta(USDC_MINT))]), [], OWNER), { ok: true });
  assert.deepEqual(ruleHolds(rule, v0([createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ownAta(USDC_MINT), wallet.publicKey, new PublicKey(USDC_MINT)), withdraw(ownAta(SHARE), ownAta(USDC_MINT))]), [], OWNER), { ok: true });
  /* A deposit is not an exit: its own instruction, or its order of accounts under the withdrawal's name, is refused. */
  assert.match(ruleHolds(rule, legacy([lendIx(ownAta(USDC_MINT), ownAta(SHARE), { name: "deposit" })]), [], OWNER).reason, /not a withdrawal/);
  assert.equal(ruleHolds(rule, legacy([withdraw(ownAta(USDC_MINT), ownAta(SHARE))]), [], OWNER).ok, false);
  /* The withdrawal is the first program's — Earn's — not another of the market's programs. */
  const OTHER = key(32).publicKey;
  assert.equal(ruleHolds({ ...rule, programs: [VENUE.toBase58(), OTHER.toBase58()] }, legacy([lendIx(ownAta(SHARE), ownAta(USDC_MINT), { programId: OTHER })]), [], OWNER).ok, false);
  /* The asset paid to a stranger's account; the share taken from one. */
  const theirs = (mint) => getAssociatedTokenAddressSync(new PublicKey(mint), STRANGER);
  assert.match(ruleHolds(rule, legacy([withdraw(ownAta(SHARE), theirs(USDC_MINT))]), [], OWNER).reason, /not the wallet's own/);
  assert.equal(ruleHolds(rule, legacy([withdraw(theirs(SHARE), ownAta(USDC_MINT))]), [], OWNER).ok, false);
  /* The wallet's own account of another coin is not the asset's. */
  assert.equal(ruleHolds(rule, legacy([withdraw(ownAta(SHARE), ownAta(COIN))]), [], OWNER).ok, false);
  /* Two instructions of the market; one not signed by the wallet. */
  assert.equal(ruleHolds(rule, legacy([withdraw(ownAta(SHARE), ownAta(USDC_MINT)), withdraw(ownAta(SHARE), ownAta(USDC_MINT))]), [], OWNER).ok, false);
  assert.equal(lendWithdrawOnly(decoded(v0([withdraw(ownAta(SHARE), ownAta(USDC_MINT), STRANGER)])), OWNER, rule).ok, false);
  /* The venue's rule still holds beside it. */
  assert.equal(ruleHolds(rule, legacy([withdraw(ownAta(SHARE), ownAta(USDC_MINT)), SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 1 })]), [], OWNER).ok, false);
});

/** A Zap Out over a Jupiter `route_v2`, as the SDK lays it out: the account counted, the router, then the route's own accounts. */
function zapOutIx({ tokenIn, destination, platformFeeBps = 0, feeAccount = null, maxSwap = 600n, quotedOut = 1_000n, slippageBps = 100, positive = 0, percentage = 100, pre = 0n, offset = 8 }) {
  const jupiter = new PublicKey(JUPITER_PROGRAM);
  const route = Buffer.alloc(30);
  Buffer.from(ROUTE_V2).copy(route, 0);
  route.writeBigUInt64LE(500n, 8);
  route.writeBigUInt64LE(quotedOut, 16);
  route.writeUInt16LE(slippageBps, 24);
  route.writeUInt16LE(platformFeeBps, 26);
  route.writeUInt16LE(positive, 28);
  const meta = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: !isSigner });
  /* authority, source, destination, 3–6, optional receiver (the router's id when absent), 8–9, the fee account. */
  const inner = [meta(wallet.publicKey, true), meta(tokenIn), meta(destination), meta(jupiter), meta(jupiter), meta(jupiter), meta(jupiter), meta(jupiter), meta(jupiter), meta(jupiter), meta(feeAccount ?? jupiter)];
  const data = Buffer.alloc(8 + 1 + 2 + 8 + 8 + 4 + route.length);
  Buffer.from(ZAP_IX.zapOut).copy(data, 0);
  data.writeUInt8(percentage, 8);
  data.writeUInt16LE(offset, 9);
  data.writeBigUInt64LE(pre, 11);
  data.writeBigUInt64LE(maxSwap, 19);
  data.writeUInt32LE(route.length, 27);
  route.copy(data, 31);
  return new TransactionInstruction({ programId: new PublicKey(ZAP_PROGRAM), keys: [meta(tokenIn), meta(jupiter), ...inner], data });
}

test("a sweep: the wallet's own accounts on both sides, the floor, the cap, Ryntra's fee exactly as reviewed — and it counts from the balance this server read", () => {
  const TOKEN = TOKEN_PROGRAM_ID.toBase58();
  const FEE_ACCOUNT = key(50).publicKey;
  const context = (over = {}) => ({ owner: OWNER, pool: "", mintX: COIN, mintY: NATIVE_SOL_MINT, programX: TOKEN, programY: TOKEN, action: "zap_rest", position: null, fee: null, swap: { maxIn: 600n, floor: 990n }, ...over });
  const rule = (over, pre = 0n, percent = 100) => ({ kind: "zap", context: context(over), pre, percent });
  const wsol = ownAta(NATIVE_SOL_MINT);
  const sweepTx = (zap) => v0([createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, wsol, wallet.publicKey, NATIVE_MINT), zap, createCloseAccountInstruction(wsol, wallet.publicKey, wallet.publicKey)]);
  const good = zapOutIx({ tokenIn: ownAta(COIN), destination: wsol });
  assert.deepEqual(ruleHolds(rule(), sweepTx(good), [], OWNER), { ok: true });
  /* The output on a stranger's account. */
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: getAssociatedTokenAddressSync(NATIVE_MINT, STRANGER) })), [], OWNER).ok, false);
  /* Counted from an account that is not the wallet's. */
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: getAssociatedTokenAddressSync(new PublicKey(COIN), STRANGER), destination: wsol })), [], OWNER).ok, false);
  /* More than the cap reviewed; less than the floor reviewed; a share of positive slippage. */
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, maxSwap: 601n })), [], OWNER).ok, false);
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, quotedOut: 900n })), [], OWNER).ok, false);
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, positive: 10 })), [], OWNER).ok, false);
  /* A fee nobody reviewed; the reviewed fee into another account; and the reviewed fee, exactly. */
  assert.equal(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, platformFeeBps: 25, feeAccount: FEE_ACCOUNT })), [], OWNER).ok, false);
  assert.equal(ruleHolds(rule({ fee: { bps: 25, account: FEE_ACCOUNT.toBase58() } }), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, platformFeeBps: 25, feeAccount: STRANGER })), [], OWNER).ok, false);
  assert.deepEqual(ruleHolds(rule({ fee: { bps: 25, account: FEE_ACCOUNT.toBase58() } }), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, platformFeeBps: 25, feeAccount: FEE_ACCOUNT })), [], OWNER), { ok: true });
  /* The balance it counts from is the one read: a sweep written to count from less would take coins the wallet held before. */
  const held = zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, pre: 10_000n });
  assert.deepEqual(ruleHolds(rule({}, 10_000n), sweepTx(held), [], OWNER), { ok: true });
  assert.match(ruleHolds(rule({}, 10_000n), sweepTx(good), [], OWNER).reason, /balance other than the one read/);
  assert.equal(ruleHolds(rule(), sweepTx(held), [], OWNER).ok, false);
  assert.deepEqual([zapOutCounts(decoded(sweepTx(held)).instructions).pre, zapOutCounts(decoded(sweepTx(held)).instructions).offset], [10_000n, 8]);
  /* The share it takes is the one reviewed: a half reviewed is not a whole built. */
  const halfOf = zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, percentage: 50 });
  assert.deepEqual(ruleHolds(rule({}, 0n, 50), sweepTx(halfOf), [], OWNER), { ok: true });
  assert.match(ruleHolds(rule({}, 0n, 50), sweepTx(good), [], OWNER).reason, /another share/);
  /* The amount is written where the route keeps its own, and nowhere else in its data. */
  assert.match(ruleHolds(rule(), sweepTx(zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, offset: 16 })), [], OWNER).reason, /outside the route's own/);
  /* Two swaps where one was reviewed; a swap riding outside the Zap; no swap at all. */
  assert.equal(ruleHolds(rule(), v0([good, zapOutIx({ tokenIn: ownAta(COIN), destination: wsol, percentage: 50 })]), [], OWNER).ok, false);
  assert.equal(ruleHolds(rule(), v0([createCloseAccountInstruction(wsol, wallet.publicKey, wallet.publicKey)]), [], OWNER).ok, false);
  /* A fixed swap of SOL: the wallet's lamports wrapped into its own account, and only there. */
  const solRule = rule({ mintX: NATIVE_SOL_MINT, mintY: USDC_MINT });
  const wrapped = (to) => v0([createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, wsol, wallet.publicKey, NATIVE_MINT), SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: to, lamports: 500 }), zapOutIx({ tokenIn: wsol, destination: ownAta(USDC_MINT) })]);
  assert.deepEqual(ruleHolds(solRule, wrapped(wsol), [], OWNER), { ok: true });
  assert.equal(ruleHolds(solRule, wrapped(STRANGER), [], OWNER).ok, false);
});

/* ── the ticket ───────────────────────────────────────────────────────── */

const stepOf = (wire, over = {}) => ({ kind: "leave", ref: "meteora-dlmm:pos1", digest: stepDigest(wire, []), lookups: [], requestId: null, all: [], any: [], needLamports: null, ...over });

test("the ticket seals the package: read back whole, refused when touched, when old, or when a step waits for a later one", () => {
  const wires = [v0([venueIx(60)]), v0([venueIx(61)])];
  const steps = [stepOf(wires[0]), stepOf(wires[1], { kind: "sweep", ref: COIN, any: [0] })];
  const sealed = issueExitTicket({ owner: OWNER, mode: "exit", steps }, ENV, 1_000);
  const read = readExitTicket(sealed, ENV, 2_000);
  assert.equal(read.ok, true);
  assert.deepEqual(read.ticket.steps, steps);
  assert.equal(read.ticket.owner, OWNER);
  assert.deepEqual(readExitTicket(`${sealed.slice(0, -2)}xx`, ENV, 2_000), { ok: false, code: "TICKET_INVALID" });
  assert.deepEqual(readExitTicket(sealed, { ...ENV, BETA_TOKEN_SECRET: "t".repeat(32) }, 2_000), { ok: false, code: "TICKET_INVALID" });
  assert.deepEqual(readExitTicket(sealed, ENV, 1_000 + 10 * 60_000), { ok: false, code: "TICKET_EXPIRED" });
  /* A step that stands on itself or on a later one is not a ticket this server would seal. */
  const forward = issueExitTicket({ owner: OWNER, mode: "exit", steps: [stepOf(wires[0], { all: [1] }), stepOf(wires[1])] }, ENV, 1_000);
  assert.deepEqual(readExitTicket(forward, ENV, 2_000), { ok: false, code: "TICKET_INVALID" });
  /* What the wallet must hold belongs to a sweep alone, and is a count of lamports. */
  const sealedWith = (over) => readExitTicket(issueExitTicket({ owner: OWNER, mode: "exit", steps: [stepOf(wires[0], over)] }, ENV, 1_000), ENV, 2_000);
  assert.equal(sealedWith({ kind: "sweep", ref: NATIVE_SOL_MINT, needLamports: "5000000000" }).ok, true);
  assert.deepEqual(sealedWith({ needLamports: "5000000000" }), { ok: false, code: "TICKET_INVALID" });
  assert.deepEqual(sealedWith({ kind: "sweep", ref: NATIVE_SOL_MINT, needLamports: "-1" }), { ok: false, code: "TICKET_INVALID" });
  /* No key, no seal; more than one approval carries, no seal. */
  assert.equal(issueExitTicket({ owner: OWNER, mode: "exit", steps }, {}, 1_000), null);
  assert.equal(issueExitTicket({ owner: OWNER, mode: "exit", steps: Array.from({ length: MAX_EXIT_STEPS + 1 }, () => steps[0]) }, ENV, 1_000), null);
});

test("the relay takes only the bytes the ticket sealed, signed by the ticket's wallet", () => {
  const wires = [v0([venueIx(62)]), v0([venueIx(63)])];
  const ticket = readExitTicket(issueExitTicket({ owner: OWNER, mode: "exit", steps: wires.map((wire) => stepOf(wire)) }, ENV, 1_000), ENV, 1_500).ticket;
  const signed = wires.map((wire) => sign(wire));
  const ok = checkExitSigned(ticket, signed, new Map());
  assert.equal(ok.ok, true);
  assert.equal(ok.signatures.length, 2);
  /* Out of order; another transaction; unsigned; signed by someone else. */
  assert.deepEqual(checkExitSigned(ticket, [signed[1], signed[0]], new Map()), { ok: false, code: "SIGNED_MISMATCH", index: 0 });
  assert.equal(checkExitSigned(ticket, [signed[0], sign(v0([venueIx(64)]))], new Map()).code, "SIGNED_MISMATCH");
  assert.deepEqual(checkExitSigned(ticket, [signed[0], wires[1]], new Map()), { ok: false, code: "NOT_SIGNED", index: 1 });
  assert.equal(checkExitSigned(ticket, [signed[0]], new Map()).ok, false);
});

/* ── the Review ───────────────────────────────────────────────────────── */

const noBuild = { ok: false, reason: "NO_ROUTE" };
function portsOf(over = {}) {
  const calls = [];
  const unit = (brings, txs = 1) => ({ ok: true, txs: Array.from({ length: txs }, venueTx), chained: true, brings, rentLamports: 0n, feeBps: null });
  const ports = {
    pool: async (request) => (calls.push(["pool", request]), { ...unit([bring(NATIVE_SOL_MINT, 2_500_000_000, 2_475_000_000, 9), bring(COIN, 512_000_000, 507_000_000)], 2), rentLamports: 57_000_000n }),
    pro: async (request) => (calls.push(["pro", request]), noBuild),
    lend: async (request) => (calls.push(["lend", request]), unit([bring(USDC_MINT, 300_000_000, 299_700_000)])),
    stake: async (request) => (calls.push(["stake", request]), { ok: true, txs: [{ wire: stakeWire({ op: request.op, owner: request.owner, account: request.account, lamports: 1_000_000_000n, blockhash: BLOCKHASH }), requestId: null, rule: { kind: "stake", account: request.account, op: request.op } }], chained: true, brings: request.op === "withdraw" ? [bring(NATIVE_SOL_MINT, 1_000_000_000, 1_000_000_000, 9)] : [], rentLamports: 0n, feeBps: null }),
    swap: async (request) => (calls.push(["swap", request]), { ...unit([bring(request.outMint, request.outMint === USDC_MINT ? 229_000_000 : 1_140_000_000, 1, request.outMint === USDC_MINT ? 6 : 9)]), txs: [{ wire: v0([venueIx((tag += 1))]), requestId: "order-1", rule: { kind: "swap" } }], feeBps: 10 }),
    sweep: async (request) => (calls.push(["sweep", request]), { ...unit([bring(request.spec.outMint, request.spec.outMint === USDC_MINT ? 400_000_000 : 2_990_000_000, 1, request.spec.outMint === USDC_MINT ? 6 : 9)]), feeBps: 25 }),
    ...over,
  };
  return { ports, calls };
}
function chainOf(over = {}) {
  const simulated = [];
  return { simulated, chain: { simulate: async (wire) => (simulated.push(wire), true), tables: async () => new Map(), send: async () => undefined, status: async () => ({ err: null, confirmed: true }), signableMs: async () => 20_000, lamports: async () => HELD_LAMPORTS, ...over } };
}
const depsOf = ({ positions = ALL, ports = portsOf().ports, chain = chainOf().chain, env = ENV, ...rest } = {}) => ({ env, ports, chain, portfolio: async () => answerOf(positions), execute: async () => ({ sent: true, reason: null }), now: () => 1_000, relayMs: 400, pollMs: 1, ...rest });
const ASK = { owner: OWNER, mode: "exit", target: "SOL" };
const HELD_LAMPORTS = 5_000_000_000n;

test("closed unless the deployment opens it: no flag or no sealing key, nothing is built", async () => {
  assert.equal(exitOpen({}), false);
  assert.equal(exitOpen({ [PORTFOLIO_EXIT_ENV]: "open" }), false);
  assert.equal(exitOpen({ [PORTFOLIO_EXIT_ENV]: "yes", BETA_TOKEN_SECRET: "s".repeat(32) }), false);
  assert.equal(exitOpen(ENV), true);
  const { ports, calls } = portsOf();
  const closed = await reviewExit(ASK, depsOf({ ports, env: {} }));
  assert.deepEqual([closed.ok, closed.code], [false, "CLOSED"]);
  assert.equal(calls.length, 0);
  /* The overview is read either way, and says the door is closed. */
  const overview = await exitOverview(ASK, depsOf({ env: {} }));
  assert.equal(overview.canExit, false);
  assert.equal(overview.items.length > 0, true);
  assert.equal((await exitOverview(ASK, depsOf())).canExit, true);
  /* Collecting swaps nothing: its «≈» is the fees' worth, not a figure in the target's coins. */
  assert.deepEqual((await exitOverview({ owner: OWNER, mode: "collect", target: "SOL" }, depsOf())).estimate, { usd: 12, lamports: null, usdcRaw: null });
});

test("one approval into SOL: the positions left, the stake's steps, the staking token swapped, what arrived swept — in order, each paid by the wallet", async () => {
  const { ports, calls } = portsOf();
  const { chain, simulated } = chainOf();
  const reviewed = await reviewExit(ASK, depsOf({ ports, chain }));
  assert.equal(reviewed.ok, true);
  const { value } = reviewed;
  /* pool (2), locked pool (2), the deposit, the stake withdrawn, the stake deactivated, the staking token's swap; then the sweeps of COIN and USDC. */
  assert.deepEqual(value.kinds, ["leave", "leave", "leave", "leave", "leave", "stake", "stake", "swap", "sweep", "sweep"]);
  assert.deepEqual(value.refs.slice(-2), [COIN, USDC_MINT]);
  assert.equal(value.transactions.length, 10);
  assert.equal(value.summary.transactions, 10);
  assert.equal(value.signableMs, 20_000);
  /* Every transaction of the package is the wallet's to pay and sign. */
  for (const wire of value.transactions) {
    const tx = decoded(wire);
    assert.equal(tx.feePayer.toBase58(), OWNER);
    assert.deepEqual(tx.signers.map((signer) => signer.toBase58()), [OWNER]);
  }
  /* What stands on the chain was run against it: each unit's first transaction; a sweep stands on what has not landed. */
  assert.equal(simulated.length, 6);
  assert.equal(value.transactions.slice(-2).some((wire) => simulated.includes(wire)), false);

  /* The ticket holds the order: a chain's second transaction stands on its first; a sweep on the positions that bring its coin. */
  const { ticket } = readExitTicket(value.ticket, ENV, 1_500);
  assert.deepEqual(ticket.steps.map((step) => [step.all, step.any]), [[[], []], [[0], []], [[], []], [[2], []], [[], []], [[], []], [[], []], [[], []], [[], [1, 3]], [[], [4]]]);
  assert.deepEqual(ticket.steps.map((step) => step.requestId), [null, null, null, null, null, null, null, "order-1", null, null]);

  /* The summary: what arrives in SOL, the rent back, the swap's own fee and nothing else, what was left out and why. */
  const lamports = 2_500_000_000n * 2n + 1_000_000_000n + 1_140_000_000n + 2_990_000_000n * 2n;
  assert.deepEqual(value.summary.receive, { lamports: lamports.toString(), usdcRaw: "0" });
  assert.equal(value.summary.rentLamports, "114000000");
  assert.equal(value.summary.feeBps, 25);
  assert.deepEqual(value.summary.later, [{ id: STAKE_ACTIVE.id, untilEpoch: 901 }]);
  assert.deepEqual(value.summary.skipped, []);
  assert.deepEqual(value.summary.others, []);
  assert.deepEqual(value.summary.held.map((row) => row.reason).sort(), ["LOCKED", "NOT_READ", "NO_ROUTE", "PROJECTION", "REPAY", "STAKE_COOLING"]);
  assert.deepEqual(value.summary.done.find((row) => row.id === LOCKED.id), { id: LOCKED.id, action: "leave", partBps: 2_500 });

  /* The builders were asked for exactly what the plan says: a locked position is not closed, a sweep is held to the portfolio's prices. */
  const pools = calls.filter(([name]) => name === "pool").map(([, request]) => request);
  assert.deepEqual(pools.map((request) => [request.venue, request.mode, request.close]).sort(), [["meteora-damm-v2", "exit", false], ["meteora-dlmm", "exit", true]]);
  assert.deepEqual(calls.filter(([name]) => name === "swap").map(([, request]) => [request.mint, request.amountRaw, request.outMint]), [[LST, "1000000000", NATIVE_SOL_MINT]]);
  const sweeps = calls.filter(([name]) => name === "sweep").map(([, request]) => request);
  assert.deepEqual(sweeps.map((request) => [request.spec.inMint, request.spec.outMint, request.inUsd === null, request.outUsd]), [[COIN, NATIVE_SOL_MINT, false, 200], [USDC_MINT, NATIVE_SOL_MINT, false, 200]]);
  assert.equal(unitPrices(answerOf(ALL)).get(COIN), 488 / 500);
});

test("bytes that are not the action are left out and named — nothing of them reaches the wallet", async () => {
  const thief = v0([venueIx(70), SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: STRANGER, lamports: 1_000_000 })]);
  const foreignPayer = v0([venueIx(71)], STRANGER);
  const { ports } = portsOf({
    lend: async () => ({ ok: true, txs: [{ wire: thief, requestId: null, rule: VENUE_RULE }], chained: true, brings: [bring(USDC_MINT, 300_000_000, 299_700_000)], rentLamports: 0n, feeBps: null }),
    swap: async () => ({ ok: true, txs: [{ wire: foreignPayer, requestId: "order-9", rule: { kind: "swap" } }], chained: true, brings: [], rentLamports: 0n, feeBps: 10 }),
  });
  const reviewed = await reviewExit(ASK, depsOf({ ports }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.summary.skipped.sort((a, b) => a.id.localeCompare(b.id)), [{ id: LEND.id, reason: "REFUSED" }, { id: WALLET_LST.id, reason: "REFUSED" }]);
  assert.equal(reviewed.value.transactions.includes(thief), false);
  assert.equal(reviewed.value.transactions.includes(foreignPayer), false);
  /* With the deposit left out, no USDC arrives and none is swept. */
  assert.equal(reviewed.value.refs.includes(USDC_MINT), false);
});

test("a unit the network would refuse now is left out; one a builder cannot build says why; the rest go", async () => {
  const { ports } = portsOf({ lend: async () => ({ ok: false, reason: "CLOSED_HERE" }), swap: async () => Promise.reject(new Error("socket hang up")) });
  let first = true;
  const { chain } = chainOf({ simulate: async () => (first ? ((first = false), false) : true) });
  const reviewed = await reviewExit({ ...ASK, positions: [POOL_POSITION.id, LEND.id, STAKE_FREE.id, WALLET_LST.id] }, depsOf({ ports, chain }));
  assert.equal(reviewed.ok, true);
  const reasons = Object.fromEntries(reviewed.value.summary.skipped.map((row) => [row.id, row.reason]));
  assert.equal(reasons[LEND.id], "CLOSED_HERE");
  assert.equal(reasons[WALLET_LST.id], "UNAVAILABLE");
  assert.equal(Object.values(reasons).filter((reason) => reason === "SIMULATION_FAILED").length, 1);
  assert.equal(reviewed.value.summary.done.length, 1);
});

test("a swap of what arrived that cannot be built leaves the coin as it came, and says so; a second leg does not go without its first", async () => {
  const { ports } = portsOf({ sweep: async ({ spec }) => (spec.inMint === COIN && spec.percent === 50 ? { ok: false, reason: "NO_PRICE" } : { ok: true, txs: [venueTx()], chained: true, brings: [bring(spec.outMint, 5, 1)], rentLamports: 0n, feeBps: null }) });
  const reviewed = await reviewExit({ owner: OWNER, mode: "exit", target: "SPLIT" }, depsOf({ ports, positions: [POOL_POSITION] }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.summary.others, [{ mint: COIN, decimals: 6, amountRaw: "512000000", reason: "NO_PRICE" }]);
  assert.equal(reviewed.value.refs.includes(COIN), false);
});

test("into USDC: the fixed swap of SOL stands on every position that brings SOL", async () => {
  const reviewed = await reviewExit({ owner: OWNER, mode: "exit", target: "USDC" }, depsOf({ positions: [POOL_POSITION, STAKE_FREE] }));
  assert.equal(reviewed.ok, true);
  const { ticket } = readExitTicket(reviewed.value.ticket, ENV, 1_500);
  assert.deepEqual(reviewed.value.kinds, ["leave", "leave", "stake", "sweep", "sweep"]);
  const sol = ticket.steps.find((step) => step.ref === NATIVE_SOL_MINT);
  assert.deepEqual([sol.all, sol.any], [[1, 2], []]);
  /* It is sent only while the wallet holds what it held at the Review, what the swap wraps and the rent that came back — less the fees the package itself costs. */
  const fees = reviewed.value.transactions.reduce((sum, wire) => sum + networkFeeOf(wire), 0n);
  assert.equal(fees > 0n, true);
  assert.equal(sol.needLamports, (HELD_LAMPORTS + 3_475_000_000n + 57_000_000n - fees).toString());
  /* A stake alone into USDC: the withdraw's own fee does not hold its swap back. */
  const stakeOnly = await reviewExit({ owner: OWNER, mode: "exit", target: "USDC" }, depsOf({ positions: [STAKE_FREE] }));
  const stakeNeed = BigInt(readExitTicket(stakeOnly.value.ticket, ENV, 1_500).ticket.steps[1].needLamports);
  assert.equal(stakeNeed < HELD_LAMPORTS + 1_000_000_000n, true);
  assert.equal(stakeNeed > HELD_LAMPORTS + 1_000_000_000n - 100_000n, true);
  assert.deepEqual(ticket.steps.filter((step) => step.ref !== NATIVE_SOL_MINT).map((step) => step.needLamports), [null, null, null, null]);
  /* Where the wallet's SOL cannot be read at the Review, there is no such swap: the SOL stays SOL. */
  const unread = await reviewExit({ owner: OWNER, mode: "exit", target: "USDC" }, depsOf({ positions: [POOL_POSITION, STAKE_FREE], chain: chainOf({ lamports: async () => Promise.reject(new Error("429")) }).chain }));
  assert.equal(unread.ok, true);
  assert.equal(unread.value.refs.includes(NATIVE_SOL_MINT), false);
  assert.equal(unread.value.summary.receive.lamports, "3500000000");
  /* What stays in SOL is what arrives above the least that is swapped. */
  assert.equal(reviewed.value.summary.receive.lamports, (3_500_000_000n - 3_475_000_000n).toString());
});

test("half and half for a coin of the wallet: two swaps of the same coin, each standing alone", async () => {
  const { ports, calls } = portsOf();
  const reviewed = await reviewExit({ owner: OWNER, mode: "exit", target: "SPLIT" }, depsOf({ ports, positions: [WALLET_LST] }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(calls.map(([, request]) => [request.amountRaw, request.outMint]), [["500000000", NATIVE_SOL_MINT], ["500000000", USDC_MINT]]);
  assert.deepEqual(reviewed.value.kinds, ["swap", "swap"]);
  assert.deepEqual(readExitTicket(reviewed.value.ticket, ENV, 1_500).ticket.steps.map((step) => step.all), [[], []]);
  assert.deepEqual(reviewed.value.summary.receive, { lamports: "1140000000", usdcRaw: "229000000" });
  assert.equal(reviewed.value.summary.feeBps, 10);
});

test("a coin that is in the wallet and also arrives from a position: the sweep goes, the wallet's own swap waits for the next approval", async () => {
  const { ports, calls } = portsOf();
  const reviewed = await reviewExit({ ...ASK, positions: [POOL_POSITION.id, WALLET_COIN.id, WALLET_LST.id] }, depsOf({ ports, positions: [POOL_POSITION, WALLET_COIN, WALLET_LST] }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.summary.skipped, [{ id: WALLET_COIN.id, reason: "NO_ROOM" }]);
  assert.deepEqual(reviewed.value.kinds, ["leave", "leave", "swap", "sweep"]);
  assert.deepEqual(reviewed.value.refs.slice(-2), [WALLET_LST.id, COIN]);
  /* What arrives counts the pool's coin once — through the sweep — and not the wallet's own. */
  assert.equal(calls.filter(([name]) => name === "sweep").length, 1);
  assert.equal(reviewed.value.summary.receive.lamports, (2_500_000_000n + 1_140_000_000n + 2_990_000_000n).toString());
});

test("what does not fit one approval is the smallest, and is named", async () => {
  const many = Array.from({ length: 10 }, (_, index) => position({ id: `meteora-dlmm:many${index}`, value: { usd: 1_000 - index, sol: 1 }, refs: refs({ position: key(100 + index).publicKey.toBase58() }) }));
  const reviewed = await reviewExit(ASK, depsOf({ positions: many }));
  assert.equal(reviewed.ok, true);
  /* Two transactions each and one sweep: seven positions fit sixteen. */
  assert.equal(reviewed.value.transactions.length, 15);
  assert.deepEqual(reviewed.value.summary.skipped, [{ id: "meteora-dlmm:many9", reason: "NO_ROOM" }, { id: "meteora-dlmm:many8", reason: "NO_ROOM" }, { id: "meteora-dlmm:many7", reason: "NO_ROOM" }]);
});

test("collecting: the fees of every pool, nothing swapped, the coins as they come", async () => {
  const { ports, calls } = portsOf({ pool: async (request) => (calls.push(["pool", request]), { ok: true, txs: [venueTx(), venueTx()], chained: false, brings: [bring(NATIVE_SOL_MINT, 60_000_000, 60_000_000, 9), bring(COIN, 12_000_000, 12_000_000)], rentLamports: 0n, feeBps: null }) });
  const { chain, simulated } = chainOf();
  const reviewed = await reviewExit({ owner: OWNER, mode: "collect", target: "SOL" }, depsOf({ ports, chain }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.kinds, ["collect", "collect"]);
  assert.deepEqual(calls.map(([name, request]) => [name, request.mode]), [["pool", "collect"]]);
  /* Claims stand alone: each is run, none waits for another. */
  assert.equal(simulated.length, 2);
  assert.deepEqual(readExitTicket(reviewed.value.ticket, ENV, 1_500).ticket.steps.map((step) => step.all), [[], []]);
  assert.deepEqual(reviewed.value.summary.receive, { lamports: "60000000", usdcRaw: "0" });
  assert.deepEqual(reviewed.value.summary.others, [{ mint: COIN, decimals: 6, amountRaw: "12000000", reason: null }]);
  assert.equal(reviewed.value.summary.feeBps, null);
});

test("nothing to do is said, not built", async () => {
  const none = await reviewExit(ASK, depsOf({ positions: [KAMINO, WALLET_SOL] }));
  assert.deepEqual([none.ok, none.code], [false, "NOTHING_TO_DO"]);
  const { ports } = portsOf({ pool: async () => ({ ok: false, reason: "NOTHING_TO_DO" }) });
  const empty = await reviewExit(ASK, depsOf({ ports, positions: [POOL_POSITION] }));
  assert.deepEqual([empty.ok, empty.code], [false, "NOTHING_TO_DO"]);
  const down = await reviewExit(ASK, depsOf({ portfolio: async () => Promise.reject(new Error("down")) }));
  assert.deepEqual([down.ok, down.code], [false, "UNAVAILABLE"]);
});

/* ── the relay ────────────────────────────────────────────────────────── */

async function packageOf(target = "SOL", positions = [POOL_POSITION, STAKE_FREE, WALLET_LST]) {
  const reviewed = await reviewExit({ owner: OWNER, mode: "exit", target }, depsOf({ positions }));
  assert.equal(reviewed.ok, true);
  return { review: reviewed.value, signed: reviewed.value.transactions.map((wire) => sign(wire)) };
}
function relayChain(outcome = () => "LANDED", lamports = async () => HELD_LAMPORTS + 10_000_000_000n) {
  const sent = [];
  const signatureOf = (wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")).signatures[0];
  const bySignature = new Map();
  return {
    sent,
    /** A transaction that went another way — Jupiter's lane — is on the chain too. */
    know: (wire) => bySignature.set(Buffer.from(signatureOf(wire)).toString("hex"), "LANDED"),
    chain: {
      lamports,
      simulate: async () => true,
      tables: async () => new Map(),
      send: async (wire) => {
        const index = sent.length;
        sent.push(wire);
        const result = outcome(wire, index);
        bySignature.set(Buffer.from(signatureOf(wire)).toString("hex"), result);
        /* The RPC client puts the endpoint's own words on the second line. */
        if (result === "PREFLIGHT") throw new Error("Simulation failed. \nMessage: Transaction simulation failed: custom program error.");
        if (result === "ALREADY") throw new Error("Simulation failed. \nMessage: Transaction simulation failed: This transaction has already been processed.");
        if (result === "TIMEOUT") throw new Error("socket hang up");
      },
      status: async (signature) => {
        for (const [hex, result] of bySignature) {
          if (base58(Buffer.from(hex, "hex")) !== signature) continue;
          if (result === "FAILED") return { err: { InstructionError: [0, "Custom"] }, confirmed: false };
          if (result === "LANDED" || result === "TIMEOUT" || result === "ALREADY") return { err: null, confirmed: true };
        }
        return undefined;
      },
      signableMs: async () => 20_000,
    },
  };
}
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

test("the relay sends in waves, once each: what stands alone first, then what stood on it", async () => {
  const { review, signed } = await packageOf();
  assert.deepEqual(review.kinds, ["leave", "leave", "stake", "swap", "sweep"]);
  const { chain, sent, know } = relayChain();
  const executed = [];
  const forgotten = [];
  const relayed = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain, execute: async (wire, requestId) => (executed.push([wire, requestId]), know(wire), { sent: true, reason: null }), forget: (owner) => forgotten.push(owner) }));
  assert.equal(relayed.ok, true);
  /* The swap's order goes to Jupiter's own lane, not the RPC — and its landing is read from the chain like the rest. */
  assert.deepEqual(executed, [[signed[3], "order-1"]]);
  assert.deepEqual(new Set(sent), new Set([signed[0], signed[1], signed[2], signed[4]]));
  assert.equal(sent.length, 4);
  /* The pool's second transaction after its first; the sweep after the pool's last. */
  assert.equal(sent.indexOf(signed[1]) > sent.indexOf(signed[0]), true);
  assert.equal(sent.indexOf(signed[4]) > sent.indexOf(signed[1]), true);
  assert.deepEqual(relayed.value.results.map((result) => [result.kind, result.state]), [["leave", "LANDED"], ["leave", "LANDED"], ["stake", "LANDED"], ["swap", "LANDED"], ["sweep", "LANDED"]]);
  assert.equal(relayed.value.settled, true);
  assert.deepEqual(forgotten, [OWNER]);
  /* The same ticket again sends the same bytes with the same signatures: the network takes each once. */
  const again = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain, execute: async (wire) => (know(wire), { sent: true, reason: null }) }));
  assert.deepEqual(again.value.results.map((result) => result.signature), relayed.value.results.map((result) => result.signature));

  /* Bytes the network has already taken — a second try after an answer was lost — are read from the chain as landed, and what stands on them goes. */
  const taken = relayChain((wire) => (wire === signed[0] || wire === signed[1] ? "ALREADY" : "LANDED"));
  const second = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain: taken.chain, execute: async (wire) => (taken.know(wire), { sent: true, reason: null }) }));
  assert.deepEqual(second.value.results.map((result) => result.state), ["LANDED", "LANDED", "LANDED", "LANDED", "LANDED"]);
  assert.equal(second.value.settled, true);

  /* An order Jupiter did not take was not sent, and says why; one with no clear answer is left to the chain. */
  const refusedOrder = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain: relayChain().chain, execute: async () => ({ sent: false, reason: "Order expired" }) }));
  assert.deepEqual([refusedOrder.value.results[3].state, refusedOrder.value.results[3].reason], ["NOT_SENT", "Order expired"]);
  assert.equal(refusedOrder.value.settled, false);
});

test("a step whose own did not land is not sent, and says so; nothing is sent twice", async () => {
  const { review, signed } = await packageOf();
  /* The pool's first transaction fails on chain: its second, and the sweep of what it would have brought, never leave. */
  const { chain, sent } = relayChain((wire) => (wire === signed[0] ? "FAILED" : "LANDED"));
  const relayed = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain }));
  assert.equal(relayed.ok, true);
  assert.deepEqual(relayed.value.results.map((result) => result.state), ["FAILED", "NOT_SENT", "LANDED", "UNKNOWN", "NOT_SENT"]);
  assert.match(relayed.value.results[1].reason, /did not land/);
  assert.match(relayed.value.results[4].reason, /did not land/);
  assert.deepEqual(new Set(sent), new Set([signed[0], signed[2]]));
  assert.equal(sent.length, 2);
});

test("a preflight refusal moved nothing; an answer that is not clear is read from the chain, never sent again", async () => {
  const { review, signed } = await packageOf();
  const { chain, sent } = relayChain((wire) => (wire === signed[2] ? "PREFLIGHT" : wire === signed[0] ? "TIMEOUT" : "LANDED"));
  const relayed = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain }));
  assert.equal(relayed.ok, true);
  /* The timed-out send had landed: the chain says so, and what stands on it goes. */
  assert.deepEqual(relayed.value.results.map((result) => result.state), ["LANDED", "LANDED", "NOT_SENT", "UNKNOWN", "LANDED"]);
  assert.match(relayed.value.results[2].reason, /simulation failed/i);
  assert.equal(sent.filter((wire) => wire === signed[0]).length, 1);
});

test("a fixed swap of SOL does not leave unless every position that brings SOL has landed", async () => {
  const { review, signed } = await packageOf("USDC", [POOL_POSITION, STAKE_FREE]);
  assert.deepEqual(review.kinds, ["leave", "leave", "stake", "sweep", "sweep"]);
  const solAt = review.refs.indexOf(NATIVE_SOL_MINT);
  const coinAt = review.refs.indexOf(COIN);
  /* The stake's withdraw fails: the SOL swap would spend the wallet's own SOL, so it is not sent; the coin's sweep still goes. */
  const { chain, sent } = relayChain((wire) => (wire === signed[2] ? "FAILED" : "LANDED"));
  const relayed = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain }));
  assert.equal(relayed.value.results[solAt].state, "NOT_SENT");
  assert.equal(relayed.value.results[coinAt].state, "LANDED");
  assert.equal(sent.includes(signed[solAt]), false);

  /* Every position landed, but less SOL came than the swap wraps — the price moved, the pool paid in the other coin: not sent. */
  const need = BigInt(readExitTicket(review.ticket, ENV, 1_500).ticket.steps[solAt].needLamports);
  const short = relayChain(() => "LANDED", async () => need - 1n);
  const held = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain: short.chain }));
  assert.deepEqual([held.value.results[solAt].state, short.sent.includes(signed[solAt])], ["NOT_SENT", false]);
  assert.match(held.value.results[solAt].reason, /Less SOL arrived/);
  /* The wallet's SOL not read is not sent either; exactly enough is. */
  const blind = relayChain(() => "LANDED", async () => Promise.reject(new Error("429")));
  const unread = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain: blind.chain }));
  assert.deepEqual([unread.value.results[solAt].state, blind.sent.includes(signed[solAt])], ["NOT_SENT", false]);
  const enough = relayChain(() => "LANDED", async () => need);
  const went = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain: enough.chain }));
  assert.equal(went.value.results[solAt].state, "LANDED");
});

test("the relay refuses what the ticket did not seal, and a door that closed since", async () => {
  const { review, signed } = await packageOf();
  const { chain, sent } = relayChain();
  const swapped = await submitExit({ ticket: review.ticket, signed: [signed[1], signed[0], ...signed.slice(2)] }, depsOf({ chain }));
  assert.deepEqual([swapped.ok, swapped.code], [false, "SIGNED_MISMATCH"]);
  const unsigned = await submitExit({ ticket: review.ticket, signed: [...signed.slice(0, 4), review.transactions[4]] }, depsOf({ chain }));
  assert.deepEqual([unsigned.ok, unsigned.code], [false, "NOT_SIGNED"]);
  /* A stranger's signature in the wallet's place. */
  const forged = review.transactions.map((wire) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    const stranger = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 77)]), format: "der", type: "pkcs8" });
    tx.signatures[0] = new Uint8Array(ed25519Sign(null, tx.message.serialize(), stranger));
    return Buffer.from(tx.serialize()).toString("base64");
  });
  const other = await submitExit({ ticket: review.ticket, signed: forged }, depsOf({ chain }));
  assert.deepEqual([other.ok, other.code], [false, "NOT_SIGNED"]);
  const old = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain, now: () => 1_000 + 10 * 60_000 }));
  assert.deepEqual([old.ok, old.code], [false, "TICKET_EXPIRED"]);
  const closed = await submitExit({ ticket: review.ticket, signed }, depsOf({ chain, env: { BETA_TOKEN_SECRET: ENV.BETA_TOKEN_SECRET } }));
  assert.deepEqual([closed.ok, closed.code], [false, "CLOSED"]);
  const bad = await submitExit({ ticket: "nope", signed }, depsOf({ chain }));
  assert.deepEqual([bad.ok, bad.code], [false, "TICKET_INVALID"]);
  assert.equal(sent.length, 0);
  assert.equal(lookupsOf(review.transactions[0]).length, 0);
});
