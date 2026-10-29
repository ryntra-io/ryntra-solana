import { walletClusters } from "../growth/cluster-check.server.ts";
import { protectDeps } from "../growth/protect-deps.server.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { judgeCityTrade, NO_CLUSTER_CHECK, type CityTrade, type TradeJudgement, type WalletClusters } from "./honest-count.ts";

/**
 * The city's wallet clusters on the server: the Growth line's answer (`lib/growth/cluster-check.server.ts`) over the
 * same store, signal key and chain readers the protection run uses, so no second system is started.
 *
 * Without a signal key in the deployment there is nothing to compare hashes with: the city falls back to
 * `NO_CLUSTER_CHECK`, which counts nothing that names a party — never a guess that two wallets are separate.
 */
let clusters: WalletClusters | null = null;

export function cityWalletClusters(env: Readonly<Record<string, string | undefined>> = process.env): WalletClusters {
  if (clusters) return clusters;
  const store = getGuardRuntime().store;
  const deps = protectDeps(store, { env });
  if (!deps) return NO_CLUSTER_CHECK;
  clusters = walletClusters({ store, key: deps.key, funding: deps.funding, transfers: deps.transfers });
  return clusters;
}

/** One trade judged by the city with the real cluster check: what the world records as its honest-count mark. */
export function judgeCityTradeOnServer(trade: CityTrade): Promise<TradeJudgement> {
  return judgeCityTrade(trade, cityWalletClusters());
}
