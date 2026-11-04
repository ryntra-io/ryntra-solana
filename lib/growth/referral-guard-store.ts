import { z } from "zod";

import type { WalletClusters } from "../city-economy/honest-count.ts";
import type { GuardStore } from "../guard/store.ts";
import { effectiveRewardEntries } from "../rewards/ledger.ts";
import type { RewardEntry } from "../rewards/model.ts";
import { listSolanaWalletActions } from "../solana/action-ledger.ts";
import { RANK_WINDOW_MS } from "../rewards/rules.ts";
import { SIGNAL_CODES } from "./protect.ts";
import {
  circularSwapRefs,
  REFERRAL_GUARD_RULES,
  REFERRAL_PAIR_STATES,
  referralHeldUsdMicros,
  referralPairEffect,
  referralPairFinding,
  referrerBarMet,
  swapLegsOf,
  type ReferralGuard,
  type ReferralPairEffect,
} from "./referral-guard.ts";
import { raiseSignals, readSubjectEvents } from "./review-store.ts";
import { caseOf, walletSubject } from "./review.ts";

/**
 * The referral guard's records and readers (Ryntra Partners, R3): one row per pair `inviter:trader`, written by the
 * pair check that runs from the bookkeeping queue after a friend's trade; read by the rank (which points count), by
 * the accrual (whose share stays with Ryntra) and by every balance (what waits).
 *
 * The row keeps no hash, no address but the two the key names, and no evidence: a flagged pair's evidence is the
 * review queue's (`growthSignals`, kept for `PROTECT_RULES.retentionDays`). Nothing here writes a reward row.
 */

export const REFERRAL_PAIR_COLLECTION = "rewardReferralPairs" as const;

const AT = z.string().datetime({ offset: true });

export const ReferralPairSchema = z
  .object({
    schema: z.literal(1),
    version: z.number().int().nonnegative(),
    /** The wallet paid for bringing the trader — at level 1 or level 2. */
    inviter: z.string().min(32).max(64),
    trader: z.string().min(32).max(64),
    state: z.enum(REFERRAL_PAIR_STATES),
    /** The codes the last check found (soft ones on a clear pair included). */
    codes: z.array(z.enum(SIGNAL_CODES)).max(SIGNAL_CODES.length),
    /** The trader's swaps that are halves of a circular trade, newest first: they earn the inviter no point. */
    circular: z.array(z.string().min(1).max(128)).max(REFERRAL_GUARD_RULES.keptCircular),
    checkedAt: AT,
    /** When the pair was last flagged: only a decision taken after it lets the pair's money go. */
    flaggedAt: AT.nullable(),
    rules: z.string().min(1).max(40),
  })
  .strict();
export type ReferralPair = z.output<typeof ReferralPairSchema>;

export function referralPairKey(inviter: string, trader: string): string {
  return `${inviter}:${trader}`;
}

/** Every pair a wallet is paid for, by trader. A row that does not parse is left out — its pair then waits. */
export async function readReferralPairs(store: GuardStore, inviter: string): Promise<Map<string, ReferralPair>> {
  const rows = await store.collection<unknown>(REFERRAL_PAIR_COLLECTION).valuesWithPrefix(`${inviter}:`);
  const out = new Map<string, ReferralPair>();
  for (const row of rows) {
    const parsed = ReferralPairSchema.safeParse(row);
    if (parsed.success && parsed.data.inviter === inviter) out.set(parsed.data.trader, parsed.data);
  }
  return out;
}

async function readReferralPair(store: GuardStore, inviter: string, trader: string): Promise<ReferralPair | null> {
  const parsed = ReferralPairSchema.safeParse(await store.versioned<ReferralPair>(REFERRAL_PAIR_COLLECTION).get(referralPairKey(inviter, trader)));
  return parsed.success && parsed.data.inviter === inviter && parsed.data.trader === trader ? parsed.data : null;
}

/** The reviewer's last word on a wallet's case, or null — none yet, or a log that cannot be read whole (then it waits). */
async function inviterDecision(store: GuardStore, inviter: string, now: string): Promise<Readonly<{ kind: "CLEAR" | "ADJUST" | "CANCEL"; at: string }> | null> {
  const subject = walletSubject(inviter);
  const read = await readSubjectEvents(store, subject);
  if (read.unreadable) return null;
  const view = caseOf(subject, read.events, now);
  return view.decision ? { kind: view.decision.kind, at: view.decision.at } : null;
}

/** A wallet's own swaps that are halves of a circular trade. */
async function ownCircular(store: GuardStore, wallet: string): Promise<Set<string>> {
  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet });
  return circularSwapRefs(swapLegsOf(listed.actions));
}

/**
 * One wallet's guard: its own circular swaps and, for each trader it is paid for, what the pair does to the money.
 * Throws when the store does not answer — a rank then waits for its retry, a balance holds every friend's share.
 */
export async function readReferralGuard(store: GuardStore, wallet: string, now: string): Promise<ReferralGuard> {
  const [pairs, decision, circular] = await Promise.all([readReferralPairs(store, wallet), inviterDecision(store, wallet, now), ownCircular(store, wallet)]);
  const out = new Map<string, Readonly<{ effect: ReferralPairEffect; circular: ReadonlySet<string> }>>();
  for (const [trader, pair] of pairs) out.set(trader, { effect: referralPairEffect(pair, decision), circular: new Set(pair.circular) });
  return { ownCircular: circular, pairs: out };
}

/**
 * What a wallet's friends' shares hold back from its payout, and whether it met the referrer bar. When the guard
 * cannot be read, every friend's share waits — never paid on a guess.
 */
export async function readReferralHold(
  store: GuardStore,
  wallet: string,
  entries: readonly RewardEntry[],
  now: string,
): Promise<Readonly<{ heldUsdMicros: bigint; barMet: boolean }>> {
  const effective = effectiveRewardEntries(entries);
  try {
    const guard = await readReferralGuard(store, wallet, now);
    const barMet = referrerBarMet(effective, wallet, guard.ownCircular);
    return { heldUsdMicros: referralHeldUsdMicros(effective, wallet, guard, barMet), barMet };
  } catch {
    return { heldUsdMicros: referralHeldUsdMicros(effective, wallet, { ownCircular: new Set(), pairs: new Map() }, false), barMet: false };
  }
}

/**
 * The levels of a first accrual whose pair a person stopped: their share stays with Ryntra, as an internal wallet's
 * does. A read that fails stops nothing here — the share is written and waits on the balance instead.
 */
export async function stoppedReferralLevels(
  store: GuardStore,
  trader: string,
  levels: Readonly<{ l1: string | null; l2: string | null }>,
  now: string,
): Promise<Set<string>> {
  const stopped = new Set<string>();
  for (const inviter of [levels.l1, levels.l2]) {
    if (!inviter || stopped.has(inviter)) continue;
    try {
      const pair = await readReferralPair(store, inviter, trader);
      if (pair?.state !== "REVIEW") continue;
      if (referralPairEffect(pair, await inviterDecision(store, inviter, now)) === "STOPPED") stopped.add(inviter);
    } catch { /* Nothing stopped on a guess; the balance holds what is not known. */ }
  }
  return stopped;
}

/** How much one payout pass checks: a pair checked within `recheckMs` and found clear is not asked again. */
export const PAYOUT_CHECK_LIMITS = { checks: 20, budgetMs: 25_000, recheckMs: 24 * 3_600_000 } as const;

/**
 * The weekly partner payouts' read of the guard (CITY-125 on CITY-128): each pair `partner:person` and what it does to
 * the share now. Pairs never checked, still pending, or clear but not looked at for a day are checked first, as many as
 * the pass has room for; the rest are read as they stand. A pair whose row or whose partner's case cannot be read
 * waits — never paid on a guess.
 */
export async function payoutPairEffects(
  store: GuardStore,
  pairs: readonly Readonly<{ partner: string; person: string }>[],
  now: string,
  deps: ReferralCheckDeps | null,
  limits: Readonly<{ checks: number; budgetMs: number; recheckMs: number }> = PAYOUT_CHECK_LIMITS,
): Promise<Map<string, ReferralPairEffect>> {
  const out = new Map<string, ReferralPairEffect>();
  const unique = [...new Map(pairs.filter((pair) => pair.partner !== pair.person).map((pair) => [referralPairKey(pair.partner, pair.person), pair])).values()];
  const rows = new Map<string, ReferralPair | null>();
  for (const pair of unique) rows.set(referralPairKey(pair.partner, pair.person), await readReferralPair(store, pair.partner, pair.person).catch(() => null));
  const stale = (row: ReferralPair | null) => !row || row.state === "PENDING" || (row.state === "CLEAR" && Date.parse(now) - Date.parse(row.checkedAt) >= limits.recheckMs);
  const deadline = Date.now() + limits.budgetMs;
  let checks = 0;
  /* Never-checked pairs first: a pair with no row has never been asked at all. */
  for (const pair of [...unique].sort((a, b) => Number(rows.get(referralPairKey(b.partner, b.person)) == null) - Number(rows.get(referralPairKey(a.partner, a.person)) == null))) {
    const key = referralPairKey(pair.partner, pair.person);
    if (!stale(rows.get(key) ?? null) || checks >= limits.checks || Date.now() >= deadline) continue;
    checks += 1;
    const outcome = await checkReferralPair(store, deps, { inviter: pair.partner, trader: pair.person, now }).catch(() => null);
    if (outcome?.state === "DECIDED") rows.set(key, outcome.pair);
    else rows.set(key, await readReferralPair(store, pair.partner, pair.person).catch(() => rows.get(key) ?? null));
  }
  const decisions = new Map<string, Awaited<ReturnType<typeof inviterDecision>> | undefined>();
  for (const pair of unique) {
    const key = referralPairKey(pair.partner, pair.person);
    const row = rows.get(key) ?? null;
    if (!decisions.has(pair.partner)) decisions.set(pair.partner, await inviterDecision(store, pair.partner, now).catch(() => undefined));
    const decision = decisions.get(pair.partner);
    /* A partner's case log that cannot be read lets no flagged pair go. */
    out.set(key, decision === undefined && row?.state === "REVIEW" ? "WAITS" : referralPairEffect(row, decision ?? null));
  }
  return out;
}

export type ReferralCheckDeps = Readonly<{
  /** The Growth line's answer to «one person?» — `walletClusters` of `cluster-check.server.ts`. */
  clusters: WalletClusters;
  /** Is the trader a young wallet at a moment (S5)? Null — not known; counted as not young. */
  young?: (wallet: string, at: string) => Promise<boolean | null>;
}>;

export type ReferralCheckOutcome =
  | Readonly<{ state: "DECIDED"; pair: ReferralPair }>
  | Readonly<{ state: "WAITING"; reason: string }>;

/**
 * Check one pair now: the cluster verdict on the two wallets, the trader's age and its circular swaps. Clear — the
 * pair pays; signals — a case on the inviter's wallet and the pair waits for a person; a read that did not answer —
 * the pair stays as it was (pending, if new) and the check runs again. A flagged pair is never cleared by a later
 * clean run: only a person lets it go.
 */
export async function checkReferralPair(
  store: GuardStore,
  deps: ReferralCheckDeps | null,
  args: Readonly<{ inviter: string; trader: string; now: string }>,
): Promise<ReferralCheckOutcome> {
  const { inviter, trader, now } = args;
  if (inviter === trader) return { state: "WAITING", reason: "A wallet is never its own inviter." };
  const existing = await readReferralPair(store, inviter, trader);
  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: trader });
  const fromMs = Date.parse(now) - RANK_WINDOW_MS;
  const legs = swapLegsOf(listed.actions);
  const circularRefs = [...circularSwapRefs(legs)];
  const recent = legs.filter((leg) => circularRefs.includes(leg.ref) && Date.parse(leg.at) > fromMs).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((leg) => leg.ref);
  const circular = [...new Set([...recent, ...(existing?.circular ?? [])])].slice(0, REFERRAL_GUARD_RULES.keptCircular);

  const write = async (next: Pick<ReferralPair, "state" | "codes" | "circular" | "checkedAt" | "flaggedAt">): Promise<ReferralPair | null> => {
    const pair = ReferralPairSchema.parse({ ...next, schema: 1, version: (existing?.version ?? -1) + 1, inviter, trader, rules: REFERRAL_GUARD_RULES.version });
    const ok = await store.versioned<ReferralPair>(REFERRAL_PAIR_COLLECTION).compareAndSet(referralPairKey(inviter, trader), existing?.version ?? null, pair);
    return ok ? pair : null;
  };

  if (!deps) {
    if (!existing) await write({ state: "PENDING", codes: [], circular, checkedAt: now, flaggedAt: null });
    return { state: "WAITING", reason: "No cluster check on this deployment; the pair waits." };
  }
  const verdict = await deps.clusters.check(trader, inviter, now);
  const young = (await deps.young?.(trader, now).catch(() => null)) ?? false;
  const finding = referralPairFinding({ verdict, youngTrader: young, circularTrades: recent.length });

  if (finding.state === "WAIT") {
    if (!existing) await write({ state: "PENDING", codes: [], circular, checkedAt: now, flaggedAt: null });
    else if (existing.state !== "REVIEW") await write({ state: existing.state, codes: existing.codes, flaggedAt: existing.flaggedAt, circular, checkedAt: now });
    return { state: "WAITING", reason: "A read did not answer; the pair is checked again." };
  }
  if (finding.state === "REVIEW") {
    /* Signals are a sign, never a verdict: they open the inviter's case and the pair's share waits for a person. */
    const raised = await raiseSignals(store, { subject: walletSubject(inviter), codes: finding.codes, now });
    if (!raised) return { state: "WAITING", reason: "The review log could not be read; the check runs again." };
    const flaggedAt = raised.written || existing?.state !== "REVIEW" ? now : existing.flaggedAt ?? now;
    const pair = await write({ state: "REVIEW", codes: [...finding.codes], circular, checkedAt: now, flaggedAt });
    return pair ? { state: "DECIDED", pair } : { state: "WAITING", reason: "The pair moved; the check runs again." };
  }
  /* Clean. A pair a person is looking at stays theirs: a quiet run does not answer for them. */
  const pair = existing?.state === "REVIEW"
    ? await write({ state: existing.state, codes: existing.codes, flaggedAt: existing.flaggedAt, circular, checkedAt: now })
    : await write({ state: "CLEAR", codes: [...finding.codes], circular, checkedAt: now, flaggedAt: null });
  return pair ? { state: "DECIDED", pair } : { state: "WAITING", reason: "The pair moved; the check runs again." };
}
