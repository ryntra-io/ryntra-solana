/**
 * «Автоінвест» on the phone — the pure half (M16).
 *
 * A rule is the person's company and a sum in dollars, and when it reminds:
 * «Регулярно» — how often and when on their own clock; «Якщо впаде» — when the
 * company's price falls N % below its reference point. It only schedules a
 * reminder: Ryntra reminds in the inbox (and in Telegram where the channel is
 * confirmed), one tap opens a fresh «Перевірка» on the rule's sum, and every
 * purchase is the wallet's own signature. Never caught up: a reminder whose
 * day passed is «Пропущено». «Бюджет місяця» is the person's own ceiling for
 * every rule; a purchase it does not cover stands until the 1st. «Умова ціни»
 * (1.18.0; M25): a rule may carry a limit its price must stay within; a
 * purchase it holds back is `deferred` — its card, its sheet and its reminder
 * say so and offer nothing (the judgement and its words: `price-condition.ts`).
 * «З кожної оплати» (1.19.0; M26): a rule may gather from the wallet's own
 * USDC payments instead of a clock or a fall — its sum is the least a reminder
 * opens at, and each reminder carries its own sum, what it gathered; a
 * purchase under it is exactly that (the terms and the share: `payments.ts`).
 *
 * Decided here once and tested: where a new rule starts, the rule a company
 * already has, the one line a rule's card says, what one tap on a reminder may
 * do now, the reminder a note of the inbox is, the month as its bar says it,
 * and a refusal of the server in the sheet's words. The web line's own rules
 * for the same page and sheet (`app/app/invest/autoinvest-model.ts`,
 * `lib/autoinvest/{dip,limits}.ts`), so the phone and ryntra.io agree.
 * Nothing here reads the network or a key; the clock is an argument.
 */

import type {
  AutoinvestRule,
  RuleBinding,
  RuleBudget,
  RuleBudgetRequest,
  RuleCreateRequest,
  RuleOccurrence,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { parseDollars } from '../invest/buy-model.ts'
import {
  isReadableSchedule,
  isTimeZone,
  nextDueAfter,
  wallClockAt,
  type RuleCadence,
  type RuleSchedule,
} from './schedule.ts'

/**
 * The contract's bounds (`capabilities.rules`): the least and the most a rule's
 * purchase is — a dollar since 1.16.0 («Кожний день по
 * долару»; it was $10 from the v5.0 draft) — and how many rules a wallet holds.
 */
export const RULE_MIN_USD = 1
export const RULE_MAX_USD = 100_000
export const RULE_LIST_LIMIT = 20
/**
 * The sum a new rule's sheet opens on — $10 (chosen 2026-09-25),
 * beside «Щотижня». A default, not advice: the sum and how often are the
 * person's own, on their own budget, from a dollar. The web's own.
 */
export const RULE_DEFAULT_USD = 10

const RULE_ID = /^rule_[0-9a-f]{32}$/

export function isRuleId(value: unknown): value is string {
  return typeof value === 'string' && RULE_ID.test(value)
}

/** An instant as the server writes it, or null. */
export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

/** The phone's own time zone, as the contract wants it; UTC where the runtime reports none it knows. */
export function deviceTimeZone(
  resolved: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const zone = resolved()
    return isTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Where a new rule starts: weekly, today, at the next full hour — so the first
 * reminder is near and the person sees it work — or tomorrow when the next
 * hour is past midnight.
 */
export function defaultSchedule(nowMs: number, timeZone: string): RuleSchedule {
  const wall = wallClockAt(nowMs, timeZone)
  const hour = (wall.hour + 1) % 24
  const weekday = hour === 0 ? (wall.weekday % 7) + 1 : wall.weekday
  return { cadence: 'weekly', weekday, monthDay: null, time: `${pad(hour)}:00`, timeZone }
}

/** The same day and time under another cadence: a weekly rule keeps its weekday, a monthly one takes today's date. */
export function withCadence(schedule: RuleSchedule, cadence: RuleCadence, nowMs: number): RuleSchedule {
  const wall = wallClockAt(nowMs, schedule.timeZone)
  if (cadence === 'daily') return { ...schedule, cadence, weekday: null, monthDay: null }
  if (cadence === 'weekly') return { ...schedule, cadence, weekday: schedule.weekday ?? wall.weekday, monthDay: null }
  return { ...schedule, cadence, weekday: null, monthDay: schedule.monthDay ?? wall.day }
}

/** The first reminder a schedule gives from now, or null when it cannot be read. */
export function firstDue(schedule: RuleSchedule, nowMs: number): number | null {
  if (!isReadableSchedule(schedule)) return null
  try {
    return nextDueAfter(schedule, nowMs)
  } catch {
    return null
  }
}

/** A time of day as a person types it — «19:00», «9:05», «9.5», «1900» — as «HH:MM», or null. */
export function timeOfInput(text: string): string | null {
  const match = /^\s*(\d{1,2})[:.](\d{1,2})\s*$/.exec(text) ?? /^\s*(\d{1,2})(\d{2})\s*$/.exec(text)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${pad(hours)}:${pad(minutes)}`
}

/** A day of the month kept within 1–31. */
export function clampMonthDay(day: number): number {
  return Math.min(31, Math.max(1, Math.round(day)))
}

/** A sum typed for a rule, in dollars and cents within the contract's bounds, or null. */
export function ruleAmountOf(text: string, locale: Locale): number | null {
  const value = parseDollars(text, locale)
  if (value === null) return null
  const cents = Math.round(value * 100) / 100
  return cents >= RULE_MIN_USD && cents <= RULE_MAX_USD ? cents : null
}

/**
 * «Умова ціни» as a request carries it (1.18.0): the limit in whole per cent,
 * or null — no condition, which is also what a company without a reference
 * writes; no key at all where the sheet said nothing of it.
 */
function conditionPart(limitPct: number | null | undefined): Pick<RuleCreateRequest, 'priceCondition'> {
  if (limitPct === undefined) return {}
  return { priceCondition: limitPct === null ? null : { limitPct } }
}

/** «Регулярно» as the server takes it. */
export function scheduleRequest(
  input: Readonly<{
    mint: string
    amountUsd: number
    schedule: RuleSchedule
    locale: Locale
    /** «Умова ціни»: the limit, or null for none. */
    limitPct?: number | null
  }>,
): RuleCreateRequest {
  return {
    asset: { mint: input.mint },
    amountUsd: Math.round(input.amountUsd * 100) / 100,
    kind: 'schedule',
    schedule: input.schedule,
    ...conditionPart(input.limitPct),
    locale: input.locale,
  }
}

/* ---- «Якщо впаде» (1.13.0) ---- */

/** How far below its reference point a price must fall, in whole per cent (`capabilities.rules.dip`), and the falls the sheet offers — the web's own. */
export const RULE_DIP_MIN_PCT = 1
export const RULE_DIP_MAX_PCT = 50
export const RULE_DIP_PRESETS_PCT = [5, 10, 15, 20] as const

/** A fall a rule may wait for: a whole per cent from 1 to 50. */
export function isDipPct(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= RULE_DIP_MIN_PCT && value <= RULE_DIP_MAX_PCT
}

/** The price at which a rule reminds: its reference point less N % (the server's own `dipTriggerUsd`). */
export function dipTriggerUsd(anchorUsd: number, dropPct: number): number {
  return anchorUsd * (1 - dropPct / 100)
}

/**
 * Where a new «Якщо впаде» rule would remind, from the price the page shows
 * now — the point the server takes afresh when it writes the rule; null
 * without a price, and the rule's answer says the point it took.
 */
export function dipPreview(
  priceUsd: number | null,
  dropPct: number,
): Readonly<{ priceUsd: number; triggerUsd: number }> | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0 || !isDipPct(dropPct)) return null
  return { priceUsd, triggerUsd: dipTriggerUsd(priceUsd, dropPct) }
}

/** «Якщо впаде» as the server takes it: the fall and the phone's own zone, in place of a schedule. */
export function dipRequest(
  input: Readonly<{
    mint: string
    amountUsd: number
    dropPct: number
    timeZone: string
    locale: Locale
    /** «Умова ціни»: the limit, or null for none. */
    limitPct?: number | null
  }>,
): RuleCreateRequest {
  return {
    asset: { mint: input.mint },
    amountUsd: Math.round(input.amountUsd * 100) / 100,
    kind: 'dip',
    dip: { dropPct: input.dropPct, timeZone: input.timeZone },
    ...conditionPart(input.limitPct),
    locale: input.locale,
  }
}

/* ---- «Бюджет місяця» (1.13.0) ---- */

/**
 * The least and the most a month's ceiling is (`capabilities.rules.budget`; a
 * dollar since 1.16.0, and the ceilings the sheets offer — the
 * web's own: the first is «щодня по $1» for the longest month, so a dollar a
 * day is never held on the 31st.
 */
export const BUDGET_MIN_USD = 1
export const BUDGET_MAX_USD = 1_000_000
export const BUDGET_PRESETS_USD = [31, 50, 100, 200] as const

/** What the month has taken — settled and still unknown alike, as the server counts it — and the share of the ceiling; null without one. */
export function monthUse(budget: RuleBudget): Readonly<{ countedUsd: number; share: number | null }> {
  const countedUsd = Math.round((budget.spentUsd + budget.unknownUsd) * 100) / 100
  const share =
    budget.capUsd === null || budget.capUsd <= 0 ? null : Math.min(1, Math.max(0, countedUsd / budget.capUsd))
  return { countedUsd, share }
}

/**
 * The month's budget as its own line — in the block on
 * Home and in Portfolio, and in a new rule's sheet: without a ceiling,
 * «Бюджет не задано · Задати»; with one, «Бюджет місяця $10 з $50 · Змінити»
 * over its bar, and once it is spent the rules stand until the 1st. Null
 * until the rules' read has said what the budget is. A rule's sum never
 * stands in this line: it is each purchase, the budget the month's ceiling
 * for every rule. The web's own (`budgetView`).
 */
export type BudgetView =
  | Readonly<{ kind: 'unset' }>
  | Readonly<{ kind: 'capped'; countedUsd: number; capUsd: number; percent: number; exhausted: boolean }>

export function budgetView(budget: RuleBudget | null): BudgetView | null {
  if (!budget) return null
  if (budget.capUsd === null) return { kind: 'unset' }
  const use = monthUse(budget)
  return {
    kind: 'capped',
    countedUsd: use.countedUsd,
    capUsd: budget.capUsd,
    percent: Math.round((use.share ?? 0) * 100),
    exhausted: budget.exhausted,
  }
}

/** A ceiling typed for the month, in dollars and cents within its bounds, or null. */
export function budgetOfInput(text: string, locale: Locale): number | null {
  const value = parseDollars(text, locale)
  if (value === null) return null
  const cents = Math.round(value * 100) / 100
  return cents >= BUDGET_MIN_USD && cents <= BUDGET_MAX_USD ? cents : null
}

/**
 * Whether a new rule's purchase would fit the month under a ceiling the sheet
 * shows — the one set now, or one just picked: what is left of it after what
 * the month has taken. Always without a ceiling; to the cent under one. A rule
 * that does not fit is written all the same, and stands until the 1st.
 */
export function fitsCeiling(amountUsd: number, capUsd: number | null, budget: RuleBudget | null): boolean {
  if (capUsd === null) return true
  const counted = budget ? monthUse(budget).countedUsd : 0
  return amountUsd <= capUsd - counted + 0.005
}

/** The ceilings a sheet offers: the quick ones, and the one set now when it is none of them. */
export function capChoices(current: number | null): readonly number[] {
  const presets: readonly number[] = BUDGET_PRESETS_USD
  return current !== null && !presets.includes(current) ? [...presets, current].sort((a, b) => a - b) : presets
}

/** «Бюджет місяця» as the server takes it: a ceiling set before keeps the clock its month is counted on; a new one takes the phone's. */
export function budgetRequest(
  input: Readonly<{ capUsd: number; budget: RuleBudget | null; deviceZone: string; locale: Locale }>,
): RuleBudgetRequest {
  const { budget } = input
  const timeZone =
    budget !== null && budget.capUsd !== null && isTimeZone(budget.timeZone) ? budget.timeZone : input.deviceZone
  return { capUsd: Math.round(input.capUsd * 100) / 100, timeZone, locale: input.locale }
}

/* ---- a rule as it stands ---- */

/** The rule this company has — the one that is on first, else the newest. One company, one rule on the page. */
export function ruleForMint(rules: readonly AutoinvestRule[], mint: string): AutoinvestRule | null {
  const own = rules.filter((rule) => rule.asset.mint === mint)
  return own.find((rule) => rule.status === 'active') ?? own[0] ?? null
}

/** The occurrence one tap buys under right now: the rule is on, the reminder is open and its day has not passed. */
export function openOccurrence(rule: AutoinvestRule, nowMs: number): RuleOccurrence | null {
  if (rule.status !== 'active') return null
  return (
    rule.occurrences.find((occurrence) => occurrence.state === 'due' && Date.parse(occurrence.openUntil) > nowMs) ??
    null
  )
}

/**
 * A purchase the rule's price condition holds back right now (1.18.0):
 * the rule on, the occurrence `deferred` and its window not passed
 * — said with why, and nothing offered; the rule judges it again. The web's
 * own (`deferredNow`).
 */
export function deferredNow(rule: AutoinvestRule, nowMs: number): RuleOccurrence | null {
  if (rule.status !== 'active') return null
  const occurrence = rule.occurrences.find((candidate) => candidate.state === 'deferred') ?? null
  if (!occurrence) return null
  const until = Date.parse(occurrence.openUntil)
  return Number.isFinite(until) && until > nowMs ? occurrence : null
}

/** The occurrence a reminder names. */
export function occurrenceAt(rule: AutoinvestRule, dueAt: string): RuleOccurrence | null {
  const at = Date.parse(dueAt)
  return rule.occurrences.find((occurrence) => Date.parse(occurrence.dueAt) === at) ?? null
}

/** The last occurrence that is over — bought, on its way, missed or held by the month's budget — for the rule's one line of history. */
export function lastSettled(rule: AutoinvestRule): RuleOccurrence | null {
  // A reminder still open, and a purchase still waiting on the price condition, have not settled.
  return rule.occurrences.find((occurrence) => occurrence.state !== 'due' && occurrence.state !== 'deferred') ?? null
}

/**
 * The sum a rule's purchase is under one reminder (1.19.0): its own, where a
 * «З кожної оплати» rule gathered it; the rule's everywhere else. The sheet,
 * «Перевірка» and the order route read the same sum — the server refuses any
 * other (`RULE_MISMATCH`). The web's own (`purchaseSumUsd`).
 */
export function purchaseSumUsd(
  rule: Pick<AutoinvestRule, 'amountUsd'>,
  occurrence?: Pick<RuleOccurrence, 'amountUsd'> | null,
): number {
  return occurrence?.amountUsd ?? rule.amountUsd
}

/**
 * Whether a rule's purchase fits what is left of the month's budget: always
 * without a ceiling; to the cent under one — the rule the tick and the order
 * route judge by. Under a reminder, its own sum.
 */
export function fitsMonth(
  rule: Pick<AutoinvestRule, 'amountUsd'>,
  budget: RuleBudget | null,
  occurrence?: Pick<RuleOccurrence, 'amountUsd'> | null,
): boolean {
  if (!budget || budget.remainingUsd === null) return true
  return purchaseSumUsd(rule, occurrence) <= budget.remainingUsd + 0.005
}

/** The rule is on and its purchase does not fit what is left: it stands until the 1st («Бюджет вичерпано»); a paused rule is paused, not held. */
export function heldByBudget(rule: Pick<AutoinvestRule, 'amountUsd' | 'status'>, budget: RuleBudget | null): boolean {
  return rule.status === 'active' && !fitsMonth(rule, budget)
}

/** The time zone a rule is said in: its schedule's, its fall's, or its payments'. */
export function zoneOfRule(
  rule: Pick<AutoinvestRule, 'schedule' | 'dip'> & Partial<Pick<AutoinvestRule, 'payments'>>,
  fallback = 'UTC',
): string {
  return rule.schedule?.timeZone ?? rule.dip?.timeZone ?? rule.payments?.timeZone ?? fallback
}

/**
 * The one line a rule's card says under its sum: the reminder that is open
 * now, the pause, a purchase the price condition holds back («Купівлю
 * відкладено»), the month's budget holding it until the 1st, when the next
 * purchase comes — for a rule that waits for a fall, the price it reminds at;
 * for one that gathers from payments (1.19.0), what it has gathered of the
 * sum it reminds from.
 */
export type RuleFace =
  | Readonly<{ kind: 'due'; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'paused' }>
  | Readonly<{ kind: 'deferred'; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'held' }>
  | Readonly<{ kind: 'next'; atMs: number; timeZone: string }>
  | Readonly<{ kind: 'dip'; triggerUsd: number }>
  | Readonly<{ kind: 'payments'; gatheredUsd: number; minimumUsd: number }>
  | Readonly<{ kind: 'plain' }>

export function ruleFace(rule: AutoinvestRule, budget: RuleBudget | null, nowMs: number): RuleFace {
  if (rule.status === 'paused') return { kind: 'paused' }
  const due = openOccurrence(rule, nowMs)
  // Under a reminder, its own sum is what the month's budget must cover (1.19.0).
  if (due) return fitsMonth(rule, budget, due) ? { kind: 'due', occurrence: due } : { kind: 'held' }
  // The price condition holds this purchase back (1.18.0): said before the budget, which has nothing to cover yet.
  const deferred = deferredNow(rule, nowMs)
  if (deferred) return { kind: 'deferred', occurrence: deferred }
  if (!fitsMonth(rule, budget)) return { kind: 'held' }
  if (rule.payments) return { kind: 'payments', gatheredUsd: rule.payments.gatheredUsd, minimumUsd: rule.amountUsd }
  if (rule.dip) return { kind: 'dip', triggerUsd: rule.dip.triggerUsd }
  const next = rule.nextDueAt ? Date.parse(rule.nextDueAt) : Number.NaN
  if (Number.isFinite(next)) return { kind: 'next', atMs: next, timeZone: zoneOfRule(rule) }
  return { kind: 'plain' }
}

/**
 * The reminder a company's page and Trade offer to buy under right now:
 * open, the rule on, its window not passed and the
 * month's budget covering it — the card's own «Час твоєї покупки». While it
 * stands, the page's first action is «Купити $20 за правилом» and an
 * ordinary purchase says the reminder stays open: the rule counts only a
 * purchase by the rule. One the budget holds is not offered — its card says
 * «Бюджет вичерпано» and its sheet «Змінити бюджет».
 */
export function reminderOffer(
  rule: AutoinvestRule | null,
  budget: RuleBudget | null,
  nowMs: number,
): RuleOccurrence | null {
  if (!rule) return null
  const face = ruleFace(rule, budget, nowMs)
  return face.kind === 'due' ? face.occurrence : null
}

/**
 * «Пропущено»: the rule's last reminder passed without a
 * signature — said under the card's line, with no action, while nothing
 * newer stands in its place (no reminder open, no purchase deferred, the
 * budget not holding it).
 * Never caught up: the next one comes on its own day, or with the next fall.
 */
export function missedOf(rule: AutoinvestRule, face: RuleFace): RuleOccurrence | null {
  if (face.kind === 'due' || face.kind === 'held' || face.kind === 'deferred') return null
  const last = lastSettled(rule)
  return last?.state === 'missed' ? last : null
}

/* ---- one tap on a reminder ---- */

/**
 * What one tap on a reminder may do now, read from the rule as the server
 * holds it this minute (a note is never permission to trade): buy while the
 * reminder is open and the month's budget covers it; otherwise say what
 * became of it — deferred by the price condition (1.18.0: why, and until when
 * the rule checks again), bought, on its way, closed (missed, never caught
 * up), the rule paused or gone — and offer no purchase.
 */
export type RuleBuyState =
  | Readonly<{ kind: 'reading' }>
  | Readonly<{ kind: 'read-failed' }>
  | Readonly<{ kind: 'gone' }>
  | Readonly<{ kind: 'open'; rule: AutoinvestRule; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'deferred'; rule: AutoinvestRule; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'held'; rule: AutoinvestRule; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'bought'; rule: AutoinvestRule; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'pending'; rule: AutoinvestRule; occurrence: RuleOccurrence }>
  | Readonly<{ kind: 'paused'; rule: AutoinvestRule }>
  | Readonly<{ kind: 'closed'; rule: AutoinvestRule }>

export function ruleBuyState(
  input: Readonly<{
    read: 'reading' | 'failed' | 'ready'
    rule: AutoinvestRule | null
    /** The occurrence the reminder names; null opens the one that is open now. */
    dueAt: string | null
    budget: RuleBudget | null
    nowMs: number
  }>,
): RuleBuyState {
  const { rule } = input
  if (!rule) {
    if (input.read === 'ready') return { kind: 'gone' }
    return input.read === 'failed' ? { kind: 'read-failed' } : { kind: 'reading' }
  }
  const occurrence = input.dueAt
    ? occurrenceAt(rule, input.dueAt)
    : (openOccurrence(rule, input.nowMs) ?? deferredNow(rule, input.nowMs))
  if (occurrence?.state === 'bought') return { kind: 'bought', rule, occurrence }
  if (occurrence?.state === 'pending') return { kind: 'pending', rule, occurrence }
  if (rule.status !== 'active') return { kind: 'paused', rule }
  if (!occurrence) return { kind: 'closed', rule }
  // The price condition holds it back while its window is open: nothing to buy, the rule judges it again (1.18.0).
  if (occurrence.state === 'deferred' && Date.parse(occurrence.openUntil) > input.nowMs)
    return { kind: 'deferred', rule, occurrence }
  // A reminder's own sum (1.19.0) is what the month's budget must cover; a rule's everywhere else.
  const fits = fitsMonth(rule, input.budget, occurrence)
  const open = occurrence.state === 'due' && Date.parse(occurrence.openUntil) > input.nowMs
  // A due the budget held is never reminded afterwards: once the month's rest covers the rule again, it is simply over.
  if (!open) return occurrence.state === 'held' && !fits ? { kind: 'held', rule, occurrence } : { kind: 'closed', rule }
  return fits ? { kind: 'open', rule, occurrence } : { kind: 'held', rule, occurrence }
}

/** Whether a refusal says the rule is not this wallet's any more — gone, not unread. */
export function isRuleGoneError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, status } = error as { code?: unknown; status?: unknown }
  return code === 'RULE_NOT_FOUND' || status === 404
}

/**
 * One rule's read as a reminder's purchase takes it: reading, failed, or
 * ready with the rule — and a rule the server answers 404 for is gone, even
 * when an earlier read of it is still at hand (a failed refetch keeps its data).
 */
export function ruleRead<T>(
  query: Readonly<{ isPending: boolean; isError: boolean; error: unknown; data: Readonly<{ rule: T }> | undefined }>,
): Readonly<{ read: 'reading' | 'failed' | 'ready'; rule: T | null }> {
  const gone = query.isError && isRuleGoneError(query.error)
  if (query.isPending) return { read: 'reading', rule: null }
  if (query.isError && !gone) return { read: 'failed', rule: query.data?.rule ?? null }
  return { read: 'ready', rule: gone ? null : (query.data?.rule ?? null) }
}

/** The binding an order names to buy under the reminder: the rule and the occurrence exactly as the server wrote it. */
export function bindingOf(state: RuleBuyState): RuleBinding | null {
  return state.kind === 'open' ? { ruleId: state.rule.id, dueAt: state.occurrence.dueAt } : null
}

/* ---- the reminder a note is ---- */

/** How a deferral's note marks the reminder's identity (1.18.0): `autoinvest:<rule>:<due>~deferred@<symbol>`. */
const DEFERRED_MARK = '~deferred'

/** The due instant a reminder's — or a deferral's — identity names (`autoinvest:<rule>:<due>@<symbol>`), or null. */
export function dueOfIdentity(identity: string, ruleId: string): string | null {
  const prefix = `autoinvest:${ruleId}:`
  if (!identity.startsWith(prefix)) return null
  const marked = identity.slice(prefix.length).split('@')[0] ?? ''
  const due = marked.endsWith(DEFERRED_MARK) ? marked.slice(0, -DEFERRED_MARK.length) : marked
  return isInstant(due) ? due : null
}

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Whether what a reminder's identity carries is a token's mint (1.31.0) rather than a company's symbol. */
export function isMintRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && MINT_SHAPE.test(ref)
}

/**
 * The company symbol a reminder's identity carries after `@` — or (1.31.0) a
 * token's mint, since a token's symbol names nothing for certain — so a note
 * still names its asset once its rule is gone.
 */
export function symbolOfIdentity(identity: string): string | null {
  if (!identity.startsWith('autoinvest:')) return null
  const at = identity.lastIndexOf('@')
  if (at < 0) return null
  try {
    const symbol = decodeURIComponent(identity.slice(at + 1))
    return /^[A-Za-z0-9._-]{1,32}$/.test(symbol) || MINT_SHAPE.test(symbol) ? symbol : null
  } catch {
    return null
  }
}

export type Reminder = Readonly<{ ruleId: string; dueAt: string | null; symbol: string | null }>

/** The reminder a note of the inbox is — its rule, its due instant and its company — or null for any other note. */
export function reminderOfNote(
  note: Readonly<{ subject?: Readonly<{ kind: string; id: string }> | null; triggerId?: string | null }>,
): Reminder | null {
  if (note.subject?.kind !== 'autoinvest-rule' || !isRuleId(note.subject.id)) return null
  const ruleId = note.subject.id
  const identity = typeof note.triggerId === 'string' ? note.triggerId : ''
  return { ruleId, dueAt: dueOfIdentity(identity, ruleId), symbol: symbolOfIdentity(identity) }
}

/**
 * Where one tap on a reminder lands on the phone (1.31.0): a company's on its
 * page, the purchase bound to the rule; a token's — a coin, a meme, a new
 * token — in Trade, the ticket as the rule's purchase (the web's
 * `/app/spot?mint=&rule=&due=`). A token is known by its rule's
 * `asset.kind`, or, once the rule is gone, by the mint its note carried.
 */
export type RuleBuyRoute = Readonly<{ pathname: '/trade' | '/asset/[mint]'; params: Readonly<Record<string, string>> }>

export function ruleBuyRoute(
  input: Readonly<{ mint: string; symbol?: string | null; token: boolean; ruleId: string; dueAt: string | null }>,
): RuleBuyRoute {
  if (!input.token) return { pathname: '/asset/[mint]', params: rulePurchaseParams(input) }
  return {
    pathname: '/trade',
    params: {
      mint: input.mint,
      ...(input.symbol && !MINT_SHAPE.test(input.symbol) ? { symbol: input.symbol } : {}),
      side: 'buy',
      rule: input.ruleId,
      ...(input.dueAt ? { due: input.dueAt } : {}),
    },
  }
}

/** The same for a rule the wallet holds: its asset's kind decides. */
export function ruleBuyRouteOf(
  rule: Pick<AutoinvestRule, 'id' | 'asset'>,
  dueAt: string | null,
): RuleBuyRoute {
  return ruleBuyRoute({
    mint: rule.asset.mint,
    symbol: rule.asset.symbol,
    token: rule.asset.kind === 'crypto' || rule.asset.kind === 'meme',
    ruleId: rule.id,
    dueAt,
  })
}

/** Where one tap on a company's reminder lands on the phone: the company, with the rule and the occurrence. */
export function rulePurchaseParams(
  input: Readonly<{ mint: string; symbol?: string | null; ruleId: string; dueAt: string | null }>,
): Readonly<{ mint: string; category: string; rule: string } & Record<string, string>> {
  return {
    mint: input.mint,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    category: 'stock',
    rule: input.ruleId,
    ...(input.dueAt ? { due: input.dueAt } : {}),
  }
}

/* ---- the server's word ---- */

/**
 * A refusal of the order route under a reminder (1.12.0–1.31.0): closed, not
 * this wallet's rule, not the rule's purchase, over the month's budget, the
 * price condition not met on the server's own figures, a token's pool under
 * the floor.
 */
export type RuleRefusal = 'closed' | 'gone' | 'mismatch' | 'budget' | 'condition' | 'floor'

export function ruleRefusalOf(code: string | null | undefined): RuleRefusal | null {
  switch (code) {
    case 'RULE_NOT_DUE':
      return 'closed'
    case 'RULE_NOT_FOUND':
      return 'gone'
    case 'RULE_MISMATCH':
      return 'mismatch'
    case 'RULE_BUDGET_EXHAUSTED':
      return 'budget'
    case 'RULE_PRICE_CONDITION':
      return 'condition'
    case 'RULE_LIQUIDITY_LOW':
      return 'floor'
    default:
      return null
  }
}

/** A write to the rules refused — turning one on, pausing, deleting, the month's budget — as the sheet says it. */
export type RuleWriteFailure = 'limit' | 'sign-in' | 'offline' | 'unavailable' | 'failed'

export function ruleWriteFailure(code: string | null | undefined): RuleWriteFailure {
  if (code === 'RULE_LIMIT_REACHED') return 'limit'
  if (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') return 'sign-in'
  if (code === 'NETWORK') return 'offline'
  // The universe or the price did not answer: a «Якщо впаде» rule is written, and turned on again, from the price now.
  if (code === 'UNAVAILABLE') return 'unavailable'
  return 'failed'
}

/**
 * A refused write in the sheet's words — what the person can do next: remove
 * a rule first, sign in again, wait for the network, or for the price (a fall
 * is counted from the price now, and a price older than half an hour or none
 * writes nothing). Everything else is said as nothing changed.
 */
export function writeFailureWords(
  code: string | null | undefined,
  words: Readonly<{
    limit: string
    signInFirst: string
    offline: string
    priceUnknownNow: string
    failed: string
    changeFailed: string
    budgetFailed: string
  }>,
  context: Readonly<{ write: 'create' | 'change' | 'budget'; dip: boolean }>,
): string {
  const failure = ruleWriteFailure(code)
  if (failure === 'limit' && context.write === 'create') return words.limit
  if (failure === 'sign-in') return words.signInFirst
  if (failure === 'offline') return words.offline
  if (failure === 'unavailable' && context.dip && context.write !== 'budget') return words.priceUnknownNow
  return context.write === 'create'
    ? words.failed
    : context.write === 'budget'
      ? words.budgetFailed
      : words.changeFailed
}

/** The sum «Купувати щотижня» starts from after a plain purchase: what left the wallet, to the cent, when it is a rule's sum at all. */
export function weeklyFromSpent(spentUsd: number | null): number | null {
  if (spentUsd === null || !Number.isFinite(spentUsd)) return null
  const cents = Math.round(spentUsd * 100) / 100
  return cents >= RULE_MIN_USD - 0.005 && cents <= RULE_MAX_USD ? Math.max(RULE_MIN_USD, cents) : null
}
