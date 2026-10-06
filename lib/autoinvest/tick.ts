/**
 * The monitoring tick's autoinvest step («Час покупки за правилом» ·
 * «Пропущено» · «Бюджет вичерпано»).
 *
 * Every five minutes, for every rule of every wallet: an occurrence that
 * History shows settled is marked bought; one whose day passed with no
 * purchase is marked missed; a «Регулярно» rule whose next due has come opens
 * the latest due — only the latest, never a backlog; a «Якщо впаде» rule
 * whose company's price is read at or below its trigger opens one reminder
 * per crossing, and moves its reference point after a purchase. Each opened
 * occurrence reminds: one note in the inbox (always) and one Telegram message
 * or push where the wallet's preferences carry them, each claimed once per
 * occurrence so a retried tick never sends a second.
 *
 * Under a month's budget, a purchase that does not fit what is left is not
 * reminded of: the occurrence is held, and one note — once per wallet, month
 * and ceiling — says the budget is spent and the rules stand until the 1st.
 * A spend nobody could read opens nothing on this pass; the next one decides.
 *
 * A rule with a price condition (1.18.0) judges it when it falls due, on the
 * facts the company's page reads: not met, or the data not fresh, and the
 * purchase is deferred — one note in the inbox, the bell and Home's
 * notifications say why, with the figure and the data's time — and every
 * pass judges it again while the occurrence is open.
 *
 * A «З кожної оплати» rule (1.19.0) reads its wallet's watch: once per wallet
 * and pass, while one of its rules of that kind is on, the transactions that
 * touched the wallet's USDC since the last read are read and numbered
 * (`./payment-watch.ts`), and each rule takes its share of the new events; a
 * sum that reached the rule's minimum opens one reminder on exactly that sum
 * — «З оплат: $1,30 → Apple».
 *
 * The note opens a fresh Review on the rule's sum; it is never permission to
 * trade, and nothing here reads a quote, builds an order or touches a wallet.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { enqueue, inboxKeyOf } from "../monitoring/apply.ts";
import { claimTrigger, inboxOf, newInboxId, readPreferences, type InboxRecord } from "../monitoring/store.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { isRetiredMint } from "../stocks/retired.ts";
import { readStockUniverse } from "../stocks/universe.server.ts";
import { budgetMonth, spendInMonth } from "./budget.ts";
import { dipTriggerUsd, usablePrice, type DipPrice } from "./dip.ts";
import { budgetMonitorId, budgetSpentIdentity, budgetSubjectId, deferralIdentity, reminderIdentity, ruleMonitorId } from "./links.ts";
import { advanceRule, type PaymentsWatchView } from "./model.ts";
import { readPaymentWatch, refreshPaymentWatch, type PaymentWatchRecord } from "./payment-watch.ts";
import { deferralWords, priceFactsOf, type PriceFacts } from "./price-condition.ts";
import { readLedger, remainingFor, type RuleDeps } from "./service.ts";
import { listAllRuleRecords, readBudgetRecord, readRule, replaceRule, type AutoinvestBudgetRecord, type AutoinvestRuleRecord, type StoredOccurrence } from "./store.ts";
import { budgetSpentWords, dipReminderWords, paymentsReminderWords, reminderWords, type ReminderWords } from "./words.ts";

/**
 * A rule's company as the tick reads it: the page's price with its time and
 * the Scaled UI multiplier («Якщо впаде»), and the facts its price condition
 * is judged on (1.18.0) — absent or null when they could not be read.
 */
export type DipMarket = Readonly<{ price: DipPrice | null; multiplier: number | null; condition?: PriceFacts | null }>;
export type DipMarkets = (mints: readonly string[]) => Promise<ReadonlyMap<string, DipMarket>>;
/** 1.19.0: the wallet's watch, read and folded for this pass; the tests pass their own. */
export type PaymentWatchReader = (
  store: GuardStore,
  owner: string,
  nowMs: number,
  input: Readonly<{ sinceMs: number; ryntraRows: () => Promise<readonly SolanaWalletAction[] | null>; deadlineMs?: number }>,
) => Promise<PaymentWatchRecord | null>;

/**
 * How long, of the monitoring pass's minute, the wallets' USDC may be read in
 * all: past it a wallet takes the events its watch already numbered, and its
 * chain is read on the next pass.
 */
export const PAYMENTS_PASS_BUDGET_MS = 20_000;
export type TickDeps = RuleDeps & Readonly<{ markets?: DipMarkets; paymentWatch?: PaymentWatchReader }>;

/** The companies' prices and the facts their price conditions read, from the one universe the company pages read — one read for every rule in the pass. */
export async function readDipMarkets(mints: readonly string[]): Promise<ReadonlyMap<string, DipMarket>> {
  const read = await readStockUniverse();
  const markets = new Map<string, DipMarket>();
  if (!read.ok) return markets;
  const wanted = new Set(mints);
  const universeObserved = Date.parse(read.universe.marketsObservedAt);
  for (const row of read.universe.rows) {
    const mint = row.representation.mint;
    if (!wanted.has(mint) || markets.has(mint)) continue;
    const observed = Date.parse(row.market.observedAt ?? read.universe.marketsObservedAt);
    markets.set(mint, {
      price: typeof row.market.priceUsd === "number" && Number.isFinite(observed) ? { usd: row.market.priceUsd, observedAtMs: observed } : null,
      multiplier: row.multiplier?.current ?? null,
      condition: priceFactsOf(row, Number.isFinite(universeObserved) ? universeObserved : null),
    });
  }
  return markets;
}

/** The clock a rule's words tell time on: its schedule's, its fall's, its payments', else UTC. */
function zoneOf(rule: Pick<AutoinvestRuleRecord, "schedule" | "dip" | "payments">): string {
  return rule.schedule?.timeZone ?? rule.dip?.timeZone ?? rule.payments?.timeZone ?? "UTC";
}

/**
 * Write the note that an occurrence's purchase is deferred by the price
 * condition: once per occurrence, in the inbox only — the bell and Home's
 * notifications carry it; the reminder that follows when the condition is
 * met travels as every reminder does.
 */
export async function writeDeferral(store: GuardStore, rule: ReminderRule, occurrence: StoredOccurrence, nowMs: number): Promise<boolean> {
  if (!occurrence.condition) return false;
  const at = new Date(nowMs).toISOString();
  const identity = deferralIdentity(rule.id, occurrence.dueAt, rule.asset.symbol);
  if (!(await claimTrigger(store, identity, at))) return false;
  const words = deferralWords({ name: rule.name, check: occurrence.condition, timeZone: zoneOf(rule), nowMs });
  const own = words[rule.locale];
  const inboxId = newInboxId();
  const note: InboxRecord = {
    id: inboxId,
    owner: rule.owner,
    monitorId: ruleMonitorId(rule.id),
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: rule.name,
    href: `/app/alerts/open?n=${inboxId}`,
    cta: own.cta,
    paper: false,
    unread: true,
    createdAt: at,
    locale: rule.locale,
    subject: { kind: "autoinvest-rule", id: rule.id },
    text: { en: { title: words.en.title, reason: words.en.reason }, uk: { title: words.uk.title, reason: words.uk.reason } },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(rule.owner, inboxId), note);
  return true;
}

type ReminderRule = Pick<AutoinvestRuleRecord, "id" | "owner" | "name" | "amountUsd" | "schedule" | "dip" | "payments" | "locale" | "asset">;

function wordsOf(rule: ReminderRule, occurrence: StoredOccurrence): ReminderWords | null {
  if (rule.payments && occurrence.amountUsd !== null) return paymentsReminderWords({ name: rule.name, amountUsd: occurrence.amountUsd, events: occurrence.events ?? 0, payments: rule.payments });
  if (occurrence.trigger) return dipReminderWords({ name: rule.name, amountUsd: rule.amountUsd, priceUsd: occurrence.trigger.priceUsd, anchorUsd: occurrence.trigger.anchorUsd });
  return rule.schedule ? reminderWords({ name: rule.name, amountUsd: rule.amountUsd, schedule: rule.schedule }) : null;
}

/** Write the reminder of one occurrence: the note, then its deliveries. Idempotent by the occurrence's identity. */
export async function writeReminder(store: GuardStore, rule: ReminderRule, occurrence: StoredOccurrence, nowMs: number): Promise<boolean> {
  const words = wordsOf(rule, occurrence);
  if (!words) return false;
  const at = new Date(nowMs).toISOString();
  const identity = reminderIdentity(rule.id, occurrence.dueAt, rule.asset.symbol);
  if (!(await claimTrigger(store, identity, at))) return false;
  const inboxId = newInboxId();
  const own = words[rule.locale];
  const note: InboxRecord = {
    id: inboxId,
    owner: rule.owner,
    monitorId: ruleMonitorId(rule.id),
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: rule.name,
    href: `/app/alerts/open?n=${inboxId}`,
    cta: own.cta,
    paper: false,
    unread: true,
    createdAt: at,
    locale: rule.locale,
    subject: { kind: "autoinvest-rule", id: rule.id },
    text: { en: { title: words.en.title, reason: words.en.reason }, uk: { title: words.uk.title, reason: words.uk.reason } },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(rule.owner, inboxId), note);
  const prefs = await readPreferences(store, rule.owner);
  if (prefs.telegram) await enqueue(store, rule.owner, identity, inboxId, "telegram", at);
  if (prefs.push) await enqueue(store, rule.owner, identity, inboxId, "push", at);
  return true;
}

/** Write the note that the month's budget is spent: once per wallet, month and ceiling, with its deliveries. */
export async function writeBudgetNote(store: GuardStore, budget: AutoinvestBudgetRecord, countedUsd: number, nowMs: number): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  const month = budgetMonth(nowMs, budget.timeZone);
  const identity = budgetSpentIdentity(budget.owner, month.key, budget.capUsd);
  if (!(await claimTrigger(store, identity, at))) return false;
  const words = budgetSpentWords({ capUsd: budget.capUsd, countedUsd });
  const own = words[budget.locale];
  const inboxId = newInboxId();
  const note: InboxRecord = {
    id: inboxId,
    owner: budget.owner,
    monitorId: budgetMonitorId(budget.owner),
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: budget.locale === "uk" ? "Регулярна купівля" : "Recurring buy",
    href: `/app/alerts/open?n=${inboxId}`,
    cta: own.cta,
    paper: false,
    unread: true,
    createdAt: at,
    locale: budget.locale,
    subject: { kind: "autoinvest-budget", id: budgetSubjectId(month.key) },
    text: { en: { title: words.en.title, reason: words.en.reason }, uk: { title: words.uk.title, reason: words.uk.reason } },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(budget.owner, inboxId), note);
  const prefs = await readPreferences(store, budget.owner);
  if (prefs.telegram) await enqueue(store, budget.owner, identity, inboxId, "telegram", at);
  if (prefs.push) await enqueue(store, budget.owner, identity, inboxId, "push", at);
  return true;
}

/** An occurrence the price condition deferred, still open — judged again on this pass. */
function waitsOnCondition(record: AutoinvestRuleRecord, nowMs: number): boolean {
  return record.occurrences.some((occurrence) => occurrence.state === "deferred" && nowMs <= Date.parse(occurrence.openUntil));
}

/** Whether a rule could open an occurrence on this pass — the only time the month's spend matters to it. */
function mayOpen(record: AutoinvestRuleRecord, market: DipMarket | undefined, nowMs: number, watch: PaymentsWatchView | null = null): boolean {
  if (record.status !== "active") return false;
  /* A deferred purchase whose condition may be met now would open its reminder: the budget decides it too. */
  if (waitsOnCondition(record, nowMs)) return true;
  /* A «З кожної оплати» rule may open when something waits, or the watch holds events it has not taken yet. */
  if (record.kind === "payments" && record.payments) {
    const lastSeq = record.payments.lastSeq;
    return record.payments.gatheredCents > 0 || (watch?.events.some((event) => event.seq > lastSeq) ?? false);
  }
  if (record.kind === "dip" && record.dip) {
    if (!record.dip.armed || record.occurrences.some((occurrence) => occurrence.state === "due")) return false;
    const price = usablePrice(market?.price, nowMs);
    return price !== null && price <= dipTriggerUsd(record.dip.anchorUsd, record.dip.dropPct);
  }
  return record.nextDueAt !== null && Date.parse(record.nextDueAt) <= nowMs;
}

/** Whether the tick reads a rule's company this pass: a «Якщо впаде» rule always; a rule with a price condition when it falls due or waits on it. */
function readsMarket(record: AutoinvestRuleRecord, nowMs: number): boolean {
  if (record.kind === "dip") return record.status === "active" || record.occurrences.some((occurrence) => occurrence.state === "due");
  if (!record.priceCondition || record.status !== "active") return false;
  /* A «З кожної оплати» rule may reach its minimum on any pass: the universe is read once for the whole pass anyway. */
  if (record.kind === "payments") return true;
  return waitsOnCondition(record, nowMs) || (record.nextDueAt !== null && Date.parse(record.nextDueAt) <= nowMs);
}

export type AutoinvestTick = Readonly<{ rules: number; reminded: number; deferred: number; held: number; failed: number }>;

/**
 * One pass over every rule. A rule that fails is left for the next pass and
 * never stops the others; History and the budget are read once per wallet,
 * and only for a wallet with a reminder to settle or an occurrence to open;
 * the companies' prices once for the whole pass.
 */
export async function tickAutoinvest(store: GuardStore, nowMs: number, deps: TickDeps = {}): Promise<AutoinvestTick> {
  const records = await listAllRuleRecords(store);
  const byOwner = new Map<string, AutoinvestRuleRecord[]>();
  for (const record of records) byOwner.set(record.owner, [...(byOwner.get(record.owner) ?? []), record]);
  const marketMints = [...new Set(records.filter((record) => !isRetiredMint(record.asset.mint) && readsMarket(record, nowMs)).map((record) => record.asset.mint))];
  const markets: ReadonlyMap<string, DipMarket> = marketMints.length > 0 ? await (deps.markets ?? readDipMarkets)(marketMints).catch(() => new Map<string, DipMarket>()) : new Map<string, DipMarket>();

  let reminded = 0;
  let deferred = 0;
  let held = 0;
  let failed = 0;
  /* Wall-clock time, not the pass's logical instant: the minute the monitoring route has is real. */
  const paymentsDeadline = Date.now() + PAYMENTS_PASS_BUDGET_MS;
  for (const [owner, list] of byOwner) {
    let ledger: readonly SolanaWalletAction[] | null | undefined;
    const rowsOf = async (): Promise<readonly SolanaWalletAction[] | null> => {
      if (ledger === undefined) ledger = await readLedger(store, owner, deps);
      return ledger;
    };
    const budget: AutoinvestBudgetRecord | null | "unknown" = await readBudgetRecord(store, owner).catch(() => "unknown" as const);
    /* The wallet's USDC is read once a pass, and only while one of its «З кожної оплати» rules is on. */
    const paying = list.filter((record) => record.kind === "payments" && record.payments !== null && record.status === "active" && !isRetiredMint(record.asset.mint));
    let watch: PaymentsWatchView | null = null;
    if (paying.length > 0) {
      const sinceMs = Math.min(...paying.map((record) => Date.parse(record.payments?.since ?? new Date(nowMs).toISOString())));
      /* Past the pass's budget the chain waits for the next pass; what the watch already numbered is taken now. */
      const read =
        Date.now() > paymentsDeadline
          ? await readPaymentWatch(store, owner).catch(() => null)
          : await (deps.paymentWatch ?? refreshPaymentWatch)(store, owner, nowMs, { sinceMs, ryntraRows: rowsOf, deadlineMs: paymentsDeadline }).catch(() => null);
      watch = read ? { events: read.events, ownAccounts: read.ownAccounts } : null;
    }
    let heldHere = false;
    for (const listed of list) {
      /* A rule on a token Ryntra no longer supports is history: it opens nothing and reminds of nothing. */
      if (isRetiredMint(listed.asset.mint)) continue;
      try {
        await withBoundedCasRetry(async () => {
          const current = await readRule(store, owner, listed.id);
          if (!current) return true;
          const market = markets.get(current.asset.mint);
          const opening = budget !== null && mayOpen(current, market, nowMs, watch);
          const history = current.occurrences.some((occurrence) => occurrence.state === "due") || opening ? await rowsOf() : null;
          const budgetUnknown = opening && (budget === "unknown" || history === null);
          const remainingUsd = opening && budget !== "unknown" && budget !== null && history !== null ? remainingFor(budget, list, history, nowMs) : null;
          const step = advanceRule(current, { rows: history, remainingUsd, budgetUnknown, market: market ?? null, payments: watch }, nowMs);
          if (!step.changed) return true;
          /* The note first: a reminder is claimed once per occurrence, so a lost race below re-decides and never writes a second. */
          if (step.remind && (await writeReminder(store, step.record, step.remind, nowMs))) reminded += 1;
          /* A deferral says why once per occurrence, claimed the same way. */
          if (step.defer && (await writeDeferral(store, step.record, step.defer, nowMs))) deferred += 1;
          const written = await replaceRule(store, current, step.record);
          if (written && step.held) {
            held += 1;
            heldHere = true;
          }
          return written;
        });
      } catch {
        failed += 1;
      }
    }
    if (heldHere && budget !== null && budget !== "unknown") {
      const rows = (await rowsOf()) ?? [];
      const sums = new Map(list.map((record) => [record.id, record.amountUsd]));
      const spend = spendInMonth(rows, budgetMonth(nowMs, budget.timeZone), (ruleId) => sums.get(ruleId) ?? null);
      await writeBudgetNote(store, budget, spend.spentUsd + spend.unknownUsd, nowMs).catch(() => false);
    }
  }
  return { rules: records.length, reminded, deferred, held, failed };
}
