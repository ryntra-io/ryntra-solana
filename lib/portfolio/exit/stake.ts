/**
 * A native stake account's step of an exit, built from the stake program's own instructions:
 *
 * - `withdraw` — every lamport of an account that is not delegated, or whose deactivation epoch has passed, to the
 *   wallet: the stake and the rent reserve with it, the account gone;
 * - `deactivate` — an active stake deactivated: its lamports are free to withdraw from the next epoch.
 *
 * The wallet is the payer and the only signer. Pure: the blockhash and the account's lamports are handed in.
 */

import { ComputeBudgetProgram, PublicKey, StakeProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/** What a stake step is given to run in, and its priority: a fraction of a cent. */
export const STAKE_UNITS = 20_000;
export const STAKE_UNIT_PRICE = 20_000;

export type StakeOp = "withdraw" | "deactivate";

export function stakeWire(input: Readonly<{ op: StakeOp; owner: string; account: string; lamports: bigint; blockhash: string }>): string {
  const owner = new PublicKey(input.owner);
  const stakePubkey = new PublicKey(input.account);
  const built =
    input.op === "withdraw"
      ? StakeProgram.withdraw({ stakePubkey, authorizedPubkey: owner, toPubkey: owner, lamports: Number(input.lamports) })
      : StakeProgram.deactivate({ stakePubkey, authorizedPubkey: owner });
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: STAKE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: STAKE_UNIT_PRICE }), ...built.instructions];
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: input.blockhash, instructions }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}
