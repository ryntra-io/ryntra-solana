/**
 * What the chain says a wallet holds — the asset it could supply, and the shares it already has.
 *
 * This is the half of Earn that no provider is asked about. A lending API's view of a wallet is a cache with
 * a timestamp somewhere else; the token account is the fact, and the registry's condition for this row is
 * explicit about it. It also means a provider that is down cannot make a position disappear: the shares are
 * still readable.
 *
 * Every read goes through the product's one RPC path (`lib/solana/rpc.ts`): the configured mainnet pair, its
 * timeout, its byte ceiling, its record of which host answered. Nothing here opens a connection of its own,
 * and nothing here writes. The shape it answers in, and the parsing, are `chain.ts`.
 */

import "server-only";

import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";

import { heldFromParsedAccounts, type EarnChainRead } from "./chain.ts";

/**
 * Several mints in one pass, each on its own request.
 *
 * One request per mint rather than a wallet-wide scan: a lending market's share token and its asset are two
 * known mints, and asking for exactly those is both smaller and the only form the default public endpoint
 * serves without refusing (`rpc.ts` names which endpoint refuses what).
 */
export async function readHeld(owner: string, mints: readonly string[], handle?: SolanaRpcHandle): Promise<EarnChainRead> {
  const rpc = handle ?? createSolanaRpcHandle({ network: "mainnet", timeoutMs: 5_000, retries: 0 });
  const held = new Map<string, bigint | null>();
  for (const mint of [...new Set(mints)]) {
    try {
      const response = await withRpcDiscipline(rpc, (abortSignal) =>
        rpc.rpc.getTokenAccountsByOwner(owner as never, { mint: mint as never }, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
      );
      held.set(mint, heldFromParsedAccounts((response as { value?: unknown }).value));
    } catch {
      held.set(mint, null);
    }
  }
  return { held, host: rpc.host(), readAt: new Date().toISOString() };
}
