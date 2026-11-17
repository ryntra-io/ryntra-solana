/**
 * What the routes of a launch into a pool need, from the same configuration as every Launch route
 * (`runtime.server.ts`):
 *
 * - `dlmmProLaunchDeps` — building and sending a step: the Launch lane open, this deployment writing launches on its
 *   network (a mainnet preview or a local server makes none: the mint names metadata only production serves), and on
 *   mainnet a store every instance shares. No key of Ryntra's: the creator's wallet pays and signs everything.
 * - `dlmmProLaunchReadDeps` — a tower's view and the list: no key, no switch; a view writes what the chain shows
 *   landed only where this deployment writes launches.
 *
 * Whether the format itself is open is the flow's own check
 * (`dlmmProLaunchOpenFor`), asked by every build and every send. The pool comes from a launch pool: the path through
 * Ryntra's dynamic config is not wired here at all — it has no config and no signer to be wired with (D-M1).
 */

import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances } from "../guard/store.ts";
import { launchArchiveConnection, launchConnection, launchNetwork, launchOpen, launchWritesHere } from "../launch/config.server.ts";
import type { DlmmProLaunchDeps } from "./engine.server.ts";

export function dlmmProLaunchDeps(): DlmmProLaunchDeps | null {
  const network = launchNetwork();
  if (!network || !launchOpen() || !launchWritesHere(network)) return null;
  const store = getGuardRuntime().store;
  if (network.cluster === "mainnet" && !storeSupportsConcurrentInstances(store)) return null;
  return { network, connection: launchConnection(network), store, now: () => new Date(), env: process.env, origin: network.origin, second: launchArchiveConnection(network) };
}

export function dlmmProLaunchReadDeps(): Pick<DlmmProLaunchDeps, "network" | "connection" | "store" | "now" | "settle" | "second"> | null {
  const network = launchNetwork();
  if (!network) return null;
  const store = getGuardRuntime().store;
  const writes = launchOpen() && launchWritesHere(network) && (network.cluster !== "mainnet" || storeSupportsConcurrentInstances(store));
  return { network, connection: launchConnection(network), store, now: () => new Date(), settle: writes, second: launchArchiveConnection(network) };
}
