import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import { listAllPointsEntries, listPointsEntries } from "../points/ledger.ts";
import type { BusinessReferralEdge, BusinessScope, SourceState } from "./business.ts";
import { resolveInternalWallets } from "./internal-wallets.ts";
import { projectPointsLedger, projectPointsTable, type PointsLedgerRow, type PointsSort, type PointsTableModel } from "./points.ts";
import { listWalletPresence } from "./wallet-presence.ts";

/**
 * The store reads behind the admin Points table, and nothing else.
 *
 * Every collection is scanned whole, as the business model's reads are, and
 * for the same written-down reason. A collection that fails to read reports
 * `unavailable`; nothing here throws into a route.
 */

const EdgeSchema = z
  .object({
    referrer: z.string().min(32).max(64),
    wallet: z.string().min(32).max(64),
    level: z.number().int().min(1).max(2),
    at: z.string().datetime({ offset: true }),
  })
  .passthrough();

export type PointsTableRead = Readonly<{
  model: PointsTableModel;
  sources: Readonly<{ points: SourceState; presence: SourceState; referrals: SourceState }>;
}>;

export async function readPointsTable(
  store: GuardStore,
  args: Readonly<{ now: string; scope: BusinessScope; sort: PointsSort; env: NodeJS.ProcessEnv }>,
): Promise<PointsTableRead> {
  const [entries, presence, edges, internal] = await Promise.all([
    listAllPointsEntries(store).then(
      (rows) => ({ status: "measured" as const, rows }),
      () => ({ status: "unavailable" as const, rows: [] }),
    ),
    listWalletPresence(store),
    store
      .collection<unknown>("rewardReferralEdges")
      .valuesWithPrefix("")
      .then(
        (rows) => ({
          status: "measured" as const,
          rows: rows.flatMap((row): BusinessReferralEdge[] => {
            const parsed = EdgeSchema.safeParse(row);
            return parsed.success ? [{ referrer: parsed.data.referrer, wallet: parsed.data.wallet, level: parsed.data.level, at: parsed.data.at }] : [];
          }),
        }),
        () => ({ status: "unavailable" as const, rows: [] as BusinessReferralEdge[] }),
      ),
    resolveInternalWallets(store, args.env),
  ]);
  const model = projectPointsTable({
    now: args.now,
    scope: args.scope,
    sort: args.sort,
    entries: entries.rows,
    presence: presence.status === "measured" ? presence.rows : [],
    edges: edges.rows,
    internalWallets: internal.wallets,
  });
  return {
    model,
    sources: { points: entries.status, presence: presence.status, referrals: edges.status },
  };
}

/** One wallet's ledger for the audit disclosure. */
export async function readPointsLedger(store: GuardStore, wallet: string): Promise<readonly PointsLedgerRow[]> {
  return projectPointsLedger(await listPointsEntries(store, wallet));
}
