import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import { rewardsActivation } from "../rewards/activation.ts";
import { RewardEntrySchema, type RewardEntry } from "../rewards/model.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import {
  projectBusiness,
  type BusinessInputs,
  type BusinessModel,
  type BusinessOrderRef,
  type BusinessRange,
  type BusinessReferralEdge,
  type BusinessScope,
  type SourceState,
} from "./business.ts";
import { resolveInternalWallets } from "./internal-wallets.ts";
import { listWalletPresence } from "./wallet-presence.ts";

/**
 * The store reads behind the business model, and nothing else.
 *
 * Every collection is scanned whole. That is right at this product's volume
 * and is written down here so it is not mistaken for a design: the Guard port
 * has one scan, `valuesWithPrefix`, and the day these collections hold tens of
 * thousands of rows the read moves to a periodic rollup rather than growing a
 * timeout. A collection that fails to read reports `unavailable` for the
 * figures that depend on it; nothing here throws into a route.
 */

const OrderRefSchema = z
  .object({
    intentDigest: z.string().min(3),
    provider: z.enum(["MAYAN", "RELAY"]),
  })
  .passthrough();

const EdgeSchema = z
  .object({
    referrer: z.string().min(32).max(64),
    wallet: z.string().min(32).max(64),
    level: z.number().int().min(1).max(2),
    at: z.string().datetime({ offset: true }),
  })
  .passthrough();

async function scan<T>(
  store: GuardStore,
  collection: Parameters<GuardStore["collection"]>[0],
  prefix: string,
  parse: (row: unknown) => T | null,
): Promise<Readonly<{ status: SourceState; rows: readonly T[] }>> {
  try {
    const raw = await store.collection<unknown>(collection).valuesWithPrefix(prefix);
    const rows: T[] = [];
    for (const row of raw) {
      const parsed = parse(row);
      if (parsed !== null) rows.push(parsed);
    }
    return { status: "measured", rows };
  } catch {
    return { status: "unavailable", rows: [] };
  }
}

const parseWith =
  <T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }) =>
  (row: unknown): T | null => {
    const parsed = schema.safeParse(row);
    return parsed.success ? parsed.data : null;
  };

export async function readBusinessInputs(
  store: GuardStore,
  args: Readonly<{ now: string; range: BusinessRange; scope: BusinessScope; env: NodeJS.ProcessEnv }>,
): Promise<BusinessInputs> {
  const [actions, orders, rewards, edges, presence, internal] = await Promise.all([
    scan<SolanaWalletAction>(store, "solanaWalletActions", "solana:mainnet:", parseWith(SolanaWalletActionSchema)),
    scan<BusinessOrderRef>(store, "solanaCrossSwapOrders", "", (row) => {
      const parsed = OrderRefSchema.safeParse(row);
      return parsed.success ? { intentDigest: parsed.data.intentDigest, provider: parsed.data.provider } : null;
    }),
    scan<RewardEntry>(store, "rewardEntries", "", parseWith(RewardEntrySchema)),
    scan<BusinessReferralEdge>(store, "rewardReferralEdges", "", (row) => {
      const parsed = EdgeSchema.safeParse(row);
      return parsed.success ? { referrer: parsed.data.referrer, wallet: parsed.data.wallet, level: parsed.data.level, at: parsed.data.at } : null;
    }),
    listWalletPresence(store),
    resolveInternalWallets(store, args.env),
  ]);
  const activation = rewardsActivation(args.env);
  return {
    now: args.now,
    range: args.range,
    scope: args.scope,
    actions: actions.rows,
    orders: orders.rows,
    rewards: rewards.rows,
    edges: edges.rows,
    presence: presence.status === "measured" ? presence.rows : [],
    internalWallets: internal.wallets,
    sources: {
      actions: actions.status,
      rewards: rewards.status === "measured" && edges.status === "measured" ? "measured" : "unavailable",
      /* An empty presence collection is a measured zero: the writers ship with
         this route, so "nobody has connected yet" is a fact rather than a gap. */
      presence: presence.status,
    },
    rewardsSince: activation.state === "OPEN" ? activation.at : null,
  };
}

export async function readBusinessModel(
  store: GuardStore,
  args: Readonly<{ now?: string; range: BusinessRange; scope: BusinessScope; env?: NodeJS.ProcessEnv }>,
): Promise<BusinessModel> {
  const inputs = await readBusinessInputs(store, {
    now: args.now ?? new Date().toISOString(),
    range: args.range,
    scope: args.scope,
    env: args.env ?? process.env,
  });
  return projectBusiness(inputs);
}
