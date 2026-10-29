/**
 * What the early-access routes need (SOL-L5), from the same configuration as every Launch route (`runtime.server.ts`):
 *
 * - `earlyAccessDeps` — building and sending a creation: the Launch lane open, this deployment writing launches on its
 *   network (a mainnet preview or a local server makes none: the mint names metadata only production serves), and on
 *   mainnet a store every instance shares. No key of Ryntra's: the creator's wallet pays and signs everything.
 * - `earlyAccessTradingDeps` — a person's deposit: the lane open; the person's wallet signs and pays.
 * - `earlyAccessReadDeps` — the token page's view: no key, no switch.
 *
 * Whether early access itself is open is the flow's
 * own check (`earlyAccessOpenFor`), asked by every build.
 */

import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances } from "../guard/store.ts";
import { launchArchiveConnection, launchConnection, launchNetwork, launchOpen, launchWritesHere } from "./config.server.ts";
import type { EarlyAccessDeps } from "./early-access.server.ts";

export function earlyAccessDeps(): EarlyAccessDeps | null {
  const network = launchNetwork();
  if (!network || !launchOpen() || !launchWritesHere(network)) return null;
  const store = getGuardRuntime().store;
  if (network.cluster === "mainnet" && !storeSupportsConcurrentInstances(store)) return null;
  return { network, connection: launchConnection(network), store, now: () => new Date(), env: process.env, origin: network.origin, second: launchArchiveConnection(network) };
}

export function earlyAccessTradingDeps(): EarlyAccessDeps | null {
  const network = launchNetwork();
  if (!network || !launchOpen()) return null;
  return { network, connection: launchConnection(network), store: getGuardRuntime().store, now: () => new Date(), env: process.env, origin: network.origin, second: launchArchiveConnection(network) };
}

export function earlyAccessReadDeps(): Pick<EarlyAccessDeps, "network" | "connection" | "store" | "now"> | null {
  const network = launchNetwork();
  if (!network) return null;
  return { network, connection: launchConnection(network), store: getGuardRuntime().store, now: () => new Date() };
}
