/**
 * CITY-128 — the partners' weekly payout: what each partner is owed for the week, counted from the engine's own records.
 *
 * The terms are `PARTNER_TERMS` (decision 93): a share of Ryntra's own fee on what the people a partner brought did —
 * 40 % for each person's first 90 days with the partner, 30 % after —, the smallest payout $5, paid weekly in USDC. The
 * currency and the first week are the supervisor's call of 2.11 (D-P2: USDC; D-P5: the week that
 * began on Monday 2.11.2026, 00:00 UTC).
 *
 * - **What counts.** An operation the operations ledger confirmed and the chain attributed to Ryntra (`VERIFIED`) — a
 *   swap, a Spot or stock trade, a trade on a launch's curve — of a wallet that is not Ryntra's own, with Ryntra's part
 *   of its fee in dollars. The fee is what Ryntra received, after the provider's part and after the friend's discount,
 *   so the share is never of the person's money. A bridge pays no share (the terms name launches and swaps).
 * - **Whose it is.** The inviter the Rewards record names at the moment of the operation (`referrerAt`), never the wallet
 *   itself; the 90 days run from that inviter's own binding, as the friend's discount counts them.
 * - **Once.** Each operation is credited in exactly one week: a statement lists the operations it credited, and a later
 *   statement skips every one an earlier statement named. An operation the chain had not attributed yet is credited in
 *   the first week after it is — never lost, never twice.
 * - **The minimum and the rest.** A partner is paid when what they are owed — this week's share plus what was carried —
 *   reaches $5; less is carried to the next week, for as long as it takes. A partner the sanctions source lists is held
 *   and carried, never paid; so is one the source did not answer for — held as a listing is, under a
 *   reason of its own, and screened again the next week (CITY-196: the screening fails closed). One proposal pays at most `MAX_PAYOUTS_PER_WEEK` partners, the largest
 *   first; the others are carried, so the week keeps one proposal.
 * - **Guarded (CITY-125).** A share is counted only for a pair the referral guard lets pay (`lib/growth/referral-guard.ts`):
 *   the partner and the person were checked and are not one person — no second own wallet, no shared device, no money
 *   between them, no common funder — or a person cleared them after a review. A pair not checked yet, or under review,
 *   waits: its operations stay uncredited and are counted the first week after it clears. A pair a person stopped never
 *   pays; its share stays with Ryntra. And a partner is paid nothing until their own wallet made a trade Ryntra
 *   received a fee for — the bar is on the payout, never on the link.
 * - **Never more than received.** Shares are floored to the micro-dollar; the sum paid is checked against the sum of
 *   Ryntra's part of the operations credited and carried, and a statement that would pay more is refused.
 *
 * Amounts are integer micro-dollars (`bigint`), which is also exactly one raw unit of USDC. Pure and client-safe: the
 * reads and the store are `prepare.server.ts`.
 */

import { PARTNER_TERMS, type PartnerTerms } from "../../city/lib/partners/terms.ts";
import { usdMicrosFromStated } from "../rewards/model.ts";
import { referrerAt, type RewardAccount } from "../rewards/referral.ts";

/** D-P5: the first week counted — Monday 2 November 2026, 00:00 UTC. Nothing before it is a partner's. */
export const PAYOUTS_FIRST_WEEK = "2026-11-02";
/** The most partners one proposal pays: the treasury's own ceiling for a batch (`MAX_PAYOUTS`, SOL-4). */
export const MAX_PAYOUTS_PER_WEEK = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BPS = 10_000n;

export type Account = Pick<RewardAccount, "referrer" | "referredAt" | "previousReferrer" | "previousReferredAt">;

/** The products whose fee a partner shares: the terms name launches and swaps. */
export const SHARED_PRODUCTS = ["SWAP", "SPOT", "STOCK", "LAUNCH"] as const;
export type SharedProduct = (typeof SHARED_PRODUCTS)[number];

/** One operation as the payout reads it — the shape of the operations ledger's projection (`lib/analytics/operations.ts`). */
export type OperationIn = Readonly<{
  id: string;
  product: string;
  status: string;
  verification: string;
  internal: boolean;
  wallet: string;
  confirmedAt: string | null;
  fee: Readonly<{ collected: boolean; ryntraUsd: number | null }> | null;
}>;

/** A fee Ryntra received from a person's operation: the unit a partner's share is counted on. */
export type FeeEvent = Readonly<{ ref: string; wallet: string; at: string; product: SharedProduct; feeMicros: bigint }>;

/** The operations that pay a share, as fee events; anything not proven, not a person's or not valued is left out. */
export function feeEventsOf(operations: readonly OperationIn[]): FeeEvent[] {
  const events: FeeEvent[] = [];
  for (const op of operations) {
    if (op.status !== "CONFIRMED" || op.verification !== "VERIFIED" || op.internal) continue;
    if (!(SHARED_PRODUCTS as readonly string[]).includes(op.product)) continue;
    if (!op.confirmedAt || !Number.isFinite(Date.parse(op.confirmedAt))) continue;
    if (!op.fee?.collected || op.fee.ryntraUsd === null) continue;
    const feeMicros = usdMicrosFromStated(op.fee.ryntraUsd);
    if (feeMicros === null || feeMicros <= 0n) continue;
    events.push({ ref: op.id, wallet: op.wallet, at: op.confirmedAt, product: op.product as SharedProduct, feeMicros });
  }
  return events;
}

/* ------------------------------------------------------------------ weeks */

/** The Monday (UTC) of the week `at` falls in, as `YYYY-MM-DD`. */
export function weekOf(at: number): string {
  const day = new Date(at);
  const monday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - ((day.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

export function weekStartMs(week: string): number {
  return Date.parse(`${week}T00:00:00.000Z`);
}

export function weekEndMs(week: string): number {
  return weekStartMs(week) + WEEK_MS;
}

export function nextWeek(week: string): string {
  return new Date(weekEndMs(week)).toISOString().slice(0, 10);
}

/** Every week from the first one that has closed by `now`, oldest first. */
export function closedWeeks(now: number, first: string = PAYOUTS_FIRST_WEEK): string[] {
  const weeks: string[] = [];
  for (let week = first; weekEndMs(week) <= now; week = nextWeek(week)) weeks.push(week);
  return weeks;
}

/* ------------------------------------------------------------------ the share */

/** The partner of `wallet` at `at`, and the share in basis points their terms give then; null when nobody's. */
export function shareAt(wallet: string, account: Account | null, at: string, terms: PartnerTerms = PARTNER_TERMS): Readonly<{ partner: string; bps: number }> | null {
  const share = terms.share;
  if (!share) return null;
  const partner = referrerAt(account, at);
  if (!partner || partner === wallet) return null;
  const since = partner === account?.referrer ? account.referredAt : account?.previousReferredAt;
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  if (typeof terms.attribution === "number" && (!Number.isFinite(sinceMs) || Date.parse(at) - sinceMs >= terms.attribution * DAY_MS)) return null;
  const first = Number.isFinite(sinceMs) && Date.parse(at) - sinceMs < share.firstDays * DAY_MS;
  return { partner, bps: first ? share.firstBps : share.afterBps };
}

/* ------------------------------------------------------------------ the guard */

/** What the referral guard does to a pair's share: pays, waits for its check or a person, or never pays. */
export type PairEffect = "PAYS" | "WAITS" | "STOPPED";

export const pairKey = (partner: string, person: string) => `${partner}:${person}`;

/** The guard's word for a statement: each pair's effect, and the partners who have traded themselves. */
export type PayoutGuard = Readonly<{
  /** By `pairKey(partner, person)`; a pair not named waits. */
  pairs: Pick<ReadonlyMap<string, PairEffect>, "get">;
  /** The partners whose own wallet made at least one trade Ryntra received a fee for. */
  traded: Pick<ReadonlySet<string>, "has">;
}>;

/** The wallets that made a trade Ryntra received a fee for, by `until` (ms): the bar a partner meets once. */
export function tradedBy(events: readonly FeeEvent[], until: number): Set<string> {
  return new Set(events.filter((event) => Date.parse(event.at) <= until).map((event) => event.wallet));
}

/** Does the share of `person`'s operation pay `partner` now? */
export function guardPays(guard: PayoutGuard, partner: string, person: string): boolean {
  return guard.traded.has(partner) && guard.pairs.get(pairKey(partner, person)) === "PAYS";
}

/** The pairs whose shares a pass would count — the uncredited operations of people a partner brought, up to `until`. */
export function pairsOf(events: readonly FeeEvent[], accounts: ReadonlyMap<string, Account | null>, credited: ReadonlySet<string>, until: number, terms: PartnerTerms = PARTNER_TERMS): Readonly<{ partner: string; person: string }>[] {
  const out = new Map<string, Readonly<{ partner: string; person: string }>>();
  for (const event of events) {
    const at = Date.parse(event.at);
    if (at < weekStartMs(PAYOUTS_FIRST_WEEK) || at > until || credited.has(event.ref)) continue;
    const share = shareAt(event.wallet, accounts.get(event.wallet) ?? null, event.at, terms);
    if (share) out.set(pairKey(share.partner, event.wallet), { partner: share.partner, person: event.wallet });
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ the statement */

/** Why a partner owed something is not paid this week. `UNSCREENED` — the sanctions source did not answer for them (CITY-196). */
export type Held = "MINIMUM" | "SANCTIONS" | "UNSCREENED" | "OVERFLOW";

export type StatementLine = Readonly<{
  partner: string;
  /** The people whose operations this week's share came from. */
  people: number;
  /** The operations credited to this partner this week (their ledger ids). */
  refs: readonly string[];
  /** Ryntra's part of those operations' fees. */
  feeMicros: string;
  /** This week's share. */
  accruedMicros: string;
  /** Of it, the share from trades on launches' curves; the rest is swaps, Spot and stocks. */
  launchMicros: string;
  /** Carried from earlier weeks. */
  carriedInMicros: string;
  /** Paid by this week's proposal. */
  payMicros: string;
  /** Carried to the next week. */
  carriedOutMicros: string;
  held: Held | null;
}>;

/** PREPARED — counted, no proposal on chain yet; PROPOSED — the proposal is on chain; PAID — executed; VOID — rejected or cancelled. */
export type StatementState = "PREPARED" | "PROPOSED" | "PAID" | "VOID";

export type Statement = Readonly<{
  version: number;
  cluster: string;
  week: string;
  from: string;
  to: string;
  preparedAt: string;
  /** The decision the terms were counted by. */
  decided: string;
  minimumMicros: string;
  lines: readonly StatementLine[];
  totals: Readonly<{ feeMicros: string; accruedMicros: string; payMicros: string; carriedMicros: string; partners: number; paid: number }>;
  state: StatementState;
  /** The proposal that pays it, once built: the multisig and its transaction number. */
  proposal: Readonly<{ multisig: string; index: string; buildId: string | null; builtAt: string; seenAt: string | null; executedAt: string | null }> | null;
  /** A VOID statement's pay, rolled into the statement of `rolledInto`. */
  rolledInto: string | null;
}>;

export type PrepareInput = Readonly<{
  cluster: string;
  week: string;
  events: readonly FeeEvent[];
  accounts: ReadonlyMap<string, Account | null>;
  /** Every operation an earlier statement credited. */
  credited: ReadonlySet<string>;
  /** The previous week's statement; null for the first week. */
  previous: Statement | null;
  /** VOID statements whose pay has not been rolled yet: it is owed again. */
  voided: readonly Statement[];
  /** Partners the sanctions source lists. */
  sanctioned: ReadonlySet<string>;
  /** Partners the sanctions source did not answer for: held like a listing, carried to the next week (CITY-196). */
  unscreened?: ReadonlySet<string>;
  /** The referral guard's word on the pairs and the partners' own trades. */
  guard: PayoutGuard;
  now: string;
  terms?: PartnerTerms;
}>;

const big = (value: string) => BigInt(value);

export function minimumMicros(terms: PartnerTerms = PARTNER_TERMS): bigint {
  return BigInt(Math.round((terms.minimumPayoutUsd ?? 0) * 100)) * 10_000n;
}

/** The week's statement: what each partner earned, what is paid, what is carried. Throws rather than pay more than received. */
export function prepareStatement(input: PrepareInput): Statement {
  const terms = input.terms ?? PARTNER_TERMS;
  const from = weekStartMs(input.week);
  const to = weekEndMs(input.week);
  if (from < weekStartMs(PAYOUTS_FIRST_WEEK)) throw new Error(`week ${input.week} is before the first payout week`);
  if (Date.parse(input.now) < to) throw new Error(`week ${input.week} has not closed`);
  if (input.previous && nextWeek(input.previous.week) !== input.week) throw new Error("the previous statement is not the week before");

  type Acc = { people: Set<string>; refs: string[]; fee: bigint; accrued: bigint; launch: bigint; carried: bigint };
  const lines = new Map<string, Acc>();
  const line = (partner: string): Acc => {
    let found = lines.get(partner);
    if (!found) lines.set(partner, (found = { people: new Set(), refs: [], fee: 0n, accrued: 0n, launch: 0n, carried: 0n }));
    return found;
  };

  const seen = new Set<string>();
  for (const event of [...input.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ref.localeCompare(b.ref))) {
    const at = Date.parse(event.at);
    if (at < weekStartMs(PAYOUTS_FIRST_WEEK) || at >= to) continue;
    if (input.credited.has(event.ref) || seen.has(event.ref)) continue;
    const share = shareAt(event.wallet, input.accounts.get(event.wallet) ?? null, event.at, terms);
    if (!share || !guardPays(input.guard, share.partner, event.wallet)) continue;
    seen.add(event.ref);
    const acc = line(share.partner);
    acc.people.add(event.wallet);
    acc.refs.push(event.ref);
    acc.fee += event.feeMicros;
    const part = (event.feeMicros * BigInt(share.bps)) / BPS;
    acc.accrued += part;
    if (event.product === "LAUNCH") acc.launch += part;
  }
  for (const before of input.previous?.lines ?? []) {
    const carried = big(before.carriedOutMicros);
    if (carried > 0n) line(before.partner).carried += carried;
  }
  for (const voided of input.voided) for (const before of voided.lines) if (big(before.payMicros) > 0n) line(before.partner).carried += big(before.payMicros);

  const minimum = minimumMicros(terms);
  const unscreened = input.unscreened ?? new Set<string>();
  const due = [...lines.entries()].map(([partner, acc]) => ({ partner, acc, due: acc.accrued + acc.carried }));
  const payable = due
    .filter((row) => row.due >= minimum && row.due > 0n && !input.sanctioned.has(row.partner) && !unscreened.has(row.partner))
    .sort((a, b) => (b.due > a.due ? 1 : b.due < a.due ? -1 : a.partner.localeCompare(b.partner)));
  const paying = new Set(payable.slice(0, MAX_PAYOUTS_PER_WEEK).map((row) => row.partner));

  const out: StatementLine[] = due
    .filter((row) => row.due > 0n || row.acc.refs.length > 0)
    .sort((a, b) => a.partner.localeCompare(b.partner))
    .map(({ partner, acc, due: owed }) => {
      const pay = paying.has(partner) ? owed : 0n;
      const held: Held | null = pay > 0n || owed === 0n ? null : input.sanctioned.has(partner) ? "SANCTIONS" : unscreened.has(partner) ? "UNSCREENED" : owed < minimum ? "MINIMUM" : "OVERFLOW";
      return {
        partner,
        people: acc.people.size,
        refs: acc.refs,
        feeMicros: acc.fee.toString(),
        accruedMicros: acc.accrued.toString(),
        launchMicros: acc.launch.toString(),
        carriedInMicros: acc.carried.toString(),
        payMicros: pay.toString(),
        carriedOutMicros: (owed - pay).toString(),
        held,
      };
    });

  const sum = (pick: (row: StatementLine) => string) => out.reduce((total, row) => total + big(pick(row)), 0n);
  const totals = {
    feeMicros: sum((row) => row.feeMicros).toString(),
    accruedMicros: sum((row) => row.accruedMicros).toString(),
    payMicros: sum((row) => row.payMicros).toString(),
    carriedMicros: sum((row) => row.carriedOutMicros).toString(),
    partners: out.length,
    paid: out.filter((row) => big(row.payMicros) > 0n).length,
  };
  /* Decision 88: every payout together is never more than Ryntra received. The share is at most the first share of the fee. */
  const ceiling = (big(totals.feeMicros) * BigInt(terms.share?.firstBps ?? 0)) / BPS;
  if (big(totals.accruedMicros) > ceiling) throw new Error("the week's share is more than the terms allow of what Ryntra received");
  if (big(totals.payMicros) > big(totals.accruedMicros) + sum((row) => row.carriedInMicros)) throw new Error("the week pays more than it owes");

  return {
    version: 1,
    cluster: input.cluster,
    week: input.week,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    preparedAt: input.now,
    decided: terms.decided ?? "",
    minimumMicros: minimum.toString(),
    lines: out,
    totals,
    state: "PREPARED",
    proposal: null,
    rolledInto: null,
  };
}

/** The proposal's lines: one USDC transfer per partner paid, in raw units (a micro-dollar is a raw unit of USDC). */
export function payoutsOf(statement: Statement): readonly Readonly<{ to: string; amountRaw: bigint }>[] {
  return statement.lines.filter((row) => big(row.payMicros) > 0n).map((row) => ({ to: row.partner, amountRaw: big(row.payMicros) }));
}

/* ------------------------------------------------------------------ the partner's own figures */

export type PartnerEarnings = Readonly<{
  /** Every share counted for the partner: the closed weeks' and this week's so far. */
  accruedMicros: string;
  /** Of it, the share from launches. */
  launchMicros: string;
  /** What executed proposals paid the partner. */
  paidMicros: string;
  /** Owed and not paid yet: carried, or in a proposal that has not run. */
  pendingMicros: string;
  /** The last week paid, `YYYY-MM-DD`; null before the first payout. */
  lastPaidWeek: string | null;
}>;

/** What «Мій район» shows a partner: counted, paid, and the rest — from the statements and this week's open count. */
export function earningsOf(partner: string, statements: readonly Statement[], open: Readonly<{ accrued: bigint; launch: bigint }> = { accrued: 0n, launch: 0n }): PartnerEarnings {
  let accrued = open.accrued;
  let launch = open.launch;
  let paid = 0n;
  let lastPaidWeek: string | null = null;
  for (const statement of [...statements].sort((a, b) => a.week.localeCompare(b.week))) {
    const row = statement.lines.find((line) => line.partner === partner);
    if (!row) continue;
    accrued += big(row.accruedMicros);
    launch += big(row.launchMicros);
    if (statement.state === "PAID" && big(row.payMicros) > 0n) {
      paid += big(row.payMicros);
      lastPaidWeek = statement.week;
    }
  }
  const pending = accrued - paid;
  return { accruedMicros: accrued.toString(), launchMicros: launch.toString(), paidMicros: paid.toString(), pendingMicros: (pending > 0n ? pending : 0n).toString(), lastPaidWeek };
}

/** This week's share so far for each partner, from the events not yet credited that the guard lets pay: in all, and of it from launches. */
export function openWeek(events: readonly FeeEvent[], accounts: ReadonlyMap<string, Account | null>, credited: ReadonlySet<string>, now: number, guard: PayoutGuard, terms: PartnerTerms = PARTNER_TERMS): Map<string, { accrued: bigint; launch: bigint }> {
  const out = new Map<string, { accrued: bigint; launch: bigint }>();
  for (const event of events) {
    const at = Date.parse(event.at);
    if (at < weekStartMs(PAYOUTS_FIRST_WEEK) || at > now || credited.has(event.ref)) continue;
    const share = shareAt(event.wallet, accounts.get(event.wallet) ?? null, event.at, terms);
    if (!share || !guardPays(guard, share.partner, event.wallet)) continue;
    const part = (event.feeMicros * BigInt(share.bps)) / BPS;
    const row = out.get(share.partner) ?? { accrued: 0n, launch: 0n };
    row.accrued += part;
    if (event.product === "LAUNCH") row.launch += part;
    out.set(share.partner, row);
  }
  return out;
}

/** Micro-dollars as the cabinet prints them: `12.40`, `<0.01`, `0.00` — floored, never rounded up. */
export function usdOfMicros(micros: string | bigint): string {
  const value = typeof micros === "bigint" ? micros : BigInt(micros);
  if (value <= 0n) return "0.00";
  if (value < 10_000n) return "<0.01";
  const cents = value / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
