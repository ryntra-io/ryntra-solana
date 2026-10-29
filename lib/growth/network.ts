import { z } from "zod";

import {
  NETWORK_DAY_MS,
  NETWORK_RULES_HISTORY,
  networkDay,
  networkRulesAt,
  networkRulesOf,
  networkShareBps,
  networkStepEnds,
  type NetworkRules,
  NETWORK_TIERS,
  type NetworkTier,
} from "../rewards/network-rules.ts";
import { PARTNER_NETWORKS, type PartnerNetwork, type PoolPartner, type SelfReferralReason, walletKey } from "./partner.ts";
import { POOL_SHARE_SOURCES, type PoolShareClaim, type PoolShareSource, type PoolShareStream1, type RegistryRowLike } from "./pool-share.ts";

/**
 * The shadow ledger of the Ryntra Network: what each creator partner has
 * earned from the launch pools of the creators they brought — computed,
 * held and shown, never paid.
 *
 * ## The base, line by line
 *
 * A line is one claim of the pool-share journal (or one pool's slice of a
 * claim split over pools): the money Ryntra actually took out of the pool.
 * Its base is Ryntra's received part of it, in dollars, less what the pool's
 * own trades already paid back to traders and their friends from the same
 * money — stream 1 on the curve's trades, which takes from the partner's part
 * of the curve fee before a `curve` claim takes the rest. Stream 1 is netted
 * against the `curve` claims that follow it, oldest first; a migration fee,
 * a surplus or a position's fees carry none of it, and stream 1 in the
 * graduated pool is Meteora's referral alone, which no claim of the pool ever
 * carries.
 *
 * What the journal already decided is not decided again: Micro's rows hold
 * Ryntra's three quarters, the demo market's claims are never written, a
 * Community claim without a price at its moment has no dollar figure — and a
 * line without one earns nothing ("no data", never zero).
 *
 * ## The share and the cap
 *
 * The share is the Network's rules on the line's day (whole days from the
 * pool's first received fee) for the partner's tier at the claim's moment.
 * Everything a pool pays together stays within the cap of its base: the cap
 * is applied to the running sums of each pool, not inferred from the rates.
 *
 * ## Written by difference, never rewritten
 *
 * Entries are append-only. A run computes what each line should hold and
 * writes only the difference from what its entries already hold — the first
 * entry of a line is `EARNED`, a decrease is a `REVERSAL` (a negative entry),
 * an increase a `CORRECTION`. A repeated run therefore writes nothing, a run
 * that crashed halfway is finished by the next, and a mistake is undone by a
 * reversal that stays in the history beside it.
 *
 * ## States
 *
 * In the pool (Ryntra has not claimed it yet — an estimate read from the
 * pool's own counters, shown and never written) → earned (a written line) →
 * pending for the hold → available. Paying is a later step of its own.
 */

export const NETWORK_ENTRY_COLLECTION = "growthPartnerEntries" as const;
/** Reasons a pool's partner may not earn that a run found after the binding was written — one row per reason. */
export const NETWORK_CHECK_COLLECTION = "growthPartnerChecks" as const;
export const FOUNDING_COLLECTION = "growthFoundingPartners" as const;
export const FOUNDING_KEY = "seats" as const;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNED = /^(?:0|-?[1-9][0-9]*)$/;
const AT = z.string().datetime({ offset: true });

export const NETWORK_ENTRY_KINDS = ["EARNED", "REVERSAL", "CORRECTION"] as const;
export type NetworkEntryKind = (typeof NETWORK_ENTRY_KINDS)[number];

/**
 * Why an entry was written: a new line, a partner found to be themselves, a line whose inputs changed, or the review's
 * decision — an amount lowered or returned with its reason in the review log.
 */
export const NETWORK_ENTRY_REASONS = ["CLAIM", "SELF_REFERRAL", "RECOMPUTED", "REVIEW"] as const;
export type NetworkEntryReason = (typeof NETWORK_ENTRY_REASONS)[number];

export const NetworkEntrySchema = z
  .object({
    schema: z.literal(1),
    kind: z.enum(NETWORK_ENTRY_KINDS),
    reason: z.enum(NETWORK_ENTRY_REASONS),
    partner: z.string().regex(SOLANA_ADDRESS),
    network: z.enum(PARTNER_NETWORKS),
    pool: z.string().min(32).max(66),
    factory: z.string().min(32).max(66),
    creator: z.string().min(32).max(64),
    /** The claim the line comes from. */
    line: z
      .object({ tx: z.string().min(1).max(120), index: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/), source: z.enum(POOL_SHARE_SOURCES), at: AT })
      .strict(),
    /** 0 for the line's first entry, then 1, 2… — with the line, the duplicate defence. */
    seq: z.number().int().nonnegative(),
    /** This entry's change to the line's base, USD micro-units. */
    baseUsdMicros: z.string().regex(SIGNED),
    /** This entry's change to the partner's share of it, USD micro-units. */
    usdMicros: z.string().regex(SIGNED),
    /** The line as it stands after this entry: its share, tier and day, and the version it is computed by. */
    rateBps: z.number().int().min(0).max(10_000),
    tier: z.enum(NETWORK_TIERS),
    day: z.number().int().positive(),
    rulesVersion: z.string().regex(/^network-[0-9]+\.[0-9]+\.[0-9]+$/),
    recordedAt: AT,
  })
  .strict()
  .refine((entry) => (entry.kind === "EARNED") === (entry.seq === 0), "a line's first entry is the one it was earned by")
  .refine((entry) => entry.kind !== "REVERSAL" || entry.usdMicros.startsWith("-") || (entry.usdMicros === "0" && entry.baseUsdMicros.startsWith("-")), "a reversal takes away");
export type NetworkEntry = z.output<typeof NetworkEntrySchema>;

/** A pool's one spelling: an EVM pool id (an address or a 32-byte id) lower-case, a Solana address as it is. */
export function poolKey(pool: string): string {
  return /^0x[0-9a-fA-F]+$/.test(pool) ? pool.toLowerCase() : walletKey(pool);
}

/** The line's own key: one claim, one pool. */
export function lineKey(network: PartnerNetwork, pool: string, tx: string, index: string): string {
  return `${network}:${pool}:${tx}:${index}`;
}

/** Every entry of a partner, for `valuesWithPrefix`. */
export function partnerEntryPrefix(partner: string): string {
  return `${partner}:`;
}

/** Every entry of one partner's pool. */
export function poolEntryPrefix(partner: string, network: PartnerNetwork, pool: string): string {
  return `${partner}:${network}:${pool}:`;
}

export function networkEntryKey(entry: Pick<NetworkEntry, "partner" | "network" | "pool" | "line" | "seq">): string {
  return `${entry.partner}:${lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index)}:${entry.seq}`;
}

export function networkCheckPrefix(network: PartnerNetwork, pool: string): string {
  return `pool:${network}:${poolKey(pool)}:`;
}

export function networkCheckKey(network: PartnerNetwork, pool: string, reason: SelfReferralReason): string {
  return `${networkCheckPrefix(network, pool)}${reason}`;
}

/** A run's first clean check of a pool whose binding was written while a lookup was down. */
export function networkClearKey(network: PartnerNetwork, pool: string): string {
  return `clear:${network}:${poolKey(pool)}`;
}

/** The rank event's reference for an entry: the line and its place. */
export function networkEntryRef(entry: Pick<NetworkEntry, "network" | "pool" | "line" | "seq">): string {
  return `${lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index)}:${entry.seq}`;
}

/* ------------------------------------------------------------------------------------------------
 * Founding
 * --------------------------------------------------------------------------------------------- */

export const FoundingSeatSchema = z
  .object({ seat: z.number().int().positive(), wallet: z.string().regex(SOLANA_ADDRESS), approvedAt: AT, approvedBy: z.string().min(1).max(120) })
  .strict();
export type FoundingSeat = z.output<typeof FoundingSeatSchema>;

export const FoundingRecordSchema = z.object({ version: z.number().int().nonnegative(), seats: z.array(FoundingSeatSchema) }).strict();
export type FoundingRecord = z.output<typeof FoundingRecordSchema>;

/** The tier a partner holds at a moment: Founding from their approval on, Standard before and without one. */
export function tierAt(seat: FoundingSeat | null, at: string): NetworkTier {
  return seat && Date.parse(seat.approvedAt) <= Date.parse(at) ? "FOUNDING" : "STANDARD";
}

/* ------------------------------------------------------------------------------------------------
 * Lines
 * --------------------------------------------------------------------------------------------- */

export type PoolLine = Readonly<{
  key: string;
  tx: string;
  index: string;
  source: PoolShareSource;
  at: string;
  /** Ryntra's received part of the line, USD micros. */
  receivedUsdMicros: bigint;
  /** Stream 1 netted against it. */
  offsetUsdMicros: bigint;
  /** What the share is a share of. */
  baseUsdMicros: bigint;
  rateBps: number;
  tier: NetworkTier;
  day: number;
  rulesVersion: string;
  /** The partner's share after the cap; zero for a partner who may not earn. */
  usdMicros: bigint;
  /** The cap took part of it. */
  capped: boolean;
}>;

export type ExcludedLine = Readonly<{ tx: string; index: string; reason: string }>;

export type PoolComputation =
  | Readonly<{
      state: "OK";
      lines: readonly PoolLine[];
      /** Valued and not: the pool's first fee Ryntra received, the day its earning began. */
      firstReceivedAt: string | null;
      unvalued: readonly Readonly<{ tx: string; index: string }>[];
      excluded: readonly ExcludedLine[];
      /** Stream 1 of the curve's trades no claim has netted yet — it comes off the next `curve` claim. */
      openOffsetUsdMicros: bigint;
    }>
  | Readonly<{ state: "UNKNOWN_VERSION"; version: string }>
  /** A claim of a config the registry does not name: whether it counts is not known, so nothing is decided. */
  | Readonly<{ state: "NO_DATA"; reason: string }>;

/**
 * The Solana configs the attribution registry names: those whose claims are Ryntra's, and the demo market's, which
 * count nothing by design. A config the registry names but cannot place (no claimer, two claimers, a claimer that
 * is not the executor) is in neither: whether it counts is not known.
 */
export type CountedConfigs = Readonly<{ counted: ReadonlySet<string>; demo: ReadonlySet<string> }>;

/** `CountedConfigs` from the registry's rows and `launchConfigPlans`' counted set. */
export function countedConfigsOf(rows: readonly RegistryRowLike[], counted: ReadonlySet<string>): CountedConfigs {
  const demo = new Set(
    rows
      .filter((row) => row.network === "solana" && row.role === "LAUNCH_CONFIG" && row.address && (row.technicalValidation || (row.countedAs !== undefined && row.countedAs !== "FEES")))
      .map((row) => row.address!),
  );
  return { counted, demo };
}

/** One pool's part of a journal claim, or null when the claim does not credit it. */
export function sliceOf(claim: PoolShareClaim, pool: string): Readonly<{ receivedRaw: bigint; usdMicros: string | null }> | null {
  if (claim.allocation) {
    const parts = claim.allocation.filter((slice) => slice.pool !== null && poolKey(slice.pool) === poolKey(pool));
    if (!parts.length) return null;
    const usd = parts.some((slice) => slice.usdMicros === null) ? null : parts.reduce((sum, slice) => sum + BigInt(slice.usdMicros!), 0n).toString();
    return { receivedRaw: parts.reduce((sum, slice) => sum + BigInt(slice.receivedRaw), 0n), usdMicros: usd };
  }
  if (claim.pool === null || poolKey(claim.pool) !== poolKey(pool)) return null;
  return { receivedRaw: BigInt(claim.receivedRaw), usdMicros: claim.usdMicros };
}

/**
 * Every line one pool's partner should hold, from the journal alone.
 *
 * `claims` are the journal's claims that credit the pool, `stream1` its
 * stream-1 rows; `configs` the Solana configs the attribution registry names —
 * a claim of a config it marks as counting nothing (the demo market) is left
 * out, so it can never become a base even if a row of it were written, and a
 * claim of a config it does not name at all makes the pool "no data": a
 * registry that could not be read is never "nothing counts". `stamped`
 * is the version each already-earned line was earned under: it keeps it.
 * `eligible` false — the partner may not earn (themselves, or the team): every
 * line is zero, base included, so nothing is earned and no point is counted.
 */
export function computePoolLines(
  args: Readonly<{
    binding: PoolPartner;
    claims: readonly PoolShareClaim[];
    stream1: readonly PoolShareStream1[];
    seat: FoundingSeat | null;
    eligible: boolean;
    configs: CountedConfigs | null;
    stamped?: ReadonlyMap<string, string>;
    history?: readonly NetworkRules[];
    /** The review's adjustment: the most the pool pays its partner in all, applied like the cap on the running sum. */
    ceilingUsdMicros?: bigint | null;
  }>,
): PoolComputation {
  const history = args.history ?? NETWORK_RULES_HISTORY;
  const { binding } = args;
  const excluded: ExcludedLine[] = [];
  const candidates: Array<{ claim: PoolShareClaim; receivedRaw: bigint; usdMicros: string | null }> = [];
  const seen = new Set<string>();
  for (const claim of args.claims) {
    const id = `${claim.claim.tx}:${claim.claim.index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const slice = sliceOf(claim, binding.pool);
    if (!slice) continue;
    if (claim.network !== binding.network) {
      excluded.push({ tx: claim.claim.tx, index: claim.claim.index, reason: "the claim is of another network" });
      continue;
    }
    if (poolKey(claim.config) !== poolKey(binding.factory)) {
      excluded.push({ tx: claim.claim.tx, index: claim.claim.index, reason: "the claim names another config than the launch was bound under" });
      continue;
    }
    if (binding.network === "solana" && args.configs && !args.configs.counted.has(claim.config)) {
      if (!args.configs.demo.has(claim.config)) return { state: "NO_DATA", reason: `the registry does not place the config ${claim.config}` };
      excluded.push({ tx: claim.claim.tx, index: claim.claim.index, reason: "the config counts nothing (the demo market)" });
      continue;
    }
    candidates.push({ claim, ...slice });
  }
  candidates.sort((a, b) => Date.parse(a.claim.claim.at) - Date.parse(b.claim.claim.at) || a.claim.claim.tx.localeCompare(b.claim.claim.tx) || a.claim.claim.index.localeCompare(b.claim.claim.index, "en", { numeric: true }));

  const firstReceivedAt = candidates.find((candidate) => candidate.receivedRaw > 0n)?.claim.claim.at ?? null;
  const curveStream1 = args.stream1
    .filter((row) => row.venue === "curve" && row.network === binding.network && poolKey(row.pool) === poolKey(binding.pool))
    .map((row) => ({ ms: Date.parse(row.settledAt), usd: BigInt(row.usdMicros) }))
    .sort((a, b) => a.ms - b.ms);

  let streamCursor = 0;
  let accrued = 0n; // stream 1 settled up to the current claim, signed
  let netted = 0n; // stream 1 already taken off earlier claims
  let cumulativeBase = 0n;
  let cumulativePaid = 0n;

  const lines: PoolLine[] = [];
  const unvalued: Array<{ tx: string; index: string }> = [];
  for (const { claim, receivedRaw, usdMicros } of candidates) {
    const at = claim.claim.at;
    const atMs = Date.parse(at);
    while (streamCursor < curveStream1.length && curveStream1[streamCursor]!.ms <= atMs) accrued += curveStream1[streamCursor++]!.usd;
    if (receivedRaw === 0n) continue;
    if (usdMicros === null) {
      /* How much of the open stream 1 an unvalued claim carried is not known. It is taken as none: the next valued
         curve claim nets all of it — a base that can only be too small, never too large, and a pool that keeps
         earning. */
      unvalued.push({ tx: claim.claim.tx, index: claim.claim.index });
      continue;
    }
    const received = BigInt(usdMicros);
    let offset = 0n;
    if (claim.source === "curve") {
      const open = accrued - netted;
      offset = open > 0n ? (open < received ? open : received) : 0n;
      netted += offset;
    }
    const base = received - offset;
    const key = lineKey(binding.network, binding.pool, claim.claim.tx, claim.claim.index);
    const stampedVersion = args.stamped?.get(key);
    const rules = stampedVersion ? networkRulesOf(stampedVersion, history) : networkRulesAt(at, history);
    if (!rules) return { state: "UNKNOWN_VERSION", version: stampedVersion! };
    const tier = tierAt(args.seat, at);
    const day = networkDay(firstReceivedAt ?? at, at);
    const rateBps = networkShareBps(rules, tier, day);
    const lineBase = args.eligible ? base : 0n;
    cumulativeBase += lineBase;
    const raw = (lineBase * BigInt(rateBps)) / 10_000n;
    /* The cap of the version the line is computed by, on the pool's running sums: a later version's cap never
       reaches back over what an earlier one earned. */
    const capRoom = (cumulativeBase * BigInt(rules.poolCapBps)) / 10_000n - cumulativePaid;
    const ceilingRoom = args.ceilingUsdMicros === undefined || args.ceilingUsdMicros === null ? null : args.ceilingUsdMicros - cumulativePaid;
    const room = ceilingRoom !== null && ceilingRoom < capRoom ? ceilingRoom : capRoom;
    const paid = raw < room ? raw : room > 0n ? room : 0n;
    cumulativePaid += paid;
    lines.push({
      key,
      tx: claim.claim.tx,
      index: claim.claim.index,
      source: claim.source,
      at,
      receivedUsdMicros: received,
      offsetUsdMicros: offset,
      baseUsdMicros: lineBase,
      rateBps: args.eligible ? rateBps : 0,
      tier,
      day,
      rulesVersion: rules.version,
      usdMicros: paid,
      capped: paid < raw,
    });
  }
  while (streamCursor < curveStream1.length) accrued += curveStream1[streamCursor++]!.usd;
  const open = accrued - netted;
  return { state: "OK", lines, firstReceivedAt, unvalued, excluded, openOffsetUsdMicros: open > 0n ? open : 0n };
}

/* ------------------------------------------------------------------------------------------------
 * Writing by difference
 * --------------------------------------------------------------------------------------------- */

type LineSum = { amount: bigint; base: bigint; count: number; first: NetworkEntry | null; selfReferral: boolean };

export function sumLines(entries: readonly NetworkEntry[]): Map<string, LineSum> {
  const sums = new Map<string, LineSum>();
  for (const entry of entries) {
    const key = lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index);
    const sum = sums.get(key) ?? { amount: 0n, base: 0n, count: 0, first: null, selfReferral: false };
    sum.amount += BigInt(entry.usdMicros);
    sum.base += BigInt(entry.baseUsdMicros);
    sum.count = Math.max(sum.count, entry.seq + 1);
    if (entry.seq === 0) sum.first = entry;
    if (entry.reason === "SELF_REFERRAL") sum.selfReferral = true;
    sums.set(key, sum);
  }
  return sums;
}

/** The versions already-earned lines keep. */
export function stampedVersions(entries: readonly NetworkEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) if (entry.seq === 0) out.set(lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index), entry.rulesVersion);
  return out;
}

/**
 * The entries that bring a pool's written lines to what they should hold.
 *
 * A line with nothing written and nothing to hold writes nothing. A written
 * line the computation no longer has (its claim stopped counting) is brought
 * to zero. `eligible` false names the reason of every decrease.
 */
export function planEntries(
  args: Readonly<{
    binding: PoolPartner;
    partner: string;
    lines: readonly PoolLine[];
    existing: readonly NetworkEntry[];
    eligible: boolean;
    now: string;
    /** The reason every later entry names instead of the default — `REVIEW` when the review's decision moved the pool. */
    reason?: Extract<NetworkEntryReason, "REVIEW">;
  }>,
): NetworkEntry[] {
  const later: NetworkEntryReason = args.reason ?? (args.eligible ? "RECOMPUTED" : "SELF_REFERRAL");
  const sums = sumLines(args.existing);
  const out: NetworkEntry[] = [];
  const wanted = new Map(args.lines.map((line) => [line.key, line]));
  const base = { schema: 1 as const, partner: args.partner, network: args.binding.network, pool: args.binding.pool, factory: args.binding.factory, creator: args.binding.creator, recordedAt: args.now };
  for (const line of args.lines) {
    const sum = sums.get(line.key);
    const dAmount = line.usdMicros - (sum?.amount ?? 0n);
    const dBase = line.baseUsdMicros - (sum?.base ?? 0n);
    /* Nothing to change — and a line with nothing written and nothing to hold (a zero base, or a partner who may
       not earn and never did) is no line at all. */
    if (dAmount === 0n && dBase === 0n) continue;
    const seq = sum?.count ?? 0;
    const kind: NetworkEntryKind = seq === 0 ? "EARNED" : dAmount < 0n || (dAmount === 0n && dBase < 0n) ? "REVERSAL" : "CORRECTION";
    out.push({
      ...base,
      kind,
      reason: seq === 0 ? "CLAIM" : later,
      line: { tx: line.tx, index: line.index, source: line.source, at: line.at },
      seq,
      baseUsdMicros: dBase.toString(),
      usdMicros: dAmount.toString(),
      rateBps: line.rateBps,
      tier: line.tier,
      day: line.day,
      rulesVersion: line.rulesVersion,
    });
  }
  for (const [key, sum] of sums) {
    if (wanted.has(key) || (sum.amount === 0n && sum.base === 0n) || !sum.first) continue;
    const first = sum.first;
    out.push({
      ...base,
      kind: "REVERSAL",
      reason: later,
      line: first.line,
      seq: sum.count,
      baseUsdMicros: (-sum.base).toString(),
      usdMicros: (-sum.amount).toString(),
      rateBps: 0,
      tier: first.tier,
      day: first.day,
      rulesVersion: first.rulesVersion,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * States
 * --------------------------------------------------------------------------------------------- */

export type EntryStates = Readonly<{
  baseUsdMicros: bigint;
  earnedUsdMicros: bigint;
  pendingUsdMicros: bigint;
  availableUsdMicros: bigint;
  /** When the next pending part becomes available; null — nothing is pending. */
  nextAvailableAt: string | null;
}>;

/**
 * Pending and available, from the entries alone.
 *
 * Each positive entry is a lot that waits the hold of its version from the
 * moment it was written. A negative entry takes from the line's oldest lots
 * first — what is closest to being paid is what a correction removes first.
 */
export function entryStates(entries: readonly NetworkEntry[], now: string, history: readonly NetworkRules[] = NETWORK_RULES_HISTORY): EntryStates {
  const nowMs = Date.parse(now);
  const byLine = new Map<string, NetworkEntry[]>();
  let base = 0n;
  for (const entry of entries) {
    const key = lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index);
    byLine.set(key, [...(byLine.get(key) ?? []), entry]);
    base += BigInt(entry.baseUsdMicros);
  }
  let pending = 0n;
  let available = 0n;
  let next: number | null = null;
  for (const list of byLine.values()) {
    const lots: Array<{ amount: bigint; ready: number }> = [];
    for (const entry of [...list].sort((a, b) => a.seq - b.seq)) {
      const amount = BigInt(entry.usdMicros);
      if (amount > 0n) {
        const holdDays = networkRulesOf(entry.rulesVersion, history)?.holdDays ?? Math.max(...history.map((rules) => rules.holdDays));
        lots.push({ amount, ready: Date.parse(entry.recordedAt) + holdDays * NETWORK_DAY_MS });
        continue;
      }
      let take = -amount;
      for (const lot of lots) {
        if (take === 0n) break;
        const part = lot.amount < take ? lot.amount : take;
        lot.amount -= part;
        take -= part;
      }
    }
    for (const lot of lots) {
      if (lot.amount === 0n) continue;
      if (lot.ready <= nowMs) available += lot.amount;
      else {
        pending += lot.amount;
        next = next === null ? lot.ready : Math.min(next, lot.ready);
      }
    }
  }
  return { baseUsdMicros: base, earnedUsdMicros: pending + available, pendingUsdMicros: pending, availableUsdMicros: available, nextAvailableAt: next === null ? null : new Date(next).toISOString() };
}

export type LineAvailability = Readonly<{
  key: string;
  network: PartnerNetwork;
  pool: string;
  /** The line's claim — the transaction Ryntra took the money out of the pool in. */
  line: NetworkEntry["line"];
  /** The version the line was earned under. */
  rulesVersion: string;
  /** What its hold has let go, by the same lots as `entryStates`. */
  availableUsdMicros: bigint;
}>;

/**
 * `entryStates`' available, line by line — what a payout's receipt is made of. The sum over a pool's lines is
 * exactly that pool's `availableUsdMicros`.
 */
export function lineAvailability(entries: readonly NetworkEntry[], now: string, history: readonly NetworkRules[] = NETWORK_RULES_HISTORY): LineAvailability[] {
  const byLine = new Map<string, NetworkEntry[]>();
  for (const entry of entries) {
    const key = lineKey(entry.network, entry.pool, entry.line.tx, entry.line.index);
    byLine.set(key, [...(byLine.get(key) ?? []), entry]);
  }
  const out: LineAvailability[] = [];
  for (const [key, list] of byLine) {
    const one = entryStates(list, now, history);
    const first = [...list].sort((a, b) => a.seq - b.seq)[0]!;
    out.push({ key, network: first.network, pool: first.pool, line: first.line, rulesVersion: first.rulesVersion, availableUsdMicros: one.availableUsdMicros });
  }
  return out.sort((a, b) => Date.parse(a.line.at) - Date.parse(b.line.at) || a.key.localeCompare(b.key));
}

export type PartnerRankEvent = Readonly<{
  ref: string;
  baseUsdMicros: bigint;
  at: string;
  cancelsAt: string | null;
  rulesVersion: string;
  /** A decrease: the ref of the base it takes from; null for a base. */
  cancels: string | null;
}>;

/**
 * The rank events of one line's entries — when each part of its base counts towards the partner's rank.
 *
 * A base counts from the end of its share's hold, so a figure the programme can still take back never lifts a
 * rank (and with it the share a friend's trade pays) — and not before `notBefore`, the moment the pool's money may
 * follow at all (its creator activated, its review answered). A base already recorded keeps the moment it was
 * recorded with (`recorded`, ref → moment). A decrease is split over the line's bases oldest first, as the money is:
 * each part names the base it cancels and counts from its own moment — or, written while that base was still
 * waiting, from that base's moment, so the two meet at once and the reversed base never counted.
 */
export function rankEventsOf(
  line: readonly NetworkEntry[],
  history: readonly NetworkRules[] = NETWORK_RULES_HISTORY,
  options: Readonly<{ recorded?: ReadonlyMap<string, string>; notBefore?: string | null }> = {},
): PartnerRankEvent[] {
  const hold = (version: string) => (networkRulesOf(version, history)?.holdDays ?? Math.max(...history.map((rules) => rules.holdDays))) * NETWORK_DAY_MS;
  const floor = options.notBefore ? Date.parse(options.notBefore) : Number.NEGATIVE_INFINITY;
  const lots: Array<{ seq: number; ref: string; left: bigint; start: number }> = [];
  const out: PartnerRankEvent[] = [];
  for (const entry of [...line].sort((a, b) => a.seq - b.seq)) {
    const base = BigInt(entry.baseUsdMicros);
    const written = Date.parse(entry.recordedAt);
    const ref = networkEntryRef(entry);
    if (base > 0n) {
      const kept = options.recorded?.get(ref);
      const start = kept !== undefined ? Date.parse(kept) : Math.max(written + hold(entry.rulesVersion), floor);
      lots.push({ seq: entry.seq, ref, left: base, start });
      out.push({ ref, baseUsdMicros: base, at: new Date(start).toISOString(), cancelsAt: null, rulesVersion: entry.rulesVersion, cancels: null });
      continue;
    }
    let take = -base;
    for (const lot of lots) {
      if (take === 0n) break;
      if (lot.left === 0n) continue;
      const part = lot.left < take ? lot.left : take;
      lot.left -= part;
      take -= part;
      const cancelRef = `${ref}:${lot.seq}`;
      const kept = options.recorded?.get(cancelRef);
      out.push({
        ref: cancelRef,
        baseUsdMicros: -part,
        at: kept ?? new Date(Math.max(written, lot.start)).toISOString(),
        cancelsAt: new Date(lot.start).toISOString(),
        rulesVersion: entry.rulesVersion,
        cancels: lot.ref,
      });
    }
  }
  return out;
}

/** The share a partner's pool earns now, and until when; for the read and the in-pool estimate. */
export function shareNow(
  args: Readonly<{ seat: FoundingSeat | null; firstReceivedAt: string | null; now: string; history?: readonly NetworkRules[] }>,
): Readonly<{ tier: NetworkTier; day: number; rateBps: number; until: string | null; rulesVersion: string; poolCapBps: number }> {
  const rules = networkRulesAt(args.now, args.history);
  const tier = tierAt(args.seat, args.now);
  const day = networkDay(args.firstReceivedAt ?? args.now, args.now);
  const ends = networkStepEnds(rules, tier, day);
  const until = ends === null || args.firstReceivedAt === null ? null : new Date(Date.parse(args.firstReceivedAt) + ends * NETWORK_DAY_MS).toISOString();
  return { tier, day, rateBps: networkShareBps(rules, tier, day), until, rulesVersion: rules.version, poolCapBps: rules.poolCapBps };
}


/* ------------------------------------------------------------------------------------------------
 * The pool's own counters — what is still in the pool
 * --------------------------------------------------------------------------------------------- */

export const DBC_POOL_OFFSETS = { config: 72, creator: 104, baseMint: 136, partnerBaseFee: 264, partnerQuoteFee: 272 } as const;
export const DBC_CONFIG_OFFSETS = { quoteMint: 8, feeClaimer: 40 } as const;

/**
 * The partner's unclaimed fees a DBC pool keeps in its own account (the
 * `VirtualPool` layout of the program's IDL: an 8-byte discriminator, the
 * 64-byte volatility tracker, five keys, two reserves, then the protocol's and
 * the partner's base and quote fees). Null when the bytes are too short.
 */
export function decodeDbcPoolCounters(data: Uint8Array): Readonly<{ config: Uint8Array; partnerBaseRaw: bigint; partnerQuoteRaw: bigint }> | null {
  if (data.length < DBC_POOL_OFFSETS.partnerQuoteFee + 8) return null;
  const view = Buffer.from(data);
  return {
    config: data.subarray(DBC_POOL_OFFSETS.config, DBC_POOL_OFFSETS.config + 32),
    partnerBaseRaw: view.readBigUInt64LE(DBC_POOL_OFFSETS.partnerBaseFee),
    partnerQuoteRaw: view.readBigUInt64LE(DBC_POOL_OFFSETS.partnerQuoteFee),
  };
}

/** What a pool still holds of Ryntra's part, by pool: USD micros of the pair side, or null — not read or not a dollar. */
export type PoolCounters = ReadonlyMap<string, Readonly<{ receivedRaw: string; mint: string; receivedUsdMicros: string | null; readAt: string }>>;

export function countersKey(network: PartnerNetwork, pool: string): string {
  return `${network}:${poolKey(pool)}`;
}
