import type { ResolvedSession } from "./rpc";

/** A removed link cannot remain a customer identity through an older cookie. */
export function walletSessionBound(session: Pick<ResolvedSession, "kind" | "method" | "walletChain" | "walletAddress" | "account">): boolean {
  if (session.kind !== "customer") return false;
  if (session.method !== "solana_siws") return true;
  return session.walletChain === "solana" && Boolean(session.walletAddress)
    && (session.account?.wallets.some((w) => w.chain === "solana" && w.address === session.walletAddress) ?? false);
}
