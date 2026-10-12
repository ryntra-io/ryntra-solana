/**
 * «Умова ціни» on the phone — the pure half (as
 * the web's, contract 1.18.0).
 *
 * A rule buys only when the price is not above its reference by more than the
 * person's limit and the data are fresh — «Не купувати, якщо дорожче за
 * орієнтир більш ніж на N %», 5 % unless the person picks another. Otherwise
 * its purchase is deferred: «Купівлю відкладено» with the reason, the figure
 * and the data's time, and the rule judges it again while the reminder's
 * window is open. **The reference** is PreStocks' valuation of one token for a
 * private company (called so — never a fair price) and the reference per
 * share for a listed one, against the token's own price on the same basis. A
 * discount always passes; the figure compared is the one a person reads, to a
 * tenth of a per cent. **Fresh or nothing:** a price or a reference older than
 * half an hour, a copy its source calls stale, or a missing figure makes the
 * rule wait — an unknown is never a pass.
 *
 * The judgement and the words are the web app's own
 * (`lib/autoinvest/price-condition.ts`, `app/app/invest/price-condition-view.ts`),
 * so what the phone says now is what the rule's tick and the order route
 * decide on the same figures, in the same words (the English with the
 * typographic apostrophe the phone's copy writes). Pure: nothing here reads
 * the network; the clock is an argument.
 */

import type { RuleConditionCheck, RuleConditionVerdict, RulePriceReference } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { wallClockAt } from './schedule.ts'
import { pctWord, priceWord } from './words.ts'

/* ---- the bounds (`capabilities.rules.priceCondition`) ---- */

/** The limit a new rule opens on, the bounds a limit is kept within (whole per cent) and how old, in minutes, the figures may be — the contract's, as production states them. */
export const PRICE_CONDITION_DEFAULT_PCT = 5
export const PRICE_CONDITION_MIN_PCT = 1
export const PRICE_CONDITION_MAX_PCT = 50
export const PRICE_CONDITION_MAX_AGE_MINUTES = 30
/** The limits the sheet offers beside «Без умови» — the web's own. */
export const PRICE_CONDITION_PRESETS_PCT = [2, 5, 10] as const

export type PriceConditionBounds = Readonly<{
  defaultPct: number
  minPct: number
  maxPct: number
  maxAgeMinutes: number
}>

const BOUNDS: PriceConditionBounds = {
  defaultPct: PRICE_CONDITION_DEFAULT_PCT,
  minPct: PRICE_CONDITION_MIN_PCT,
  maxPct: PRICE_CONDITION_MAX_PCT,
  maxAgeMinutes: PRICE_CONDITION_MAX_AGE_MINUTES,
}

const wholePct = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/**
 * The bounds as the server's capabilities state them (never hard-wired where
 * the server says otherwise), or the contract's own while they are unread or
 * state something a limit cannot be.
 */
export function conditionBounds(stated: unknown): PriceConditionBounds {
  if (!stated || typeof stated !== 'object') return BOUNDS
  const { defaultPct, minPct, maxPct, maxAgeMinutes } = stated as Record<string, unknown>
  if (!wholePct(minPct) || !wholePct(maxPct) || !wholePct(defaultPct) || minPct < 1 || maxPct > 100 || minPct > maxPct)
    return BOUNDS
  if (defaultPct < minPct || defaultPct > maxPct) return BOUNDS
  if (typeof maxAgeMinutes !== 'number' || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) return BOUNDS
  return { defaultPct, minPct, maxPct, maxAgeMinutes }
}

/** The limits the sheet offers — the web's, within the bounds, and the default when it is none of them — then «Без умови» (null). */
export function conditionChoices(bounds: PriceConditionBounds): readonly (number | null)[] {
  const presets: number[] = PRICE_CONDITION_PRESETS_PCT.filter((pct) => pct >= bounds.minPct && pct <= bounds.maxPct)
  if (!presets.includes(bounds.defaultPct)) presets.push(bounds.defaultPct)
  return [...presets.sort((a, b) => a - b), null]
}

/** A limit a rule may carry: whole per cent within the bounds. */
export function isPriceConditionLimit(limitPct: unknown, bounds: PriceConditionBounds = BOUNDS): limitPct is number {
  return wholePct(limitPct) && limitPct >= bounds.minPct && limitPct <= bounds.maxPct
}

/* ---- the facts and the judgement ---- */

/** What the condition is judged on: the price and the reference, each with the instant it stands for. */
export type PriceFacts = Readonly<{
  reference: RulePriceReference | null
  priceUsd: number | null
  priceAtMs: number | null
  referenceUsd: number | null
  referenceAtMs: number | null
  /** The source calls its own copy stale (PreStocks' catalogue served under grace, a reference judged stale). */
  referenceStale: boolean
}>

/** One judgement, as a rule's occurrence keeps it (`condition`) and the sheets draw it. */
export type PriceCheck = RuleConditionCheck

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
const instant = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const tenth = (value: number): number => Math.round(value * 10) / 10

/** The price against the reference, per cent to a tenth; null without both figures. */
export function deviationOf(priceUsd: number | null, referenceUsd: number | null): number | null {
  if (!positive(priceUsd) || !positive(referenceUsd)) return null
  const deviation = tenth((priceUsd / referenceUsd - 1) * 100)
  return Object.is(deviation, -0) ? 0 : deviation
}

/** Judge the condition now. Missing figures wait, old data wait, a price above the limit waits; only fresh data within it are met. */
export function checkPriceCondition(
  limitPct: number,
  facts: PriceFacts | null | undefined,
  nowMs: number,
  maxAgeMinutes: number = PRICE_CONDITION_MAX_AGE_MINUTES,
): PriceCheck {
  const checkedAt = new Date(nowMs).toISOString()
  const base = {
    reference: facts?.reference ?? null,
    limitPct,
    priceUsd: positive(facts?.priceUsd) ? facts.priceUsd : null,
    referenceUsd: positive(facts?.referenceUsd) ? facts.referenceUsd : null,
    checkedAt,
  }
  const deviationPct = deviationOf(base.priceUsd, base.referenceUsd)
  // A token's price when its rule was turned on (1.31.0) is a fixed point: its age is the rule's, never staleness —
  // only the price now must be fresh.
  const fixed = facts?.reference === 'enabled'
  const times = (fixed ? [facts?.priceAtMs] : [facts?.priceAtMs, facts?.referenceAtMs]).filter(instant)
  const dataAt = times.length > 0 ? new Date(Math.min(...times)).toISOString() : null
  const verdict = (value: RuleConditionVerdict): PriceCheck => ({ ...base, deviationPct, dataAt, verdict: value })
  if (!facts || base.reference === null || deviationPct === null) return verdict('unavailable')
  const old = (at: number | null): boolean => !instant(at) || nowMs - at > maxAgeMinutes * 60_000
  if (facts.referenceStale || old(facts.priceAtMs) || (!fixed && old(facts.referenceAtMs))) return verdict('stale')
  return verdict(deviationPct > limitPct ? 'above' : 'met')
}

/** The parts of a stock row the condition reads — `GET /api/stocks/asset`'s row, the one the order route judges on. */
export type PriceFactsRow = Readonly<{
  representation: Readonly<{ instrument?: Readonly<{ class: string }> | null }>
  market: Readonly<{ priceUsd: number | null; observedAt: string | null }>
  tokenPerShareUsd: number | null
  reference: Readonly<{
    state: string
    perShare: number | null
    source: Readonly<{ id: string }>
    observedAt: string | null
    fetchedAt: string | null
  }>
  issuerMark?: Readonly<{
    source: Readonly<{ id: string }>
    perUnit: number | null
    fetchedAt: string
    stale: boolean
  }> | null
}>

const parsed = (at: string | null | undefined): number | null => {
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? ms : null
}

/** Which reference a company has at all: PreStocks' valuation for a private one, a reference per share for a listed one; null when none is read — and then no condition is offered. */
export function referenceKindOf(row: PriceFactsRow): RulePriceReference | null {
  if (row.representation.instrument?.class === 'pre-ipo')
    return row.issuerMark?.source.id === 'issuer-prestocks' ? 'prestocks' : null
  if (row.reference.source.id === 'issuer-xstocks') return 'issuer'
  if (row.reference.source.id === 'pyth') return 'market'
  return null
}

/**
 * The facts a stock row states. `marketObservedAtMs` stands in for a price
 * the row does not date itself — the read's own time, never the clock: a
 * price nobody dated is not fresh.
 */
export function priceFactsOf(row: PriceFactsRow, marketObservedAtMs: number | null = null): PriceFacts {
  const reference = referenceKindOf(row)
  const priceAtMs = parsed(row.market.observedAt) ?? marketObservedAtMs
  if (reference === 'prestocks') {
    return {
      reference,
      priceUsd: row.market.priceUsd,
      priceAtMs,
      referenceUsd: row.issuerMark?.perUnit ?? null,
      referenceAtMs: parsed(row.issuerMark?.fetchedAt),
      referenceStale: row.issuerMark?.stale === true,
    }
  }
  return {
    reference,
    // A listed token on the reference's basis: its price per share, which the row draws only when the chain stated the multiplier.
    priceUsd: row.tokenPerShareUsd,
    priceAtMs,
    referenceUsd: row.reference.perShare,
    // The source's own observation time where it states one, else Ryntra's fetch.
    referenceAtMs: parsed(row.reference.observedAt ?? row.reference.fetchedAt),
    referenceStale: row.reference.state === 'stale',
  }
}

/* ---- the words ---- */

/**
 * The reference in the form a sentence needs: `name` on its own («Оцінка
 * PreStocks»), `against` after «дорожча за» («оцінку PreStocks»), `of` after
 * «до» («+2,1 % до оцінки PreStocks»). PreStocks' figure is its valuation —
 * never a fair price.
 */
const REFERENCE_PHRASES: Readonly<
  Record<RulePriceReference, Readonly<Record<Locale, Readonly<{ name: string; against: string; of: string }>>>>
> = {
  prestocks: {
    en: { name: 'PreStocks’ valuation', against: 'PreStocks’ valuation', of: 'PreStocks’ valuation' },
    uk: { name: 'Оцінка PreStocks', against: 'оцінку PreStocks', of: 'оцінки PreStocks' },
  },
  issuer: {
    en: { name: 'Issuer’s reference', against: 'the issuer’s reference', of: 'the issuer’s reference' },
    uk: { name: 'Орієнтир емітента', against: 'орієнтир емітента', of: 'орієнтира емітента' },
  },
  market: {
    en: { name: 'Market reference', against: 'the market reference', of: 'the market reference' },
    uk: { name: 'Біржовий орієнтир', against: 'біржовий орієнтир', of: 'біржового орієнтира' },
  },
  // 1.31.0: a token's market price when its rule was turned on — kept on the rule, taken again after a pause.
  enabled: {
    en: {
      name: 'Price when turned on',
      against: 'the price when the rule was turned on',
      of: 'the price when the rule was turned on',
    },
    uk: { name: 'Ціна при ввімкненні', against: 'ціну при ввімкненні правила', of: 'ціни при ввімкненні правила' },
  },
}

export function referencePhrase(
  reference: RulePriceReference | null,
  locale: Locale,
  form: 'name' | 'against' | 'of',
): string {
  return REFERENCE_PHRASES[reference ?? 'issuer'][locale][form]
}

/** A deviation the way a person reads it: a whole per cent from ten up, one decimal below. */
export function deviationWord(deviationPct: number, locale: Locale): string {
  const size = Math.abs(deviationPct)
  return pctWord(size, locale, size >= 9.95 ? 0 : 1)
}

/* «на» never ends a line apart from its figure — the web's no-break space. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0)

/** The rule's condition in one line: «Не купувати, якщо дорожче за оцінку PreStocks більш ніж на 5 %». */
export function conditionLine(limitPct: number, reference: RulePriceReference | null, locale: Locale): string {
  return locale === 'uk'
    ? `Не купувати, якщо дорожче за ${referencePhrase(reference, 'uk', 'against')} більш ніж на${NO_BREAK_SPACE}${pctWord(limitPct, 'uk')}`
    : `Don’t buy if it costs more than ${pctWord(limitPct, 'en')} above ${referencePhrase(reference, 'en', 'against')}`
}

/** The rule's condition as a short fact: «не дорожче за оцінку PreStocks більш ніж на 5 %» · «at most 5% above PreStocks' valuation». */
export function conditionShort(limitPct: number, reference: RulePriceReference | null, locale: Locale): string {
  return locale === 'uk'
    ? `не дорожче за ${referencePhrase(reference, 'uk', 'against')} більш ніж на${NO_BREAK_SPACE}${pctWord(limitPct, 'uk')}`
    : `at most ${pctWord(limitPct, 'en')} above ${referencePhrase(reference, 'en', 'against')}`
}

/** «ліміт 5 %» · «limit 5%». */
export function limitWords(limitPct: number, locale: Locale): string {
  return locale === 'uk' ? `ліміт ${pctWord(limitPct, 'uk')}` : `limit ${pctWord(limitPct, 'en')}`
}

/** The data's time on the rule's clock: «10:32» the same day, «24 вер. о 10:32» · «Sep 24 at 10:32» another. */
export function dataTimeWords(atMs: number, nowMs: number, timeZone: string, locale: Locale): string {
  const wall = wallClockAt(atMs, timeZone)
  const today = wallClockAt(nowMs, timeZone)
  const time = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
  if (wall.year === today.year && wall.month === today.month && wall.day === today.day) return time
  const day = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(atMs))
  return locale === 'uk' ? `${day} о ${time}` : `${day} at ${time}`
}

/** The data's time of a judgement, or null when it has none. */
function dataTimeOf(check: Pick<PriceCheck, 'dataAt'>, nowMs: number, timeZone: string, locale: Locale): string | null {
  const ms = parsed(check.dataAt)
  return ms === null ? null : dataTimeWords(ms, nowMs, timeZone, locale)
}

/** How far the price stands from the reference: «на 30 % дорожча за оцінку PreStocks» · «30% above PreStocks' valuation»; «на рівні: …» within a twentieth. */
export function standingWords(check: Pick<PriceCheck, 'deviationPct' | 'reference'>, locale: Locale): string | null {
  if (check.deviationPct === null) return null
  const whose = referencePhrase(check.reference, locale, 'against')
  if (Math.abs(check.deviationPct) < 0.05) return locale === 'uk' ? `на рівні: ${whose}` : `level with ${whose}`
  const figure = deviationWord(check.deviationPct, locale)
  if (locale === 'uk') return `на ${figure} ${check.deviationPct > 0 ? 'дорожча' : 'дешевша'} за ${whose}`
  return `${figure} ${check.deviationPct > 0 ? 'above' : 'below'} ${whose}`
}

/**
 * The condition judged now, under the limits of a rule being written: «Зараз
 * ціна на 30 % дорожча за оцінку PreStocks — купівлю буде відкладено.» · «… —
 * у межах умови.» · «Свіжих даних зараз немає — правило чекатиме на них.»
 */
export function conditionNowLine(check: PriceCheck, locale: Locale): string {
  const standing = standingWords(check, locale)
  if (check.verdict === 'stale' || check.verdict === 'unavailable' || standing === null) {
    return locale === 'uk'
      ? 'Свіжих даних зараз немає — правило чекатиме на них.'
      : 'No fresh data right now — the rule would wait for them.'
  }
  if (check.verdict === 'above')
    return locale === 'uk'
      ? `Зараз ціна ${standing} — купівлю буде відкладено.`
      : `Now the price is ${standing} — the purchase would be deferred.`
  return locale === 'uk'
    ? `Зараз ціна ${standing} — у межах умови.`
    : `Now the price is ${standing} — within the condition.`
}

/**
 * The condition's line over a rule's purchase and in «Перевірка»: «+2,1 % до
 * оцінки PreStocks $1 000,00 · ліміт 5 % · дані 10:32» — the deviation, the
 * reference and its figure, the limit, the data's time.
 */
export function conditionReviewLine(check: PriceCheck, nowMs: number, timeZone: string, locale: Locale): string {
  const time = dataTimeOf(check, nowMs, timeZone, locale)
  const parts: string[] = []
  const figure = check.referenceUsd !== null ? priceWord(check.referenceUsd, locale) : null
  if (check.deviationPct !== null) {
    const sign = check.deviationPct > 0 ? '+' : check.deviationPct < 0 ? '−' : ''
    const size = pctWord(Math.abs(check.deviationPct), locale, 1)
    const reference = referencePhrase(check.reference, locale, 'of')
    parts.push(
      locale === 'uk'
        ? `${sign}${size} до ${reference}${figure ? ` ${figure}` : ''}`
        : `${sign}${size} against ${reference}${figure ? ` of ${figure}` : ''}`,
    )
  } else if (figure) {
    parts.push(`${referencePhrase(check.reference, locale, 'name')} ${figure}`)
  }
  parts.push(limitWords(check.limitPct, locale))
  if (time) parts.push(locale === 'uk' ? `дані ${time}` : `data at ${time}`)
  return parts.join(' · ')
}

/**
 * Why a rule's purchase waits: «OpenAI на 30 % дорожча за оцінку PreStocks
 * (твій ліміт 5 %) · дані 18:56» · «OpenAI — дані про ціну застаріли ·
 * останні — 17:00» · «OpenAI — зараз немає орієнтира».
 */
export function deferralLine(check: PriceCheck, name: string, nowMs: number, timeZone: string, locale: Locale): string {
  const time = dataTimeOf(check, nowMs, timeZone, locale)
  if (check.verdict === 'above' && check.deviationPct !== null) {
    const standing = standingWords(check, locale)
    const limit =
      locale === 'uk'
        ? `(твій ліміт ${pctWord(check.limitPct, 'uk')})`
        : `(your limit ${pctWord(check.limitPct, 'en')})`
    const head = locale === 'uk' ? `${name} ${standing} ${limit}` : `${name} is ${standing} ${limit}`
    return time ? `${head} · ${locale === 'uk' ? `дані ${time}` : `data at ${time}`}` : head
  }
  if (check.verdict === 'stale') {
    const head = locale === 'uk' ? `${name} — дані про ціну застаріли` : `${name} — price data out of date`
    return time ? `${head} · ${locale === 'uk' ? `останні — ${time}` : `latest at ${time}`}` : head
  }
  return locale === 'uk' ? `${name} — зараз немає орієнтира` : `${name} — no reference right now`
}

/**
 * A token's condition while its rule is written (1.31.0): the reference is
 * the price now, kept when the rule is turned on, so the line says the
 * ceiling it makes — «Орієнтир — ціна зараз $150,00: правило не купить
 * дорожче за $157,50.» The web's own (`anchorNowLine`).
 */
export function anchorNowLine(priceUsd: number, limitPct: number, locale: Locale): string {
  const ceiling = priceWord(priceUsd * (1 + limitPct / 100), locale)
  return locale === 'uk'
    ? `Орієнтир — ціна зараз ${priceWord(priceUsd, 'uk')}: правило не купить дорожче за ${ceiling}.`
    : `The reference is the price now, ${priceWord(priceUsd, 'en')}: the rule won’t buy above ${ceiling}.`
}

/** A token rule's anchor as it stands: «$150,00 · купує до $157,50» · «$150.00 · buys up to $157.50». */
export function anchorStandingLine(referenceUsd: number, limitPct: number, locale: Locale): string {
  const ceiling = priceWord(referenceUsd * (1 + limitPct / 100), locale)
  return locale === 'uk'
    ? `${priceWord(referenceUsd, 'uk')} · купує до ${ceiling}`
    : `${priceWord(referenceUsd, 'en')} · buys up to ${ceiling}`
}
