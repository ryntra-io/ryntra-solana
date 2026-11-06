/**
 * CITY-198 — what a Zap may do, read instruction by instruction before anyone is asked to sign it.
 *
 * A Zap is several programs in a row: the wallet's own token-account plumbing, a swap (Jupiter's router, or the pier's
 * own DLMM pool), Meteora's Zap program (`zapvX9M3…Miz`) with its ledger, and the DLMM program it calls. The Zap SDK
 * (`@meteora-ag/zap-sdk` 2.0.0) builds them and checks nothing of their economics, and the Zap program itself trusts
 * the token accounts it is handed. So the Review holds every instruction to one rule — **the money starts in the
 * wallet, moves only through the pier's pool and Jupiter's router, and ends in the wallet** — and refuses anything else:
 *
 * - Jupiter: only `route_v2` and `shared_accounts_route_v2`; the wallet is the authority, spends from its own account
 *   and receives on its own account of a coin of the pier; Ryntra's fee (CITY-198 §2) is exactly the rate asked, in
 *   exactly the fee wallet's account, with no share of positive slippage; the least the route accepts is at least the
 *   Review's own floor (`swapFloor`, held against the reference price by `againstReference`).
 * - DLMM: `swap2` on the pier's own pool between the wallet's own accounts of its two coins, no host fee, at least the
 *   floor; `initialize_bin_array` of the pier's pool paid by the wallet. Nothing else of DLMM at the top level.
 * - Zap: the wallet's own ledger (the PDA of `user_ledger` and the wallet) opened, set, updated from the wallet's own
 *   account of a coin of the pier, and closed back to the wallet; `zap_in_dlmm_for_uninitialized_position` into the
 *   pier's pool, from the wallet's own accounts of its two coins, into the fresh position key, rent paid by the wallet.
 * - Zap Out: the Zap program does **not** check who owns `user_token_in_account` — it reads that account's balance and
 *   swaps the difference. Here it must be the wallet's own account of a coin of the pier, the very account the inner
 *   swap spends from; the inner swap pays the wallet's own account of the other coin, signed by the wallet.
 *
 * Pure: no network, no clock.
 */

import { createHash } from "node:crypto";

import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import { LIGHTHOUSE_PROGRAM } from "../../solana/limits/model.ts";
import { DLMM_PROGRAM } from "./dlmm.ts";

export const ZAP_PROGRAM = "zapvX9M3uf5pvy4wRPAbQgdQsM1xmuiFnkfHKPvwMiz";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO = new Set(["MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);

const anchor = (name: string): Buffer => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/** The Zap program's instructions, by Anchor's discriminator (its IDL, SDK 2.0.0). */
export const ZAP_IX = Object.freeze({
  initializeLedger: anchor("initialize_ledger_account"),
  closeLedger: anchor("close_ledger_account"),
  setLedgerBalance: anchor("set_ledger_balance"),
  updateLedgerAfterSwap: anchor("update_ledger_balance_after_swap"),
  zapInDlmmNew: anchor("zap_in_dlmm_for_uninitialized_position"),
  zapOut: anchor("zap_out"),
});

/** Jupiter's two routes (on-chain IDL, CITY-136 §4 and CITY-183) and DLMM's own instructions. */
export const ROUTE_V2 = anchor("route_v2");
export const SHARED_ACCOUNTS_ROUTE_V2 = anchor("shared_accounts_route_v2");
export const DLMM_SWAP2 = anchor("swap2");
export const DLMM_INIT_BIN_ARRAY = anchor("initialize_bin_array");

/**
 * Where each route keeps what is checked (Jupiter's on-chain IDL; the same layout the agent's mandate pins,
 * `lib/mandate/terms.ts`). `route_v2`'s `destination_token_account` is optional: when absent the slot holds Jupiter's
 * own id and the output lands on `user_destination_token_account`. The fee account is the first after the route's own.
 */
const ROUTE = Object.freeze({
  v2: { authority: 0, source: 1, destination: 2, receiver: 7, own: 10, inAmount: 8, quotedOut: 16, slippage: 24, platformFee: 26, positiveSlippage: 28 },
  shared: { authority: 1, source: 2, destination: 5, receiver: 5, own: 12, inAmount: 9, quotedOut: 17, slippage: 25, platformFee: 27, positiveSlippage: 29 },
});
/** DLMM `swap2`'s accounts (its IDL, EXE-0 §3.1) and data. */
const SWAP2 = Object.freeze({ pool: 0, source: 4, receiver: 5, hostFee: 9, user: 10, inAmount: 8, minOut: 16 });

export type ZapCheckContext = Readonly<{
  owner: string;
  /** The pier's DLMM pool, its two coins and their token programs. */
  pool: string;
  mintX: string;
  mintY: string;
  programX: string;
  programY: string;
  /** zap_in: opens the fresh position; zap_rest: swaps back what a half-landed Zap left, closes the ledger, unwraps. */
  action: "zap_in" | "zap_rest";
  /** The fresh position key a zap_in opens. */
  position: string | null;
  /** Ryntra's fee on a Jupiter swap leg: the rate and the fee wallet's account; null — no fee asked. */
  fee: Readonly<{ bps: number; account: string }> | null;
  /** The swap leg: at most this much in, at least this much out, base units; null — the build swaps nothing. */
  swap: Readonly<{ maxIn: bigint; floor: bigint }> | null;
}>;

export type ZapCheck = Readonly<{ ok: true; zapCalls: number; swaps: number }> | Readonly<{ ok: false; reason: string }>;

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean => data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);
const u16At = (data: Uint8Array, offset: number): number | null => (offset + 2 <= data.length ? data[offset]! | (data[offset + 1]! << 8) : null);
const u64At = (data: Uint8Array, offset: number): bigint | null => (offset + 8 <= data.length ? Buffer.from(data.subarray(offset, offset + 8)).readBigUInt64LE(0) : null);

export function ledgerOf(owner: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from("user_ledger"), new PublicKey(owner).toBuffer()], new PublicKey(ZAP_PROGRAM))[0].toBase58();
}

export function ownAccountOf(owner: string, mint: string, program: string): string {
  return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(program)).toBase58();
}

/** The wallet's own accounts of the pier's two coins (and its wrapped SOL, which is one of them on a SOL pier). */
function ownAccounts(ctx: ZapCheckContext): Readonly<{ x: string; y: string; wsol: string; all: ReadonlySet<string> }> {
  const x = ownAccountOf(ctx.owner, ctx.mintX, ctx.programX);
  const y = ownAccountOf(ctx.owner, ctx.mintY, ctx.programY);
  const wsol = ownAccountOf(ctx.owner, NATIVE_MINT.toBase58(), TOKEN);
  return { x, y, wsol, all: new Set([x, y]) };
}

type Swap = Readonly<{ source: string; receiver: string; inAmount: bigint; minOut: bigint }>;

/** A Jupiter route's terms, checked; a reason when it is not one the Review takes. */
function jupiterRoute(keys: readonly string[], data: Uint8Array, ctx: ZapCheckContext, own: ReturnType<typeof ownAccounts>): Swap | string {
  const at = startsWith(data, ROUTE_V2) ? ROUTE.v2 : startsWith(data, SHARED_ACCOUNTS_ROUTE_V2) ? ROUTE.shared : null;
  if (!at) return "a Jupiter instruction other than route_v2 or shared_accounts_route_v2";
  if (keys[at.authority] !== ctx.owner) return "the swap is not the wallet's own";
  const source = keys[at.source];
  if (!source || !own.all.has(source)) return "the swap spends from an account that is not the wallet's";
  const optional = at === ROUTE.v2 && keys[at.receiver] !== JUPITER_PROGRAM ? keys[at.receiver] : null;
  const destination = keys[at.destination];
  const receiver = optional ?? destination;
  if (!destination || !own.all.has(destination) || !receiver || !own.all.has(receiver) || receiver === source) return "the swap's output does not land on the wallet's own account";
  const inAmount = u64At(data, at.inAmount);
  const quoted = u64At(data, at.quotedOut);
  const slippage = u16At(data, at.slippage);
  const platformFee = u16At(data, at.platformFee);
  const positive = u16At(data, at.positiveSlippage);
  if (inAmount === null || quoted === null || slippage === null || platformFee === null || positive === null || slippage > 10_000) return "the swap's terms cannot be read";
  if (positive !== 0) return "the swap takes a share of positive slippage";
  if (ctx.fee) {
    if (platformFee !== ctx.fee.bps || keys[at.own] !== ctx.fee.account) return "the swap does not pay Ryntra's fee as reviewed";
  } else if (platformFee !== 0) return "the swap pays a fee nobody reviewed";
  return { source, receiver, inAmount, minOut: (quoted * BigInt(10_000 - slippage)) / 10_000n };
}

/** A DLMM `swap2` on the pier's own pool, between the wallet's own accounts; a reason otherwise. */
function poolSwap(keys: readonly string[], data: Uint8Array, ctx: ZapCheckContext, own: ReturnType<typeof ownAccounts>): Swap | string {
  if (!startsWith(data, DLMM_SWAP2)) return "a DLMM swap other than swap2";
  if (keys[SWAP2.pool] !== ctx.pool) return "the swap is in another pool";
  if (keys[SWAP2.user] !== ctx.owner) return "the swap is not the wallet's own";
  const source = keys[SWAP2.source];
  const receiver = keys[SWAP2.receiver];
  if (!source || !own.all.has(source) || !receiver || !own.all.has(receiver) || source === receiver) return "the swap moves money outside the wallet's own accounts";
  if (keys[SWAP2.hostFee] !== DLMM_PROGRAM) return "the swap pays a host fee";
  const inAmount = u64At(data, SWAP2.inAmount);
  const minOut = u64At(data, SWAP2.minOut);
  if (inAmount === null || minOut === null) return "the swap's terms cannot be read";
  return { source, receiver, inAmount, minOut };
}

/** A swap's size and floor against the Review's: never more in, never less out (Zap Out's amount is set on chain, under its own cap). */
function withinReview(swap: Swap, ctx: ZapCheckContext, sizedOnChain: boolean): string | null {
  if (!ctx.swap) return "a swap the Review did not show";
  if (!sizedOnChain && swap.inAmount > ctx.swap.maxIn) return "the swap spends more than the Review showed";
  if (swap.minOut < ctx.swap.floor) return "the swap accepts less than the Review's floor";
  return null;
}

/** The wallet's own plumbing: its token accounts opened on its own rent, its SOL wrapped into and unwrapped from its own account. */
function plumbing(program: string, keys: readonly string[], data: Buffer, ctx: ZapCheckContext, own: ReturnType<typeof ownAccounts>): boolean {
  if (program === COMPUTE_BUDGET || MEMO.has(program)) return true;
  if (program === ATA) {
    if (!((data.length === 0 || (data.length === 1 && data[0] === 1)) && keys[0] === ctx.owner && keys[2] === ctx.owner)) return false;
    /* The account opened is the wallet's canonical one for the mint named. */
    const mint = keys[3];
    const tokenProgram = keys[5];
    return Boolean(mint && tokenProgram && (tokenProgram === TOKEN || tokenProgram === TOKEN_2022) && keys[1] === ownAccountOf(ctx.owner, mint, tokenProgram));
  }
  if (program === SYSTEM) return data.length === 12 && data.readUInt32LE(0) === 2 && keys[0] === ctx.owner && keys[1] === own.wsol;
  if (program === TOKEN || program === TOKEN_2022) {
    if (data.length === 1 && data[0] === 17) return keys[0] === own.wsol;
    if (data.length === 1 && data[0] === 9) return keys[0] === own.wsol && keys[1] === ctx.owner && keys[2] === ctx.owner;
    return false;
  }
  return false;
}

/**
 * Every instruction of one built transaction, as the Review will show it: the wallet's plumbing, the swap, the Zap
 * program's own ledger and deposit (or Zap Out), and the bin arrays the deposit needs — each on the wallet's own
 * accounts, and nothing else. Counts the Zap program's instructions and the swaps it saw, for the whole build's check.
 */
export function zapCallsOnly(instructions: readonly TransactionInstruction[], payer: string | null, ctx: ZapCheckContext): ZapCheck {
  if (payer !== ctx.owner) return { ok: false, reason: "The built transaction is paid by someone other than the wallet." };
  const own = ownAccounts(ctx);
  const ledger = ledgerOf(ctx.owner);
  let zapCalls = 0;
  let swaps = 0;
  const refuse = (why: string): ZapCheck => ({ ok: false, reason: `The built Zap has ${why}.` });
  for (const instruction of instructions) {
    const program = instruction.programId.toBase58();
    const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
    const data = Buffer.from(instruction.data);
    if (program === LIGHTHOUSE_PROGRAM) return refuse("an assertion the Review did not write");
    if (plumbing(program, keys, data, ctx, own)) continue;
    if (program === JUPITER_PROGRAM) {
      if (ctx.action !== "zap_in") return refuse("a Jupiter swap outside the deposit");
      const swap = jupiterRoute(keys, data, ctx, own);
      if (typeof swap === "string") return refuse(swap);
      const off = withinReview(swap, ctx, false);
      if (off) return refuse(off);
      swaps += 1;
      continue;
    }
    if (program === DLMM_PROGRAM) {
      if (startsWith(data, DLMM_INIT_BIN_ARRAY)) {
        if (keys[0] !== ctx.pool || keys[2] !== ctx.owner) return refuse("a bin array of another pool, or paid by someone else");
        continue;
      }
      if (ctx.action !== "zap_in") return refuse("a DLMM instruction outside the deposit");
      const swap = poolSwap(keys, data, ctx, own);
      if (typeof swap === "string") return refuse(swap);
      const off = withinReview(swap, ctx, false);
      if (off) return refuse(off);
      swaps += 1;
      continue;
    }
    if (program !== ZAP_PROGRAM) return refuse(`an instruction of ${program}`);
    zapCalls += 1;
    if (startsWith(data, ZAP_IX.initializeLedger)) {
      if (keys[0] !== ledger || keys[1] !== ctx.owner || keys[2] !== ctx.owner) return refuse("a ledger that is not the wallet's");
    } else if (startsWith(data, ZAP_IX.closeLedger)) {
      if (keys[0] !== ledger || keys[1] !== ctx.owner || keys[2] !== ctx.owner) return refuse("a ledger closed to someone else");
    } else if (startsWith(data, ZAP_IX.setLedgerBalance)) {
      if (ctx.action !== "zap_in" || keys[0] !== ledger || keys[1] !== ctx.owner) return refuse("a ledger that is not the wallet's");
    } else if (startsWith(data, ZAP_IX.updateLedgerAfterSwap)) {
      if (ctx.action !== "zap_in" || keys[0] !== ledger || keys[2] !== ctx.owner) return refuse("a ledger that is not the wallet's");
      if (!keys[1] || !own.all.has(keys[1])) return refuse("a ledger counted from an account that is not the wallet's");
    } else if (startsWith(data, ZAP_IX.zapInDlmmNew)) {
      if (ctx.action !== "zap_in") return refuse("a deposit outside the Zap in");
      /* ledger, lbPair, position, bitmap?, userTokenX, userTokenY, reserveX, reserveY, mintX, mintY, dlmm, owner, rentPayer, … */
      if (keys[0] !== ledger || keys[1] !== ctx.pool || keys[2] !== ctx.position || !instruction.keys[2]?.isSigner) return refuse("a deposit into another pool or position");
      if (keys[4] !== own.x || keys[5] !== own.y) return refuse("a deposit from accounts that are not the wallet's");
      if (keys[8] !== ctx.mintX || keys[9] !== ctx.mintY || keys[10] !== DLMM_PROGRAM) return refuse("a deposit of other coins");
      if (keys[11] !== ctx.owner || keys[12] !== ctx.owner) return refuse("a deposit owned or paid by someone else");
    } else if (startsWith(data, ZAP_IX.zapOut)) {
      if (ctx.action !== "zap_rest") return refuse("a Zap Out inside the deposit");
      const out = zapOutTerms(instruction, ctx, own);
      if (typeof out === "string") return refuse(out);
      swaps += 1;
    } else return refuse("a Zap instruction the Review does not take");
  }
  return { ok: true, zapCalls, swaps };
}

/**
 * Zap Out: the hole the program leaves — `user_token_in_account` is not checked for its owner — closed here. The
 * account must be the wallet's own account of a coin of the pier and the very account the inner swap spends; the inner
 * swap (DLMM `swap2` on the pier's pool, or a Jupiter route) is the wallet's, to its own account of the other coin, at
 * least the Review's floor, under the cap the program holds it to.
 */
function zapOutTerms(instruction: TransactionInstruction, ctx: ZapCheckContext, own: ReturnType<typeof ownAccounts>): Swap | string {
  const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
  const data = Buffer.from(instruction.data);
  const tokenIn = keys[0];
  const amm = keys[1];
  if (!tokenIn || !own.all.has(tokenIn)) return "a Zap Out from an account that is not the wallet's";
  /* params: percentage u8, offset_amount_in u16, pre_user_token_balance u64, max_swap_amount u64, payload_data bytes */
  if (data.length < 8 + 1 + 2 + 8 + 8 + 4) return "a Zap Out whose terms cannot be read";
  const percentage = data[8]!;
  const maxSwap = data.readBigUInt64LE(19);
  const length = data.readUInt32LE(27);
  if (31 + length !== data.length) return "a Zap Out whose terms cannot be read";
  const payload = data.subarray(31);
  if (percentage < 1 || percentage > 100) return "a Zap Out of an odd share";
  if (!ctx.swap || maxSwap > ctx.swap.maxIn) return "a Zap Out larger than the Review showed";
  const inner = keys.slice(2);
  let swap: Swap | string;
  if (amm === DLMM_PROGRAM) swap = poolSwap(inner, payload, ctx, own);
  else if (amm === JUPITER_PROGRAM) swap = jupiterRoute(inner, payload, ctx, own);
  else return "a Zap Out through another program";
  if (typeof swap === "string") return swap;
  if (swap.source !== tokenIn) return "a Zap Out that counts one account and spends another";
  const off = withinReview(swap, ctx, true);
  return off ?? swap;
}

/**
 * The swap leg against a price of its own (CITY-198 §3): the SDK takes Jupiter's or the pool's quote as it comes, and a
 * route's slippage bounds the fill against that quote only. The least the swap accepts must stand within the fee, the
 * slippage and one per cent of what the venue's dollar prices say the input is worth in the output coin. A leg without
 * a price on both sides is refused, never guessed.
 */
export const ZAP_REFERENCE_MARGIN_BPS = 100;

export type ReferenceCheck =
  | Readonly<{ ok: true; referenceOut: bigint; shortBps: number }>
  | Readonly<{ ok: false; code: "ZAP_UNPRICED" | "ZAP_PRICE"; referenceOut: bigint | null; shortBps: number | null }>;

export function againstReference(
  leg: Readonly<{ inAmount: bigint; inDecimals: number; inUsd: number | null; floor: bigint; outDecimals: number; outUsd: number | null; feeBps: number; slippageBps: number }>,
): ReferenceCheck {
  const { inUsd, outUsd } = leg;
  if (inUsd === null || outUsd === null || !(inUsd > 0) || !(outUsd > 0) || !Number.isFinite(inUsd) || !Number.isFinite(outUsd)) return { ok: false, code: "ZAP_UNPRICED", referenceOut: null, shortBps: null };
  if (leg.inAmount <= 0n) return { ok: true, referenceOut: 0n, shortBps: 0 };
  const worth = (Number(leg.inAmount) / 10 ** leg.inDecimals) * inUsd;
  const referenceOut = BigInt(Math.floor((worth / outUsd) * 10 ** leg.outDecimals));
  if (referenceOut <= 0n) return { ok: false, code: "ZAP_UNPRICED", referenceOut, shortBps: null };
  const shortBps = Number(((referenceOut - leg.floor) * 10_000n) / referenceOut);
  const allowed = leg.feeBps + leg.slippageBps + ZAP_REFERENCE_MARGIN_BPS;
  return shortBps <= allowed ? { ok: true, referenceOut, shortBps } : { ok: false, code: "ZAP_PRICE", referenceOut, shortBps };
}
