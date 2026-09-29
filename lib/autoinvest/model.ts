/**
 * What a rule's occurrences are, and what the tick and the order route decide
 * about them (`RYN-INVEST-SIMPLE-001`, sessions 3–4; canon v5.1 §4.1, B.3,
 * B.5).
 *
 * **History is the durable source.** A purchase made under a reminder carries
 * `origin.rule` from the order into the issuer-signed bundle and onto the
 * History row, in the execute path and in the recovery path alike. So the rule
 * never has to be told that it was bought: an occurrence is `bought` when a
 * settled row names it, `pending` while a row names it and has not settled —
 * a signed purchase whose outcome is unknown is never a reason to remind
 * again or to offer another — and `missed` when its day passed with no row at
 * all. A failed row moved no money and is no purchase.
 *
 * **Never caught up.** When the tick finds several due instants passed (the
 * service was down, the rule was paused), it opens only the latest, and only
 * while it is still open; nothing older is reminded of.
 *
 * **«Якщо впаде»** (session 4) opens its occurrence at the first read of the
 * price at or below its trigger, one note per crossing (`./dip.ts`); after a
 * purchase under it the reference point moves to what that purchase paid.
 *
 * **«Бюджет місяця»** (session 4): a purchase that does not fit what is left
 * of the month's ceiling is not reminded of — the occurrence is `held` and the
 * rules stand until the 1st (`./budget.ts`). The order route refuses it too.
 *
 * **«Умова ціни»** (`RYN-PRICE-GUARD-001`, canon v5.5 В37): a rule with a
 * price condition judges it when it falls due. Met, it reminds as before;
 * otherwise the occurrence is `deferred` — one note says why — and every pass
 * while it is open judges it again: met in time, it becomes `due` and
 * reminds; never met, it is `missed` at its end. A «Якщо впаде» crossing
 * whose price comes back above the trigger before the condition is met is
 * over. The order route judges the condition once more on its own facts.
 *
 * **«З кожної оплати»** (`RYN-PAY-TRIGGERS-001`, canon v5.5 В38): the rule
 * takes its share of every event the wallet's watch numbered after the last
 * one it took — counted from the instant it was turned on, never an event to
 * or from an account the person named as their own — and what it gathers
 * waits, the money in the wallet. Once the sum reaches the rule's minimum and
 * no reminder of it is open, one occurrence opens on exactly that sum and
 * takes every waiting event: within the month's budget and the price
 * condition it reminds; otherwise it is held or deferred like any rule's.
 * What an occurrence took never waits again — a reminder nobody bought is
 * missed, never gathered into the next.
 *
 * Pure: the clock, the rule, the History rows, the ceiling, the price and the
 * condition's facts are arguments.
 */

import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { RULE_OCCURRENCES_KEPT, type AutoinvestRule, type RuleBinding, type RuleOccurrence, type RulePayments } from "../api/v1/contract.ts";
import { fitsBudget, usdcOutOf } from "./budget.ts";
import { dipTriggerUsd, purchasePriceUsd, usablePrice, type DipPrice } from "./dip.ts";
import { PAYMENT_EVENTS_KEPT, PAYMENT_QUEUE_LISTED } from "./limits.ts";
import { contributionCents, usdOfMicro, type PaymentDirection } from "./payments.ts";
import { checkPriceCondition, type PriceCheck, type PriceFacts } from "./price-condition.ts";
import { isReadableSchedule, latestDueAtOrBefore, nextDueAfter, reminderOpenUntil, RULE_REMINDER_HOURS } from "./schedule.ts";
import type { AutoinvestRuleDraft, AutoinvestRuleRecord, StoredDip, StoredOccurrence, StoredPaymentEvent, StoredPayments } from "./store.ts";

const iso = (ms: number): string => new Date(ms).toISOString();
const sameInstant = (a: string, b: string): boolean => Date.parse(a) === Date.parse(b);
const REMINDER_MS = RULE_REMINDER_HOURS * 3_600_000;

/** USDC in raw units (6 decimals) for a sum of dollars and cents. */
export function usdToUsdcRaw(amountUsd: number): string {
  return String(BigInt(Math.round(amountUsd * 100)) * 10_000n);
}

/** The History rows bound to one rule. */
export function rowsOfRule(rows: readonly SolanaWalletAction[], ruleId: string): readonly SolanaWalletAction[] {
  return rows.filter((row) => row.origin?.rule?.ruleId === ruleId);
}

export type HistoryWord =
  | Readonly<{ state: "bought"; signature: string | null; spentUsd: number | null; boughtAt: string; row: SolanaWalletAction }>
  | Readonly<{ state: "pending"; signature: string | null }>;

/** What History says of one occurrence: settled, signed and on its way, or nothing. */
export function historyOf(dueAt: string, rows: readonly SolanaWalletAction[]): HistoryWord | null {
  const bound = rows.filter((row) => row.origin?.rule && sameInstant(row.origin.rule.dueAt, dueAt) && row.outcome !== "FAILED");
  const done = bound.find((row) => row.outcome === "DONE");
  if (done) return { state: "bought", signature: done.signature, spentUsd: usdcOutOf(done), boughtAt: done.updatedAt, row: done };
  const moving = bound[0];
  return moving ? { state: "pending", signature: moving.signature } : null;
}

/** One occurrence as the contract states it: History over the stored decision, the clock over an open reminder. */
export function projectOccurrence(occurrence: StoredOccurrence, rows: readonly SolanaWalletAction[], nowMs: number): RuleOccurrence {
  const base = {
    dueAt: occurrence.dueAt,
    openUntil: occurrence.openUntil,
    remindedAt: occurrence.remindedAt,
    trigger: occurrence.trigger,
    condition: occurrence.condition,
    amountUsd: occurrence.amountUsd ?? null,
    events: occurrence.events ?? null,
  };
  /* Nothing was reminded of a held occurrence, so nothing can have been bought under it. */
  if (occurrence.state === "held") return { ...base, state: "held", signature: null, spentUsd: null, boughtAt: null };
  /* A deferred purchase was never offered, so nothing was bought under it: deferred while it is open, missed after. */
  if (occurrence.state === "deferred") return { ...base, state: nowMs > Date.parse(occurrence.openUntil) ? "missed" : "deferred", signature: null, spentUsd: null, boughtAt: null };
  const seen = historyOf(occurrence.dueAt, rows);
  if (seen?.state === "bought") return { ...base, state: "bought", signature: seen.signature, spentUsd: seen.spentUsd, boughtAt: seen.boughtAt };
  if (seen?.state === "pending") return { ...base, state: "pending", signature: seen.signature, spentUsd: null, boughtAt: null };
  if (occurrence.state === "bought") return { ...base, state: "bought", signature: occurrence.signature, spentUsd: occurrence.spentUsd, boughtAt: occurrence.boughtAt };
  const closed = occurrence.state === "missed" || nowMs > Date.parse(occurrence.openUntil);
  return { ...base, state: closed ? "missed" : "due", signature: null, spentUsd: null, boughtAt: null };
}

/** The trigger a reference point and a fall make, to a millionth of a dollar. */
function triggerOf(dip: StoredDip): number {
  return Math.round(dipTriggerUsd(dip.anchorUsd, dip.dropPct) * 1e6) / 1e6;
}

/** When the wallet's USDC was last read, and whether the read proved itself — the watch's word, for the rule's projection. */
export type PaymentsRead = Readonly<{ at: string; state: "ok" | "partial" | "unavailable" }> | null;

/** How many listed events the wire carries, newest first. */
const PAYMENT_EVENTS_ON_WIRE = PAYMENT_EVENTS_KEPT * 2;

/** A «З кожної оплати» rule's state as the contract states it: the terms, what waits, the newest events. */
export function projectPayments(payments: StoredPayments, read: PaymentsRead): RulePayments {
  return {
    mode: payments.mode,
    roundToUsd: payments.roundToUsd,
    fixedUsd: payments.fixedUsd,
    percent: payments.percent,
    timeZone: payments.timeZone,
    since: payments.since,
    gatheredUsd: payments.gatheredCents / 100,
    gatheredCount: payments.gatheredCount,
    events: [...payments.events]
      .sort((a, b) => b.seq - a.seq)
      .slice(0, PAYMENT_EVENTS_ON_WIRE)
      .map((event) => ({ signature: event.signature, direction: event.direction, amountUsd: event.amountUsd, addUsd: event.addCents / 100, at: event.at, label: event.label, dueAt: event.dueAt })),
    read,
  };
}

/** The record as the contract states a rule: the occurrences newest first. `read` is the wallet's watch, for a «З кожної оплати» rule. */
export function projectRule(record: AutoinvestRuleRecord, rows: readonly SolanaWalletAction[], nowMs: number, read: PaymentsRead = null): AutoinvestRule {
  const own = rowsOfRule(rows, record.id);
  return {
    id: record.id,
    owner: record.owner,
    network: record.network,
    kind: record.kind,
    asset: record.asset,
    name: record.name,
    amountUsd: record.amountUsd,
    schedule: record.schedule,
    dip: record.dip ? { ...record.dip, triggerUsd: triggerOf(record.dip) } : null,
    payments: record.payments ? projectPayments(record.payments, read) : null,
    priceCondition: record.priceCondition,
    status: record.status,
    nextDueAt: record.nextDueAt,
    occurrences: [...record.occurrences].reverse().map((occurrence) => projectOccurrence(occurrence, own, nowMs)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * What the tick knows about one rule's world at one instant.
 *
 * `rows` are the wallet's History rows, or null when History could not be
 * read — then nothing is marked bought or missed on this pass (a purchase the
 * tick cannot see is not a missed one). `remainingUsd` is what is left of the
 * month's ceiling, null without one; `budgetUnknown` says a ceiling exists and
 * its spend could not be read — then nothing is opened on this pass and the
 * next one decides. `market` is the rule's company: the price read now and
 * the Scaled UI multiplier a purchase's units are counted in («Якщо впаде»),
 * and the facts its price condition is judged on — null when they could not
 * be read, which never passes.
 */
export type TickContext = Readonly<{
  rows: readonly SolanaWalletAction[] | null;
  remainingUsd: number | null;
  budgetUnknown?: boolean;
  market?: Readonly<{ price: DipPrice | null; multiplier: number | null; condition?: PriceFacts | null }> | null;
  /** 1.19.0: the wallet's watch — the numbered events and the person's own accounts; null when it could not be read, which gathers nothing. */
  payments?: PaymentsWatchView | null;
}>;

/** What a «З кожної оплати» rule reads of its wallet's watch. */
export type PaymentsWatchEvent = Readonly<{ seq: number; signature: string; at: string; direction: PaymentDirection; amountMicro: string; counterparty: string | null; memo: string | null }>;
export type PaymentsWatchView = Readonly<{ events: readonly PaymentsWatchEvent[]; ownAccounts: readonly string[] }>;

/** The sum one occurrence buys: its own, where a «З кожної оплати» rule gathered it; the rule's otherwise. */
export function occurrenceSumUsd(record: Pick<AutoinvestRuleRecord, "amountUsd">, occurrence: Pick<StoredOccurrence, "amountUsd">): number {
  return occurrence.amountUsd ?? record.amountUsd;
}

/** `remind`: the occurrence to remind of now · `defer`: the occurrence the price condition deferred now — its one note · `held`: the budget held one. */
export type TickStep = Readonly<{ changed: boolean; record: AutoinvestRuleDraft; remind: StoredOccurrence | null; defer: StoredOccurrence | null; held: boolean }>;

/** The rule's price condition judged on this pass's facts; null where the rule has none. */
function judged(record: AutoinvestRuleRecord, context: TickContext, nowMs: number): PriceCheck | null {
  if (!record.priceCondition) return null;
  return checkPriceCondition(record.priceCondition.limitPct, context.market?.condition ?? null, nowMs);
}

type Recheck = Readonly<{ occurrence: StoredOccurrence; remind: boolean; held: boolean }>;

/**
 * A deferred occurrence judged again. Met: it reminds now — unless the month's
 * budget no longer covers it (held) or its spend cannot be read (the next pass
 * decides). Not met: it stays deferred, keeping the newest judgement only when
 * the reason changed, so a waiting rule is not rewritten every five minutes.
 */
function recheckDeferred(record: AutoinvestRuleRecord, occurrence: StoredOccurrence, context: TickContext, nowMs: number): Recheck | null {
  const check = judged(record, context, nowMs);
  if (check === null || check.verdict === "met") {
    if (context.budgetUnknown) return null;
    if (context.remainingUsd !== null && !fitsBudget(occurrenceSumUsd(record, occurrence), context.remainingUsd)) {
      return { occurrence: { ...occurrence, state: "held", openUntil: iso(nowMs), condition: check }, remind: false, held: true };
    }
    return { occurrence: { ...occurrence, state: "due", remindedAt: iso(nowMs), condition: check }, remind: true, held: false };
  }
  if (check.verdict === occurrence.condition?.verdict) return null;
  return { occurrence: { ...occurrence, condition: check }, remind: false, held: false };
}

type Settled = Readonly<{ occurrences: StoredOccurrence[]; changed: boolean; bought: readonly Readonly<{ occurrence: StoredOccurrence; row: SolanaWalletAction }>[] }>;

/** Mark what History settled: a due occurrence bought, or missed once its day passed with nothing on its way. */
function settle(record: AutoinvestRuleRecord, own: readonly SolanaWalletAction[] | null, nowMs: number): Settled {
  let changed = false;
  const bought: { occurrence: StoredOccurrence; row: SolanaWalletAction }[] = [];
  const occurrences = record.occurrences.map((occurrence): StoredOccurrence => {
    /* A deferred purchase that never became due is missed at its end; nothing could have been bought under it. */
    if (occurrence.state === "deferred") {
      if (nowMs <= Date.parse(occurrence.openUntil)) return occurrence;
      changed = true;
      return { ...occurrence, state: "missed" };
    }
    if (occurrence.state !== "due" || own === null) return occurrence;
    const seen = historyOf(occurrence.dueAt, own);
    if (seen?.state === "bought") {
      changed = true;
      const next: StoredOccurrence = { ...occurrence, state: "bought", signature: seen.signature, spentUsd: seen.spentUsd, boughtAt: seen.boughtAt };
      bought.push({ occurrence: next, row: seen.row });
      return next;
    }
    /* A signed purchase on its way is neither bought nor missed yet. */
    if (seen?.state === "pending") return occurrence;
    if (nowMs > Date.parse(occurrence.openUntil)) {
      changed = true;
      return { ...occurrence, state: "missed" };
    }
    return occurrence;
  });
  return { occurrences, changed, bought };
}

function draftOf(record: AutoinvestRuleRecord): AutoinvestRuleDraft {
  const { version: _version, ...rest } = record;
  return rest;
}

/** The tick's decision for a «Регулярно» rule. */
function advanceSchedule(record: AutoinvestRuleRecord, context: TickContext, nowMs: number): TickStep {
  const settled = settle(record, context.rows === null ? null : rowsOfRule(context.rows, record.id), nowMs);
  let changed = settled.changed;
  const occurrences = settled.occurrences;
  let nextDueAt = record.nextDueAt;
  let remind: StoredOccurrence | null = null;
  let defer: StoredOccurrence | null = null;
  let held = false;

  /* A purchase the price condition deferred is judged again on every pass while it is open — and only while the rule is on. */
  if (record.status === "active") {
    for (let index = 0; index < occurrences.length; index += 1) {
      if (occurrences[index].state !== "deferred") continue;
      const next = recheckDeferred(record, occurrences[index], context, nowMs);
      if (!next) continue;
      occurrences[index] = next.occurrence;
      changed = true;
      if (next.remind) remind = next.occurrence;
      if (next.held) held = true;
    }
  }

  const schedule = record.schedule;
  const fallsDue = record.status === "active" && schedule !== null && nextDueAt !== null && Date.parse(nextDueAt) <= nowMs && isReadableSchedule(schedule);
  /* A ceiling whose spend cannot be read opens nothing now: the due stays where it is and the next pass decides. */
  if (fallsDue && schedule !== null && !context.budgetUnknown) {
    changed = true;
    nextDueAt = iso(nextDueAfter(schedule, nowMs));
    const latest = latestDueAtOrBefore(schedule, nowMs);
    if (latest !== null && !occurrences.some((occurrence) => sameInstant(occurrence.dueAt, iso(latest)))) {
      const openUntil = reminderOpenUntil(schedule, latest);
      /* A due whose day already passed (the service was down past it) is missed at once — never reminded late, never caught up. */
      const open = nowMs <= openUntil;
      const fits = context.remainingUsd === null || fitsBudget(record.amountUsd, context.remainingUsd);
      /* The price condition is judged only for a purchase that could be offered: open and within the budget. */
      const check = open && fits ? judged(record, context, nowMs) : null;
      const state = !open ? "missed" : !fits ? "held" : check !== null && check.verdict !== "met" ? "deferred" : "due";
      const occurrence: StoredOccurrence = {
        dueAt: iso(latest),
        openUntil: iso(state === "held" ? latest : openUntil),
        state,
        remindedAt: state === "due" ? iso(nowMs) : null,
        signature: null,
        spentUsd: null,
        boughtAt: null,
        trigger: null,
        condition: check,
        amountUsd: null,
        events: null,
      };
      occurrences.push(occurrence);
      if (state === "due") remind = occurrence;
      if (state === "deferred") defer = occurrence;
      if (state === "held") held = true;
    }
  }
  return {
    changed,
    remind,
    defer,
    held,
    record: { ...draftOf(record), occurrences: occurrences.slice(-RULE_OCCURRENCES_KEPT), nextDueAt, updatedAt: changed ? iso(nowMs) : record.updatedAt },
  };
}

/** The tick's decision for a «Якщо впаде» rule. */
function advanceDip(record: AutoinvestRuleRecord, context: TickContext, nowMs: number): TickStep {
  const own = context.rows === null ? null : rowsOfRule(context.rows, record.id);
  const settled = settle(record, own, nowMs);
  let changed = settled.changed;
  const occurrences = settled.occurrences;
  let dip = record.dip as StoredDip;
  let remind: StoredOccurrence | null = null;
  let defer: StoredOccurrence | null = null;
  let held = false;

  /* A purchase under the rule settled: the reference point moves to what it paid per unit — or, where that cannot be read, the price that opened it. */
  for (const { occurrence, row } of settled.bought) {
    const paid = purchasePriceUsd(row, record.asset.decimals, context.market?.multiplier ?? null) ?? occurrence.trigger?.priceUsd ?? null;
    if (paid === null) continue;
    dip = { ...dip, anchorUsd: Math.round(paid * 1e6) / 1e6, anchorAt: occurrence.boughtAt ?? iso(nowMs), anchorFrom: "purchase", armed: false, heldAt: null };
    changed = true;
  }

  const price = usablePrice(context.market?.price, nowMs);

  /*
   * A crossing the price condition deferred, judged again while it is open.
   * Back above the trigger before the condition was met, the crossing is
   * over — missed now, and the rule arms again below. Still below it and
   * met, it reminds on a fresh day's reminder with the price read now.
   */
  const waiting = occurrences.findIndex((occurrence) => occurrence.state === "deferred");
  if (waiting >= 0 && record.status === "active" && price !== null) {
    const occurrence = occurrences[waiting];
    if (price > dipTriggerUsd(dip.anchorUsd, dip.dropPct)) {
      occurrences[waiting] = { ...occurrence, state: "missed", openUntil: iso(nowMs) };
      changed = true;
    } else {
      const next = recheckDeferred(record, occurrence, context, nowMs);
      if (next) {
        const facts = { priceUsd: price, anchorUsd: dip.anchorUsd };
        occurrences[waiting] = next.remind ? { ...next.occurrence, openUntil: iso(nowMs + REMINDER_MS), trigger: facts } : next.occurrence;
        changed = true;
        if (next.remind) remind = occurrences[waiting];
        if (next.held) {
          /* Held like any crossing the budget holds: the rule stays armed and reminds the moment it fits. */
          dip = { ...dip, armed: true, heldAt: iso(nowMs) };
          held = true;
        }
      }
    }
  }

  /* One reminder at a time: an occurrence still `due` or `deferred` after settling is open, or its purchase travels, or History could not say — the price decides nothing then. */
  const reminding = occurrences.some((occurrence) => occurrence.state === "due" || occurrence.state === "deferred");
  if (record.status === "active" && !reminding && price !== null) {
    const trigger = dipTriggerUsd(dip.anchorUsd, dip.dropPct);
    if (price > trigger) {
      /* Back above the line: the next fall below it is a new crossing, and a held crossing is over. */
      if (!dip.armed || dip.heldAt !== null) {
        dip = { ...dip, armed: true, heldAt: null };
        changed = true;
      }
    } else if (dip.armed && !context.budgetUnknown) {
      const fits = context.remainingUsd === null || fitsBudget(record.amountUsd, context.remainingUsd);
      const facts = { priceUsd: price, anchorUsd: dip.anchorUsd };
      if (fits) {
        /* The crossing is judged against the rule's price condition: met, it reminds; otherwise it waits, deferred, and says why once. */
        const check = judged(record, context, nowMs);
        const deferred = check !== null && check.verdict !== "met";
        const occurrence: StoredOccurrence = {
          dueAt: iso(nowMs),
          openUntil: iso(nowMs + REMINDER_MS),
          state: deferred ? "deferred" : "due",
          remindedAt: deferred ? null : iso(nowMs),
          signature: null,
          spentUsd: null,
          boughtAt: null,
          trigger: facts,
          condition: check,
          amountUsd: null,
          events: null,
        };
        occurrences.push(occurrence);
        if (deferred) defer = occurrence;
        else remind = occurrence;
        dip = { ...dip, armed: false, heldAt: null };
        changed = true;
      } else if (dip.heldAt === null) {
        /* Held once per crossing: the rule stays armed, so the purchase is reminded of the moment it fits — the 1st, or a larger budget. */
        occurrences.push({ dueAt: iso(nowMs), openUntil: iso(nowMs), state: "held", remindedAt: null, signature: null, spentUsd: null, boughtAt: null, trigger: facts, condition: null, amountUsd: null, events: null });
        dip = { ...dip, heldAt: iso(nowMs) };
        held = true;
        changed = true;
      }
    }
  }

  return {
    changed,
    remind,
    defer,
    held,
    record: { ...draftOf(record), dip, occurrences: occurrences.slice(-RULE_OCCURRENCES_KEPT), nextDueAt: null, updatedAt: changed ? iso(nowMs) : record.updatedAt },
  };
}

/**
 * The events a rule lists: every one still waiting (the newest
 * `PAYMENT_QUEUE_LISTED`) and the last `PAYMENT_EVENTS_KEPT` a reminder took,
 * oldest first. An unlisted waiting event still counts in the sum.
 */
function listedEvents(events: readonly StoredPaymentEvent[]): StoredPaymentEvent[] {
  const waiting = events.filter((event) => event.dueAt === null).slice(-PAYMENT_QUEUE_LISTED);
  const taken = events.filter((event) => event.dueAt !== null).slice(-PAYMENT_EVENTS_KEPT);
  return [...taken, ...waiting].sort((a, b) => a.seq - b.seq);
}

/**
 * The rule's share of every event its wallet's watch numbered after the last
 * one it took: from the instant it counts from, never to or from the
 * person's own accounts, in whole cents. Each event is taken once — the
 * number moves past it whether it added anything or not.
 */
export function gatherPayments(payments: StoredPayments, watch: PaymentsWatchView): Readonly<{ payments: StoredPayments; changed: boolean }> {
  const sinceMs = Date.parse(payments.since);
  const own = new Set(watch.ownAccounts);
  let lastSeq = payments.lastSeq;
  let gatheredCents = payments.gatheredCents;
  let gatheredCount = payments.gatheredCount;
  const events = [...payments.events];
  let changed = false;
  for (const event of [...watch.events].sort((a, b) => a.seq - b.seq)) {
    if (event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    changed = true;
    if (!(Date.parse(event.at) >= sinceMs)) continue;
    if (event.counterparty !== null && own.has(event.counterparty)) continue;
    const addCents = contributionCents(payments, { direction: event.direction, amountMicro: BigInt(event.amountMicro) });
    if (addCents <= 0) continue;
    gatheredCents += addCents;
    gatheredCount += 1;
    events.push({ seq: event.seq, signature: event.signature, direction: event.direction, amountUsd: usdOfMicro(event.amountMicro), addCents, at: event.at, label: event.memo, dueAt: null });
  }
  return changed ? { payments: { ...payments, lastSeq, gatheredCents, gatheredCount, events: listedEvents(events) }, changed } : { payments, changed };
}

/** Every waiting event taken by the occurrence that opened at `dueAt`; nothing waits after it. */
function takeGathered(payments: StoredPayments, dueAt: string): StoredPayments {
  const events = payments.events.map((event) => (event.dueAt === null ? { ...event, dueAt } : event));
  return { ...payments, gatheredCents: 0, gatheredCount: 0, events: listedEvents(events) };
}

/**
 * The events the person named as their own leave what waits: their share
 * comes out of the sum. An event a reminder already took stays with it — that
 * reminder's sum was said once and does not change.
 */
export function releaseOwnEvents(payments: StoredPayments, signatures: ReadonlySet<string>): Readonly<{ payments: StoredPayments; changed: boolean }> {
  const leaving = payments.events.filter((event) => event.dueAt === null && signatures.has(event.signature));
  if (leaving.length === 0) return { payments, changed: false };
  const cents = leaving.reduce((sum, event) => sum + event.addCents, 0);
  return {
    payments: {
      ...payments,
      gatheredCents: Math.max(0, payments.gatheredCents - cents),
      gatheredCount: Math.max(0, payments.gatheredCount - leaving.length),
      events: payments.events.filter((event) => !leaving.includes(event)),
    },
    changed: true,
  };
}

/** The tick's decision for a «З кожної оплати» rule. */
function advancePayments(record: AutoinvestRuleRecord, context: TickContext, nowMs: number): TickStep {
  const settled = settle(record, context.rows === null ? null : rowsOfRule(context.rows, record.id), nowMs);
  let changed = settled.changed;
  const occurrences = settled.occurrences;
  let payments = record.payments as StoredPayments;
  let remind: StoredOccurrence | null = null;
  let defer: StoredOccurrence | null = null;
  let held = false;

  /* A purchase the price condition deferred is judged again on every pass while it is open — and only while the rule is on. */
  if (record.status === "active") {
    for (let index = 0; index < occurrences.length; index += 1) {
      if (occurrences[index].state !== "deferred") continue;
      const next = recheckDeferred(record, occurrences[index], context, nowMs);
      if (!next) continue;
      occurrences[index] = next.occurrence;
      changed = true;
      if (next.remind) remind = next.occurrence;
      if (next.held) held = true;
    }
  }

  /* A paused rule takes nothing: the events of the pause stay behind its `since` when it is turned on again. */
  if (record.status === "active" && context.payments) {
    const gathered = gatherPayments(payments, context.payments);
    if (gathered.changed) {
      payments = gathered.payments;
      changed = true;
    }
  }

  /* One reminder at a time: while one is open, or its purchase travels, what gathers waits for the next. */
  const open = occurrences.some((occurrence) => occurrence.state === "due" || occurrence.state === "deferred");
  const thresholdCents = Math.round(record.amountUsd * 100);
  if (record.status === "active" && !open && remind === null && payments.gatheredCents > 0 && payments.gatheredCents >= thresholdCents && !context.budgetUnknown) {
    const amountUsd = payments.gatheredCents / 100;
    const dueAt = iso(nowMs);
    const fits = context.remainingUsd === null || fitsBudget(amountUsd, context.remainingUsd);
    /* The price condition is judged only for a purchase that could be offered: within the budget. */
    const check = fits ? judged(record, context, nowMs) : null;
    const state = !fits ? "held" : check !== null && check.verdict !== "met" ? "deferred" : "due";
    const occurrence: StoredOccurrence = {
      dueAt,
      openUntil: iso(state === "held" ? nowMs : nowMs + REMINDER_MS),
      state,
      remindedAt: state === "due" ? dueAt : null,
      signature: null,
      spentUsd: null,
      boughtAt: null,
      trigger: null,
      condition: check,
      amountUsd,
      events: payments.gatheredCount,
    };
    occurrences.push(occurrence);
    payments = takeGathered(payments, dueAt);
    changed = true;
    if (state === "due") remind = occurrence;
    if (state === "deferred") defer = occurrence;
    if (state === "held") held = true;
  }

  return {
    changed,
    remind,
    defer,
    held,
    record: { ...draftOf(record), payments, occurrences: occurrences.slice(-RULE_OCCURRENCES_KEPT), nextDueAt: null, updatedAt: changed ? iso(nowMs) : record.updatedAt },
  };
}

/** The tick's decision for one rule at one instant. */
export function advanceRule(record: AutoinvestRuleRecord, context: TickContext, nowMs: number): TickStep {
  if (record.kind === "payments" && record.payments) return advancePayments(record, context, nowMs);
  return record.kind === "dip" && record.dip ? advanceDip(record, context, nowMs) : advanceSchedule(record, context, nowMs);
}

/** The occurrence one tap may buy under right now: the rule is on, the reminder open, and History holds no purchase for it. */
export function openOccurrenceOf(record: AutoinvestRuleRecord, rows: readonly SolanaWalletAction[], nowMs: number): StoredOccurrence | null {
  if (record.status !== "active") return null;
  const own = rowsOfRule(rows, record.id);
  for (let index = record.occurrences.length - 1; index >= 0; index -= 1) {
    const occurrence = record.occurrences[index];
    if (projectOccurrence(occurrence, own, nowMs).state === "due") return occurrence;
  }
  return null;
}

export type RuleOrderRefusal = Readonly<{ ok: false; status: 404 | 409; code: "RULE_NOT_FOUND" | "RULE_NOT_DUE" | "RULE_MISMATCH" | "RULE_BUDGET_EXHAUSTED" | "RULE_PRICE_CONDITION"; message: string }>;

/** Why the price condition refuses a rule's purchase now, in one sentence. */
function conditionRefusal(check: PriceCheck): string {
  if (check.verdict === "above" && check.deviationPct !== null) {
    return `The price stands ${check.deviationPct.toFixed(1)}% above its reference, over the rule's limit of ${check.limitPct}%; the rule checks again.`;
  }
  if (check.verdict === "stale") return "The price or its reference is not fresh; a rule never buys on old data.";
  return "The price or its reference cannot be read right now; a rule never buys without its reference.";
}

/**
 * The order route's check of `origin.rule` (canon B.3: a rule is never an
 * authorization). The rule must be the proven wallet's and on; the reminder
 * the order names must be open — not bought, not on its way, not missed, not
 * deferred; the order must be the rule's own purchase: its sum of USDC for its
 * company; (1.13.0) the purchase must fit what is left of the month's budget;
 * and (1.18.0) a rule with a price condition must meet it now, on the facts
 * the route reads itself — missing facts never pass. Anything else is refused
 * before a byte is built, so a reminder cannot buy twice, cannot buy something
 * else, two reminders cannot spend past the ceiling, and a rule never buys
 * above the person's limit or on old data.
 */
export function judgeRuleOrder(
  record: AutoinvestRuleRecord | null,
  binding: RuleBinding,
  order: Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>,
  rows: readonly SolanaWalletAction[],
  nowMs: number,
  remainingUsd: number | null = null,
  conditionFacts: PriceFacts | null = null,
): Readonly<{ ok: true; occurrence: StoredOccurrence }> | RuleOrderRefusal {
  if (!record) return { ok: false, status: 404, code: "RULE_NOT_FOUND", message: "No such rule for this wallet." };
  if (record.status !== "active") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "The rule is paused; turn it on to buy under its reminders." };
  const occurrence = record.occurrences.find((candidate) => sameInstant(candidate.dueAt, binding.dueAt)) ?? null;
  if (!occurrence) return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "No reminder of this rule fell due at that time." };
  const state = projectOccurrence(occurrence, rowsOfRule(rows, record.id), nowMs).state;
  if (state === "bought") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "This reminder's purchase is already bought." };
  if (state === "pending") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "A purchase under this reminder is already on its way; recover it by its signature." };
  if (state === "missed") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "This reminder's day has passed; the next one comes on the rule's day." };
  if (state === "held") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "The month's budget held this occurrence; nothing was reminded." };
  if (state === "deferred") return { ok: false, status: 409, code: "RULE_NOT_DUE", message: "The rule's price condition deferred this purchase; the rule checks again while it is open." };
  /* 1.19.0: a «З кожної оплати» reminder buys exactly what it gathered; every other, the rule's sum. */
  const sumUsd = occurrenceSumUsd(record, occurrence);
  if (order.inputMint !== SOLANA_MAINNET_USDC_MINT || order.outputMint !== record.asset.mint || order.amountRaw !== usdToUsdcRaw(sumUsd)) {
    return { ok: false, status: 409, code: "RULE_MISMATCH", message: `The order is not the rule's purchase: ${sumUsd} USDC for ${record.asset.symbol}.` };
  }
  if (remainingUsd !== null && !fitsBudget(sumUsd, remainingUsd)) {
    return { ok: false, status: 409, code: "RULE_BUDGET_EXHAUSTED", message: "What is left of this month's autoinvest budget does not cover this purchase; the rules stand until the 1st." };
  }
  if (record.priceCondition) {
    const check = checkPriceCondition(record.priceCondition.limitPct, conditionFacts, nowMs);
    if (check.verdict !== "met") return { ok: false, status: 409, code: "RULE_PRICE_CONDITION", message: conditionRefusal(check) };
  }
  return { ok: true, occurrence };
}
