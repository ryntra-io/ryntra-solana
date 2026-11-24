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
/* Given 18.11.2026 — «Так, відкривай». */
export const DLMM_PRO_LAUNCH_OWNER_WORD = true;

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

/**
 * The reward for a launch's pool liquidity — a part of the creator's supply paid to the liquidity at the
 * price. Closed until the rehearsal of the lead session on a mainnet fork or devnet: a deployment opens it with
 * `RYNTRA_POOL_LAUNCH_REWARDS=open` (the terminal's step shows with `NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS=open`), and
 * on mainnet it stays closed besides until this constant is true. A launch begun with a reward is finished with it,
 * whatever the switch says later: its terms are its record's.
 */
export const DLMM_PRO_LAUNCH_REWARD_MAINNET = false;
export const DLMM_PRO_LAUNCH_REWARD_ENV = "RYNTRA_POOL_LAUNCH_REWARDS";

/** Whether a new launch may ask for the reward here: the deployment's switch, and on mainnet the constant too. */
export function dlmmProLaunchRewardOpenFor(network: ClusterOf, env: Readonly<Record<string, string | undefined>> | null | undefined, mainnetWord: boolean = DLMM_PRO_LAUNCH_REWARD_MAINNET): boolean {
  if (env?.[DLMM_PRO_LAUNCH_REWARD_ENV] !== "open") return false;
  if (clusterOf(network) === "devnet") return true;
  return mainnetWord === true;
}
