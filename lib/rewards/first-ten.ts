import { z } from "zod";

import type { GuardAtomicVersionedWrite, GuardStore } from "../guard/store.ts";
import {
  ancestryOf,
  DAY_MS,
  type FundingNode,
  fundingLink,
  isYoung,
  needsReview,
  partyAncestry,
  PROTECT_RULES,
  type SignalCode,
  signalHash,
  SIGNAL_HASH,
} from "../growth/protect.ts";
import type { FundingRead, TransferRead } from "../growth/protect-chain.server.ts";
import { effectOf, raiseSignals, readDevices, readFundingNodes, readHubs, readSubjectEvents, writeFundingNode } from "../growth/review-store.ts";
import { walletSubject } from "../growth/review.ts";
import { effectiveRewardEntries, listRewardEntries, readRewardAccount } from "./ledger.ts";
import { rewardEntryKey, RewardEntrySchema, type RewardEntry } from "./model.ts";
import { REWARD_RULES_V2_1, type RewardRules } from "./rules.ts";
import { benefitJobWrite } from "./benefit-jobs.ts";

/**
 * «First $10 back» and «30 % to who brought them» (rules `2.1.0`, the decision of 2026-10-17): one record per
 * wallet that says when it first traded and whether it holds the window, and one record per month that holds its
 * places.
 *
 * ## The wallet's record — written once, at its first trade under `2.1.0`
 *
 * `firstTradeAt` is when the wallet first traded through Ryntra (its earliest own cashback), so the inviter's 90
 * days run from it. A wallet that had no trade of its own before is **new**: if the month of its first trade still
 * has a place among the first `walletsPerMonth`, it holds «First $10 back» — 30 days from that trade, until what came
 * back reaches the cap. Its place is taken in the same atomic write as its first rows, so two first trades at once
 * cannot both take the last place. A wallet that is not new is written too, once. One that came when the month was
 * full tries again on its later trades of the same month and its first 30 days: a place a refused wallet left is then
 * its.
 *
 * ## The check
 *
 * The rest of each window trade's fee — everything past the ordinary half — waits until the wallet passes the
 * cluster check (`checkFirstTen`): its funding and its transfers against its inviter's and the month's other new
 * wallets', its device, its age. A clean wallet passes at once (a zero row lets the rest be claimed). Signals, or
 * what could not be seen, open a case of the review queue on the wallet (S10) — a person answers, and the wallet can
 * appeal; while the case is open the wallet's payouts wait, as for any case. Cleared — the check passes; stopped — it
 * fails: one negative row takes the rest back, the inviters get their shares of the window's trades, the place goes
 * to another wallet and the window ends. The check runs from the bookkeeping queue (`benefit-replay.server.ts`),
 * queued again on each window trade while it waits.
 *
 * Only hashes of other addresses are kept, as everywhere in protection (`PROTECT_RULES.retentionDays`).
 */

export const FIRST_TEN_COLLECTION = "rewardWelcome" as const;
export const FIRST_TEN_MONTH_COLLECTION = "rewardWelcomeMonths" as const;

const AT = z.string().datetime({ offset: true });
const MICROS = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const HASH = z.string().regex(SIGNAL_HASH);

export const FIRST_TEN_CHECKS = ["PENDING", "PASSED", "FAILED"] as const;
export type FirstTenCheck = (typeof FIRST_TEN_CHECKS)[number];

export const FirstTenRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    wallet: z.string().min(32).max(64),
    /** The window belongs to the rules that opened it; later versions keep it unchanged. */
    rulesVersion: z.enum(["2.1.0", "2.2.0"]),
    /** The wallet's first own trade through Ryntra — the start of the inviter's 90 days and of the window. */
    firstTradeAt: AT,
    createdAt: AT,
    /** Null — the wallet does not hold the window; `refused` says why. */
    window: z
      .object({
        /** `YYYY-MM`, UTC: the month whose place it holds. */
        month: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
        endsAt: AT,
        /** What came back in the window, the ordinary halves and the rest together; the rest alone. USD micro-units. */
        returnedUsdMicros: MICROS,
        restUsdMicros: MICROS,
        check: z.enum(FIRST_TEN_CHECKS),
        checkedAt: AT.nullable(),
        /** Hashes of where the wallet sent money, kept for the month's later checks (S3) until `outsUntil`. */
        outs: z.array(HASH).max(50),
        outsUntil: AT.nullable(),
        /** When the place was taken — later than the first trade for a wallet that found its month full at first. */
        placedAt: AT.optional(),
      })
      .strict()
      .nullable(),
    refused: z.enum(["NOT_NEW", "MONTH_FULL"]).nullable(),
  })
  .strict();
export type FirstTenRecord = z.output<typeof FirstTenRecordSchema>;

export const FirstTenMonthSchema = z
  .object({
    version: z.number().int().nonnegative(),
    month: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
    /** The wallets holding a place: waiting for their check or passed. A refused wallet leaves. */
    wallets: z.array(z.string().min(32).max(64)).max(1000),
  })
  .strict();
export type FirstTenMonth = z.output<typeof FirstTenMonthSchema>;

export function monthOf(at: string): string {
  return new Date(Date.parse(at)).toISOString().slice(0, 7);
}

export async function readFirstTen(store: GuardStore, wallet: string): Promise<FirstTenRecord | null> {
  const parsed = FirstTenRecordSchema.safeParse(await store.versioned<FirstTenRecord>(FIRST_TEN_COLLECTION).get(wallet));
  return parsed.success && parsed.data.wallet === wallet ? parsed.data : null;
}

async function readMonth(store: GuardStore, month: string): Promise<FirstTenMonth | null> {
  const parsed = FirstTenMonthSchema.safeParse(await store.versioned<FirstTenMonth>(FIRST_TEN_MONTH_COLLECTION).get(month));
  return parsed.success && parsed.data.month === month ? parsed.data : null;
}

/** Is the window open for a trade that settled at `settledAt`? */
export function firstTenOpen(record: FirstTenRecord | null, settledAt: string, rules: RewardRules = REWARD_RULES_V2_1): boolean {
  const window = record?.window;
  if (!window || !rules.firstTen || window.check === "FAILED") return false;
  const settled = Date.parse(settledAt);
  return settled >= Date.parse(record!.firstTradeAt) && settled < Date.parse(window.endsAt) && BigInt(window.returnedUsdMicros) < rules.firstTen.capUsdMicros;
}

/** Is a trade at `settledAt` inside the inviter's 90 days from this trader's first trade? */
export function inviterWindowOpen(record: FirstTenRecord | null, settledAt: string, rules: RewardRules = REWARD_RULES_V2_1): boolean {
  /* A wallet whose window a person cancelled — one person's wallets — earns its inviter the rank's share, not the 90 days'. */
  if (!record || !rules.inviterWindow || record.window?.check === "FAILED") return false;
  const first = Date.parse(record.firstTradeAt);
  const settled = Date.parse(settledAt);
  return settled >= first && settled < first + rules.inviterWindow.days * DAY_MS;
}

export type FirstTenPlan = Readonly<{
  /** What the accrual is told: the window and what may still come back, or none; the inviter's window. */
  window: Readonly<{ firstTen: Readonly<{ remainingUsdMicros: bigint }> | null; inviter: boolean }>;
  /** The wallet holds a window still waiting for its check: the check is (re)queued once the rows are written. */
  queueCheck: boolean;
  /** The writes that go with the accrual's own, in the same atomic batch: the record, and the month when a place is taken. */
  writes: (result: Readonly<{ returnedUsdMicros: bigint; restUsdMicros: bigint }> | undefined) => GuardAtomicVersionedWrite[];
}>;

/** A place in the month of the first trade, if one is free; the window it opens, and the month's next record. */
async function takePlace(store: GuardStore, wallet: string, firstTradeAt: string, cap: NonNullable<RewardRules["firstTen"]>, now: string) {
  const key = monthOf(firstTradeAt);
  const current = await readMonth(store, key);
  const held = current?.wallets ?? [];
  if (held.length >= cap.walletsPerMonth && !held.includes(wallet)) return null;
  const month: FirstTenMonth = { version: (current?.version ?? -1) + 1, month: key, wallets: [...held.filter((other) => other !== wallet), wallet] };
  const window: NonNullable<FirstTenRecord["window"]> = {
    month: key,
    endsAt: new Date(Date.parse(firstTradeAt) + cap.days * DAY_MS).toISOString(),
    returnedUsdMicros: "0",
    restUsdMicros: "0",
    check: "PENDING",
    checkedAt: null,
    outs: [],
    outsUntil: null,
    placedAt: now,
  };
  return { window, month, monthVersion: current?.version ?? null };
}

/**
 * The windows of one trade, read — and on the wallet's first trade under `2.1.0`, decided — inside the accrual's
 * compare-and-set round, so a lost round reads them again. A new wallet that came while the month's places were all
 * held tries again on each trade of its first 30 days in the same month: a place a refused wallet left is then its.
 */
export async function planFirstTen(
  store: GuardStore,
  args: Readonly<{ trader: string; settledAt: string; now: string; rules: RewardRules }>,
): Promise<FirstTenPlan> {
  const rules = args.rules;
  const cap = rules.firstTen;
  const existing = await readFirstTen(store, args.trader);
  let record: FirstTenRecord;
  let month: FirstTenMonth | null = null;
  let monthVersion: number | null = null;
  let changed = false;
  if (existing) {
    record = existing;
    const settled = Date.parse(args.settledAt);
    const first = Date.parse(record.firstTradeAt);
    if (record.refused === "MONTH_FULL" && cap && monthOf(args.settledAt) === monthOf(record.firstTradeAt) && settled < first + cap.days * DAY_MS) {
      const place = await takePlace(store, args.trader, record.firstTradeAt, cap, args.now);
      if (place) {
        record = { ...record, window: place.window, refused: null };
        month = place.month;
        monthVersion = place.monthVersion;
        changed = true;
      }
    }
  } else {
    /* The wallet's own trades already on the ledger: none — it is new. */
    const own = (await listRewardEntries(store, args.trader)).filter((entry) => entry.type === "CASHBACK" && entry.source?.trader === args.trader && entry.recipient === args.trader);
    const earliest = own.reduce<number>((min, entry) => Math.min(min, Date.parse(entry.source!.settledAt)), Number.POSITIVE_INFINITY);
    const firstTradeAt = new Date(Math.min(earliest, Date.parse(args.settledAt))).toISOString();
    let window: FirstTenRecord["window"] = null;
    let refused: FirstTenRecord["refused"] = own.length ? "NOT_NEW" : null;
    if (!own.length && cap) {
      const place = await takePlace(store, args.trader, firstTradeAt, cap, args.now);
      if (!place) refused = "MONTH_FULL";
      else {
        window = place.window;
        month = place.month;
        monthVersion = place.monthVersion;
      }
    }
    record = { version: -1, wallet: args.trader, rulesVersion: args.rules.version === "2.2.0" ? "2.2.0" : "2.1.0", firstTradeAt, createdAt: args.now, window, refused };
    changed = true;
  }
  const open = cap ? firstTenOpen(record, args.settledAt, rules) : false;
  const remaining = open && cap ? cap.capUsdMicros - BigInt(record.window!.returnedUsdMicros) : 0n;
  const created = record.version < 0;
  return {
    window: { firstTen: open ? { remainingUsdMicros: remaining } : null, inviter: inviterWindowOpen(record, args.settledAt, rules) },
    queueCheck: record.window?.check === "PENDING",
    writes: (result) => {
      const writes: GuardAtomicVersionedWrite[] = [];
      const window = record.window && result && open
        ? {
            ...record.window,
            returnedUsdMicros: (BigInt(record.window.returnedUsdMicros) + result.returnedUsdMicros).toString(),
            restUsdMicros: (BigInt(record.window.restUsdMicros) + result.restUsdMicros).toString(),
          }
        : record.window;
      if (changed || window !== record.window) {
        const next = FirstTenRecordSchema.parse({ ...record, window, version: record.version + 1 });
        writes.push({ collection: FIRST_TEN_COLLECTION, key: args.trader, expectedVersion: created ? null : record.version, next });
      }
      if (month) {
        writes.push({ collection: FIRST_TEN_MONTH_COLLECTION, key: month.month, expectedVersion: monthVersion, next: FirstTenMonthSchema.parse(month) });
        /* The place and its check are written together: no window waits without its check queued. */
        writes.push(benefitJobWrite({ kind: "FIRST_TEN_CHECK", wallet: args.trader, operationId: "first-ten", settledAt: record.firstTradeAt }, args.now));
      }
      return writes;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The check
 * --------------------------------------------------------------------------------------------- */

export type FirstTenCheckDeps = Readonly<{
  /** The signal key (`signalKeyFrom`): without it nothing is hashed, and the check waits. */
  key: Uint8Array;
  funding: (wallet: string) => Promise<FundingRead>;
  transfers: (wallet: string, since: string) => Promise<TransferRead | null>;
}>;

export type FirstTenCheckOutcome =
  | Readonly<{ state: "NONE" | "PASSED" | "FAILED" }>
  | Readonly<{ state: "WAITING"; reason: string; review?: boolean }>
  | Readonly<{ state: "DECIDED"; check: "PASSED" | "FAILED"; signals: readonly SignalCode[] }>;

/** After this many days of a check that cannot finish on its own, a person looks (a case of the review queue). */
export const FIRST_TEN_WAIT_DAYS = 3;

const PASSED_REF = "first-ten:passed";
const VOID_REF = "first-ten:void";
const REINSTATED_REF = "first-ten:reinstated";

/** The zero row of a pass and the negative row of a refusal, keyed so each is written once. */
export function firstTenMarkKey(wallet: string, mark: "PASSED" | "VOID"): string {
  return rewardEntryKey({ recipient: wallet, type: "ADJUSTMENT", ref: mark === "PASSED" ? PASSED_REF : VOID_REF });
}

function markEntry(wallet: string, mark: "PASSED" | "VOID" | "REINSTATED", usdMicros: bigint, now: string): RewardEntry {
  return RewardEntrySchema.parse({
    version: 0,
    type: "ADJUSTMENT",
    recipient: wallet,
    rateBps: 0,
    shareRaw: null,
    usdMicros: (mark === "VOID" ? -usdMicros : mark === "REINSTATED" ? usdMicros : 0n).toString(),
    valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "first-ten", observedAt: now },
    source: null,
    createdAt: now,
    claimId: null,
    signature: null,
    fundedBy: "fee",
    window: mark === "PASSED" ? "FIRST_TEN_PASSED" : mark === "VOID" ? "FIRST_TEN_VOID" : "FIRST_TEN_REINSTATED",
  });
}

/** Read one wallet's funding into the graph, from the store when a live node is there, else from the chain (kept). */
async function nodeOf(store: GuardStore, deps: FirstTenCheckDeps, wallet: string, now: string, graph: Map<string, FundingNode>): Promise<string> {
  const hash = signalHash(deps.key, "address", wallet);
  if (graph.has(hash)) return hash;
  const stored = (await readFundingNodes(store, [hash], now)).get(hash);
  if (stored) {
    graph.set(hash, stored);
    return hash;
  }
  const read = await deps.funding(wallet);
  const node: FundingNode = { state: read.state, funder: read.funder ? signalHash(deps.key, "address", read.funder) : null, firstAt: read.firstAt, lastAt: read.lastAt };
  graph.set(hash, node);
  await writeFundingNode(store, hash, node, now);
  /* The funder's own funding, for the second step back — only by its hash once kept, so it is read here by address. */
  if (read.state === "FOUND" && read.funder && node.funder && !graph.has(node.funder)) {
    const storedFunder = (await readFundingNodes(store, [node.funder], now)).get(node.funder);
    if (storedFunder) graph.set(node.funder, storedFunder);
    else {
      const up = await deps.funding(read.funder);
      const upNode: FundingNode = { state: up.state, funder: up.funder ? signalHash(deps.key, "address", up.funder) : null, firstAt: up.firstAt, lastAt: up.lastAt };
      graph.set(node.funder, upNode);
      await writeFundingNode(store, node.funder, upNode, now);
    }
  }
  return hash;
}

/**
 * The cluster check of a wallet holding «First $10 back» — S1–S6 as they apply to one new wallet, and S10 for what
 * they lead to:
 * - S1 — a funding source shared, two steps back, with its inviter or another of the month's new wallets;
 * - S2 — one funded the other, or money moved between the wallet and its inviter;
 * - S3 — the wallet sent money where another of the month's new wallets (or its inviter, once checked) did;
 * - S4 — its device carries three wallets or more, or it was seen on its inviter's or another new wallet's device;
 * - S5 — a few days old and its whole life within two days (soft);
 * - S6 (round trips) earns nothing here — the window gives no points and no more than the fee paid — and S7–S9 are
 *   the window's own cap, place and wait.
 * Nothing here refuses on its own: one hard signal or two soft ones — or what could not be seen — open a case of the
 * review queue (S10) on the wallet, and the rest waits for a person. The case's decision is the verdict: cleared — the
 * check passes; stopped — it fails. A check that cannot finish (no key, reads that never answer) asks a person too,
 * after `FIRST_TEN_WAIT_DAYS`. A clean wallet passes without anyone.
 */
export async function checkFirstTen(store: GuardStore, wallet: string, deps: FirstTenCheckDeps | null, now: string): Promise<FirstTenCheckOutcome> {
  const record = await readFirstTen(store, wallet);
  if (!record?.window) return { state: "NONE" };
  if (record.window.check === "PASSED") return { state: "PASSED" };

  /* The review queue first: a person's decision on the wallet — made since its first trade — is the verdict. */
  const subject = walletSubject(wallet);
  const log = await readSubjectEvents(store, subject);
  const reviewed = log.events.length || log.unreadable ? effectOf(subject, log.events, log.unreadable, now) : null;
  const clearedAt = reviewed?.effect.kind === "PAY" && reviewed.view.decision?.kind === "CLEAR" ? Date.parse(reviewed.view.decision.at) : null;
  if (record.window.check === "FAILED") {
    /* «A person blocked by mistake gets everything after an appeal»: cleared after the cancellation, the window is back. */
    const cancelledAt = Date.parse(record.window.checkedAt ?? record.firstTradeAt);
    if (clearedAt !== null && clearedAt > cancelledAt) return (await reinstateFirstTen(store, wallet, now)) ? { state: "DECIDED", check: "PASSED", signals: [] } : { state: "WAITING", reason: "The record moved; the check runs again." };
    return { state: "FAILED" };
  }
  if (reviewed) {
    if (reviewed.effect.kind === "CANCEL") return decided(store, wallet, "FAILED", [], now);
    if (reviewed.effect.kind === "HOLD") return { state: "WAITING", reason: "A person is reviewing the wallet.", review: true };
    if (clearedAt !== null && clearedAt >= Date.parse(record.firstTradeAt)) return decided(store, wallet, "PASSED", [], now);
  }

  /* Counted from when the place was taken: a wallet that came in later is not sent to a person on its first slow read. */
  const stale = Date.parse(now) - Date.parse(record.window.placedAt ?? record.firstTradeAt) >= FIRST_TEN_WAIT_DAYS * DAY_MS;
  const wait = async (reason: string): Promise<FirstTenCheckOutcome> => {
    if (!stale) return { state: "WAITING", reason };
    await raiseSignals(store, { subject, codes: ["UNVERIFIED"], now });
    return { state: "WAITING", reason: `${reason} A person looks.`, review: true };
  };
  if (!deps) return wait("No signal key on this deployment.");

  const graph = new Map<string, FundingNode>();
  const hubs = await readHubs(store);
  const self = await nodeOf(store, deps, wallet, now, graph);
  const selfNode = graph.get(self)!;
  if (selfNode.state === "UNAVAILABLE" || selfNode.state === "EMPTY") return wait("The wallet's funding could not be read.");

  const account = await readRewardAccount(store, wallet);
  const inviter = account?.referrer && account.referrer !== wallet ? account.referrer : null;
  const month = (await readMonth(store, record.window.month))?.wallets.filter((other) => other !== wallet) ?? [];
  /* The month's other new wallets as their own checks kept them; one not yet checked is compared when it is. */
  const cohort: Array<{ wallet: string; hash: string; outs: readonly string[] }> = [];
  for (const other of month) {
    const hash = signalHash(deps.key, "address", other);
    const stored = (await readFundingNodes(store, [hash], now)).get(hash);
    if (!stored) continue;
    graph.set(hash, stored);
    if (stored.state === "FOUND" && stored.funder && !graph.has(stored.funder)) {
      const up = (await readFundingNodes(store, [stored.funder], now)).get(stored.funder);
      if (up) graph.set(stored.funder, up);
    }
    const theirs = await readFirstTen(store, other);
    const live = theirs?.window?.outsUntil && Date.parse(theirs.window.outsUntil) > Date.parse(now) ? theirs.window.outs : [];
    cohort.push({ wallet: other, hash, outs: live });
  }
  const inviterHash = inviter ? await nodeOf(store, deps, inviter, now, graph) : null;
  const inviterOuts = inviter ? (await readFirstTen(store, inviter))?.window?.outs ?? [] : [];

  const ancestry = ancestryOf(self, graph, hubs);
  if (!ancestry.complete) return wait("The wallet's funding trail could not be read whole.");
  let codes: SignalCode[] = [];
  const firstTrade = Date.parse(record.firstTradeAt);
  /* A history too long to read to its start counts alone only if it reaches thirty days before the first trade. */
  if (ancestry.deep && !(ancestry.since !== null && Date.parse(ancestry.since) <= firstTrade - PROTECT_RULES.funding.deepAgeDays * DAY_MS)) codes.push("UNVERIFIED");
  const mine = partyAncestry([self], graph, hubs);
  const others = [...(inviterHash ? [{ hash: inviterHash }] : []), ...cohort.map((member) => ({ hash: member.hash }))];
  for (const other of others) {
    const link = fundingLink(mine, partyAncestry([other.hash], graph, hubs));
    if (link === "DIRECT") codes.push("S2_DIRECT_FUNDS");
    if (link === "SHARED") codes.push("S1_SHARED_FUNDING");
  }

  const since = new Date(firstTrade - PROTECT_RULES.funding.directDays * DAY_MS).toISOString();
  const transfers = await deps.transfers(wallet, since);
  if (!transfers) return wait("The wallet's transfers could not be read.");
  if (!transfers.complete) codes.push("UNVERIFIED");
  if (inviter && transfers.items.some((item) => item.counterparty === inviter)) codes.push("S2_DIRECT_FUNDS");
  const parties = new Set([wallet, ...(inviter ? [inviter] : []), ...cohort.map((member) => member.wallet)]);
  const outs = [...new Set(transfers.items.filter((item) => item.direction === "out" && !parties.has(item.counterparty)).map((item) => signalHash(deps.key, "address", item.counterparty)))]
    .filter((hash) => !hubs.has(hash));
  const shared = new Set([...inviterOuts, ...cohort.flatMap((member) => member.outs)]);
  if (outs.some((hash) => shared.has(hash))) codes.push("S3_SHARED_WITHDRAWAL");

  const devices = await readDevices(store, wallet, now);
  if (devices.crowd >= PROTECT_RULES.device.crowd) codes.push("S4_DEVICE_CROWD");
  const near = new Set([...(inviter ? [inviter] : []), ...cohort.map((member) => member.wallet)]);
  if (devices.crowds.some((crowd) => crowd.members.some((member) => near.has(member)))) codes.push("S4_SHARED_DEVICE");

  if (isYoung(selfNode, record.firstTradeAt)) codes.push("S5_YOUNG_WALLETS");
  codes = [...new Set(codes)];
  /* Signals are a sign, never a verdict: they open the wallet's case, and the rest waits for a person (S10). */
  if (needsReview(codes)) {
    await raiseSignals(store, { subject, codes, now });
    await keepOuts(store, wallet, outs, now);
    return { state: "WAITING", reason: "Signals found; a person reviews the wallet.", review: true };
  }
  return decided(store, wallet, "PASSED", codes, now, outs);
}

async function decided(store: GuardStore, wallet: string, check: "PASSED" | "FAILED", signals: readonly SignalCode[], now: string, outs?: readonly string[]): Promise<FirstTenCheckOutcome> {
  return (await decideFirstTen(store, { wallet, check, outs, now })) ? { state: "DECIDED", check, signals } : { state: "WAITING", reason: "The record moved; the check runs again." };
}

/** Keep the wallet's out-hashes for the month's later checks while its own waits for a person. */
async function keepOuts(store: GuardStore, wallet: string, outs: readonly string[], now: string): Promise<void> {
  const record = await readFirstTen(store, wallet);
  if (!record?.window || record.window.check !== "PENDING") return;
  const window = { ...record.window, outs: [...outs].slice(0, 50), outsUntil: new Date(Date.parse(now) + PROTECT_RULES.retentionDays * DAY_MS).toISOString() };
  await store.versioned<FirstTenRecord>(FIRST_TEN_COLLECTION).compareAndSet(wallet, record.version, FirstTenRecordSchema.parse({ ...record, window, version: record.version + 1 }));
}

/**
 * A cancelled window given back after an appeal that won: the opposite of the negative row, the pass's zero row, the
 * place in its month again if the month still has one (if not, the window stays closed for new trades) — the trades
 * made meanwhile stay as they were written.
 */
export async function reinstateFirstTen(store: GuardStore, wallet: string, now: string): Promise<boolean> {
  const record = await readFirstTen(store, wallet);
  if (!record?.window || record.window.check !== "FAILED") return record?.window?.check === "PASSED";
  const rest = BigInt(record.window.restUsdMicros);
  const writes: GuardAtomicVersionedWrite[] = [
    { collection: FIRST_TEN_COLLECTION, key: wallet, expectedVersion: record.version, next: FirstTenRecordSchema.parse({ ...record, window: { ...record.window, check: "PASSED", checkedAt: now }, version: record.version + 1 }) },
    { collection: "rewardEntries", key: rewardEntryKey({ recipient: wallet, type: "ADJUSTMENT", ref: REINSTATED_REF }), expectedVersion: null, next: { ...markEntry(wallet, "REINSTATED", rest, now), version: 0 } },
    { collection: "rewardEntries", key: firstTenMarkKey(wallet, "PASSED"), expectedVersion: null, next: { ...markEntry(wallet, "PASSED", 0n, now), version: 0 } },
  ];
  const month = await readMonth(store, record.window.month);
  if (!month?.wallets.includes(wallet)) {
    const cap = REWARD_RULES_V2_1.firstTen!;
    if ((month?.wallets.length ?? 0) < cap.walletsPerMonth) {
      writes.push({ collection: FIRST_TEN_MONTH_COLLECTION, key: record.window.month, expectedVersion: month?.version ?? null, next: FirstTenMonthSchema.parse({ version: (month?.version ?? -1) + 1, month: record.window.month, wallets: [...(month?.wallets ?? []), wallet] }) });
    } else {
      /* Its place went to another wallet meanwhile: the month stays at its hundred. What the wallet earned comes back;
         the window does not reopen for its next trades. */
      writes[0] = { ...writes[0]!, next: FirstTenRecordSchema.parse({ ...record, window: { ...record.window, check: "PASSED", checkedAt: now, endsAt: now }, version: record.version + 1 }) };
    }
  }
  return store.compareAndSetMany(writes);
}

/**
 * Write the verdict: the record, the month's place, and the row that lets the rest be claimed or takes it back, in
 * one atomic batch against the record's version, so no window trade can add rest between the reading and the rows.
 */
export async function decideFirstTen(
  store: GuardStore,
  args: Readonly<{ wallet: string; check: "PASSED" | "FAILED"; outs?: readonly string[]; now: string }>,
): Promise<boolean> {
  const record = await readFirstTen(store, args.wallet);
  if (!record?.window || record.window.check !== "PENDING") return Boolean(record?.window);
  const writes: GuardAtomicVersionedWrite[] = [];
  const window = {
    ...record.window,
    check: args.check,
    checkedAt: args.now,
    outs: [...(args.outs ?? record.window.outs)].slice(0, 50),
    outsUntil: new Date(Date.parse(args.now) + PROTECT_RULES.retentionDays * DAY_MS).toISOString(),
  };
  writes.push({ collection: FIRST_TEN_COLLECTION, key: args.wallet, expectedVersion: record.version, next: FirstTenRecordSchema.parse({ ...record, window, version: record.version + 1 }) });
  const rest = BigInt(record.window.restUsdMicros);
  if (args.check === "PASSED") {
    writes.push({ collection: "rewardEntries", key: firstTenMarkKey(args.wallet, "PASSED"), expectedVersion: null, next: markEntry(args.wallet, "PASSED", 0n, args.now) as RewardEntry & { version: number } });
  } else {
    /* Written even when nothing was held: it is what an appeal that wins is the opposite of. Nobody else is paid for
       the window's trades — a cancellation is a person's verdict that the wallets are one, and a share to the inviter
       would pay that one person. */
    writes.push({ collection: "rewardEntries", key: firstTenMarkKey(args.wallet, "VOID"), expectedVersion: null, next: markEntry(args.wallet, "VOID", rest, args.now) as RewardEntry & { version: number } });
    const month = await readMonth(store, record.window.month);
    if (month?.wallets.includes(args.wallet)) {
      writes.push({ collection: FIRST_TEN_MONTH_COLLECTION, key: month.month, expectedVersion: month.version, next: FirstTenMonthSchema.parse({ ...month, version: month.version + 1, wallets: month.wallets.filter((other) => other !== args.wallet) }) });
    }
  }
  return store.compareAndSetMany(writes);
}

/**
 * What a wallet's rows hold back for the check: the rest of its window trades, while neither the pass nor the
 * refusal is on the ledger. A pure fold of the rows, so every reader of a balance agrees without reading the record.
 */
export function firstTenHeldUsdMicros(entries: readonly RewardEntry[]): bigint {
  let rest = 0n;
  let settled = false;
  for (const entry of effectiveRewardEntries(entries)) {
    if (entry.window === "FIRST_TEN_PASSED" || entry.window === "FIRST_TEN_VOID") settled = true;
    else if (entry.window === "FIRST_TEN_REST" && entry.type === "CASHBACK" && entry.usdMicros !== null) rest += BigInt(entry.usdMicros);
  }
  return settled || rest < 0n ? 0n : rest;
}

/** What the Rewards page is told about the window: nothing for a wallet that does not hold it. */
export type FirstTenView = Readonly<{
  state: "OPEN" | "CLOSED";
  check: FirstTenCheck;
  returnedUsdMicros: bigint;
  capUsdMicros: bigint;
  endsAt: string;
}>;

export function firstTenView(record: FirstTenRecord | null, now: string, rules: RewardRules = REWARD_RULES_V2_1): FirstTenView | null {
  if (!record?.window || !rules.firstTen) return null;
  return {
    state: firstTenOpen(record, now, rules) ? "OPEN" : "CLOSED",
    check: record.window.check,
    /* Never shown past the cap, whatever a late price did to the counter. */
    returnedUsdMicros: BigInt(record.window.returnedUsdMicros) < rules.firstTen.capUsdMicros ? BigInt(record.window.returnedUsdMicros) : rules.firstTen.capUsdMicros,
    capUsdMicros: rules.firstTen.capUsdMicros,
    endsAt: record.window.endsAt,
  };
}
