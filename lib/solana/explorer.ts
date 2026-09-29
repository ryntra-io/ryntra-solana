/**
 * Explorer links, in one place, spelled per network.
 *
 * A link to the wrong cluster looks exactly like a link to the right one until
 * it is clicked and shows an empty account — which is worse than no link,
 * because an empty explorer page reads as "this address holds nothing" rather
 * than as "you are looking at the wrong network". This workspace has already
 * shipped both halves of that mistake: a shell that pinned every address to
 * devnet on behalf of one surface, and a Send console that spells its cluster
 * inline.
 *
 * `explorer.solana.com` defaults to mainnet-beta with no query at all, so the
 * mainnet form is deliberately bare rather than carrying `?cluster=mainnet` —
 * a link people copy out of the product should be the plain canonical one.
 */

import type { SolanaNetwork } from "./rpc.ts";

const BASE = "https://explorer.solana.com";

function suffix(network: SolanaNetwork): string {
  return network === "mainnet" ? "" : `?cluster=${network}`;
}

/** An account, a wallet or a mint — the explorer routes all three here. */
export function explorerAddressUrl(network: SolanaNetwork, address: string): string {
  return `${BASE}/address/${address}${suffix(network)}`;
}

export function explorerTxUrl(network: SolanaNetwork, signature: string): string {
  return `${BASE}/tx/${signature}${suffix(network)}`;
}
