/**
 * A launch that reached a DEX earns its creator the growth module's points —
 * the call into `lib/rewards` (`recordLaunchGraduation`), its names and
 * arguments unchanged. Called wherever the chain is read and shows the curve
 * graduated: the token's market and the creator's cabinet. Once per mint: the
 * rewards side claims the mint first, and a process remembers what it asked.
 */

import type { GuardStore } from "../guard/store.ts";
import { recordLaunchGraduation } from "../rewards/rank-store.ts";
import type { LaunchRecord } from "./flow.server.ts";

const NOTED = new Set<string>();

/** The moment is the curve's own `finish_curve_timestamp` (unix seconds) — when it was filled for the DEX. */
export async function noteGraduation(store: GuardStore, record: Pick<LaunchRecord, "cluster" | "token" | "creator">, graduatedAt: number | null, now: Date): Promise<void> {
  const key = `${record.cluster}:${record.token}`;
  if (graduatedAt === null || graduatedAt <= 0 || NOTED.has(key)) return;
  const outcome = await recordLaunchGraduation(store, { creator: record.creator, mint: record.token, graduatedAt: new Date(graduatedAt * 1000).toISOString(), now: now.toISOString() });
  /* A write that failed is asked again on the next read; one recorded or found is done. */
  if (outcome.state !== "SKIPPED") NOTED.add(key);
}
