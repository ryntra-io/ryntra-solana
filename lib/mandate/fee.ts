/**
 * CITY-183 — Ryntra's fee on the agent's trades.
 *
 * Nothing new is priced here. The rate is fee policy v2's (`../core/fee-policy.ts`), the very table a person's own swap
 * pays by, read off the pair; the fee lands where a person's lands — the fee wallet the registry names
 * (`../attribution/registry.ts`), its canonical token account of the budget's mint; and it travels by the same lane:
 * Jupiter's platform fee on `/build`, a share of the amount taken by Jupiter's program inside the swap. On devnet, where
 * Jupiter is not deployed, a transfer of that same share to the same account runs in the same execution, just before the
 * pool's swap — the lane a person's Meteora sell already takes.
 *
 * The fee is a share of the trade's amount, never on top of it: the trade cap, the day's cap and the budget count it with
 * the amount, and the person's minimum is what reaches her after it.
 *
 * The agent pays only by the router's lane. A pair whose flow names no fee there — dollar to dollar, a stock sold by RFQ,
 * a side the catalogue could not read — is not an agent trade: decision 91 asks a fee of every trade, and the chain rule
 * (`./terms.ts`) keeps Ryntra's fee account in the fee's place.
 */

import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import { feeWalletOf } from "../attribution/registry.ts";
import { DOLLAR_MINTS, MAJOR_MINTS, type SideFacts } from "../core/fee-policy.ts";
import { TOKEN_PROGRAM_ID } from "./ssa.ts";

/** The product the agent's fees belong to in the registry; its fee wallet is the swap's today. */
export const AGENT_FEE_PRODUCT = "bots" as const;

export { AGENT_FEE_CEILING_BPS, AGENT_FEE_FLOOR_BPS, AGENT_FEE_FLOWS, AGENT_FEE_RATES, agentFeeBps, agentFeeRaw, pairFeeBps, type FeeSides } from "./fee-rates.ts";

/** The registry's fee wallet for the agent's trades. */
export function agentFeeWallet(): PublicKey {
  const owner = feeWalletOf(AGENT_FEE_PRODUCT);
  if (!owner) throw new Error("the registry names no fee wallet for the agent's trades");
  return new PublicKey(owner);
}

/** The fee wallet's canonical token account of the budget's mint — the one account the fee may land in. */
export const agentFeeAccount = (budgetMint: PublicKey): PublicKey => getAssociatedTokenAddressSync(budgetMint, agentFeeWallet(), true);

/**
 * Why Ryntra's fee account of the budget's mint cannot take the fee now; null when it can. As a person's swap checks before
 * it asks for a fee (`feeWalletAccounts`): the account is on chain, a Token account of that mint, the fee wallet's own. An
 * account that is not there would fail the trade on chain at the agent's cost, slot after slot.
 */
export function feeAccountRefusal(info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null, budgetMint: PublicKey): string | null {
  if (!info) return "Ryntra's fee account is not on chain";
  if (!info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < 64) return "Ryntra's fee account is not a token account";
  const data = Buffer.from(info.data);
  if (!data.subarray(0, 32).equals(budgetMint.toBuffer()) || !data.subarray(32, 64).equals(agentFeeWallet().toBuffer())) return "Ryntra's fee account is not the fee wallet's of the budget's mint";
  return null;
}

/**
 * What a side is to the table where no catalogue reads it — devnet's coins: a dollar or a major by its mint, anything else
 * a token nobody verified, which the table calls MEME.
 */
export function uncataloguedFacts(mint: string): SideFacts {
  return { mint, verified: DOLLAR_MINTS.has(mint) || MAJOR_MINTS.has(mint), tags: [], firstPoolAt: null };
}

/* ------------------------------------------------------------------ the devnet lane: a transfer in the same execution */

/** Token's `TransferChecked`. */
const TRANSFER_CHECKED = 12;

/** The fee as its own instruction, the vault paying from the budget's account into Ryntra's. */
export function feeTransferInstruction(input: Readonly<{ budgetMint: PublicKey; budgetAccount: PublicKey; vault: PublicKey; fee: bigint; decimals: number }>): TransactionInstruction {
  if (input.fee <= 0n) throw new Error("the fee is above zero");
  return createTransferCheckedInstruction(input.budgetAccount, input.budgetMint, agentFeeAccount(input.budgetMint), input.vault, input.fee, input.decimals);
}

export type FeeTransfer = Readonly<{ source: PublicKey; mint: PublicKey; destination: PublicKey; authority: PublicKey; amount: bigint }>;

/** A `TransferChecked` read back from its bytes; null for any other instruction. */
export function readFeeTransfer(instruction: Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>): FeeTransfer | null {
  const { programId, accounts, data } = instruction;
  if (!programId.equals(TOKEN_PROGRAM_ID) || data.length !== 10 || data[0] !== TRANSFER_CHECKED || accounts.length !== 4) return null;
  const [source, mint, destination, authority] = accounts as [PublicKey, PublicKey, PublicKey, PublicKey];
  return { source, mint, destination, authority, amount: Buffer.from(data.buffer, data.byteOffset, data.byteLength).readBigUInt64LE(1) };
}

/** The data rule's tag: the instruction is a `TransferChecked`. */
export const FEE_TRANSFER_TAG = TRANSFER_CHECKED;

/**
 * Whether a policy account was written with Ryntra's fee rule: its constraints name the fee account. A mandate the person
 * signed before CITY-183 has none, and the agent no longer trades for it.
 */
export function policyCarriesFee(policyData: Uint8Array, budgetMint: PublicKey): boolean {
  const account = agentFeeAccount(budgetMint).toBytes();
  return Buffer.from(policyData).indexOf(Buffer.from(account)) >= 0;
}
