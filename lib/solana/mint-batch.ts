/**
 * Many mints in few reads — the stock desk's warm-up, kept apart from
 * `mint.ts` because the public evidence kit ships that file and allows it
 * one RPC method, `getAccountInfo`. This module is the product's own.
 */

import type { MintReadFailure, RawMintAccount } from "./mint.ts";
import type { SolanaRpcHandle } from "./rpc.ts";
import { withRpcDiscipline } from "./rpc.ts";

/**
 * Accounts per `getMultipleAccounts`. The protocol allows a hundred; the
 * public endpoint Ryntra falls back to answers `Request blocked` — after a
 * three-second wait — to anything past about twenty, and the second public
 * endpoint rate-limits the retry. Ten is what every endpoint on the list
 * takes at once; the batches run side by side, so the size costs no time.
 */
export const MINT_BATCH_LIMIT = 10;
const MINT_BATCH_CONCURRENCY = 6;

/**
 * Many mints in as few reads as the endpoints allow — `getMultipleAccounts`,
 * ten at a time, six batches in flight. The stock universe asks for every
 * representation's multiplier on one cold start; three hundred single reads
 * at the public endpoint's pace were most of the seconds a person waited for
 * the list. A mint the chain does not know is a stated failure in its own
 * slot; one failed batch fails only the mints in it, never the ones already
 * read.
 */
export async function fetchRawMintAccounts(handle: SolanaRpcHandle, mints: readonly string[]): Promise<ReadonlyMap<string, RawMintAccount | MintReadFailure>> {
  const out = new Map<string, RawMintAccount | MintReadFailure>();
  const unique = [...new Set(mints)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += MINT_BATCH_LIMIT) batches.push(unique.slice(start, start + MINT_BATCH_LIMIT));
  let next = 0;
  const readBatch = async (batch: readonly string[]): Promise<void> => {
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .getMultipleAccounts(batch as never, { encoding: "base64" })
          .send({ abortSignal }),
      );
      const observedAt = new Date().toISOString();
      const slot = response.context?.slot !== undefined ? String(response.context.slot) : null;
      batch.forEach((mint, index) => {
        const value = response.value[index];
        if (!value) {
          out.set(mint, { ok: false, code: "ACCOUNT_NOT_FOUND", reason: `No account exists at ${mint} on ${handle.network}.` });
          return;
        }
        const [dataBase64] = value.data;
        out.set(mint, { mint, network: handle.network, owner: String(value.owner), dataBase64, observedAt, slot, endpointHost: handle.host() });
      });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : String(failure);
      for (const mint of batch) out.set(mint, { ok: false, code: "RPC_FAILED", reason });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MINT_BATCH_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++;
        await readBatch(batches[index]);
      }
    }),
  );
  return out;
}
