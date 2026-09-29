/**
 * The chain and catalogue reads behind the v1 payment-link routes — the ones
 * the web's `/api/pay/requests` makes, with its timeouts. Server only.
 */

import { fetchTokenCatalog } from "../solana/catalog.ts";
import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import type { GuardStore } from "../guard/store.ts";
import type { PayLinkDeps } from "./links.server.ts";

export function payLinkDeps(store: GuardStore): PayLinkDeps {
  return {
    store,
    readMint: async (mint) => {
      const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 1 });
      const read = await readMintAccount(handle, mint);
      return read.ok ? { ok: true, decimals: read.decoded.decimals } : { ok: false, reason: read.reason, unavailable: read.code === "RPC_FAILED" };
    },
    symbolOf: async (mint) => {
      const catalog = await fetchTokenCatalog([mint], 2_500).catch(() => null);
      return catalog?.ok ? (catalog.byMint[mint]?.symbol ?? null) : null;
    },
  };
}
