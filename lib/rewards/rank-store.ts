import type { GuardStore } from "../guard/store.ts";
import { heldPartnerPools } from "../growth/review-store.ts";
import { listRewardEntries } from "./ledger.ts";
import { rankStanding, RankEventSchema, type RankEvent, type RankStanding } from "./rank.ts";
import { RANK_EVENT_POINTS, REWARD_RULES_V1, REWARD_RULES_V2, REWARD_RULES_V2_1, REWARD_RULES_V2_1_NOT_BEFORE, REWARD_RULES_V2_2, REWARD_RULES_V2_2_NOT_BEFORE, type RewardRules } from "./rules.ts";
import { rankCountedEntries } from "../growth/referral-guard.ts";
import { readReferralGuard } from "../growth/referral-guard-store.ts";

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

type RulesRecord = Readonly<{ version: "2.0.0" | "2.1.0" | "2.2.0"; effectiveFrom: string; setBy: string }>;

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

/**
 * The moment rules `2.1.0` came into force on this store — the same mechanism as `2.0.0`'s, by the same builds,
 * after `2.0.0`'s own moment, and never before the decision (`REWARD_RULES_V2_1_NOT_BEFORE`): an ask before it
 * writes nothing. Null while it has not happened.
 */
export async function rewardRulesV21EffectiveFrom(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const collection = store.collection<RulesRecord>(RULES);
  const existing = await collection.get(REWARD_RULES_V2_1.version);
  if (existing) return existing.effectiveFrom;
  if (!mayStartRewardRules(env) || !(Date.parse(now) >= Date.parse(REWARD_RULES_V2_1_NOT_BEFORE))) return null;
  if ((await rewardRulesEffectiveFrom(store, now, env)) === null) return null;
  await collection.insertIfAbsent(REWARD_RULES_V2_1.version, {
    version: "2.1.0",
    effectiveFrom: new Date(Date.parse(now)).toISOString(),
    setBy: (env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_URL ?? "local").slice(0, 120),
  });
  return (await collection.get(REWARD_RULES_V2_1.version))?.effectiveFrom ?? null;
}

/**
 * The moment rules `2.2.0` came into force on this store — the same mechanism as `2.1.0`'s, after its moment, and
 * never before the decision (`REWARD_RULES_V2_2_NOT_BEFORE`). `2.2.0` moved the rank ladder one decade down and
 * changed no share, so a store that has not started it yet simply keeps judging by the old ladder.
 */
export async function rewardRulesV22EffectiveFrom(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const collection = store.collection<RulesRecord>(RULES);
  const existing = await collection.get(REWARD_RULES_V2_2.version);
  if (existing) return existing.effectiveFrom;
  if (!mayStartRewardRules(env) || !(Date.parse(now) >= Date.parse(REWARD_RULES_V2_2_NOT_BEFORE))) return null;
  if ((await rewardRulesV21EffectiveFrom(store, now, env)) === null) return null;
  await collection.insertIfAbsent(REWARD_RULES_V2_2.version, {
    version: "2.2.0",
    effectiveFrom: new Date(Date.parse(now)).toISOString(),
    setBy: (env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_URL ?? "local").slice(0, 120),
  });
  return (await collection.get(REWARD_RULES_V2_2.version))?.effectiveFrom ?? null;
}

/**
 * The rules in force at `at`, read only: the moments as stored, nothing started — for a reader that must write
 * nothing (the header's balance). Before a moment is stored, the earlier rules.
 */
export async function readRewardRulesInForce(store: GuardStore, at: string): Promise<RewardRules> {
  const collection = store.collection<RulesRecord>(RULES);
  const [v2, v21, v22] = await Promise.all([collection.get(REWARD_RULES_V2.version), collection.get(REWARD_RULES_V2_1.version), collection.get(REWARD_RULES_V2_2.version)]);
  const ms = Date.parse(at);
  if (!v2 || !(ms >= Date.parse(v2.effectiveFrom))) return REWARD_RULES_V1;
  if (!(v21 && ms >= Date.parse(v21.effectiveFrom) && ms >= Date.parse(REWARD_RULES_V2_1_NOT_BEFORE))) return REWARD_RULES_V2;
  return v22 && ms >= Date.parse(v22.effectiveFrom) && ms >= Date.parse(REWARD_RULES_V2_2_NOT_BEFORE) ? REWARD_RULES_V2_2 : REWARD_RULES_V2_1;
}

/**
 * When each version of the traders' rules came into force on this store, read only — nothing is started. A version
 * whose moment is not stored is null: it has not come into force here.
 */
export async function readRewardRuleMoments(store: GuardStore): Promise<Readonly<Record<"2.0.0" | "2.1.0" | "2.2.0", string | null>>> {
  const collection = store.collection<RulesRecord>(RULES);
  const [v2, v21, v22] = await Promise.all([collection.get(REWARD_RULES_V2.version), collection.get(REWARD_RULES_V2_1.version), collection.get(REWARD_RULES_V2_2.version)]);
  return { "2.0.0": v2?.effectiveFrom ?? null, "2.1.0": v21?.effectiveFrom ?? null, "2.2.0": v22?.effectiveFrom ?? null };
}

/** The rules an operation that settled at `settledAt` is computed by. */
export async function rewardRulesFor(store: GuardStore, settledAt: string, now: string, env: NodeJS.ProcessEnv = process.env): Promise<RewardRules> {
  const from = await rewardRulesEffectiveFrom(store, now, env);
  const settled = Date.parse(settledAt);
  if (from === null || !(settled >= Date.parse(from))) return REWARD_RULES_V1;
  const from21 = await rewardRulesV21EffectiveFrom(store, now, env);
  if (!(from21 !== null && settled >= Date.parse(from21) && settled >= Date.parse(REWARD_RULES_V2_1_NOT_BEFORE))) return REWARD_RULES_V2;
  const from22 = await rewardRulesV22EffectiveFrom(store, now, env);
  return from22 !== null && settled >= Date.parse(from22) && settled >= Date.parse(REWARD_RULES_V2_2_NOT_BEFORE) ? REWARD_RULES_V2_2 : REWARD_RULES_V2_1;
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

/**
 * Points for Ryntra's received part of a launch pool whose creator this wallet brought — one earned line of the
 * Ryntra Network, or its reversal (a negative base).
 *
 * The call the Network's accrual makes beside every line it writes, under that line's own reference, so a repeat
 * — the next run, a retry after a crash between the two writes — records nothing. The event is dated by the
 * caller at the moment the base may count — the end of the share's hold — so a figure still open to reversal
 * never lifts a rank; a reversal is dated so that it cancels what it reverses.
 */
export async function recordPartnerPoolBase(
  store: GuardStore,
  args: Readonly<{ partner: string; ref: string; baseUsdMicros: bigint; at: string; cancelsAt?: string | null; rulesVersion: string; now?: string }>,
): Promise<RankEventOutcome> {
  try {
    const event = RankEventSchema.parse({
      wallet: args.partner,
      kind: "PARTNER_POOL",
      ref: args.ref,
      points: "0",
      usdMicros: args.baseUsdMicros.toString(),
      ...(args.cancelsAt ? { cancelsAt: new Date(Date.parse(args.cancelsAt)).toISOString() } : {}),
      rulesVersion: args.rulesVersion,
      at: new Date(Date.parse(args.at)).toISOString(),
      createdAt: args.now ?? new Date().toISOString(),
    });
    const inserted = await store.collection<RankEvent>(EVENTS).insertIfAbsent(eventKey(event), event);
    return { state: inserted ? "RECORDED" : "EXISTING" };
  } catch (failure) {
    return { state: "SKIPPED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

/** One wallet's standing at one moment. */
export async function readRankStanding(store: GuardStore, wallet: string, at: string): Promise<RankStanding> {
  const [entries, events, rules, guard] = await Promise.all([listRewardEntries(store, wallet), listCountedRankEvents(store, wallet, at), readRewardRulesInForce(store, at), readReferralGuard(store, wallet, at)]);
  /* The ladder of the moment, not of today: a trade that settled under the old ladder keeps it even when the
     accrual is written later (rules `2.2.0`). Only the rows the referral guard lets count: no point for half of a
     circular trade, none for a friend whose pair is not clear (Ryntra Partners R3). A guard that cannot be read
     throws — the accrual that asked waits for its retry rather than freezing a rank on a guess. */
  return rankStanding({ wallet, entries: rankCountedEntries(entries, wallet, guard), events, at, rules });
}

/**
 * A wallet's rank events as the rank counts them: a partner's pool points leave while a review holds or took back
 * that pool's money — so a friend's share is never paid at a rank the review has not let stand. When the review
 * cannot be read, no partner point counts (a lower rank, never a higher one).
 */
export async function listCountedRankEvents(store: GuardStore, wallet: string, now: string): Promise<readonly RankEvent[]> {
  const events = await listRankEvents(store, wallet);
  if (!events.some((event) => event.kind === "PARTNER_POOL")) return events;
  /* The pools these points came from (`networkEntryRef`: `<network>:<pool>:…`), each binding read by its key. */
  const pools = events.flatMap((event) => {
    if (event.kind !== "PARTNER_POOL") return [];
    const [network, pool] = event.ref.split(":");
    return network && pool ? [{ network, pool }] : [];
  });
  const held = await heldPartnerPools(store, wallet, now, pools).catch(() => null);
  return events.filter((event) => event.kind !== "PARTNER_POOL" || (held !== null && ![...held].some((pool) => event.ref.startsWith(pool))));
}
