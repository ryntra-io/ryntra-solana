/**
 * What a wallet holds of the tokens the IPO and conversion watch speaks about
 * — read from the chain, one mint at a time, through the product's own RPC
 * handle and its discipline (`lib/solana/rpc.ts`). Every token account of
 * the mint the wallet owns is added up, in raw units; a read that fails is
 * `null`, never zero — the watch says nothing on a read it could not make.
 */

import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import type { HeldReader } from "./issuer-events.ts";

const RAW = /^\d+$/;

/** The raw amounts of a `jsonParsed` token-accounts answer, added up; null for an answer of any other shape. */
export function heldFromParsedAccounts(value: unknown): bigint | null {
  if (!Array.isArray(value)) return null;
  let total = 0n;
  for (const entry of value) {
    const amount = (entry as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } } } })?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string" || !RAW.test(amount)) return null;
    total += BigInt(amount);
  }
  return total;
}

/** The production reader: mainnet, `confirmed`, each mint's accounts owned by the wallet. */
export const readHeldOnChain: HeldReader = async (owner, mints) => {
  /* Short and without a retry: the watch reads again on its next pass, and a slow host must not hold a tick or a bell. */
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 3_000, retries: 0 });
  const held = new Map<string, bigint | null>();
  for (const mint of mints) {
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getTokenAccountsByOwner(owner as never, { mint: mint as never }, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
      );
      held.set(mint, heldFromParsedAccounts((response as { value?: unknown }).value));
    } catch {
      held.set(mint, null);
    }
  }
  return held;
};
