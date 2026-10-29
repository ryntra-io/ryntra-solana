import type { GuardStore } from "../guard/store.ts";
import { readNetworkLedger } from "./network-store.ts";
import type { RegistryRowLike } from "./pool-share.ts";
import { caseOf, parseSubject, poolSubject, type ReviewEvent } from "./review.ts";
import { readActivations, readAllEvents, readEvidence, activationKey, readHubLog } from "./review-store.ts";

/**
 * The review queue as the reviewer reads it: every case — open ones first,
 * the overdue at the top — with its signals, trust score, due time, history
 * and the hashes behind each signal while they are kept; and every partner's
 * pool with its activation and what protection does to its money.
 *
 * The reviewer's own read: the creator's and the partner's addresses are in
 * it (they are the binding), the traders and funding sources only as hashes.
 */

export type QueueCase = Readonly<{
  subject: string;
  kind: "pool" | "wallet";
  state: "OPEN" | "DECIDED" | "NONE";
  signals: readonly string[];
  trust: number;
  openedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  appealed: boolean;
  decision: Readonly<{ kind: string; ceilingUsdMicros: string | null; note: string; by: string; at: string }> | null;
  frozen: Readonly<{ note: string; by: string; at: string }> | null;
  /** Rows of the log this build could not read — the case holds its money all the same. */
  unreadable: number;
  events: readonly Pick<ReviewEvent, "seq" | "kind" | "at" | "by" | "signals" | "decision" | "ceilingUsdMicros" | "note">[];
  evidence: readonly Readonly<{ code: string; hash: string; expiresAt: string }>[];
  pool: Readonly<{ network: string; pool: string; creator: string; partner: string; launchedAt: string }> | null;
}>;

export type QueuePool = Readonly<{
  network: string;
  pool: string;
  creator: string;
  partner: string;
  launchedAt: string;
  status: string;
  activated: boolean;
  activatedAt: string | null;
  /** The latest run's figures: independent and external addresses, volumes with the team's marked. */
  activity: Readonly<{
    at: string;
    independent: number;
    external: number;
    unknown: number;
    volumeUsdMicros: string;
    teamVolumeUsdMicros: string;
    insiderVolumeUsdMicros: string;
    roundTripVolumeUsdMicros: string;
    unvaluedTrades: number;
    tradesComplete: boolean;
    partiesComplete: boolean;
    sharedSources: readonly Readonly<{ hash: string; wallets: number }>[];
  }> | null;
  effect: string;
  earnedUsdMicros: string;
  pendingUsdMicros: string;
  availableUsdMicros: string;
  heldUsdMicros: string;
}>;

export type ReviewQueue = Readonly<{
  at: string;
  cases: readonly QueueCase[];
  pools: readonly QueuePool[];
  counts: Readonly<{ open: number; overdue: number; frozen: number; awaitingActivation: number }>;
  /** Sources marked an exchange or a bridge now, with who, when and why. */
  hubs: readonly Readonly<{ hash: string; note: string; by: string; at: string }>[];
}>;

const RANK = (item: QueueCase) => (item.state === "OPEN" ? (item.overdue ? 0 : 1) : item.frozen ? 2 : 3);

export async function readReviewQueue(store: GuardStore, args: Readonly<{ now: string; registry?: readonly RegistryRowLike[] }>): Promise<ReviewQueue> {
  const [logs, activations, ledger, hubLog] = await Promise.all([readAllEvents(store), readActivations(store), readNetworkLedger(store, { now: args.now, ...(args.registry ? { registry: args.registry } : {}) }), readHubLog(store)]);
  const latestHub = new Map(hubLog.filter((event) => event.kind !== "VIEWED").map((event) => [event.hash, event] as const));
  const poolsByKey = new Map(ledger.partners.flatMap((partner) => partner.pools.map((pool) => [poolSubject(pool.network, pool.pool), { ...pool, partner: partner.partner }] as const)));
  const subjects = new Set([...logs.bySubject.keys(), ...[...logs.unreadable.keys()].filter((key) => key !== "*")]);
  const cases: QueueCase[] = [];
  for (const subject of subjects) {
    const parsed = parseSubject(subject);
    if (!parsed) continue;
    const events = logs.bySubject.get(subject) ?? [];
    const view = caseOf(subject, events, args.now);
    const pool = parsed.kind === "pool" ? poolsByKey.get(subject) : undefined;
    cases.push({
      subject,
      kind: parsed.kind,
      state: view.state,
      signals: view.signals,
      trust: view.trust,
      openedAt: view.openedAt,
      dueAt: view.dueAt,
      overdue: view.overdue,
      appealed: view.appealed,
      decision: view.decision,
      frozen: view.frozen,
      unreadable: (logs.unreadable.get(subject) ?? 0) + (logs.unreadable.get("*") ?? 0),
      events: view.events.map(({ seq, kind, at, by, signals, decision, ceilingUsdMicros, note }) => ({ seq, kind, at, by, signals, decision, ceilingUsdMicros, note })),
      evidence: (await readEvidence(store, subject, args.now)).map((row) => ({ code: row.code, hash: row.hash, expiresAt: row.expiresAt })),
      pool: pool ? { network: pool.network, pool: pool.pool, creator: pool.creator, partner: pool.partner, launchedAt: pool.launchedAt } : null,
    });
  }
  cases.sort((a, b) => RANK(a) - RANK(b) || (a.dueAt ?? a.openedAt ?? "").localeCompare(b.dueAt ?? b.openedAt ?? ""));
  const pools: QueuePool[] = [...poolsByKey.values()].map((pool) => {
    const record = activations.records.get(activationKey(pool.network, pool.pool));
    return {
      network: pool.network,
      pool: pool.pool,
      creator: pool.creator,
      partner: pool.partner,
      launchedAt: pool.launchedAt,
      status: pool.status,
      activated: pool.activated,
      activatedAt: record?.activatedAt ?? null,
      activity: record?.last ?? null,
      effect: pool.review?.effect ?? "PAY",
      earnedUsdMicros: pool.earnedUsdMicros,
      pendingUsdMicros: pool.pendingUsdMicros,
      availableUsdMicros: pool.availableUsdMicros,
      heldUsdMicros: pool.heldUsdMicros,
    };
  });
  return {
    at: args.now,
    cases,
    pools,
    counts: {
      open: cases.filter((item) => item.state === "OPEN").length,
      overdue: cases.filter((item) => item.overdue).length,
      frozen: cases.filter((item) => item.frozen).length,
      awaitingActivation: pools.filter((pool) => !pool.activated && pool.status !== "NOT_COUNTED").length,
    },
    hubs: [...latestHub.values()].filter((event) => event.kind === "MARKED").map(({ hash, note, by, at }) => ({ hash, note, by, at })),
  };
}
