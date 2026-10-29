import { jsonRpc } from "../growth/pool-share-read.server.ts";
import { readFunding, readTransfers } from "../growth/protect-chain.server.ts";
import { PROTECT_SOLANA_RPC } from "../growth/protect-deps.server.ts";
import { signalKeyFrom } from "../growth/protect.ts";
import type { FirstTenCheckDeps } from "./first-ten.ts";

/**
 * The production reads of the «First $10 back» check: the same public node and the same funding and transfer reads
 * as the Network's protection, and the same signal key. Null without the key — the check then waits, and nothing
 * that would need a hash is kept.
 */
export function firstTenCheckDeps(env: Readonly<Record<string, string | undefined>> = process.env): FirstTenCheckDeps | null {
  const key = signalKeyFrom(env);
  if (!key) return null;
  const rpc = jsonRpc(PROTECT_SOLANA_RPC, { attempts: 4 });
  return { key, funding: (wallet) => readFunding(rpc, wallet), transfers: (wallet, since) => readTransfers(rpc, wallet, since) };
}
