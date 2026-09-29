/**
 * «Автоінвест» — the rule's lifecycle and the month's budget
 * (`RYN-INVEST-SIMPLE-001`, sessions 3–4; canon v5.1 §4.1, B.3).
 *
 * Write a rule, read the wallet's rules, pause one or turn it on again,
 * remove one — for the wallet that proved itself and nobody else. The company
 * is resolved by mint from the confirmed stock universe, the way a plan's is
 * (`lib/plans/service.ts`): a rule never names a token nobody confirms, and a
 * company the issuer is not selling right now is refused with that reason.
 *
 * «Регулярно» reminds first at the next instant its day and time name on the
 * person's clock; turned on again, it starts from now — nothing a pause
 * skipped is caught up. «Якщо впаде» takes its reference point from the price
 * the company's page shows when it is written, and again whenever it is
 * turned on after a pause; a price that cannot be read writes nothing.
 *
 * The month's budget is the person's own ceiling for every rule; only the
 * person sets it, changes it or removes it. Its spend is read from History at
 * every read — never stored (`./budget.ts`).
 *
 * Every read projects the occurrences through the wallet's History, so a
 * purchase made under a reminder shows as bought the moment its row settles.
 * The result types are the contract's; the routes turn them into the one error
 * shape. Nothing here reads a cookie or a header, and nothing here buys.
 */

import { RULE_LIST_LIMIT, RULE_MINIMUM_USD, type AutoinvestRule, type RuleBudget, type RuleKind, type RuleOccurrenceState, type RulePaymentsRequest, type RuleStatus } from "../api/v1/contract.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { planAssetOf } from "../plans/service.ts";
import { listSolanaWalletActions, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { eventStateAt } from "../stocks/instrument.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { isRetiredMint, RETIRED_REASON } from "../stocks/retired.ts";
import { companyDisplayName } from "../stocks/shelf.ts";
import { findStockRow, type StockRow } from "../stocks/universe.server.ts";
import { budgetMonth, fitsBudget, remainingOf, spendInMonth } from "./budget.ts";
import { usablePrice } from "./dip.ts";
import { PRICE_CONDITION_MAX_PCT, PRICE_CONDITION_MIN_PCT, RULE_DIP_MAX_PCT, RULE_DIP_MIN_PCT } from "./limits.ts";
import { isPriceConditionLimit, priceFactsOf, type PriceFacts } from "./price-condition.ts";
import { dueOfIdentity } from "./links.ts";
import { projectOccurrence, projectRule, releaseOwnEvents, rowsOfRule, type PaymentsRead } from "./model.ts";
import { freshWatch, markOwnAccount, readPaymentWatch, usdcAccountOf, writePaymentWatch, type PaymentWatchRecord } from "./payment-watch.ts";
import { isReadableSchedule, isTimeZone, nextDueAfter, type RuleSchedule } from "./schedule.ts";
import {
  insertRule,
  listRuleRecords,
  newRuleId,
  readBudgetRecord,
  readRule,
  removeBudgetRecord,
  removeRule,
  replaceRule,
  writeBudgetRecord,
  type AutoinvestBudgetRecord,
  type AutoinvestRuleRecord,
  type StoredDip,
  type StoredPayments,
} from "./store.ts";

export type RuleFailure = Readonly<{ ok: false; code: "ASSET_UNCONFIRMED" | "RULE_NOT_FOUND" | "RULE_LIMIT_REACHED" | "VALIDATION_ERROR" | "UNAVAILABLE"; message: string }>;
export type RuleWriteResult = Readonly<{ ok: true; rule: AutoinvestRule }> | RuleFailure;
export type BudgetResult = Readonly<{ ok: true; budget: RuleBudget }> | RuleFailure;

type Ledger = (store: GuardStore, owner: string) => Promise<readonly SolanaWalletAction[]>;
export type RuleDeps = Readonly<{
  now?: () => Date;
  findRow?: typeof findStockRow;
  ledger?: Ledger;
  ruleId?: () => string;
  lifecycle?: typeof lifecycleEventFor;
  /** 1.19.0: the wallet's USDC account; the tests pass one. */
  usdcAccount?: (owner: string) => Promise<string>;
}>;

const iso = (ms: number): string => new Date(ms).toISOString();
/** A price per unit kept to a millionth of a dollar. */
const toMillionth = (usd: number): number => Math.round(usd * 1e6) / 1e6;

function nowOf(deps: RuleDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/** The wallet's History; a History that cannot be read leaves every occurrence as the tick last decided it. */
export async function ledgerOf(store: GuardStore, owner: string, deps: RuleDeps = {}): Promise<readonly SolanaWalletAction[]> {
  if (deps.ledger) return deps.ledger(store, owner);
  try {
    return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
  } catch {
    return [];
  }
}

/** The wallet's History, or null when it could not be read — the tick's reader, which must tell «nothing» from «could not say». */
export async function readLedger(store: GuardStore, owner: string, deps: RuleDeps = {}): Promise<readonly SolanaWalletAction[] | null> {
  try {
    if (deps.ledger) return await deps.ledger(store, owner);
    return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
  } catch {
    return null;
  }
}

/**
 * The facts a rule's price condition is judged on (1.18.0): the company's row
 * as the universe the pages read states it now; null when the row could not
 * be read — which never passes.
 */
export async function conditionFactsOf(mint: string, deps: RuleDeps = {}): Promise<PriceFacts | null> {
  const found = await (deps.findRow ?? findStockRow)(mint).catch(() => null);
  if (!found || !found.ok || !found.row || found.row.representation.mint !== mint) return null;
  const universeAt = found.universe ? Date.parse(found.universe.marketsObservedAt) : Number.NaN;
  return priceFactsOf(found.row, Number.isFinite(universeAt) ? universeAt : null);
}

/** The price a company's page shows, per unit as the wallet shows it, while it is fresh; null otherwise. A row with no time of its own was read with the universe just now. */
export function pagePriceOf(row: StockRow, nowMs: number): number | null {
  const observed = row.market.observedAt ? Date.parse(row.market.observedAt) : nowMs;
  return usablePrice(typeof row.market.priceUsd === "number" ? { usd: row.market.priceUsd, observedAtMs: observed } : null, nowMs);
}

type RuleInput = Readonly<{
  owner: string;
  mint: string;
  amountUsd: number;
  /** Absent: «Регулярно». */
  kind?: RuleKind;
  schedule?: RuleSchedule | null;
  dip?: Readonly<{ dropPct: number; timeZone: string }> | null;
  /** 1.19.0: «З кожної оплати» — the mode and its figure; the rule's `amountUsd` is the least sum a reminder opens at. */
  payments?: RulePaymentsRequest | null;
  /** 1.18.0: «Умова ціни»; absent or null — none. */
  priceCondition?: Readonly<{ limitPct: number }> | null;
  locale: "en" | "uk";
}>;

/** The terms a «З кожної оплати» request asks for make one rule: the mode's own figure and nothing else. */
function paymentTermsValid(terms: RulePaymentsRequest): boolean {
  if (!isTimeZone(terms.timeZone)) return false;
  if (terms.mode === "roundup") return terms.roundToUsd !== null && terms.fixedUsd === null && terms.percent === null;
  if (terms.mode === "fixed") return terms.fixedUsd !== null && terms.roundToUsd === null && terms.percent === null;
  return terms.percent !== null && terms.roundToUsd === null && terms.fixedUsd === null;
}

/**
 * Make the wallet's watch ready to count from now: a wallet with no watch
 * gets one; a watch nobody read for a while (no rule of that kind was on)
 * starts its next read from the newest transactions again rather than wading
 * through everything since. Returns the number the next event will carry —
 * a new rule takes nothing numbered before it.
 */
export async function readyPaymentWatch(store: GuardStore, owner: string, nowMs: number, deps: RuleDeps = {}): Promise<number> {
  const stale = 30 * 60_000;
  const outcome = await withBoundedCasRetry<number>(async () => {
    const current = await readPaymentWatch(store, owner);
    if (current && current.readAt !== null && nowMs - Date.parse(current.readAt) <= stale) return current.nextSeq;
    const account = current?.account ?? (await (deps.usdcAccount ?? usdcAccountOf)(owner));
    const base = current ? (({ version: _version, ...rest }: PaymentWatchRecord) => rest)(current) : freshWatch(owner, account, nowMs);
    const next = { ...base, cursor: null, balanceRaw: null, updatedAt: new Date(nowMs).toISOString() };
    return (await writePaymentWatch(store, current, next)) ? next.nextSeq : false;
  }).catch(() => null);
  return outcome ?? 1;
}

export async function createRule(store: GuardStore, input: RuleInput, deps: RuleDeps = {}): Promise<RuleWriteResult> {
  const kind: RuleKind = input.kind ?? "schedule";
  const schedule = kind === "schedule" ? (input.schedule ?? null) : null;
  const dipAsk = kind === "dip" ? (input.dip ?? null) : null;
  const paymentsAsk = kind === "payments" ? (input.payments ?? null) : null;
  const priceCondition = input.priceCondition ?? null;
  if (kind === "schedule" && (!schedule || !isReadableSchedule(schedule))) return { ok: false, code: "VALIDATION_ERROR", message: "schedule: the day, the time and the time zone do not make a schedule." };
  if (kind === "dip" && (!dipAsk || !Number.isInteger(dipAsk.dropPct) || dipAsk.dropPct < RULE_DIP_MIN_PCT || dipAsk.dropPct > RULE_DIP_MAX_PCT || !isTimeZone(dipAsk.timeZone))) {
    return { ok: false, code: "VALIDATION_ERROR", message: `dip: a fall of ${RULE_DIP_MIN_PCT}–${RULE_DIP_MAX_PCT} whole per cent and a time zone.` };
  }
  if (kind === "payments" && (!paymentsAsk || !paymentTermsValid(paymentsAsk))) {
    return { ok: false, code: "VALIDATION_ERROR", message: "payments: a round-up to $1 or $5, a sum from every payment or a per cent of what comes in — one of them — and a time zone." };
  }
  if (priceCondition !== null && !isPriceConditionLimit(priceCondition.limitPct)) {
    return { ok: false, code: "VALIDATION_ERROR", message: `priceCondition: a limit of ${PRICE_CONDITION_MIN_PCT}–${PRICE_CONDITION_MAX_PCT} whole per cent.` };
  }
  const existing = await listRuleRecords(store, input.owner);
  if (existing.length >= RULE_LIST_LIMIT) {
    return { ok: false, code: "RULE_LIMIT_REACHED", message: `A wallet holds at most ${RULE_LIST_LIMIT} rules; remove one first.` };
  }
  /* A token Ryntra no longer supports (canon v5.2 В26) is named by no new rule, and no provider is asked about it. */
  if (isRetiredMint(input.mint)) return { ok: false, code: "ASSET_UNCONFIRMED", message: `Autoinvest cannot name that token. ${RETIRED_REASON}` };
  const found = await (deps.findRow ?? findStockRow)(input.mint);
  if (!found.ok) return { ok: false, code: "UNAVAILABLE", message: found.reason };
  const row = found.row && found.row.representation.mint === input.mint ? found.row : null;
  if (!row) return { ok: false, code: "ASSET_UNCONFIRMED", message: "Autoinvest names a company: that mint is not a confirmed stock representation." };
  const rep = row.representation;
  if (!row.lifecycle.tradable || rep.tradingHalted === true) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: "The issuer is not offering new purchases of this company right now." };
  }
  const now = nowOf(deps);
  /* The registry's event read with the clock: a conversion window past its cut-off is closed, whatever the file still says. */
  const lifecycle = (deps.lifecycle ?? lifecycleEventFor)(input.mint);
  if (lifecycle && eventStateAt(lifecycle, now.getTime()) !== "conversion-open") return { ok: false, code: "ASSET_UNCONFIRMED", message: lifecycle.note };
  const at = now.toISOString();
  let dip: StoredDip | null = null;
  if (dipAsk) {
    /* The reference point is the price the page shows now; without one the rule would fall from nothing. */
    const price = pagePriceOf(row, now.getTime());
    if (price === null) return { ok: false, code: "UNAVAILABLE", message: "The company's price could not be read right now; try again." };
    dip = { dropPct: dipAsk.dropPct, timeZone: dipAsk.timeZone, anchorUsd: toMillionth(price), anchorAt: at, anchorFrom: "enabled", armed: true, heldAt: null };
  }
  let payments: StoredPayments | null = null;
  if (paymentsAsk) {
    /* Events count from now: nothing the wallet's watch numbered before this rule is its. */
    const nextSeq = await readyPaymentWatch(store, input.owner, now.getTime(), deps);
    payments = {
      mode: paymentsAsk.mode,
      roundToUsd: paymentsAsk.roundToUsd,
      fixedUsd: paymentsAsk.fixedUsd === null ? null : Math.round(paymentsAsk.fixedUsd * 100) / 100,
      percent: paymentsAsk.percent,
      timeZone: paymentsAsk.timeZone,
      since: at,
      lastSeq: Math.max(0, nextSeq - 1),
      gatheredCents: 0,
      gatheredCount: 0,
      events: [],
    };
  }
  const preIpo = rep.instrument?.class === "pre-ipo";
  const record: AutoinvestRuleRecord = {
    schema: "ryntra.autoinvest-rule",
    schemaVersion: "1.0.0",
    id: (deps.ruleId ?? newRuleId)(),
    owner: input.owner,
    network: "solana:mainnet",
    kind,
    asset: planAssetOf(row),
    name: companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol).slice(0, 128),
    amountUsd: Math.round(input.amountUsd * 100) / 100,
    schedule,
    dip,
    payments,
    priceCondition: priceCondition ? { limitPct: priceCondition.limitPct } : null,
    status: "active",
    locale: input.locale,
    nextDueAt: schedule ? iso(nextDueAfter(schedule, now.getTime())) : null,
    occurrences: [],
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  if (!(await insertRule(store, record))) return { ok: false, code: "UNAVAILABLE", message: "The rule could not be stored; try again." };
  return { ok: true, rule: projectRule(record, [], now.getTime(), payments ? await paymentsReadOf(store, input.owner, [record]) : null) };
}

/** When the wallet's USDC was last read and how that read went — for the rules of that kind; null without one. */
export async function paymentsReadOf(store: GuardStore, owner: string, records: readonly AutoinvestRuleRecord[]): Promise<PaymentsRead> {
  if (!records.some((record) => record.kind === "payments")) return null;
  const watch = await readPaymentWatch(store, owner).catch(() => null);
  return watch && watch.readAt ? { at: watch.readAt, state: watch.readState } : null;
}

/** The clock a wallet's month is counted on: its budget's, else its newest rule's, else UTC. */
function monthZone(budget: AutoinvestBudgetRecord | null, records: readonly AutoinvestRuleRecord[]): string {
  if (budget) return budget.timeZone;
  for (const record of records) {
    const zone = record.schedule?.timeZone ?? record.dip?.timeZone ?? record.payments?.timeZone ?? null;
    if (zone && isTimeZone(zone)) return zone;
  }
  return "UTC";
}

/** What is left of a wallet's ceiling this month, from History; null without a ceiling. */
export function remainingFor(budget: AutoinvestBudgetRecord | null, records: readonly AutoinvestRuleRecord[], rows: readonly SolanaWalletAction[], nowMs: number): number | null {
  if (!budget) return null;
  const month = budgetMonth(nowMs, budget.timeZone);
  const sums = new Map(records.map((record) => [record.id, record.amountUsd]));
  return remainingOf(budget.capUsd, spendInMonth(rows, month, (ruleId) => sums.get(ruleId) ?? null));
}

/** The month as the contract states it. */
export function projectBudget(budget: AutoinvestBudgetRecord | null, records: readonly AutoinvestRuleRecord[], rows: readonly SolanaWalletAction[], nowMs: number): RuleBudget {
  const timeZone = monthZone(budget, records);
  const month = budgetMonth(nowMs, timeZone);
  const sums = new Map(records.map((record) => [record.id, record.amountUsd]));
  const spend = spendInMonth(rows, month, (ruleId) => sums.get(ruleId) ?? null);
  const remainingUsd = budget ? remainingOf(budget.capUsd, spend) : null;
  const active = records.filter((record) => record.status === "active");
  /* Spent when no rule that is on can buy with what is left; with no rule on, when not even the least purchase fits. */
  const exhausted = remainingUsd !== null && (active.length > 0 ? active.every((record) => !fitsBudget(record.amountUsd, remainingUsd)) : !fitsBudget(RULE_MINIMUM_USD, remainingUsd));
  return {
    capUsd: budget?.capUsd ?? null,
    timeZone,
    monthStartsAt: iso(month.startMs),
    monthEndsAt: iso(month.endMs),
    spentUsd: spend.spentUsd,
    unknownUsd: spend.unknownUsd,
    remainingUsd,
    exhausted,
    updatedAt: budget?.updatedAt ?? null,
  };
}

/** The wallet's rules, newest written first, through History; and the month's budget. */
export async function listRules(store: GuardStore, owner: string, deps: RuleDeps = {}): Promise<Readonly<{ rules: readonly AutoinvestRule[]; total: number; budget: RuleBudget }>> {
  const [records, budget] = await Promise.all([listRuleRecords(store, owner), readBudgetRecord(store, owner)]);
  const nowMs = nowOf(deps).getTime();
  const rows = records.length > 0 || budget ? await ledgerOf(store, owner, deps) : [];
  const read = await paymentsReadOf(store, owner, records);
  return {
    rules: records.slice(0, RULE_LIST_LIMIT).map((record) => projectRule(record, rows, nowMs, read)),
    total: records.length,
    budget: projectBudget(budget, records, rows, nowMs),
  };
}

export async function getRule(store: GuardStore, owner: string, ruleId: string, deps: RuleDeps = {}): Promise<RuleWriteResult> {
  const record = await readRule(store, owner, ruleId);
  if (!record) return { ok: false, code: "RULE_NOT_FOUND", message: "No such rule for this wallet." };
  return { ok: true, rule: projectRule(record, await ledgerOf(store, owner, deps), nowOf(deps).getTime(), await paymentsReadOf(store, owner, [record])) };
}

/**
 * Pause a rule, or turn it on again. A pause stops the reminders; an open
 * reminder stays open to its end — it was already sent. Turning it on starts
 * from now: a «Регулярно» rule's next due is the next instant its schedule
 * names, a «Якщо впаде» rule's reference point is the price now — nothing the
 * pause skipped is caught up.
 */
export async function setRuleStatus(store: GuardStore, owner: string, ruleId: string, status: RuleStatus, deps: RuleDeps = {}): Promise<RuleWriteResult> {
  const first = await readRule(store, owner, ruleId);
  if (!first) return { ok: false, code: "RULE_NOT_FOUND", message: "No such rule for this wallet." };
  /* A «Якщо впаде» rule turned on again falls from the price now: read before the write, so a price nobody could read changes nothing. */
  let price: number | null = null;
  if (status === "active" && first.status !== "active" && first.kind === "dip") {
    const found = await (deps.findRow ?? findStockRow)(first.asset.mint).catch(() => null);
    const row = found && found.ok && found.row && found.row.representation.mint === first.asset.mint ? found.row : null;
    price = row ? pagePriceOf(row, nowOf(deps).getTime()) : null;
    if (price === null) return { ok: false, code: "UNAVAILABLE", message: "The company's price could not be read right now; try again." };
  }
  /* A «З кожної оплати» rule turned on again counts from now: the events of the pause are not its. */
  const resumedSeq = status === "active" && first.status !== "active" && first.kind === "payments" ? await readyPaymentWatch(store, owner, nowOf(deps).getTime(), deps) : null;
  const outcome = await withBoundedCasRetry<AutoinvestRuleRecord | "missing">(async () => {
    const read = await readRule(store, owner, ruleId);
    if (!read) return "missing";
    if (read.status === status) return read;
    const nowMs = nowOf(deps).getTime();
    const { version: _version, ...rest } = read;
    const resumedDip = status === "active" && read.dip && price !== null ? { ...read.dip, anchorUsd: toMillionth(price), anchorAt: iso(nowMs), anchorFrom: "enabled" as const, armed: true, heldAt: null } : read.dip;
    const resumedPayments = status === "active" && read.payments && resumedSeq !== null ? { ...read.payments, since: iso(nowMs), lastSeq: Math.max(read.payments.lastSeq, resumedSeq - 1) } : read.payments;
    const next = {
      ...rest,
      status,
      dip: resumedDip,
      payments: resumedPayments,
      nextDueAt: status === "active" && read.schedule ? iso(nextDueAfter(read.schedule, nowMs)) : null,
      updatedAt: iso(nowMs),
    };
    return (await replaceRule(store, read, next)) ? { ...next, version: read.version + 1 } : false;
  }).catch(() => null);
  if (outcome === null) return { ok: false, code: "UNAVAILABLE", message: "The rule is being changed elsewhere; try again." };
  if (outcome === "missing") return { ok: false, code: "RULE_NOT_FOUND", message: "No such rule for this wallet." };
  return { ok: true, rule: projectRule(outcome, await ledgerOf(store, owner, deps), nowOf(deps).getTime(), await paymentsReadOf(store, owner, [outcome])) };
}

/**
 * «Це мій рахунок» (1.19.0): the other side of one counted event is the
 * person's own account. From now on no transfer to or from it counts for any
 * «З кожної оплати» rule of the wallet, and every waiting event with it leaves
 * what waits. The account is never named back.
 */
export async function markOwnPaymentAccount(store: GuardStore, owner: string, signature: string, deps: RuleDeps = {}): Promise<Readonly<{ ok: true; rules: readonly AutoinvestRule[]; total: number; budget: RuleBudget }> | RuleFailure> {
  const nowMs = nowOf(deps).getTime();
  const marked = await markOwnAccount(store, owner, signature, nowMs);
  if (!marked.ok) {
    return marked.code === "EVENT_NOT_FOUND"
      ? { ok: false, code: "RULE_NOT_FOUND", message: "No counted payment of this wallet has that signature." }
      : { ok: false, code: "UNAVAILABLE", message: "The wallet's payments are being changed elsewhere; try again." };
  }
  /* Every event of the wallet's watch with that other side — the one named and any other still waiting. */
  const leaving = new Set(marked.watch.events.filter((event) => event.counterparty === marked.account).map((event) => event.signature));
  for (const listed of await listRuleRecords(store, owner)) {
    if (listed.kind !== "payments" || !listed.payments) continue;
    await withBoundedCasRetry(async () => {
      const read = await readRule(store, owner, listed.id);
      if (!read || !read.payments) return true;
      const released = releaseOwnEvents(read.payments, leaving);
      if (!released.changed) return true;
      const { version: _version, ...rest } = read;
      return replaceRule(store, read, { ...rest, payments: released.payments, updatedAt: iso(nowMs) });
    }).catch(() => false);
  }
  const listed = await listRules(store, owner, deps);
  return { ok: true, rules: listed.rules, total: listed.total, budget: listed.budget };
}

/** Remove a rule. Its purchases stay in History, each still naming it — and still counted in the month they were signed in. */
export async function deleteRule(store: GuardStore, owner: string, ruleId: string): Promise<Readonly<{ ok: true; id: string }> | RuleFailure> {
  const read = await readRule(store, owner, ruleId);
  if (!read) return { ok: false, code: "RULE_NOT_FOUND", message: "No such rule for this wallet." };
  await removeRule(store, owner, ruleId);
  return { ok: true, id: ruleId };
}

/**
 * What became of each of the wallet's reminders, as its rule reads it now
 * (1.13.0, `ruleState` on the monitoring surface): the rule's occurrence the
 * note's identity names, projected through History. A reminder whose rule is
 * gone, or whose occurrence the rule no longer keeps, says nothing.
 */
export async function reminderStates(
  store: GuardStore,
  owner: string,
  nowMs: number,
  deps: RuleDeps = {},
): Promise<(note: Readonly<{ triggerId: string; subject?: Readonly<{ kind: string; id: string }> }>) => RuleOccurrenceState | null> {
  const records = await listRuleRecords(store, owner);
  if (records.length === 0) return () => null;
  const rows = await ledgerOf(store, owner, deps);
  const byId = new Map(records.map((record) => [record.id, record]));
  return (note) => {
    const rule = note.subject?.kind === "autoinvest-rule" ? byId.get(note.subject.id) : undefined;
    const due = rule ? dueOfIdentity(note.triggerId, rule.id) : null;
    if (!rule || !due) return null;
    const occurrence = rule.occurrences.find((candidate) => Date.parse(candidate.dueAt) === Date.parse(due));
    return occurrence ? projectOccurrence(occurrence, rowsOfRule(rows, rule.id), nowMs).state : null;
  };
}

/* ------------------------------------------------------------ the month's budget (1.13.0) */

async function budgetNow(store: GuardStore, owner: string, budget: AutoinvestBudgetRecord | null, deps: RuleDeps): Promise<RuleBudget> {
  const records = await listRuleRecords(store, owner);
  const rows = records.length > 0 || budget ? await ledgerOf(store, owner, deps) : [];
  return projectBudget(budget, records, rows, nowOf(deps).getTime());
}

export async function readBudget(store: GuardStore, owner: string, deps: RuleDeps = {}): Promise<RuleBudget> {
  return budgetNow(store, owner, await readBudgetRecord(store, owner), deps);
}

/** Set the ceiling — the person's own number, on the person's own clock. */
export async function setBudget(store: GuardStore, owner: string, input: Readonly<{ capUsd: number; timeZone: string; locale: "en" | "uk" }>, deps: RuleDeps = {}): Promise<BudgetResult> {
  if (!isTimeZone(input.timeZone)) return { ok: false, code: "VALIDATION_ERROR", message: "timeZone: not a time zone (an IANA name such as Europe/Kyiv)." };
  const written = await withBoundedCasRetry<AutoinvestBudgetRecord>(async () => {
    const read = await readBudgetRecord(store, owner);
    const at = nowOf(deps).toISOString();
    const next = {
      schema: "ryntra.autoinvest-budget" as const,
      schemaVersion: "1.0.0" as const,
      owner,
      network: "solana:mainnet" as const,
      capUsd: Math.round(input.capUsd * 100) / 100,
      timeZone: input.timeZone,
      locale: input.locale,
      createdAt: read?.createdAt ?? at,
      updatedAt: at,
    };
    return (await writeBudgetRecord(store, read, next)) ? { ...next, version: (read?.version ?? 0) + 1 } : false;
  }).catch(() => null);
  if (!written) return { ok: false, code: "UNAVAILABLE", message: "The budget could not be stored; try again." };
  return { ok: true, budget: await budgetNow(store, owner, written, deps) };
}

/** Remove the ceiling: the month is still counted, and nothing is held by it. */
export async function clearBudget(store: GuardStore, owner: string, deps: RuleDeps = {}): Promise<BudgetResult> {
  await removeBudgetRecord(store, owner);
  return { ok: true, budget: await budgetNow(store, owner, null, deps) };
}
