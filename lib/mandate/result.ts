/**
 * CITY-179 — «the money did not reach you, so the trade does not happen», written into the trade.
 *
 * Every venue checks its own minimum: Jupiter its quote less the slippage, DLMM its `min_amount_out`. Neither measures
 * the person's account: the number is the venue's own count. So every agent trade ends with one more instruction, after
 * the swap: the person's token account must now hold at least what it held before plus the trade's minimum, or the whole
 * transaction is undone.
 *
 * The rule is Lighthouse's `AssertTokenAccount` — an existing program with no upgrade key on mainnet (the same build on
 * devnet, read from the chain 02.11.2026). It reads one account and can only fail a transaction: it moves nothing and
 * holds no authority. We write no program of our own.
 *
 * This holds every trade the agent's signer signs: the signer refuses a trade without it (`./signer.server.ts`). Someone
 * holding a stolen agent key can leave it out; for them the chain's ceiling is the day's cap, or the person's floor on a
 * regular buy (`./terms.ts`).
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { DLMM_PROGRAM_ID, DLMM_SWAP2, JUPITER_PROGRAM_ID, LAYOUT, ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2 } from "./terms.ts";

export const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

/* The program's own numbering: instruction `AssertTokenAccount`, silent logs, assertion `Amount`, operator `>=`. */
const ASSERT_TOKEN_ACCOUNT = 9;
const LOG_SILENT = 0;
const ASSERTION_AMOUNT = 2;
const OPERATOR_AT_LEAST = 4;

/** The person's token account must hold at least `amount` when this instruction runs. */
export function receivedAtLeastInstruction(account: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(12);
  data[0] = ASSERT_TOKEN_ACCOUNT;
  data[1] = LOG_SILENT;
  data[2] = ASSERTION_AMOUNT;
  data.writeBigUInt64LE(amount, 3);
  data[11] = OPERATOR_AT_LEAST;
  return new TransactionInstruction({ programId: LIGHTHOUSE_PROGRAM_ID, keys: [{ pubkey: account, isSigner: false, isWritable: false }], data });
}

/** The rule read back from its own bytes; null for any other instruction of that program. */
export function readReceivedAtLeast(instruction: Pick<TransactionInstruction, "programId" | "keys" | "data">): Readonly<{ account: PublicKey; amount: bigint }> | null {
  const { data, keys } = instruction;
  if (!instruction.programId.equals(LIGHTHOUSE_PROGRAM_ID) || keys.length !== 1 || data.length !== 12) return null;
  if (data[0] !== ASSERT_TOKEN_ACCOUNT || data[1] !== LOG_SILENT || data[2] !== ASSERTION_AMOUNT || data[11] !== OPERATOR_AT_LEAST) return null;
  return { account: keys[0]!.pubkey, amount: Buffer.from(data).readBigUInt64LE(3) };
}

/** What a venue instruction's own bytes say of the trade. */
export type TradeTerms = Readonly<{ receiver: PublicKey; amountIn: bigint; minOut: bigint }>;

const startsWith = (data: Uint8Array, head: Uint8Array) => head.every((byte, index) => data[index] === byte);

function u64At(data: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > data.length) return null;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).readBigUInt64LE(offset);
}

/** Jupiter's own minimum: its quote less the slippage the instruction names. */
function jupiterTerms(accounts: readonly PublicKey[], data: Uint8Array, at: Readonly<{ receiver: number; inAmount: number; quotedOut: number; slippage: number }>): TradeTerms | null {
  const receiver = accounts[at.receiver];
  const amountIn = u64At(data, at.inAmount);
  const quoted = u64At(data, at.quotedOut);
  if (!receiver || amountIn === null || quoted === null || at.slippage + 2 > data.length) return null;
  const slippage = BigInt(data[at.slippage]! | (data[at.slippage + 1]! << 8));
  if (slippage > 10_000n) return null;
  return { receiver, amountIn, minOut: (quoted * (10_000n - slippage)) / 10_000n };
}

/** The trade a venue instruction makes: who receives, what goes in, the least that comes out; null — not a trade we know. */
export function tradeTerms(instruction: Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>): TradeTerms | null {
  const { programId, accounts, data } = instruction;
  if (programId.equals(JUPITER_PROGRAM_ID)) {
    if (startsWith(data, ROUTE_V2)) return jupiterTerms(accounts, data, LAYOUT.routeV2);
    if (startsWith(data, SHARED_ACCOUNTS_ROUTE_V2)) return jupiterTerms(accounts, data, LAYOUT.sharedRouteV2);
    return null;
  }
  if (programId.equals(DLMM_PROGRAM_ID) && startsWith(data, DLMM_SWAP2)) {
    const receiver = accounts[LAYOUT.dlmmSwap2.receiver];
    const amountIn = u64At(data, LAYOUT.dlmmSwap2.inAmount);
    const minOut = u64At(data, LAYOUT.dlmmSwap2.minOut);
    return receiver && amountIn !== null && minOut !== null ? { receiver, amountIn, minOut } : null;
  }
  return null;
}

/** Ryntra's fee as a Jupiter route carries it (CITY-183): its rate, its positive-slippage share and the fee slot's account. */
export type RouteFee = Readonly<{ bps: number; positiveSlippageBps: number; account: PublicKey | null }>;

const u16At = (data: Uint8Array, offset: number): number | null => (offset + 2 <= data.length ? data[offset]! | (data[offset + 1]! << 8) : null);

/** The fee a Jupiter `route_v2` or `shared_accounts_route_v2` names; null for any other instruction. */
export function jupiterFeeOf(instruction: Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>): RouteFee | null {
  const { programId, accounts, data } = instruction;
  if (!programId.equals(JUPITER_PROGRAM_ID)) return null;
  const at = startsWith(data, ROUTE_V2) ? LAYOUT.routeV2 : startsWith(data, SHARED_ACCOUNTS_ROUTE_V2) ? LAYOUT.sharedRouteV2 : null;
  if (!at) return null;
  const bps = u16At(data, at.platformFee);
  const positiveSlippageBps = u16At(data, at.positiveSlippage);
  if (bps === null || positiveSlippageBps === null) return null;
  return { bps, positiveSlippageBps, account: accounts[at.feeAccount] ?? null };
}

/** The amount a token account's data holds; zero for an account not yet opened. */
export function heldIn(data: Uint8Array | null | undefined): bigint {
  return (data && u64At(data, 64)) ?? 0n;
}
