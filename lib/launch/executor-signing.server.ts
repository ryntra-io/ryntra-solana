/**
 * What Ryntra's executor may sign — checked in code on every transaction, before its key touches it.
 *
 * The executor signs only:
 * - Meteora DBC: the migration of a full curve, and — on a config whose fee claimer it is — the partner's trading fee,
 *   migration fee and surplus;
 * - Meteora DAMM v2: the fees of a position it owns, and the cent's purchase a DLMM pool asks its creator for — a swap of
 *   at most `PROOF_SWAP_MAX_RAW`, between the executor's own accounts, with no referral account;
 * - Meteora DLMM: its own pool, position and steps — open, add, remove, move, close;
 * - the compute budget, and the opening of its own token accounts.
 * Every token account a Meteora instruction pays into must be one of the executor's own (its associated accounts of
 * the instruction's mints) — or, for the holders' collector, of the position's owner, whom the program alone pays from
 * a delegate's claim; a rent receiver must be the executor. Nothing else — no transfer, no other program, no
 * account of another wallet's — is ever signed: the leak of the key is bounded by the wallet's own balance.
 */

import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, type TransactionInstruction } from "@solana/web3.js";

/** An Anchor IDL as the programs publish it: each instruction's name, discriminator and accounts in order. */
export type Idl = Readonly<{ address: string; instructions: readonly Readonly<{ name: string; discriminator: readonly number[]; accounts: readonly Readonly<{ name: string }>[] }>[] }>;

/** The instructions the executor may sign, by program — names as each program's own IDL writes them. */
export const EXECUTOR_INSTRUCTIONS: Readonly<Record<"dbc" | "damm" | "dlmm", readonly string[]>> = Object.freeze({
  dbc: ["migration_damm_v2", "claim_trading_fee", "withdraw_migration_fee", "partner_withdraw_surplus"],
  damm: ["claim_position_fee", "swap"],
  dlmm: [
    "initialize_customizable_permissionless_lb_pair2",
    "initialize_bin_array",
    "initialize_bin_array_bitmap_extension",
    "initialize_position",
    "initialize_position2",
    "increase_position_length",
    "increase_position_length2",
    "decrease_position_length",
    "add_liquidity_by_strategy",
    "add_liquidity_by_strategy2",
    "add_liquidity_by_weight",
    "add_liquidity_by_weight2",
    "remove_liquidity",
    "remove_liquidity2",
    "remove_liquidity_by_range",
    "remove_liquidity_by_range2",
    "remove_all_liquidity",
    "rebalance_liquidity",
    "go_to_a_bin",
    "claim_fee",
    "claim_fee2",
    "close_position",
    "close_position2",
    "close_position_if_empty",
  ],
});

/** Accounts a Meteora instruction pays tokens into: each must be the executor's own. */
const RECEIVERS = new Set([
  "token_a_account",
  "token_b_account",
  "token_quote_account",
  "token_base_account",
  "input_token_account",
  "output_token_account",
  "user_token_x",
  "user_token_y",
  "user_token",
  "user_token_account",
  "user_token_in",
  "user_token_out",
  "owner_token_x",
  "owner_token_y",
  "receiver_token",
  "receiver_token_x",
  "receiver_token_y",
]);
/** Accounts that must be the executor itself. */
const SELF = new Set(["rent_receiver", "rent_payer", "fee_claimer", "sender", "payer", "signer", "owner", "user", "funder"]);
const MINTS = /mint/;

type Program = Readonly<{ idl: Idl; allowed: ReadonlySet<string> }>;

/*
 * DLMM's IDL comes from the caller — the chain that already loads the DLMM client: its package's module build does not
 * load under plain Node, so this module stays importable anywhere.
 */
const programs = (dlmm: Idl): ReadonlyMap<string, Program> =>
  new Map(
    ([
      [DynamicBondingCurveIdl as unknown as Idl, EXECUTOR_INSTRUCTIONS.dbc],
      [CpAmmIdl as unknown as Idl, EXECUTOR_INSTRUCTIONS.damm],
      [dlmm, EXECUTOR_INSTRUCTIONS.dlmm],
    ] as const).map(([idl, names]) => [idl.address, { idl, allowed: new Set(names) }]),
  );

const ATA = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const COMPUTE = ComputeBudgetProgram.programId.toBase58();
/** The largest swap the executor signs: the DLMM pool's proof is a cent; a tenth of a dollar is its ceiling. */
export const PROOF_SWAP_MAX_RAW = 100_000n;
/** The compute budget it signs: at most the network's limit of units, and a priority price no higher than this (µlamports). */
export const COMPUTE_UNIT_PRICE_MAX = 1_000_000n;
const COMPUTE_UNIT_LIMIT_MAX = 1_400_000;

/** Why a transaction is not the executor's to sign; null when it is. */
export function executorSigningRefusal(instructions: readonly TransactionInstruction[], executor: string, dlmm: Idl, payees: readonly string[] = []): string | null {
  const self = new PublicKey(executor);
  const wallets = [self, ...payees.map((payee) => new PublicKey(payee))];
  const PROGRAMS = programs(dlmm);
  for (const [index, ix] of instructions.entries()) {
    const program = ix.programId.toBase58();
    if (program === COMPUTE) {
      /* SetComputeUnitLimit (2, u32) and SetComputeUnitPrice (3, u64) only — and bounded, so a priority price can never drain the wallet. */
      const kind = ix.data[0];
      if (kind === 2 && ix.data.length >= 5 && ix.data.readUInt32LE(1) <= COMPUTE_UNIT_LIMIT_MAX) continue;
      if (kind === 3 && ix.data.length >= 9 && ix.data.readBigUInt64LE(1) <= COMPUTE_UNIT_PRICE_MAX) continue;
      return `instruction ${index}: a compute-budget instruction off the executor's bounds`;
    }
    if (program === ATA) {
      /* Only the opening of the executor's own account: Create (no data or 0) and CreateIdempotent (1), owner key 2. */
      const kind = ix.data.length === 0 ? 0 : ix.data[0];
      if (kind !== 0 && kind !== 1) return `instruction ${index}: an associated-token instruction other than opening an account`;
      if (!ix.keys[2]?.pubkey.equals(self)) return `instruction ${index}: opens a token account of another wallet`;
      continue;
    }
    const known = PROGRAMS.get(program);
    if (!known) return `instruction ${index}: program ${program} is not on the executor's list`;
    const head = [...ix.data.subarray(0, 8)];
    const shape = known.idl.instructions.find((entry) => entry.discriminator.length === 8 && entry.discriminator.every((byte, at) => byte === head[at]));
    if (!shape || !known.allowed.has(shape.name)) return `instruction ${index}: ${shape?.name ?? "an unknown instruction"} is not on the executor's list`;
    const at = (name: string) => {
      const position = shape.accounts.findIndex((account) => account.name === name);
      return position >= 0 ? ix.keys[position]?.pubkey ?? null : null;
    };
    const mints = shape.accounts.filter((account) => MINTS.test(account.name)).map((account) => at(account.name)).filter((key): key is PublicKey => key !== null);
    const own = new Set(
      mints.flatMap((mint) => wallets.flatMap((wallet) => [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((tokenProgram) => getAssociatedTokenAddressSync(mint, wallet, true, tokenProgram).toBase58()))),
    );
    if (shape.name === "swap") {
      /* The pool's proof: the first amount the swap names (its amount in) within the ceiling, and no referral account. */
      const amountIn = ix.data.length >= 16 ? ix.data.readBigUInt64LE(8) : null;
      if (amountIn === null || amountIn > PROOF_SWAP_MAX_RAW) return `instruction ${index}: a swap above the proof's ceiling`;
      const referral = at("referral_token_account");
      if (referral && !referral.equals(ix.programId)) return `instruction ${index}: a swap that pays a referral account`;
    }
    for (const account of shape.accounts) {
      const key = at(account.name);
      /* An optional account left out is the program itself. */
      if (!key || key.equals(ix.programId)) continue;
      if (RECEIVERS.has(account.name) && !own.has(key.toBase58())) return `instruction ${index}: ${shape.name} pays into ${account.name} ${key.toBase58()}, not the executor's own`;
      if (SELF.has(account.name) && !key.equals(self)) return `instruction ${index}: ${shape.name} names ${account.name} ${key.toBase58()}, not the executor`;
    }
  }
  return null;
}

export class SigningRefused extends Error {
  constructor(reason: string) {
    super(`The executor refuses to sign: ${reason}.`);
    this.name = "SigningRefused";
  }
}

/** Throws unless every instruction is one the executor may sign. */
export function assertExecutorSignable(instructions: readonly TransactionInstruction[], executor: string, dlmm: Idl, payees: readonly string[] = []): void {
  const refusal = executorSigningRefusal(instructions, executor, dlmm, payees);
  if (refusal) throw new SigningRefused(refusal);
}
