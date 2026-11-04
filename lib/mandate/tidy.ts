/**
 * CITY-195 — tidying up after the agent's sales and at her stop, inside a transaction the person signs anyway: never a
 * signature of its own (CITY-187 report §5, rows 2 and 3).
 *
 * - **Sold sales' mandates removed.** A sale's mandate stands on chain until its day ends, and its rent (≈ 0.008 SOL)
 *   sits in it. Only she can remove it; her next signature does, and the rent comes back to her wallet.
 * - **Accounts of her vault closed.** The vault's account of a coin the agent no longer routes through: whatever coin a
 *   sale left in it (its mandate never landed, or it did not sell) home to her first, then closed — its rent back to her.
 * - **Her wSOL unwrapped.** What her sales paid lands as wrapped SOL in her own account; closing it puts all of it in her
 *   wallet as SOL, rent too. Never while a sale may still pay into it — the sale's mandate pins that very account.
 *
 * Pure: the plan and what fits. What stands on chain is read by `./sale.server.ts` (`readTidy`).
 */

import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createHarvestWithheldTokensToMintInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { fits } from "./human.ts";
import { ownerExecuteInstruction, settingsSyncInstruction } from "./ssa.ts";

/**
 * A vault's empty token account, under its coin's program. `withheld` — the coin's mint, when the coin withholds a fee on
 * transfers (CITY-184): what the account withheld is swept to the mint first, or the program would not close it.
 */
export type EmptyAccount = Readonly<{
  account: PublicKey;
  program: PublicKey;
  withheld?: PublicKey;
  /**
   * Coin left in it — a sale whose mandate never landed, or one that did not sell: it goes home to her account first, then
   * the account closes. Absent — the account is empty.
   */
  left?: Readonly<{ mint: PublicKey; amount: bigint; decimals: number; to: PublicKey }>;
}>;

export type Tidy = Readonly<{
  /** Mandates of hers to remove: sold sales'. */
  policies: readonly PublicKey[];
  /** The vault's empty accounts to close. */
  empty: readonly EmptyAccount[];
  /** Her own wSOL account to close into her wallet; null — leave it. */
  unwrap: PublicKey | null;
}>;

export const NO_TIDY: Tidy = Object.freeze({ policies: [], empty: [], unwrap: null });

export const tidyIsEmpty = (tidy: Tidy): boolean => !tidy.policies.length && !tidy.empty.length && !tidy.unwrap;

type Owner = Readonly<{ human: PublicKey; settings: PublicKey; vault: PublicKey }>;

/** The mandates removed at once, in one settings change: each one's rent back to her, the rent payer. */
export function removeInstruction(owner: Owner, policies: readonly PublicKey[]): TransactionInstruction | null {
  if (!policies.length) return null;
  return settingsSyncInstruction({
    settings: owner.settings,
    rentPayer: owner.human,
    signers: [owner.human],
    policyAccounts: policies,
    actions: policies.map((policy) => ({ kind: "policyRemove" as const, policy })),
  });
}

/** The tidying's instructions, in order: the mandates removed, the vault's empty accounts closed, her wSOL unwrapped. */
export function planTidy(owner: Owner, tidy: Tidy): readonly TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  const remove = removeInstruction(owner, tidy.policies);
  if (remove) out.push(remove);
  if (tidy.empty.length) {
    /* Anyone may sweep a withheld fee to its mint: nothing moves to anyone, and the account can close. */
    /* Her account of a coin left behind, opened if she closed it (idempotent: nothing happens when it stands). */
    for (const { program, left } of tidy.empty) if (left) out.push(createAssociatedTokenAccountIdempotentInstruction(owner.human, left.to, owner.human, left.mint, program));
    /* The coin home before the sweep: what its own transfer withholds is swept with the rest. */
    const home = tidy.empty.flatMap(({ account, program, left }) => (left ? [createTransferCheckedInstruction(account, left.mint, left.to, owner.vault, left.amount, left.decimals, [], program)] : []));
    const closes = tidy.empty.map(({ account, program }) => createCloseAccountInstruction(account, owner.human, owner.vault, [], program));
    const sweeps = tidy.empty.flatMap(({ account, program, withheld }) => (withheld ? [createHarvestWithheldTokensToMintInstruction(withheld, [account], program)] : []));
    if (home.length) out.push(ownerExecuteInstruction({ settings: owner.settings, signer: owner.human, instructions: home }));
    out.push(...sweeps);
    out.push(ownerExecuteInstruction({ settings: owner.settings, signer: owner.human, instructions: closes }));
  }
  /* Her own account, she its owner: no smart account in the way. All of it — the sales' SOL and the rent — to her wallet. */
  if (tidy.unwrap) out.push(createCloseAccountInstruction(tidy.unwrap, owner.human, owner.human));
  return out;
}

/** The same tidying, a step smaller: her wSOL first, then the empty accounts, then one mandate at a time. */
function smaller(tidy: Tidy): Tidy | null {
  if (tidy.unwrap) return { ...tidy, unwrap: null };
  if (tidy.empty.length) return { ...tidy, empty: tidy.empty.slice(0, -1) };
  if (tidy.policies.length) return { ...tidy, policies: tidy.policies.slice(0, -1) };
  return null;
}

/**
 * Her transactions with as much of the tidying as fits: added to the end of the first transaction it fits in, within the
 * packet ceiling — never a transaction more, so never a signature more. What fits nowhere waits for her next signature.
 */
export function withTidy(owner: Owner, transactions: readonly (readonly TransactionInstruction[])[], tidy: Tidy): Readonly<{ transactions: readonly (readonly TransactionInstruction[])[]; tidied: Tidy }> {
  for (let left: Tidy | null = tidy; left && !tidyIsEmpty(left); left = smaller(left)) {
    const extra = planTidy(owner, left);
    for (const [at, instructions] of transactions.entries()) {
      const grown = [...instructions, ...extra];
      if (fits(owner.human, grown)) return { transactions: transactions.map((tx, index) => (index === at ? grown : tx)), tidied: left };
    }
  }
  return { transactions, tidied: NO_TIDY };
}
