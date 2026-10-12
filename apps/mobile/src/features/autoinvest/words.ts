/**
 * How a rule is said — «Щотижня · чт о 19:00», «Щотижня $25 в NVIDIA», «чт,
 * 24 вер. о 19:00», «Якщо NVIDIA впаде на 5 % — докупити $20», «Округлення
 * кожної оплати до $1», «Накопичено $0,60 · нагадаю від $1», «Цього місяця
 * $45 з $100» — in both languages («Автоінвест» ·
 * «Щотижня» · «Якщо впаде на 5 %» · «Бюджет місяця» · «З кожної
 * оплати»; never DCA, trigger or «купує автоматично»). The web app's own
 * phrases (`lib/autoinvest/words.ts`, `app/app/invest/invest-words.ts`), so
 * the reminder a person gets and the rule they set on the phone say the same
 * thing. Pure.
 */

import type { AutoinvestRule, RuleBudget, RulePaymentDirection } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { dollarsText } from '../invest/buy-model.ts'
import type { PaymentTerms } from './payments.ts'
import { monthUse, type BudgetView } from './rule-model.ts'
import { wallClockAt, type RuleCadence, type RuleSchedule } from './schedule.ts'

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

const CADENCE: Readonly<Record<RuleCadence, Readonly<Record<Locale, string>>>> = {
  daily: { en: 'Every day', uk: 'Щодня' },
  weekly: { en: 'Every week', uk: 'Щотижня' },
  monthly: { en: 'Every month', uk: 'Щомісяця' },
}

/** ISO weekday 1 (Monday) … 7 (Sunday), short. */
export const WEEKDAY_SHORT: Readonly<Record<Locale, readonly string[]>> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  uk: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'],
}

export function cadenceWord(cadence: RuleCadence, locale: Locale): string {
  return CADENCE[cadence][locale]
}

function ordinal(day: number): string {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${day}th`
  return `${day}${day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`
}

/** When, on the rule's own clock: «чт о 19:00» · «о 19:00» · «1-го о 10:00»; «Thu at 19:00» · «at 19:00» · «on the 1st at 10:00». */
export function whenPhrase(schedule: RuleSchedule, locale: Locale): string {
  const at = locale === 'uk' ? `о ${schedule.time}` : `at ${schedule.time}`
  if (schedule.cadence === 'weekly' && schedule.weekday !== null)
    return `${WEEKDAY_SHORT[locale][schedule.weekday - 1]} ${at}`
  if (schedule.cadence === 'monthly' && schedule.monthDay !== null)
    return locale === 'uk' ? `${schedule.monthDay}-го ${at}` : `on the ${ordinal(schedule.monthDay)} ${at}`
  return at
}

/** «Щотижня · чт о 19:00». */
export function ruleLine(schedule: RuleSchedule, locale: Locale): string {
  return `${cadenceWord(schedule.cadence, locale)} · ${whenPhrase(schedule, locale)}`
}

/** A per cent the way each language writes it: «5 %» (a no-break space) and «5,3 %»; «5%» and «5.3%». */
export function pctWord(pct: number, locale: Locale, fractionDigits = 0): string {
  const figure = new Intl.NumberFormat(numberTag(locale), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(pct)
  return locale === 'uk' ? `${figure} %` : `${figure}%`
}

/** «Якщо впаде на 5 %» · «If it falls 5%». */
export function dipLine(dropPct: number, locale: Locale): string {
  return locale === 'uk' ? `Якщо впаде на ${pctWord(dropPct, 'uk')}` : `If it falls ${pctWord(dropPct, 'en')}`
}

/**
 * «Округлення кожної оплати до $1» · «$2 з кожної оплати» · «10 % з кожного
 * надходження»; «Round every payment up to $1» · «$2 from every payment» ·
 * «10% of every incoming transfer» (1.19.0.
 */
export function paymentsLine(payments: PaymentTerms, locale: Locale): string {
  if (payments.mode === 'percent')
    return locale === 'uk'
      ? `${pctWord(payments.percent ?? 0, 'uk')} з кожного надходження`
      : `${pctWord(payments.percent ?? 0, 'en')} of every incoming transfer`
  if (payments.mode === 'fixed')
    return locale === 'uk'
      ? `${dollarsText(payments.fixedUsd ?? 0, 'uk')} з кожної оплати`
      : `${dollarsText(payments.fixedUsd ?? 0, 'en')} from every payment`
  return locale === 'uk'
    ? `Округлення кожної оплати до ${dollarsText(payments.roundToUsd ?? 1, 'uk')}`
    : `Round every payment up to ${dollarsText(payments.roundToUsd ?? 1, 'en')}`
}

/** How any rule is said in one line: its schedule, its fall, or what it takes from payments. */
export function ruleWhenLine(
  rule: Pick<AutoinvestRule, 'schedule' | 'dip'> & Partial<Pick<AutoinvestRule, 'payments'>>,
  locale: Locale,
): string {
  if (rule.dip) return dipLine(rule.dip.dropPct, locale)
  if (rule.payments) return paymentsLine(rule.payments, locale)
  return rule.schedule ? ruleLine(rule.schedule, locale) : ''
}

/** «Накопичено $0,60 · нагадаю від $1» · «$0.60 gathered · reminder from $1» — what a «З кожної оплати» rule waits with. */
export function gatheredLine(gatheredUsd: number, minimumUsd: number, locale: Locale): string {
  return locale === 'uk'
    ? `Накопичено ${dollarsText(gatheredUsd, 'uk')} · нагадаю від ${dollarsText(minimumUsd, 'uk')}`
    : `${dollarsText(gatheredUsd, 'en')} gathered · reminder from ${dollarsText(minimumUsd, 'en')}`
}

/** «Накопичено $0,50 з $1» · «$0.50 of $1 gathered» — the same, in one short line for a narrow card. */
export function gatheredShort(gatheredUsd: number, minimumUsd: number, locale: Locale): string {
  return locale === 'uk'
    ? `Накопичено ${dollarsText(gatheredUsd, 'uk')} з ${dollarsText(minimumUsd, 'uk')}`
    : `${dollarsText(gatheredUsd, 'en')} of ${dollarsText(minimumUsd, 'en')} gathered`
}

/** «Оплата $3,40 → $0,60 в Apple» · «A $3.40 payment → $0.60 into Apple» — what the rule would set aside, on an example. */
export function setAsideExample(
  direction: RulePaymentDirection,
  amountUsd: number,
  addUsd: number,
  name: string,
  locale: Locale,
): string {
  if (locale === 'uk')
    return `${direction === 'out' ? 'Оплата' : 'Надходження'} ${dollarsText(amountUsd, 'uk')} → ${dollarsText(addUsd, 'uk')} в ${name}`
  return `A ${dollarsText(amountUsd, 'en')} ${direction === 'out' ? 'payment' : 'incoming transfer'} → ${dollarsText(addUsd, 'en')} into ${name}`
}

/** A price per unit: «$335,95» · «$335.95»; under a dollar, four places; under a cent (a meme, 1.31.0), four significant digits — «$0.00001834». The web's own. */
export function priceWord(usd: number, locale: Locale): string {
  if (usd > 0 && usd < 0.01)
    return `$${new Intl.NumberFormat(numberTag(locale), { maximumSignificantDigits: 4, minimumSignificantDigits: 2 }).format(usd)}`
  const places = usd >= 1 ? 2 : 4
  return `$${new Intl.NumberFormat(numberTag(locale), { minimumFractionDigits: places, maximumFractionDigits: places }).format(usd)}`
}

/** A due instant on the rule's own clock: «чт, 24 вер. о 19:00» · «Thu, Sep 24 at 19:00». */
export function dueWords(dueAtMs: number, timeZone: string, locale: Locale): string {
  const date = new Intl.DateTimeFormat(numberTag(locale), {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(dueAtMs))
  const wall = wallClockAt(dueAtMs, timeZone)
  const time = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
  return locale === 'uk' ? `${date} о ${time}` : `${date} at ${time}`
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

/** A phrase that wraps whole on a narrow card — «пт, 25 вер. о 11:00», never «о» apart from its hour. */
export function unbroken(text: string): string {
  return text.replace(/ /g, NO_BREAK_SPACE)
}

/** A card's line of parts — «$10 · Щодня · о 11:00» — that may wrap only between its parts. */
export function unbrokenParts(line: string): string {
  return line.split(' · ').map(unbroken).join(' · ')
}

/** A phrase that wraps freely, its last word never alone on a line — «Округлення кожної оплати до $1». */
export function keptTail(text: string): string {
  const at = text.lastIndexOf(' ')
  return at < 0 ? text : `${text.slice(0, at)}${NO_BREAK_SPACE}${text.slice(at + 1)}`
}

/** A line of short parts — «Умова ціни · +2,1 % до оцінки PreStocks $1 000,00 · ліміт 5 % · дані 10:32» — each whole, wrapped only after a «·». */
export function wholeParts(line: string): string {
  return line.split(' · ').map(unbroken).join(`${NO_BREAK_SPACE}· `)
}

/**
 * A sentence with its time last — «… (твій ліміт 5 %) · дані 18:56» — that
 * wraps freely, the time never apart from its word and a line never begun by
 * the «·» before it.
 */
export function unbrokenTail(line: string): string {
  const parts = line.split(' · ')
  if (parts.length < 2) return line
  return `${parts.slice(0, -1).join(' · ')}${NO_BREAK_SPACE}· ${unbroken(parts[parts.length - 1] ?? '')}`
}

/** A day on a clock: «24 вер.» · «Sep 24». */
export function dayWords(atMs: number, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(numberTag(locale), { timeZone, day: 'numeric', month: 'short' }).format(new Date(atMs))
}

/**
 * The month as its bar says it («$45 з $100»): «Цього місяця $45 з
 * $100» · «This month $45 of $100»; without a ceiling «Цього місяця $0 · без
 * стелі». What the month has taken counts the purchases still on their way,
 * as the server does.
 */
export function monthWords(
  budget: RuleBudget,
  words: Readonly<{ thisMonth: string; of: string; noBudgetYet: string }>,
  locale: Locale,
): string {
  const counted = dollarsText(monthUse(budget).countedUsd, locale)
  return budget.capUsd === null
    ? `${words.thisMonth} ${counted} · ${words.noBudgetYet}`
    : `${words.thisMonth} ${counted} ${words.of} ${dollarsText(budget.capUsd, locale)}`
}

/**
 * The budget's own line, read whole: «Бюджет не задано» ·
 * «No budget set»; «Бюджет місяця $10 з $50» · «Monthly budget $10 of $50» —
 * what the month has taken counting the purchases still on their way.
 */
export function budgetRowWords(
  view: BudgetView,
  words: Readonly<{ budgetNotSet: string; monthBudget: string; of: string }>,
  locale: Locale,
): string {
  if (view.kind === 'unset') return words.budgetNotSet
  return `${words.monthBudget} ${dollarsText(view.countedUsd, locale)} ${words.of} ${dollarsText(view.capUsd, locale)}`
}

/**
 * «Щотижня $25 в NVIDIA» · «$25 of NVIDIA, every week»; «Якщо NVIDIA впаде на
 * 5 % — докупити $20» · «If NVIDIA falls 5% — buy $20 more»; «Округлення
 * кожної оплати до $1 — в Apple» · «Round every payment up to $1 — into Apple».
 */
export function ruleSentence(
  rule: Pick<AutoinvestRule, 'amountUsd' | 'schedule' | 'dip'> & Partial<Pick<AutoinvestRule, 'payments'>>,
  name: string,
  locale: Locale,
): string {
  const usd = dollarsText(rule.amountUsd, locale)
  if (rule.payments)
    return locale === 'uk'
      ? `${paymentsLine(rule.payments, 'uk')} — в ${name}`
      : `${paymentsLine(rule.payments, 'en')} — into ${name}`
  if (rule.dip)
    return locale === 'uk'
      ? `Якщо ${name} впаде на ${pctWord(rule.dip.dropPct, 'uk')} — докупити ${usd}`
      : `If ${name} falls ${pctWord(rule.dip.dropPct, 'en')} — buy ${usd} more`
  const cadence = rule.schedule?.cadence ?? 'weekly'
  return locale === 'uk'
    ? `${cadenceWord(cadence, 'uk')} ${usd} в ${name}`
    : `${usd} of ${name}, ${cadenceWord(cadence, 'en').toLowerCase()}`
}
