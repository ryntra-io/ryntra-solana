/**
 * CITY-174 — the agent's trade: one venue instruction, wrapped in the person's policy, in a transaction the agent alone
 * signs and pays for.
 *
 * Every trade carries what CITY-136 measured it needs (report §4, §8): a compute limit of 1.4 million units and a heap
 * of 256 KB — the smart account's allocator gives 32 KB without asking, and a three-hop Jupiter route needs more. The
 * venue instruction moves the vault's budget; the program signs for the vault only inside the policy's bounds.
 */

import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { receivedAtLeastInstruction, tradeTerms } from "./result.ts";
import { policyExecuteInstruction } from "./ssa.ts";
import { constraintIndexFor } from "./terms.ts";
import { afterTransferFee, type Coin } from "./token-2022.ts";
import type { Mandate } from "./human.ts";

export const AGENT_COMPUTE_UNIT_LIMIT = 1_400_000;
export const AGENT_HEAP_BYTES = 256 * 1024;
/** The most the agent pays to be first, in lamports, at the full compute limit — Ryntra's swap ceiling (0.0003 SOL). */
export const AGENT_PRIORITY_FEE_CEILING_LAMPORTS = 300_000n;
/** The compute-unit price that ceiling allows at the full limit, in micro-lamports. */
export const AGENT_UNIT_PRICE_MAX = (AGENT_PRIORITY_FEE_CEILING_LAMPORTS * 1_000_000n) / BigInt(AGENT_COMPUTE_UNIT_LIMIT);

/**
 * The trade's instructions, in order: the compute budget, the setup the venue asked for (token accounts the agent opens
 * and pays for), the venue instruction inside the policy — after Ryntra's fee transfer where the venue does not carry the
 * fee itself (devnet, `./fee.ts`) — and the rule that the money reached the person (`./result.ts`): her account holds
 * `holding` — what it held before — plus the trade's minimum, or nothing happened. A coin bought that withholds a
 * transfer fee (CITY-184, `transferFee`) reaches her less that fee on each transfer, at the epoch's rate: the rule asks
 * what is left.
 */
export function agentTradeInstructions(
  input: Readonly<{
    mandate: Mandate;
    venueInstruction: TransactionInstruction;
    holding: bigint;
    fee?: TransactionInstruction | undefined;
    setup?: readonly TransactionInstruction[];
    unitPriceMicroLamports?: bigint;
    transferFee?: Readonly<{ coin: Pick<Coin, "transferFee">; epoch: bigint }> | undefined;
  }>,
): readonly TransactionInstruction[] {
  const { mandate, venueInstruction } = input;
  const index = constraintIndexFor(mandate.terms.venue, venueInstruction.programId, venueInstruction.data);
  if (index === null) throw new Error("The venue instruction is not one the mandate allows.");
  const inner = input.fee ? [input.fee, venueInstruction] : [venueInstruction];
  const indices = inner.map((instruction) => constraintIndexFor(mandate.terms.venue, instruction.programId, instruction.data));
  if (indices.some((at) => at === null)) throw new Error("The fee instruction is not one the mandate allows.");
  const terms = tradeTerms({ programId: venueInstruction.programId, accounts: venueInstruction.keys.map((key) => key.pubkey), data: venueInstruction.data });
  if (!terms || terms.minOut <= 0n) throw new Error("The venue instruction names no minimum for the person.");
  const price = input.unitPriceMicroLamports ?? 0n;
  if (price < 0n || price > AGENT_UNIT_PRICE_MAX) throw new Error("The priority fee is above the agent's ceiling.");
  const withheld = input.transferFee;
  const reaches = withheld ? afterTransferFee(terms.minOut, withheld.coin, withheld.epoch) : terms.minOut;
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: AGENT_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.requestHeapFrame({ bytes: AGENT_HEAP_BYTES }),
    ...(price > 0n ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })] : []),
    ...(input.setup ?? []),
    policyExecuteInstruction({ policy: mandate.policy, signer: mandate.terms.agent, instructions: inner, constraintIndices: indices as number[] }),
    receivedAtLeastInstruction(terms.receiver, input.holding + reaches),
  ];
}

/** A venue's instruction as JSON from an API: program, accounts with flags, base64 data. */
export type ApiInstruction = Readonly<{ programId: string; accounts: readonly Readonly<{ pubkey: string; isSigner: boolean; isWritable: boolean }>[]; data: string }>;

export function apiInstruction(entry: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(entry.programId),
    keys: entry.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })),
    data: Buffer.from(entry.data, "base64"),
  });
}
