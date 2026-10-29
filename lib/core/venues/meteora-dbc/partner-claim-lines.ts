/**
 * The partner's claims as a multisig's vault signs them (SOL-L1d): what a line of a Squads proposal may hold to be a
 * claim of Ryntra's launch fees into the vault — nothing else.
 *
 * On «Класичний», «Захищений», «Спільнота» and «Розширений» the config's fee claimer is the vault of the partner's
 * Squads multisig: the curve's partner fee, the partner's migration fee, the partner's share of the surplus and the fees
 * of the partner's locked position in the graduated pool are taken only by a vault transaction its members approve.
 * A line is read here instruction by instruction: each one a claim of Meteora's own programs, signed by the vault alone,
 * paying only into the vault's own token accounts of the mints the instruction itself names. A line with anything else
 * — another program, another signer, an account loaded from a lookup table, a destination that is not the vault's —
 * is not a claim, and no page of Ryntra's approves or runs it.
 *
 * Pure: the bytes are handed in.
 */

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { BudgetSource } from "../../launch/budget.ts";

export const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const DAMM_V2_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);

/** Where each claim names its accounts (the programs' IDLs, DBC 1.5 and DAMM v2 1.5). */
type Layout = Readonly<{
  program: string;
  name: string;
  source: BudgetSource;
  /** The data's length exactly: the discriminator and its arguments. */
  dataLength: number;
  pool: number;
  /** The vault, the instruction's only signer. */
  signer: number;
  /** Where it names the launch's own token, when it does (the curve's base mint, the pool's token A); else the curve stands for it. */
  token?: number;
  /** Each account paid into, with the mint and the token program it is of. */
  pays: readonly Readonly<{ account: number; mint: number; program: number }>[];
}>;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export const PARTNER_CLAIM_LAYOUTS: Readonly<Record<string, Layout>> = {
  /* claim_trading_fee: the curve's partner fee, both sides, to token_a (base) and token_b (quote). */
  [hex(Uint8Array.from([8, 236, 89, 49, 152, 125, 177, 81]))]: {
    program: DBC_PROGRAM_ID,
    name: "claim_trading_fee",
    source: "curve",
    dataLength: 8 + 8 + 8,
    pool: 2,
    signer: 9,
    token: 7,
    pays: [
      { account: 3, mint: 7, program: 10 },
      { account: 4, mint: 8, program: 11 },
    ],
  },
  /* withdraw_migration_fee with flag 0: the partner's part of the graduation fee. */
  [hex(Uint8Array.from([237, 142, 45, 23, 129, 6, 222, 162]))]: {
    program: DBC_PROGRAM_ID,
    name: "withdraw_migration_fee",
    source: "migration",
    dataLength: 8 + 1,
    pool: 2,
    signer: 6,
    pays: [{ account: 3, mint: 5, program: 7 }],
  },
  /* partner_withdraw_surplus: the partner's share of what the last purchase raised above the threshold. */
  [hex(Uint8Array.from([168, 173, 72, 100, 201, 98, 38, 92]))]: {
    program: DBC_PROGRAM_ID,
    name: "partner_withdraw_surplus",
    source: "surplus",
    dataLength: 8,
    pool: 2,
    signer: 6,
    pays: [{ account: 3, mint: 5, program: 7 }],
  },
  /* claim_position_fee: the fees of a position the vault holds — only its fee moves, the position stays locked. */
  [hex(Uint8Array.from([180, 38, 154, 17, 133, 33, 162, 211]))]: {
    program: DAMM_V2_PROGRAM_ID,
    name: "claim_position_fee",
    source: "lp",
    dataLength: 8,
    pool: 1,
    signer: 10,
    token: 7,
    pays: [
      { account: 3, mint: 7, program: 11 },
      { account: 4, mint: 8, program: 12 },
    ],
  },
};

/** A vault transaction's message as Squads stores it: its keys (signers first), and each instruction by index. */
export type LineMessage = Readonly<{
  numSigners: number;
  accountKeys: readonly PublicKey[];
  instructions: readonly Readonly<{ programIdIndex: number; accountIndexes: ArrayLike<number>; data: ArrayLike<number> }>[];
  addressTableLookups: readonly unknown[];
}>;

export type ClaimLineRead = Readonly<{
  /** Every claim the line makes, in order; empty when the line is not a claim line. */
  /** `launch` — the launch's token where the claim names it, else its curve: a line's claims are one launch's. */
  claims: readonly Readonly<{ name: string; source: BudgetSource; pool: string; launch: string }>[];
  /** The line does something besides claims into the vault: no page of Ryntra's approves or runs it. */
  foreign: boolean;
}>;

/** The vault's own account of `mint` under `program` — the only place a claim line may pay. */
export function vaultTokenAccount(vault: PublicKey, mint: PublicKey, program: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true, program);
}

/**
 * A line read for what the vault does in it: claims only, each of Meteora's programs, the vault the one signer of the
 * whole line (and its payer), and every account a claim pays into the vault's own account of the mint the claim names.
 */
export function readClaimLine(message: LineMessage, vault: PublicKey): ClaimLineRead {
  const foreign = { claims: [], foreign: true } as const;
  const keys = message.accountKeys;
  if (message.addressTableLookups.length > 0) return foreign;
  if (message.numSigners !== 1 || !keys[0]?.equals(vault)) return foreign;
  if (message.instructions.length === 0) return foreign;
  const claims: { name: string; source: BudgetSource; pool: string; launch: string | null }[] = [];
  for (const instruction of message.instructions) {
    const at = (position: number): PublicKey | null => {
      const index = instruction.accountIndexes[position];
      return index === undefined || index >= keys.length ? null : keys[index]!;
    };
    const program = keys[instruction.programIdIndex]?.toBase58() ?? "";
    const data = Uint8Array.from(instruction.data);
    const layout = data.length >= 8 ? PARTNER_CLAIM_LAYOUTS[hex(data.subarray(0, 8))] : undefined;
    if (!layout || layout.program !== program || data.length !== layout.dataLength) return foreign;
    if (Array.from(instruction.accountIndexes).some((index) => index >= keys.length)) return foreign;
    /* The partner's migration fee only: flag 1 is the creator's withdrawal. */
    if (layout.name === "withdraw_migration_fee" && data[8] !== 0) return foreign;
    if (!at(layout.signer)?.equals(vault)) return foreign;
    for (const pay of layout.pays) {
      const account = at(pay.account);
      const mint = at(pay.mint);
      const tokenProgram = at(pay.program);
      if (!account || !mint || !tokenProgram || !TOKEN_PROGRAMS.has(tokenProgram.toBase58())) return foreign;
      if (!account.equals(vaultTokenAccount(vault, mint, tokenProgram))) return foreign;
    }
    const pool = at(layout.pool);
    if (!pool) return foreign;
    claims.push({ name: layout.name, source: layout.source, pool: pool.toBase58(), launch: layout.token === undefined ? null : (at(layout.token)?.toBase58() ?? null) });
  }
  /* A claim that names no token (the DEX launch fee, the surplus) belongs to the launch another claim of the line names. */
  const named = claims.find((claim) => claim.launch !== null)?.launch ?? null;
  return { claims: claims.map((claim) => ({ ...claim, launch: claim.launch ?? named ?? claim.pool })), foreign: false };
}
