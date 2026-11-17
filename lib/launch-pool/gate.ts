/**
 * Whether a launch straight into a pool on Meteora DLMM Pro may be built here — the surface's own gate.
 *
 * The venue (`lib/core/venues/meteora-dlmm-pro/`) is reached only through this folder: its routes
 * (`app/api/v1/launch/dlmm-pro/**`) call the engine here, and the venue's guard (`sdk.test.mjs`, `SURFACES`) holds that
 * nothing else a person can reach loads it. `./launch-pool.test.mjs` holds this gate closed on mainnet.
 *
 * Pure: no I/O, no clock, no environment.
 */

import type { LaunchCluster, LaunchNetwork } from "../launch/config.server.ts";

/**
 * Whether a launch on DLMM Pro is open to people on mainnet. False: closed, whatever a
 * deployment says; flipped here, with the venue's own gate and the capability registry, when he gives it. The devnet stand is open without it. A constant, not a flag: nothing in a deployment
 * can flip it.
 */
export const DLMM_PRO_LAUNCH_OWNER_WORD = false;

/**
 * Where a launch's pool comes from. `launch` — a launch pool, which anybody holding both coins may make: the
 * protocol keeps a fifth of what liquidity earns and there is no partner. `config` — a pool from Ryntra's dynamic
 * config: the protocol keeps a tenth and Ryntra has the partner's share. The config is Meteora's to give (D-M1, asked
 * 14.11.2026, no answer yet) and its wallet signs every pool made from it. Until both are there this stays `launch`: the other path is built and unreachable.
 */
export const DLMM_PRO_LAUNCH_POOL_SOURCE: "launch" | "config" = "launch";

export type ClusterOf = LaunchCluster | Pick<LaunchNetwork, "cluster">;
export const clusterOf = (network: ClusterOf): LaunchCluster => (typeof network === "string" ? network : network.cluster);

/** Whether a launch on DLMM Pro may be built here: the devnet stand always. */
export function dlmmProLaunchOpenFor(network: ClusterOf, ownerWord: boolean = DLMM_PRO_LAUNCH_OWNER_WORD): boolean {
  if (clusterOf(network) === "devnet") return true;
  return ownerWord === true;
}
