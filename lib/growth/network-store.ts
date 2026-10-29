import type { GuardStore } from "../guard/store.ts";
import { NETWORK_RULES_HISTORY, networkRulesAt, type NetworkRules, type NetworkTier } from "../rewards/network-rules.ts";
import { listRankEvents, recordPartnerPoolBase } from "../rewards/rank-store.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  computePoolLines,
  networkClearKey,
  rankEventsOf,
  type CountedConfigs,
  countedConfigsOf,
  countersKey,
  entryStates,
  FOUNDING_COLLECTION,
  FOUNDING_KEY,
  FoundingRecordSchema,
  type FoundingRecord,
  type FoundingSeat,
  NETWORK_CHECK_COLLECTION,
  NETWORK_ENTRY_COLLECTION,
  networkCheckKey,
  networkCheckPrefix,
  networkEntryKey,
  NetworkEntrySchema,
  type NetworkEntry,
  partnerEntryPrefix,
  planEntries,
  type PoolCounters,
  poolEntryPrefix,
  type PoolLine,
  poolKey,
  shareNow,
  stampedVersions,
  sumLines,
} from "./network.ts";
import { normalizeWallet, PARTNER_NETWORKS, type PartnerNetwork, POOL_PARTNER_COLLECTION, type PoolPartner, PoolPartnerSchema, SELF_REFERRAL_REASONS, type SelfReferralReason, walletKey } from "./partner.ts";
import { type PartnerDeps, recheckPoolPartner } from "./partner-store.ts";
import { everLinked } from "./wallet-link-store.ts";
import { launchConfigPlans, type PoolShareClaim, poolShareKey, type PoolShareStream1, poolShareTotals, type RegistryRowLike } from "./pool-share.ts";
import { readPoolShareRows, readStream1 } from "./pool-share-store.ts";
import { type CaseView, type MoneyEffect, poolSubject, walletSubject } from "./review.ts";
import { activationKey, type PoolProtection, protectionOf, readActivations, readAllEvents, readProtection } from "./review-store.ts";

/**
 * The store side of the Ryntra Network's shadow ledger: the run that writes
 * what each partner earned, the Founding seats, and the reads — the partner's
 * own (for the Rewards page) and the whole ledger (for the review of the whole programme).
 *
 * Nothing here moves money. An entry is a figure in `guard_objects`; paying
 * it is a later step with its own canary and receipt.
 */

const MAX_ROUNDS = 4;

function parseEntry(raw: unknown): NetworkEntry | null {
  const parsed = NetworkEntrySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The entries under a prefix for a read people see: one that cannot be read throws, never a figure shown too high. */
async function readEntriesOrThrow(store: GuardStore, prefix: string): Promise<NetworkEntry[]> {
  const read = await readEntriesStrict(store, prefix);
  if (read.unreadable) throw new Error(`${read.unreadable} entr${read.unreadable === 1 ? "y" : "ies"} of the shadow ledger could not be read.`);
  return read.entries;
}

/** One partner's entries, for a payout: an entry that cannot be read throws — a payout is never planned over a hole. */
export async function readPartnerEntries(store: GuardStore, partner: string): Promise<NetworkEntry[]> {
  return readEntriesOrThrow(store, partnerEntryPrefix(partner));
}

/** The entries under a prefix, and how many could not be read — a pool with one of those is decided by nobody. */
async function readEntriesStrict(store: GuardStore, prefix: string): Promise<Readonly<{ entries: NetworkEntry[]; unreadable: number }>> {
  const rows = await store.collection<unknown>(NETWORK_ENTRY_COLLECTION).valuesWithPrefix(prefix);
  const entries = rows.map(parseEntry).filter((entry): entry is NetworkEntry => entry !== null);
  return { entries, unreadable: rows.length - entries.length };
}

/** Every pool bound to a partner (bindings without one are left out). */
export async function readPartnerBindings(store: GuardStore, partner?: string): Promise<PoolPartner[]> {
  const rows = await store.collection<unknown>(POOL_PARTNER_COLLECTION).valuesWithPrefix("pool:");
  const out: PoolPartner[] = [];
  for (const row of rows) {
    const parsed = PoolPartnerSchema.safeParse(row);
    if (!parsed.success || !parsed.data.partner) continue;
    if (partner !== undefined && parsed.data.partner !== partner) continue;
    out.push(parsed.data);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Reasons found after the launch
 * --------------------------------------------------------------------------------------------- */

type FoundReason = Readonly<{ network: PartnerNetwork; pool: string; partner: string; reason: SelfReferralReason; at: string }>;
/** A run's first clean check of a binding whose own check could not run at the launch. */
type CheckClear = Readonly<{ network: PartnerNetwork; pool: string; partner: string; clear: true; at: string }>;

/** The reasons found for each pool — and whether a row of it could not be read, which blocks the pool all the same. */
type FoundReasons = Map<string, Readonly<{ reasons: readonly SelfReferralReason[]; unreadable: boolean }>>;

/**
 * The reasons runs found for pools after their bindings were written — one row per reason, never removed. A row
 * whose pool can be read but whose reason this build does not know (a newer build's, or damage) still blocks its
 * pool: a reason once found is never read as none.
 */
async function readFoundReasons(store: GuardStore): Promise<FoundReasons> {
  const rows = await store.collection<FoundReason>(NETWORK_CHECK_COLLECTION).valuesWithPrefix("pool:");
  const out: FoundReasons = new Map();
  const mark = (key: string, reason: unknown, readable: boolean) => {
    const known = readable && (SELF_REFERRAL_REASONS as readonly string[]).includes(reason as string);
    const held = out.get(key) ?? { reasons: [], unreadable: false };
    out.set(key, { reasons: known ? [...new Set([...held.reasons, reason as SelfReferralReason])] : held.reasons, unreadable: held.unreadable || !known });
  };
  for (const row of rows) {
    /* Damage fails closed: a row without its network blocks its pool on every network, one without its pool blocks every pool. */
    if (!row || typeof row.pool !== "string") mark(ANY_POOL, null, false);
    else if (typeof row.network !== "string") for (const network of PARTNER_NETWORKS) mark(networkCheckPrefix(network, row.pool), null, false);
    else mark(networkCheckPrefix(row.network, row.pool), row.reason, true);
  }
  return out;
}

const ANY_POOL = "*";

/** The pools a run has checked clean at least once, by `networkCheckPrefix`. */
async function readCleared(store: GuardStore): Promise<Set<string>> {
  const rows = await store.collection<CheckClear>(NETWORK_CHECK_COLLECTION).valuesWithPrefix("clear:");
  return new Set(rows.filter((row) => row && row.clear === true && typeof row.pool === "string").map((row) => networkCheckPrefix(row.network, row.pool)));
}

/** Every reason a pool's partner may not earn — the binding's own and those any run found since — and whether it may not. */
function blockOf(binding: PoolPartner, found: FoundReasons): Readonly<{ reasons: SelfReferralReason[]; blocked: boolean; unreadable: boolean }> {
  const held = found.get(networkCheckPrefix(binding.network, binding.pool));
  const reasons = [...new Set([...(binding.checks?.reasons ?? []), ...(held?.reasons ?? [])])];
  const unreadable = (held?.unreadable ?? false) || (found.get(ANY_POOL)?.unreadable ?? false);
  return { reasons, blocked: reasons.length > 0 || unreadable, unreadable };
}

/* ------------------------------------------------------------------------------------------------
 * Protection: the review's decisions and the creator's activation
 * --------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------
 * The journal as a run and a read see it
 * --------------------------------------------------------------------------------------------- */

type JournalState = Readonly<{ rows: Awaited<ReturnType<typeof readPoolShareRows>>; open: ReadonlySet<string> }>;

/**
 * The claims and whether each pool's stream 1 is all known, from one read of the journal's rows: stream 1 the core
 * has ready but the journal has not written is open against these very rows.
 */
async function readJournalState(store: GuardStore, registry: readonly RegistryRowLike[], now: string): Promise<JournalState> {
  const stream1 = await readStream1(store, { registry, now });
  const rows = await readPoolShareRows(store);
  const written = new Set(rows.map(poolShareKey));
  const pending = [...stream1.pending, ...stream1.rows.filter((row) => !written.has(poolShareKey(row)))];
  const counts = new Map<string | null, number>();
  for (const item of pending) counts.set(item.pool, (counts.get(item.pool) ?? 0) + 1);
  const totals = poolShareTotals(rows, [...counts].map(([pool, count]) => ({ pool, count })));
  /* A trade of stream 1 not yet traced to any pool is counted into every Solana pool's total, so it leaves them all open. */
  const open = new Set(totals.filter((total) => total.network === "solana" && total.pool !== null && total.stream1UsdMicros === null).map((total) => poolKey(total.pool!)));
  return { rows, open };
}

/* ------------------------------------------------------------------------------------------------
 * Founding
 * --------------------------------------------------------------------------------------------- */

/** The Founding seats. A record that exists and cannot be read throws — it is never read as "no seats". */
export async function readFoundingSeats(store: GuardStore): Promise<FoundingRecord> {
  const raw = await store.versioned<FoundingRecord>(FOUNDING_COLLECTION).get(FOUNDING_KEY);
  if (raw === undefined || raw === null) return { version: 0, seats: [] };
  return FoundingRecordSchema.parse(raw);
}

export function seatOf(record: FoundingRecord, wallet: string): FoundingSeat | null {
  return record.seats.find((seat) => seat.wallet === wallet) ?? null;
}

export type FoundingOutcome =
  | Readonly<{ ok: true; seat: FoundingSeat; created: boolean }>
  | Readonly<{ ok: false; code: "INVALID" | "FULL" | "TEAM" | "UNAVAILABLE" | "CONTENDED" }>;

/**
 * Approve an external partner as Founding — the first `foundingSeats` approvals, one seat each, kept for good.
 *
 * The approval is a person's decision (the review of the partner), recorded here with who made it, at the moment
 * it is recorded by the server's own clock — never dated back (`clock` exists for tests alone). A wallet of the team, or one ever linked to a wallet of the team, is never a
 * Founding partner; a team list or a link that could not be read approves nobody. Approving a wallet that already
 * holds a seat returns that seat. The Founding shares apply to what the partner's pools receive from the approval
 * on — never to what they received before it.
 */
export async function approveFoundingPartner(
  store: GuardStore,
  deps: Pick<PartnerDeps, "team">,
  args: Readonly<{ wallet: string; approvedBy: string; rules?: NetworkRules; clock?: () => number }>,
): Promise<FoundingOutcome> {
  const wallet = normalizeWallet("solana", args.wallet);
  const at = (args.clock ?? Date.now)();
  const now = new Date(at).toISOString();
  if (!wallet || !Number.isFinite(at) || !args.approvedBy.trim()) return { ok: false, code: "INVALID" };
  const rules = args.rules ?? networkRulesAt(now);
  const collection = store.versioned<FoundingRecord>(FOUNDING_COLLECTION);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const current = await readFoundingSeats(store);
    const held = seatOf(current, wallet);
    if (held) return { ok: true, seat: held, created: false };
    if (current.seats.length >= rules.foundingSeats) return { ok: false, code: "FULL" };
    const [team, linked] = await Promise.all([deps.team().catch(() => null), everLinked(store, "solana", wallet)]);
    if (team === null || linked.unavailable) return { ok: false, code: "UNAVAILABLE" };
    if ([wallet, ...linked.linked].some((address) => team.has(walletKey(address)))) return { ok: false, code: "TEAM" };
    const seat: FoundingSeat = { seat: current.seats.length + 1, wallet, approvedAt: new Date(at).toISOString(), approvedBy: args.approvedBy.trim().slice(0, 120) };
    const next: FoundingRecord = { version: current.version + 1, seats: [...current.seats, seat] };
    if (await collection.compareAndSet(FOUNDING_KEY, current.version === 0 ? null : current.version, next)) return { ok: true, seat, created: true };
  }
  return { ok: false, code: "CONTENDED" };
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * --------------------------------------------------------------------------------------------- */

export type PoolRunState =
  /** Entries written. */
  | "WRITTEN"
  /** Already what it should be. */
  | "UNCHANGED"
  /** The partner may not earn on this pool; nothing is held (what was, is reversed). */
  | "BLOCKED"
  /** Stream 1 of the pool is not all known yet — no base without it; the next run tries again. */
  | "NO_DATA"
  /** The self-referral check could not be run; the next run tries again. */
  | "UNAVAILABLE"
  /** An earned line names a version this build does not know. */
  | "UNKNOWN_VERSION"
  /** Another run kept writing the same pool. */
  | "CONTENDED";

/** What protection did to the pool in this run: its review's effect, or that the creator is not activated yet. */
export type PoolRunProtection = MoneyEffect["kind"] | "AWAITING_ACTIVATION" | "UNREAD";

export type PoolRunReport = Readonly<{
  network: PartnerNetwork;
  pool: string;
  partner: string;
  state: PoolRunState;
  written: number;
  /** Lines without a dollar figure (a pair with no price at the claim's moment, or after one on the curve), never a base. */
  unvalued: number;
  excluded: number;
  reasons: readonly SelfReferralReason[];
  protection: PoolRunProtection;
}>;

export type NetworkRunReport = Readonly<{
  at: string;
  pools: readonly PoolRunReport[];
  /** `held` — points of a pool whose money may not follow yet (not activated, under review): counted once it may. */
  points: Readonly<{ recorded: number; existing: number; skipped: number; held: number }>;
}>;

type PoolInputs = Readonly<{ claims: readonly PoolShareClaim[]; stream1: readonly PoolShareStream1[]; stream1Open: boolean }>;

/** The journal's rows of one pool, and whether its stream 1 is all known. */
function inputsFor(binding: PoolPartner, rows: Awaited<ReturnType<typeof readPoolShareRows>>, openPools: ReadonlySet<string>): PoolInputs {
  const pool = poolKey(binding.pool);
  const claims: PoolShareClaim[] = [];
  const stream1: PoolShareStream1[] = [];
  for (const row of rows) {
    if (row.network !== binding.network) continue;
    if (row.kind === "STREAM1") {
      if (poolKey(row.pool) === pool) stream1.push(row);
      continue;
    }
    if ((row.pool !== null && poolKey(row.pool) === pool) || row.allocation?.some((slice) => slice.pool !== null && poolKey(slice.pool) === pool)) claims.push(row);
  }
  return { claims, stream1, stream1Open: binding.network === "solana" && openPools.has(pool) };
}

/**
 * Write what every partner's pools have earned, by difference.
 *
 * Reads the pool-share journal, the bindings and the Founding seats; for each
 * bound pool runs the self-referral check again (a profile or link proven after
 * the launch only adds reasons — and a reason, once found, keeps the pool
 * blocked), computes the lines and writes the entries that bring them to what
 * they should hold, then the rank points beside them. A pool whose stream 1 is
 * not all known, or whose check could not run, is left for the next run — a
 * base is never guessed.
 *
 * `registry` is the attribution registry (`/api/stats/registry`), the same the
 * journal reads: only its counted Solana configs give a base.
 */
export async function accrueNetwork(
  store: GuardStore,
  deps: PartnerDeps,
  args: Readonly<{ registry: readonly RegistryRowLike[]; history?: readonly NetworkRules[]; clock?: () => number }>,
): Promise<NetworkRunReport> {
  /* The run's moment is the server's own clock (`clock` exists for tests alone): it starts every hold, so it is never dated back. */
  const nowMs = (args.clock ?? Date.now)();
  if (!Number.isFinite(nowMs)) throw new Error("A run needs a readable moment.");
  const now = new Date(nowMs).toISOString();
  const history = args.history ?? NETWORK_RULES_HISTORY;
  const readJournal = () => readJournalState(store, args.registry, now);
  const [bindings, founding] = await Promise.all([readPartnerBindings(store), readFoundingSeats(store)]);
  let found: FoundReasons;
  let journal: JournalState;
  const configs: CountedConfigs = countedConfigsOf(args.registry, new Set(launchConfigPlans(args.registry).counted.keys()));
  const entriesOf = store.collection<NetworkEntry>(NETWORK_ENTRY_COLLECTION);
  const pools: PoolRunReport[] = [];
  const points = { recorded: 0, existing: 0, skipped: 0, held: 0 };
  for (const binding of bindings) {
    const partner = binding.partner!;
    const prefix = poolEntryPrefix(partner, binding.network, binding.pool);
    /* The pool's entries first, then the journal and the reasons found: both only ever grow, so read after the
       entries they hold every claim and every reason any entry was written from — another run's included. */
    let read = await readEntriesStrict(store, prefix);
    [journal, found] = await Promise.all([readJournal(), readFoundReasons(store)]);
    let existing = read.entries;
    /* The review's decisions and the activation, as they stand now; a decision taken while this run writes is the next run's. */
    const protection = await readProtection(store, binding, now);
    const protectionKind: PoolRunProtection = !protection ? "UNREAD" : protection.effect.kind === "PAY" && !protection.activated ? "AWAITING_ACTIVATION" : protection.effect.kind;
    const idle = (state: PoolRunState): PoolRunReport => ({ network: binding.network, pool: binding.pool, partner, state, written: 0, unvalued: 0, excluded: 0, reasons: binding.checks?.reasons ?? [], protection: protectionKind });
    pools.push(read.unreadable ? idle("NO_DATA") : !protection ? idle("UNAVAILABLE") : await accruePool(protection));
    /* The points beside every entry the pool holds — whatever this run decided about it: only those not written yet,
       so a repeat writes nothing and a crash between an entry and its point is mended here, at the very moment it
       would have had: a base and the decreases that cancel it always name the same moment. The moments come from
       the entries, whose times are the server's own. */
    const lines = new Map<string, NetworkEntry[]>();
    for (const entry of existing) {
      const key = `${entry.line.tx}:${entry.line.index}`;
      lines.set(key, [...(lines.get(key) ?? []), entry]);
    }
    /* A pool with an entry that cannot be read has no points written: a decrease would be split over the wrong bases, for
       good — and one whose protection could not be read has none either. A base counts only while the pool's money may
       follow (its creator activated, no review holding it), from the moment it was let go; a decrease is written only
       against a base that was. */
    if (read.unreadable || !protection) continue;
    const known = new Map((await listRankEvents(store, partner)).filter((event) => event.kind === "PARTNER_POOL").map((event) => [event.ref, event.at] as const));
    for (const line of lines.values()) {
      for (const event of rankEventsOf(line, history, { recorded: known, notBefore: protection.payableFrom })) {
        if (known.has(event.ref)) {
          points.existing += 1;
          continue;
        }
        /* A base is written once its moment has come, never ahead: a pool held after it was written would still lift the rank. */
        if (event.cancels === null ? !protection.payable || Date.parse(event.at) > nowMs : !known.has(event.cancels)) {
          points.held += 1;
          continue;
        }
        const recorded = await recordPartnerPoolBase(store, { partner, ref: event.ref, baseUsdMicros: event.baseUsdMicros, at: event.at, cancelsAt: event.cancelsAt, rulesVersion: event.rulesVersion, now });
        if (recorded.state === "RECORDED" || recorded.state === "EXISTING") known.set(event.ref, event.at);
        if (recorded.state === "RECORDED") points.recorded += 1;
        else if (recorded.state === "EXISTING") points.existing += 1;
        else points.skipped += 1;
      }
    }

    async function accruePool(protection: PoolProtection): Promise<PoolRunReport> {
      const report = (state: PoolRunState, extra: Partial<PoolRunReport> = {}): PoolRunReport => ({
        network: binding.network,
        pool: binding.pool,
        partner,
        state,
        written: 0,
        unvalued: 0,
        excluded: 0,
        reasons: binding.checks?.reasons ?? [],
        protection: protectionKind,
        ...extra,
      });
      const checks = store.collection<FoundReason | CheckClear>(NETWORK_CHECK_COLLECTION);
      /* A reason found once — in the binding, or by an earlier run — keeps the pool blocked: reasons are never removed. */
      const block = blockOf(binding, found);
      let reasons = block.reasons;
      if (!block.blocked) {
        const verdict = await recheckPoolPartner(store, deps, binding).catch(() => null);
        if (!verdict || verdict.status === "unavailable") return report("UNAVAILABLE");
        reasons = [...verdict.reasons];
        for (const reason of reasons) await checks.insertIfAbsent(networkCheckKey(binding.network, binding.pool, reason), { network: binding.network, pool: binding.pool, partner, reason, at: now });
        /* The first clean check of a binding written while a lookup was down: the pool is no longer "not checked yet". */
        if (!reasons.length) await checks.insertIfAbsent(networkClearKey(binding.network, binding.pool), { network: binding.network, pool: binding.pool, partner, clear: true, at: now });
      }
      /* The review's cancellation holds nothing; its adjustment caps what the pool pays. Either names itself on every entry it moves. */
      const cancelled = protection.effect.kind === "CANCEL";
      const ceiling = protection.effect.kind === "CEILING" ? protection.effect.ceilingUsdMicros : null;
      let eligible = !block.blocked && reasons.length === 0 && !cancelled;
      /* Taking back what this run just wrote is a round of its own, never one of the budget for lost writes. */
      let extra = 0;
      for (let round = 0; round < MAX_ROUNDS + extra; round += 1) {
        let lines: readonly PoolLine[] = [];
        let unvalued = 0;
        let excluded = 0;
        if (eligible) {
          /* A registry with nothing counted is a registry that was not read — never "nothing counts". */
          if (binding.network === "solana" && configs.counted.size === 0) return report("NO_DATA", { reasons });
          const inputs = inputsFor(binding, journal.rows, journal.open);
          if (inputs.stream1Open) return report("NO_DATA", { reasons });
          const computed = computePoolLines({
            binding,
            claims: inputs.claims,
            stream1: inputs.stream1,
            seat: seatOf(founding, partner),
            eligible,
            configs,
            stamped: stampedVersions(existing),
            history,
            ceilingUsdMicros: ceiling,
          });
          if (computed.state === "UNKNOWN_VERSION") return report("UNKNOWN_VERSION", { reasons });
          if (computed.state === "NO_DATA") return report("NO_DATA", { reasons });
          lines = computed.lines;
          unvalued = computed.unvalued.length;
          excluded = computed.excluded.length;
        }
        /* A partner who may not earn holds nothing: every written line goes to zero, from the entries alone — no
           registry, journal or version is needed to take back what was earned. Decreases first: a run that stops
           halfway never leaves a pool holding more than it should. */
        /* A move the review made names the review; one a reason of the partner's own made names that. */
        const reviewMoved = reasons.length === 0 && !block.blocked && (cancelled || ceiling !== null);
        const writes = planEntries({ binding, partner, lines, existing, eligible, now, ...(reviewMoved ? { reason: "REVIEW" as const } : {}) })
          .map((entry) => NetworkEntrySchema.parse(entry))
          .sort((a, b) => Number(BigInt(a.usdMicros) >= 0n) - Number(BigInt(b.usdMicros) >= 0n));
        let lost = false;
        for (const entry of writes) {
          if (await entriesOf.insertIfAbsent(networkEntryKey(entry), entry)) {
            existing = [...existing, entry];
            continue;
          }
          lost = true;
          break;
        }
        if (lost) {
          /* Another run wrote this pool meanwhile: read the entries, the journal and the reasons found again, then decide anew. */
          read = await readEntriesStrict(store, prefix);
          [journal, found] = await Promise.all([readJournal(), readFoundReasons(store)]);
          existing = read.entries;
          if (read.unreadable) return report("NO_DATA", { reasons });
          const again = blockOf(binding, found);
          if (again.blocked) {
            reasons = [...new Set([...reasons, ...again.reasons])];
            eligible = false;
          }
          continue;
        }
        /* A reason another run found while this one was writing takes back, in this same run, what it just wrote. */
        if (eligible && writes.length) {
          found = await readFoundReasons(store);
          const later = blockOf(binding, found);
          if (later.blocked) {
            reasons = [...new Set([...reasons, ...later.reasons])];
            eligible = false;
            extra = 1;
            continue;
          }
        }
        return report(!eligible ? "BLOCKED" : writes.length ? "WRITTEN" : "UNCHANGED", { written: writes.length, unvalued, excluded, reasons });
      }
      return report("CONTENDED", { reasons });
    }
  }
  return { at: now, pools, points };
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * --------------------------------------------------------------------------------------------- */

export type PartnerPoolView = Readonly<{
  network: PartnerNetwork;
  pool: string;
  factory: string;
  creator: string;
  launchedAt: string;
  partnerCode: string | null;
  /**
   * `EARNING` — the pool has paid Ryntra; `WAITING` — not yet; `BLOCKED` — the partner may not earn on it (the
   * review ledger, with its reasons; in the partner's own read only a pool the reviewer cancelled, with no reason);
   * `REVIEW` — not earning while it is looked at. The partner's own read
   * shows every blocked pool, whatever the reason, and every pool whose check has not run yet as `REVIEW`, with no
   * reason and no day: what it says is the same whether the wallet was the team's, linked to the partner or not
   * checked yet. `NOT_COUNTED` — a launch on the demo market, which earns nobody anything.
   */
  status: "EARNING" | "WAITING" | "BLOCKED" | "REVIEW" | "NOT_COUNTED";
  /**
   * `NO_DATA` — an input of the pool is missing (stream 1 not all known, a config the registry cannot place), so its
   * figures are what was written before and may be short: never read as a zero. `OK` for a pool under review.
   */
  data: "OK" | "NO_DATA";
  /** Claims Ryntra received with no dollar figure at their moment: they earn nothing, and are counted here. */
  unvaluedClaims: number;
  /** Why it is blocked — the review ledger only; empty in the partner's own read. */
  reasons: readonly SelfReferralReason[];
  /** The review ledger only: blocked by a reason row this build cannot read. Always false in the partner's own read. */
  unreadableReason: boolean;
  /** Null — no fee received yet, or a pool under review in the partner's own read. */
  firstReceivedAt: string | null;
  tier: NetworkTier;
  day: number | null;
  /** The share the pool earns now, basis points, and when the current step ends (null — it does not). */
  shareBps: number;
  shareUntil: string | null;
  rulesVersion: string;
  /** The partner's share of what Ryntra has not claimed yet — an estimate from the pool's counters; null when not read. */
  inPoolUsdMicros: string | null;
  baseUsdMicros: string;
  earnedUsdMicros: string;
  pendingUsdMicros: string;
  availableUsdMicros: string;
  nextAvailableAt: string | null;
  /** The cap of the pool's base, and whether everything earned stays within it. */
  capUsdMicros: string;
  withinCap: boolean;
  /** The creator counts (three independent external addresses within thirty days): until then nothing is available. */
  activated: boolean;
  /**
   * The partner's own question to the reviewer on this pool, still to be answered — their own action, so it tells
   * them nothing they did not do. No due date: a case's clock starts with the case, not the question, and would tell a
   * pool under signals from one blocked without a case.
   */
  asked: boolean;
  /**
   * Past its hold but not available: the creator is not activated yet, or the review holds the pool. `available` is
   * what may be paid; `held` waits — the two together are what the hold alone would have made available.
   */
  heldUsdMicros: string;
  /**
   * The pool may pay now: checked and not blocked, not the demo market, its creator activated, no review holding or
   * closing it, within the reviewer's amount, its inputs whole and its sum within its cap. A payout takes only from such pools — and a debt (a reversal after a
   * payout) from any.
   */
  payable: boolean;
  /** The review ledger only: the case of the pool and of the partner's wallet, and what it does to the money. Null in the partner's own read. */
  review: Readonly<{
    effect: MoneyEffect["kind"];
    ceilingUsdMicros: string | null;
    pool: Pick<CaseView, "state" | "signals" | "trust" | "openedAt" | "dueAt" | "overdue" | "appealed" | "decision" | "frozen">;
    wallet: Pick<CaseView, "state" | "dueAt" | "overdue" | "appealed" | "decision" | "frozen">;
  }> | null;
}>;

export type PartnerNetworkView = Readonly<{
  partner: string;
  rulesVersion: string;
  founding: Readonly<{ seat: number; approvedAt: string }> | null;
  pools: readonly PartnerPoolView[];
  /** `complete` false — a pool's inputs are missing, so the sums may be short. */
  totals: Readonly<{ complete: boolean; inPoolUsdMicros: string | null; earnedUsdMicros: string; pendingUsdMicros: string; availableUsdMicros: string; heldUsdMicros: string }>;
}>;

type ViewInputs = Readonly<{
  bindings: readonly PoolPartner[];
  found: FoundReasons;
  journal: JournalState;
  cleared: ReadonlySet<string>;
  entries: readonly NetworkEntry[];
  rows: Awaited<ReturnType<typeof readPoolShareRows>>;
  founding: FoundingRecord;
  counters?: PoolCounters;
  now: string;
  history: readonly NetworkRules[];
  /** The ledger's review sees every reason; the partner's own read never sees the team's. */
  allReasons: boolean;
  configs: CountedConfigs;
  logs: Awaited<ReturnType<typeof readAllEvents>>;
  activations: Awaited<ReturnType<typeof readActivations>>;
}>;

function poolView(binding: PoolPartner, inputs: ViewInputs): PartnerPoolView {
  const partner = binding.partner!;
  const entries = inputs.entries.filter((entry) => entry.partner === partner && entry.network === binding.network && poolKey(entry.pool) === poolKey(binding.pool));
  const states = entryStates(entries, inputs.now, inputs.history);
  const seat = seatOf(inputs.founding, partner);
  const claims = inputsFor(binding, inputs.rows, new Set());
  /* The first fee Ryntra received, from the same computation the run makes (eligibility does not move it). */
  /* Neither eligibility nor a version moves the first received fee, so it is read without either; the demo
     market's claims are not fees. */
  const notCounted = binding.network === "solana" && inputs.configs.demo.has(binding.factory);
  const computed = computePoolLines({ binding, claims: notCounted ? [] : claims.claims, stream1: claims.stream1, seat, eligible: true, configs: null, history: inputs.history });
  /* Whether the pool's figures are whole, by the same rules the run decides by: a missing input is "no data", never a zero. */
  const checked = computePoolLines({ binding, claims: claims.claims, stream1: claims.stream1, seat, eligible: true, configs: inputs.configs, stamped: stampedVersions(entries), history: inputs.history });
  const noData =
    !notCounted &&
    ((binding.network === "solana" && inputs.configs.counted.size === 0) || (binding.network === "solana" && inputs.journal.open.has(poolKey(binding.pool))) || checked.state !== "OK");
  const firstReceivedAt = computed.state === "OK" ? computed.firstReceivedAt : null;
  const share = shareNow({ seat, firstReceivedAt, now: inputs.now, history: inputs.history });
  const { reasons, blocked, unreadable } = blockOf(binding, inputs.found);
  const unchecked = !blocked && binding.checks?.status === "unavailable" && entries.length === 0 && !inputs.cleared.has(networkCheckPrefix(binding.network, binding.pool));
  const logOf = (subject: string) => ({
    events: inputs.logs.bySubject.get(subject) ?? [],
    unreadable: (inputs.logs.unreadable.get(subject) ?? 0) + (inputs.logs.unreadable.get("*") ?? 0),
  });
  const protection = protectionOf(
    binding,
    { pool: logOf(poolSubject(binding.network, binding.pool)), wallet: logOf(walletSubject(partner)) },
    inputs.activations.records.get(activationKey(binding.network, binding.pool)) ?? null,
    inputs.now,
  );
  /* A case open, a freeze or a cancellation: the review holds the pool. */
  const reviewing = protection.effect.kind === "HOLD" || protection.effect.kind === "CANCEL";
  /* The partner's own read says "under review" for any reason at all, for a check not run yet and for an open case.
     A case the reviewer closed by cancelling is no longer looked at: it reads as not counted, never as a review
     still to answer — and, like every other closed state, without its reason. */
  const review = unchecked || (blocked && !inputs.allReasons) || (protection.effect.kind === "HOLD" && !inputs.allReasons) || (inputs.allReasons && protection.effect.kind === "HOLD" && !blocked);
  /* What the partner's own read hides; the review ledger sees a held pool's figures whole. */
  const hidden = unchecked || (!inputs.allReasons && (blocked || reviewing));
  const quiet = blocked || hidden || notCounted;
  const counter = inputs.counters?.get(countersKey(binding.network, binding.pool));
  let inPool: string | null = null;
  if (hidden) inPool = null;
  else if (blocked || notCounted) inPool = "0";
  else if (counter && counter.receivedUsdMicros !== null) {
    const open = computed.state === "OK" ? computed.openOffsetUsdMicros : 0n;
    const base = BigInt(counter.receivedUsdMicros) - open;
    inPool = (((base > 0n ? base : 0n) * BigInt(share.rateBps)) / 10_000n).toString();
  }
  /* The same cap the reconciliation holds the pool to: the widest of the versions its lines were earned under. */
  const earnedUnder = new Set(entries.filter((entry) => entry.seq === 0).map((entry) => entry.rulesVersion));
  const capBps = earnedUnder.size ? Math.max(...inputs.history.filter((rules) => earnedUnder.has(rules.version)).map((rules) => rules.poolCapBps), 0) : share.poolCapBps;
  const cap = (states.baseUsdMicros * BigInt(capBps)) / 10_000n;
  /* What the hold has let go is paid only while the pool may pay: its creator activated and no review holding it —
     and, under an adjustment, only once the entries are within the reviewer's amount (the next run cuts them). */
  const overCeiling = protection.effect.kind === "CEILING" && states.earnedUsdMicros > protection.effect.ceilingUsdMicros;
  const held = protection.payable && !overCeiling ? 0n : states.availableUsdMicros;
  const pick = <T extends object, K extends keyof T>(value: T, keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
  return {
    network: binding.network,
    pool: binding.pool,
    factory: binding.factory,
    creator: binding.creator,
    launchedAt: binding.launchedAt,
    partnerCode: binding.partnerCode,
    status: review ? "REVIEW" : blocked || protection.effect.kind === "CANCEL" ? "BLOCKED" : notCounted ? "NOT_COUNTED" : firstReceivedAt ? "EARNING" : "WAITING",
    data: hidden || !noData ? "OK" : "NO_DATA",
    unvaluedClaims: hidden || checked.state !== "OK" ? 0 : checked.unvalued.length,
    reasons: inputs.allReasons ? reasons : [],
    unreadableReason: inputs.allReasons && unreadable,
    firstReceivedAt: hidden ? null : firstReceivedAt,
    tier: share.tier,
    day: hidden ? null : share.day,
    shareBps: quiet ? 0 : share.rateBps,
    shareUntil: quiet ? null : share.until,
    rulesVersion: share.rulesVersion,
    inPoolUsdMicros: inPool,
    baseUsdMicros: states.baseUsdMicros.toString(),
    earnedUsdMicros: states.earnedUsdMicros.toString(),
    pendingUsdMicros: states.pendingUsdMicros.toString(),
    availableUsdMicros: (states.availableUsdMicros - held).toString(),
    nextAvailableAt: states.nextAvailableAt,
    capUsdMicros: cap.toString(),
    withinCap: states.earnedUsdMicros <= cap,
    activated: protection.activated,
    heldUsdMicros: held.toString(),
    /* Paid only from a pool whose figures are whole and within its cap: a pool short of an input, or over its cap, waits for the run that mends it. */
    payable: !unchecked && !blocked && !notCounted && !noData && protection.payable && !overCeiling && states.earnedUsdMicros <= cap,
    asked: protection.pool.appealed,
    review: inputs.allReasons
      ? {
          effect: protection.effect.kind,
          ceilingUsdMicros: protection.effect.kind === "CEILING" ? protection.effect.ceilingUsdMicros.toString() : null,
          pool: pick(protection.pool, ["state", "signals", "trust", "openedAt", "dueAt", "overdue", "appealed", "decision", "frozen"] as const),
          wallet: pick(protection.wallet, ["state", "dueAt", "overdue", "appealed", "decision", "frozen"] as const),
        }
      : null,
  };
}

function partnerView(partner: string, bindings: readonly PoolPartner[], inputs: ViewInputs): PartnerNetworkView {
  const pools = bindings
    .filter((binding) => binding.partner === partner)
    .map((binding) => poolView(binding, inputs))
    .sort((a, b) => b.launchedAt.localeCompare(a.launchedAt));
  const sum = (pick: (pool: PartnerPoolView) => string) => pools.reduce((total, pool) => total + BigInt(pick(pool)), 0n).toString();
  const seat = seatOf(inputs.founding, partner);
  return {
    partner,
    rulesVersion: networkRulesAt(inputs.now, inputs.history).version,
    founding: seat ? { seat: seat.seat, approvedAt: seat.approvedAt } : null,
    pools,
    totals: {
      complete: !pools.some((pool) => pool.data === "NO_DATA"),
      /* A pool under review holds nothing in the pool for its partner; only a counter not read leaves the total open. */
      inPoolUsdMicros: pools.some((pool) => pool.inPoolUsdMicros === null && pool.status !== "REVIEW") ? null : sum((pool) => pool.inPoolUsdMicros ?? "0"),
      earnedUsdMicros: sum((pool) => pool.earnedUsdMicros),
      pendingUsdMicros: sum((pool) => pool.pendingUsdMicros),
      availableUsdMicros: sum((pool) => pool.availableUsdMicros),
      heldUsdMicros: sum((pool) => pool.heldUsdMicros),
    },
  };
}

/** The registry's counted and demo configs; the registry in code when none is given. */
function configsOf(registry: readonly RegistryRowLike[] = ATTRIBUTION_REGISTRY): CountedConfigs {
  return countedConfigsOf(registry, new Set(launchConfigPlans(registry).counted.keys()));
}

/**
 * One partner's pools and sums by state — the read the Rewards page builds on.
 *
 * Read from what the run wrote, never recomputed into money: the figures are
 * the entries. `counters` (the pools' own unclaimed fees, read from the chain
 * by the caller) adds the estimate of what is still in the pool; without it
 * that figure is null — not read, not zero.
 */
export async function readPartnerNetwork(
  store: GuardStore,
  partner: string,
  args: Readonly<{ now: string; counters?: PoolCounters; history?: readonly NetworkRules[]; registry?: readonly RegistryRowLike[] }>,
): Promise<PartnerNetworkView> {
  const registry = args.registry ?? ATTRIBUTION_REGISTRY;
  const [bindings, entries, founding, cleared] = await Promise.all([readPartnerBindings(store, partner), readEntriesOrThrow(store, partnerEntryPrefix(partner)), readFoundingSeats(store), readCleared(store)]);
  /* Read after the entries, as the run does: everything an entry came from is in them. */
  const [journal, found, logs, activations] = await Promise.all([readJournalState(store, registry, args.now), readFoundReasons(store), readAllEvents(store), readActivations(store)]);
  return partnerView(partner, bindings, { bindings, found, journal, cleared, entries, rows: journal.rows, founding, counters: args.counters, now: args.now, history: args.history ?? NETWORK_RULES_HISTORY, allReasons: false, configs: configsOf(registry), logs, activations });
}

export type NetworkLedger = Readonly<{
  at: string;
  rulesVersion: string;
  founding: readonly FoundingSeat[];
  partners: readonly PartnerNetworkView[];
  totals: PartnerNetworkView["totals"];
  /**
   * Bound pools still holding Ryntra's part unclaimed, by the counters read: on Solana it reaches Ryntra — and a
   * partner's base — only when the safe claims it. The reminder that a claim is due; empty without counters.
   */
  awaitingClaim: readonly Readonly<{ network: PartnerNetwork; pool: string; partner: string; receivedRaw: string; mint: string; receivedUsdMicros: string | null; readAt: string }>[];
}>;

/** Every partner of the programme, with every reason — the review of the shadow ledger. */
export async function readNetworkLedger(
  store: GuardStore,
  args: Readonly<{ now: string; counters?: PoolCounters; history?: readonly NetworkRules[]; registry?: readonly RegistryRowLike[] }>,
): Promise<NetworkLedger> {
  const history = args.history ?? NETWORK_RULES_HISTORY;
  const registry = args.registry ?? ATTRIBUTION_REGISTRY;
  const [bindings, entries, founding, cleared] = await Promise.all([readPartnerBindings(store), readEntriesOrThrow(store, ""), readFoundingSeats(store), readCleared(store)]);
  const [journal, found, logs, activations] = await Promise.all([readJournalState(store, registry, args.now), readFoundReasons(store), readAllEvents(store), readActivations(store)]);
  const inputs: ViewInputs = { bindings, found, journal, cleared, entries, rows: journal.rows, founding, counters: args.counters, now: args.now, history, allReasons: true, configs: configsOf(registry), logs, activations };
  const partners = [...new Set(bindings.map((binding) => binding.partner!))].sort().map((partner) => partnerView(partner, bindings, inputs));
  const sum = (pick: (view: PartnerNetworkView) => string | null) => partners.reduce((total, view) => total + BigInt(pick(view) ?? "0"), 0n).toString();
  return {
    at: args.now,
    rulesVersion: networkRulesAt(args.now, history).version,
    founding: founding.seats,
    partners,
    awaitingClaim: bindings.flatMap((binding) => {
      const counter = args.counters?.get(countersKey(binding.network, binding.pool));
      /* A pair that is not a dollar is listed too, unvalued: the claim is due all the same. */
      return counter && BigInt(counter.receivedRaw) > 0n
        ? [{ network: binding.network, pool: binding.pool, partner: binding.partner!, receivedRaw: counter.receivedRaw, mint: counter.mint, receivedUsdMicros: counter.receivedUsdMicros, readAt: counter.readAt }]
        : [];
    }),
    totals: {
      complete: partners.every((view) => view.totals.complete),
      inPoolUsdMicros: partners.some((view) => view.totals.inPoolUsdMicros === null) ? null : sum((view) => view.totals.inPoolUsdMicros),
      earnedUsdMicros: sum((view) => view.totals.earnedUsdMicros),
      pendingUsdMicros: sum((view) => view.totals.pendingUsdMicros),
      availableUsdMicros: sum((view) => view.totals.availableUsdMicros),
      heldUsdMicros: sum((view) => view.totals.heldUsdMicros),
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The reconciliation
 * --------------------------------------------------------------------------------------------- */

export type NetworkCheck = Readonly<{
  ok: boolean;
  /** Entries that could not be read — the ledger is not whole while there are any. */
  unreadable: number;
  pools: readonly Readonly<{
    network: PartnerNetwork;
    pool: string;
    partner: string;
    /** Σ of the written entries. */
    writtenUsdMicros: string;
    writtenBaseUsdMicros: string;
    /** Σ of the lines the journal gives now: the share of each line's base, after the cap. */
    expectedUsdMicros: string;
    expectedBaseUsdMicros: string;
    capUsdMicros: string;
    withinCap: boolean;
    /** Lines whose written sum differs from what they should hold. */
    drift: readonly Readonly<{ line: string; written: string; expected: string }>[];
  }>[];
}>;

/**
 * "What was earned is the share of the base": every pool's written entries
 * against the lines the journal gives now, line by line, and every pool's sum
 * against its cap. Uses the checks already recorded (the binding's and the
 * reversals'), so it runs without any lookup; a pool the run deferred shows as
 * drift until the run writes it.
 */
export async function checkNetworkLedger(
  store: GuardStore,
  args: Readonly<{ registry: readonly RegistryRowLike[]; history?: readonly NetworkRules[] }>,
): Promise<NetworkCheck> {
  const history = args.history ?? NETWORK_RULES_HISTORY;
  const [bindings, read, rows, founding, found, logs] = await Promise.all([readPartnerBindings(store), readEntriesStrict(store, ""), readPoolShareRows(store), readFoundingSeats(store), readFoundReasons(store), readAllEvents(store)]);
  const entries = read.entries;
  const configs: CountedConfigs = countedConfigsOf(args.registry, new Set(launchConfigPlans(args.registry).counted.keys()));
  const pools = [];
  let ok = true;
  for (const binding of bindings) {
    const partner = binding.partner!;
    const own = entries.filter((entry) => entry.partner === partner && entry.network === binding.network && poolKey(entry.pool) === poolKey(binding.pool));
    const logOf = (subject: string) => ({ events: logs.bySubject.get(subject) ?? [], unreadable: (logs.unreadable.get(subject) ?? 0) + (logs.unreadable.get("*") ?? 0) });
    const { effect } = protectionOf(binding, { pool: logOf(poolSubject(binding.network, binding.pool)), wallet: logOf(walletSubject(partner)) }, null, new Date().toISOString());
    const eligible = !blockOf(binding, found).blocked && effect.kind !== "CANCEL";
    const inputs = inputsFor(binding, rows, new Set());
    const computed = computePoolLines({
      binding,
      claims: inputs.claims,
      stream1: inputs.stream1,
      seat: seatOf(founding, partner),
      eligible,
      configs,
      stamped: stampedVersions(own),
      history,
      ceilingUsdMicros: effect.kind === "CEILING" ? effect.ceilingUsdMicros : null,
    });
    const lines: readonly PoolLine[] = computed.state === "OK" ? computed.lines : [];
    const sums = sumLines(own);
    const drift: Array<{ line: string; written: string; expected: string }> = [];
    const keys = new Set([...lines.map((line) => line.key), ...sums.keys()]);
    for (const key of keys) {
      const line = lines.find((candidate) => candidate.key === key);
      const written = sums.get(key);
      const expected = line?.usdMicros ?? 0n;
      const expectedBase = line?.baseUsdMicros ?? 0n;
      if ((written?.amount ?? 0n) !== expected || (written?.base ?? 0n) !== expectedBase) drift.push({ line: key, written: (written?.amount ?? 0n).toString(), expected: expected.toString() });
    }
    const writtenAmount = [...sums.values()].reduce((sum, line) => sum + line.amount, 0n);
    const writtenBase = [...sums.values()].reduce((sum, line) => sum + line.base, 0n);
    /* Each line keeps its version's cap; the pool's sum is held to the widest of the versions it was earned under. */
    const versions = new Set(own.filter((entry) => entry.seq === 0).map((entry) => entry.rulesVersion));
    const capBps = Math.max(0, ...history.filter((rules) => versions.has(rules.version)).map((rules) => rules.poolCapBps));
    const cap = (writtenBase * BigInt(capBps)) / 10_000n;
    const withinCap = writtenAmount <= cap && writtenAmount >= 0n;
    if (drift.length || !withinCap || computed.state !== "OK") ok = false;
    pools.push({
      network: binding.network,
      pool: binding.pool,
      partner,
      writtenUsdMicros: writtenAmount.toString(),
      writtenBaseUsdMicros: writtenBase.toString(),
      expectedUsdMicros: lines.reduce((sum, line) => sum + line.usdMicros, 0n).toString(),
      expectedBaseUsdMicros: lines.reduce((sum, line) => sum + line.baseUsdMicros, 0n).toString(),
      capUsdMicros: cap.toString(),
      withinCap,
      drift,
    });
  }
  return { ok: ok && read.unreadable === 0, unreadable: read.unreadable, pools };
}
