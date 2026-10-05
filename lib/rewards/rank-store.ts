import type { GuardStore } from "../guard/store.ts";
import { listRewardEntries } from "./ledger.ts";
import { rankStanding, RankEventSchema, type RankEvent, type RankStanding } from "./rank.ts";
import { RANK_EVENT_POINTS, REWARD_RULES_V1, REWARD_RULES_V2, type RewardRules } from "./rules.ts";

/**
 * The durable half of ranks: when rules `2.0.0` came into force, the events
 * that earn points without a fee, and one wallet's standing read from both.
 *
 * ## When the new rules begin, without anybody setting a date
 *
 * A fixed date in code would either reach back over operations the previous
 * build already recorded under the old rules, or leave a gap nobody chose.
 * So the moment is the first time a **production** build of this code is
 * asked — the first accrual or the first Rewards read after the deploy —
 * written once with `insertIfAbsent`, with the deployment that wrote it, and
 * read by every instance after. A preview, a local server or a script pointed
 * at the production store reads the moment and never writes it; until it
 * exists they compute by `1.0.0`, exactly as the production build before this
 * one does. An operation that settled before
 * the moment is computed by `1.0.0`; one that settled after, by `2.0.0`.
 * Nothing earlier is touched.
 */

const RULES = "rewardRules" as const;
const EVENTS = "rankEvents" as const;

type RulesRecord = Readonly<{ version: "2.0.0"; effectiveFrom: string; setBy: string }>;

/**
 * May this process start the new rules?
 *
 * Production on Vercel; a process on a store of its own (memory or file —
 * tests and the local stand); or one told to explicitly with
 * `RYNTRA_REWARDS_RULES_START=1`. A preview, a `vercel env pull`-ed server
 * or a repair script on the shared Postgres store may only read the moment.
 */
export function mayStartRewardRules(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.RYNTRA_REWARDS_RULES_START ?? "").trim() === "1") return true;
  const vercel = (env.VERCEL_ENV ?? "").trim();
  if (vercel) return vercel === "production";
  const store = (env.RYNTRA_GUARD_STORE ?? "").trim().toLowerCase();
  return store === "" || store === "memory" || store === "file";
}

/**
 * The moment rules `2.0.0` came into force on this store, writing it on the
 * first ask of a build that may start them; null while it has not happened.
 */
export async function rewardRulesEffectiveFrom(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const collection = store.collection<RulesRecord>(RULES);
  const existing = await collection.get(REWARD_RULES_V2.version);
  if (existing) return existing.effectiveFrom;
  if (!mayStartRewardRules(env)) return null;
  await collection.insertIfAbsent(REWARD_RULES_V2.version, {
    version: "2.0.0",
    effectiveFrom: new Date(Date.parse(now)).toISOString(),
    setBy: (env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_URL ?? "local").slice(0, 120),
  });
  return (await collection.get(REWARD_RULES_V2.version))?.effectiveFrom ?? null;
}

/** The rules an operation that settled at `settledAt` is computed by. */
export async function rewardRulesFor(store: GuardStore, settledAt: string, now: string, env: NodeJS.ProcessEnv = process.env): Promise<RewardRules> {
  const from = await rewardRulesEffectiveFrom(store, now, env);
  return from !== null && Date.parse(settledAt) >= Date.parse(from) ? REWARD_RULES_V2 : REWARD_RULES_V1;
}

function eventKey(event: Pick<RankEvent, "wallet" | "kind" | "ref">): string {
  return `${event.wallet}:${event.kind}:${event.ref}`;
}

export async function listRankEvents(store: GuardStore, wallet: string): Promise<readonly RankEvent[]> {
  const rows = await store.collection<RankEvent>(EVENTS).valuesWithPrefix(`${wallet}:`);
  return rows.flatMap((row) => {
    const parsed = RankEventSchema.safeParse(row);
    return parsed.success && parsed.data.wallet === wallet ? [parsed.data] : [];
  });
}

export type RankEventOutcome = Readonly<{ state: "RECORDED" | "EXISTING" } | { state: "SKIPPED"; reason: string }>;

/**
 * Points for a launch of this wallet's that left its curve for a DEX.
 *
 * The call the launch lane makes when it sees a graduation. Once per mint,
 * whoever is named as its creator: the mint is claimed first under its own
 * key, so a second report of the same graduation — even naming another
 * wallet — records nothing. Non-fatal, like every other reward write — a
 * launch must never fail because a point could not be stored.
 */
export async function recordLaunchGraduation(
  store: GuardStore,
  args: Readonly<{ creator: string; mint: string; graduatedAt: string; now?: string }>,
): Promise<RankEventOutcome> {
  try {
    const event = RankEventSchema.parse({
      wallet: args.creator,
      kind: "LAUNCH_GRADUATED",
      ref: args.mint,
      points: RANK_EVENT_POINTS.LAUNCH_GRADUATED.toString(),
      rulesVersion: REWARD_RULES_V2.version,
      at: new Date(Date.parse(args.graduatedAt)).toISOString(),
      createdAt: args.now ?? new Date().toISOString(),
    });
    const events = store.collection<RankEvent>(EVENTS);
    /* The mint's own claim. Its key does not start with a wallet, so no
       wallet's prefix scan ever reads it. */
    const claimed = await events.insertIfAbsent(`${event.kind}:${event.ref}`, event);
    if (!claimed) {
      const owner = await events.get(`${event.kind}:${event.ref}`);
      if (owner?.wallet !== event.wallet) return { state: "EXISTING" };
    }
    const inserted = await events.insertIfAbsent(eventKey(event), event);
    return { state: inserted ? "RECORDED" : "EXISTING" };
  } catch (failure) {
    return { state: "SKIPPED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

/** One wallet's standing at one moment. */
export async function readRankStanding(store: GuardStore, wallet: string, at: string): Promise<RankStanding> {
  const [entries, events] = await Promise.all([listRewardEntries(store, wallet), listRankEvents(store, wallet)]);
  return rankStanding({ wallet, entries, events, at });
}
