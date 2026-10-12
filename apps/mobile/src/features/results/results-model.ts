/**
 * Results on the phone — what happened against what was planned, read
 * from the contract and never recomputed: the plans' own projections
 * (`GET /api/v1/plans/results`, `GET /api/v1/plans/memory`, 1.9.0) and each
 * «Автоінвест» rule's reminders as the server states them
 * (`GET /api/v1/rules`, `occurrences`, 1.12.0–1.19.0).
 *
 * The sentences are the web's (`app/app/results/results-words.ts`), built
 * here from the figures in the reader's language. Two rules hold throughout:
 * a figure the server did not establish is a dash and a word, never a zero;
 * and a modelled figure is never spoken of as paid. Pure.
 */

import type {
  AutoinvestRule,
  PlanCheckId,
  PlanCostPart,
  PlanMemoryCitation,
  PlanMemoryFact,
  PlanNoTradeOutcome,
  PlanPosition,
  PlanPositionRow,
  PlanResult,
  PlanResultsResponse,
  RuleOccurrence,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { dollarsText } from '../invest/buy-model.ts'
import { formatAmount, formatUsd } from '../../utils/format.ts'
import { CHECK_WORDS, RESULTS_COPY } from './copy.ts'

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'brand'

/* ---- what a row is called ---- */

/** The symbol a person knows the asset by — the company's own, else the token's. */
export function symbolOf(row: Readonly<{ asset: PlanPositionRow['asset'] }>): string {
  return row.asset.underlying?.symbol || row.asset.symbol
}

export function checkWord(id: PlanCheckId, locale: Locale): string {
  return CHECK_WORDS[locale][id] ?? id
}

/** The leg's own word. */
export function legWord(result: PlanResult, locale: Locale): string {
  const copy = RESULTS_COPY[locale]
  if (result.actual.leg === 'entry') return copy.entry
  if (result.actual.leg === 'exit') return copy.exit
  return copy.legUnknown
}

/**
 * The verdict an operation wears: an exit is judged by its own adherence (the
 * version that ruled it), an entry by the plan's checks; nothing is a chip
 * when neither could be judged.
 */
export function verdictOf(result: PlanResult, locale: Locale): Readonly<{ word: string; tone: Tone }> {
  const copy = RESULTS_COPY[locale]
  const verdict = result.exit ? result.exit.verdict : result.verdict
  if (verdict === 'followed') return { word: result.exit ? copy.exitFollowed : copy.followed, tone: 'success' }
  if (verdict === 'deviated') return { word: result.exit ? copy.exitDeviated : copy.deviated, tone: 'warning' }
  return { word: result.exit ? copy.exitUnknown : copy.unsettled, tone: 'neutral' }
}

/* ---- the figures ---- */

/** A cost part as text — the money and the percentage when established; `null` (a dash) when not. */
export function costPartText(part: PlanCostPart, locale: Locale): string | null {
  if (part.basis === 'unknown' || (part.usd === null && part.pct === null)) return null
  const money = part.usd === null ? null : `${part.usd > 0 ? '+' : ''}${formatUsd(part.usd, locale)}`
  const pct = part.pct === null ? null : `${part.pct > 0 ? '+' : ''}${percent(part.pct, locale)}`
  return [money, pct].filter(Boolean).join(' · ')
}

function percent(value: number, locale: Locale): string {
  const text = `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}%`
  return locale === 'uk' ? text.replace('.', ',') : text
}

/** A rate in basis points as a percentage; a dash when unknown. */
export function bpsText(bps: number | null, locale: Locale): string | null {
  return bps === null ? null : percent(bps / 100, locale)
}

export function pctText(pct: number | null, locale: Locale): string | null {
  return pct === null ? null : percent(pct, locale)
}

/** Why a cost part could not be established, in the reader's language; null when it was. */
export function costReasonText(reason: string | null, locale: Locale): string | null {
  if (!reason) return null
  const say: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
    'no-review': { en: 'no Review was kept for this operation', uk: 'для цієї операції не збережено Review' },
    'no-planned-price': { en: 'this version planned no price for this leg', uk: 'ця версія не планувала ціни для цієї ноги' },
    'no-fill-price': { en: 'the fill’s price per unit was not established', uk: 'ціну за одиницю на виконанні не встановлено' },
    'fee-not-recorded': { en: 'the operation recorded no fee', uk: 'операція не записала комісії' },
  }
  return say[reason]?.[locale] ?? null
}

/** Why a position states no realised figure. A reason the phone does not know is left out, never printed as an id. */
export function unknownText(id: string, locale: Locale): string | null {
  const say: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
    'position-open': { en: 'the position is still open', uk: 'позиція ще відкрита' },
    'no-entry': { en: 'no entry has settled under this plan', uk: 'за цим планом не підтверджено жодного входу' },
    'side-not-established': { en: 'an operation’s side was never recorded', uk: 'сторону однієї операції не записано' },
    'entry-not-valued': { en: 'an entry could not be valued in dollars', uk: 'вхід неможливо оцінити в доларах' },
    'exit-not-valued': { en: 'an exit could not be valued in dollars', uk: 'вихід неможливо оцінити в доларах' },
    'units-not-countable': { en: 'the units of an operation are not countable in this plan’s unit', uk: 'одиниці операції не порахувати в одиниці цього плану' },
    'fee-not-recorded': { en: 'an operation recorded no fee', uk: 'операція не записала комісії' },
  }
  return say[id]?.[locale] ?? null
}

/** The position's realised figure with its method, or the reasons there is none. */
export function realisedLine(position: PlanPosition, locale: Locale): string | null {
  const copy = RESULTS_COPY[locale]
  if (position.realisedUsd !== null) return null
  const reasons = position.unknowns.map((id) => unknownText(id, locale)).filter((text): text is string => text !== null)
  return reasons.length > 0 ? `${copy.noRealised} ${reasons.join('; ')}.` : null
}

/* ---- the sentences ---- */

/** The position in one line: what is held, or what it came to. */
export function positionSentence(position: PlanPosition, symbol: string, locale: Locale): string {
  const uk = locale === 'uk'
  if (position.state === 'none') return uk ? 'Позиції за цим планом немає.' : 'There is no position under this plan.'
  const held = formatAmount(Number(position.unitsHeld), 6, locale)
  const bought = formatAmount(Number(position.unitsIn), 6, locale)
  const sold = formatAmount(Number(position.unitsOut), 6, locale)
  if (position.state === 'open') return uk ? `Куплено ${bought} ${symbol}; утримується ${held}.` : `Bought ${bought} ${symbol}; ${held} held.`
  return uk
    ? `Куплено ${bought} ${symbol}, продано ${sold} — позицію закрито.`
    : `Bought ${bought} ${symbol}, sold ${sold} — the position is closed.`
}

/**
 * Why a plan made no trade, from the outcome's own figures. A statement about
 * a rule, never about the person: the plan working, and *failed* nowhere. The
 * Review's `expected` and `found` are English phrases it wrote when it
 * judged; they stand beside the sentence as figures, never inside it.
 */
export function noTradeSentence(outcome: PlanNoTradeOutcome, locale: Locale): string {
  const symbol = symbolOf(outcome)
  const uk = locale === 'uk'
  const every = outcome.everyReview && outcome.reviews > 1
  const inAll = every ? (uk ? ` — в усіх ${outcome.reviews} Review` : ` — in all ${outcome.reviews} Reviews`) : ''
  switch (outcome.reason) {
    case 'entry-bound-unmet':
      return uk
        ? `Без угоди: виконувана ціна лишалася вищою за максимум, який готовий платити план${inAll}.`
        : `No trade: the executable price stayed above the most this plan will pay${inAll}.`
    case 'liquidity-unavailable':
      return uk
        ? `Без угоди: ліквідність майданчика так і не сягнула порогу, якого вимагає план${inAll}.`
        : `No trade: the venue’s liquidity never reached the floor this plan requires${inAll}.`
    case 'conditions-unmet':
      return uk
        ? `Без угоди: умова щодо доказів, яку ти вимагав, не виконана або її неможливо оцінити${inAll}.`
        : `No trade: a condition you required on the evidence was not met, or could not be judged${inAll}.`
    case 'invalidated-before-entry':
      return uk
        ? 'Без угоди: на Review ціна вже була на рівні інвалідації або нижче — теза була хибною ще до входу.'
        : 'No trade: at the Review the price was already at or below your invalidation — the thesis was wrong before the entry.'
    case 'review-blocked':
      return uk
        ? 'Без угоди: правило цього плану відмовило ордеру.'
        : 'No trade: a rule of this plan refused the order.'
    case 'expired':
      return uk
        ? 'Без угоди: вікно входу закрилося раніше, ніж з’явилася ціна, яку план приймає.'
        : 'No trade: the entry window closed before a price the plan accepts appeared.'
    case 'cancelled':
      return uk ? 'Без угоди: ти скасував цей план.' : 'No trade: you cancelled this plan.'
    case 'reviewed-not-taken': {
      const n = outcome.reviews
      return uk
        ? `Без угоди: ${n === 1 ? 'один Review пройшов' : `${n} Review пройшли`}, і ти не став продовжувати.`
        : `No trade: ${n === 1 ? 'one Review' : `${n} Reviews`} passed and you did not proceed.`
    }
    case 'no-review':
      return uk ? `${symbol} активний, і за ним ще нічого не перевіряли.` : `${symbol} is live and nothing has been reviewed under it yet.`
  }
}

/* ---- memory ---- */

const figureOf = (fact: PlanMemoryFact, key: string) => fact.figures.find((figure) => figure.key === key) ?? null
const numberOf = (fact: PlanMemoryFact, key: string) => figureOf(fact, key)?.value ?? null
const textOf = (fact: PlanMemoryFact, key: string) => figureOf(fact, key)?.text ?? null

function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100
  const last = n % 10
  if (last === 1 && tens !== 11) return one
  if (last >= 2 && last <= 4 && (tens < 10 || tens >= 20)) return few
  return many
}

/**
 * One memory fact as a sentence, built from its own figures. A fact whose
 * figures do not make a sentence — or whose kind the phone does not know — is
 * not shown: a shorter memory rather than one that says what the record does
 * not, and never an id on the screen.
 */
export function memorySentence(fact: PlanMemoryFact, locale: Locale): string | null {
  const symbol = fact.scope.symbol ?? ''
  const uk = locale === 'uk'
  const usd = (value: number) => formatUsd(value, locale)
  switch (fact.kind) {
    case 'plans-written': {
      const plans = numberOf(fact, 'plans')
      const active = numberOf(fact, 'active') ?? 0
      if (plans === null || !symbol) return null
      return uk
        ? `${plans} ${plural(plans, 'план', 'плани', 'планів')} на ${symbol}${
            active <= 0
              ? ''
              : active === plans
                ? ` — ${plans === 1 ? 'активний' : 'усі активні'}`
                : `, з них ${active} ${plural(active, 'активний', 'активні', 'активних')}`
          }.`
        : `${plans} plan${plans === 1 ? '' : 's'} written on ${symbol}${
            active <= 0 ? '' : active === plans ? ` — ${plans === 1 ? 'live' : 'all live'}` : `, ${active} of them live`
          }.`
    }
    case 'trades-made': {
      const reviewed = numberOf(fact, 'reviewed') ?? 0
      const traded = numberOf(fact, 'traded') ?? 0
      if (!symbol) return null
      return uk
        ? `На ${symbol}: перевірено ${reviewed} ${plural(reviewed, 'план', 'плани', 'планів')}, угодою ${traded === 1 ? 'став' : 'стали'} ${traded}.`
        : `On ${symbol}: ${reviewed} plan${reviewed === 1 ? '' : 's'} reviewed, ${traded} became ${traded === 1 ? 'a trade' : 'trades'}.`
    }
    case 'blocked-by-rule': {
      const plans = numberOf(fact, 'plans') ?? 0
      const rule = textOf(fact, 'rule')
      const word = rule ? CHECK_WORDS[locale][rule as PlanCheckId] : undefined
      if (!word || !symbol) return null
      return uk
        ? `${plans} ${plural(plans, 'план', 'плани', 'планів')} на ${symbol} так і не торгували: правило «${word.toLowerCase()}» відмовило кожному Review.`
        : `${plans} plan${plans === 1 ? '' : 's'} on ${symbol} never traded: the rule “${word.toLowerCase()}” refused every Review.`
    }
    case 'entry-vs-plan': {
      const diff = numberOf(fact, 'diff')
      const planned = numberOf(fact, 'planned')
      const actual = numberOf(fact, 'actual')
      if (diff === null || planned === null || actual === null || !symbol) return null
      const by = percent(Math.abs(diff), locale)
      return uk
        ? `Вхід на ${symbol} був ${usd(actual)} проти планових ${usd(planned)} — на ${by} ${diff >= 0 ? 'вище' : 'нижче'}.`
        : `The ${symbol} entry was ${usd(actual)} against the planned ${usd(planned)} — ${by} ${diff >= 0 ? 'above' : 'below'}.`
    }
    case 'position-open': {
      const held = numberOf(fact, 'unitsHeld')
      const basis = numberOf(fact, 'costBasis')
      if (held === null || !symbol) return null
      const units = formatAmount(held, 6, locale)
      return uk
        ? `Позиція на ${symbol} відкрита: ${units}${basis === null ? '' : ` за ${usd(basis)}`}.`
        : `A ${symbol} position is open: ${units}${basis === null ? '' : ` for ${usd(basis)}`}.`
    }
    case 'exit-adherence': {
      const verdict = textOf(fact, 'verdict')
      const price = numberOf(fact, 'price')
      const rule = textOf(fact, 'rule')
      if (!verdict || !symbol) return null
      const at = price === null ? '' : uk ? ` за ${usd(price)}` : ` at ${usd(price)}`
      const word = rule ? CHECK_WORDS[locale][rule as PlanCheckId] : undefined
      if (verdict === 'deviated' && word) {
        return uk
          ? `Вихід із ${symbol}${at} не виконав правило «${word.toLowerCase()}», яке вже існувало.`
          : `The ${symbol} exit${at} did not meet “${word.toLowerCase()}”, a rule that already existed.`
      }
      if (verdict === 'followed') return uk ? `Вихід із ${symbol}${at} виконав кожне правило, що існувало.` : `The ${symbol} exit${at} met every rule that existed.`
      return uk ? `Вихід із ${symbol} неможливо оцінити проти правил плану.` : `The ${symbol} exit could not be judged against the plan’s rules.`
    }
    case 'monitoring-said': {
      const said = findingWords(textOf(fact, 'finding'), textOf(fact, 'outcome'), locale)
      if (!said || !symbol) return null
      return uk ? `Нагляд записав по ${symbol}: ${said}.` : `Monitoring wrote on ${symbol}: ${said}.`
    }
    default:
      return null
  }
}

/** A monitoring finding in the reader's language; a kind the phone does not know is not said at all. */
function findingWords(kind: string | null, outcome: string | null, locale: Locale): string | null {
  const kinds: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
    invalidation: { en: 'the invalidation', uk: 'інвалідація' },
    target: { en: 'the target', uk: 'ціль' },
    entry: { en: 'the entry bound', uk: 'межа входу' },
    validity: { en: 'the entry window', uk: 'вікно входу' },
    deviation: { en: 'the deviation from the reference', uk: 'відхилення від референсу' },
    liquidity: { en: 'the liquidity', uk: 'ліквідність' },
    evidence: { en: 'an evidence condition', uk: 'умова доказів' },
  }
  const outcomes: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
    crossed: { en: 'was crossed', uk: 'перетнуто' },
    reached: { en: 'was reached', uk: 'досягнуто' },
    met: { en: 'was met', uk: 'виконано' },
    unmet: { en: 'was not met', uk: 'не виконано' },
    unknown: { en: 'could not be judged', uk: 'неможливо оцінити' },
    passed: { en: 'passed', uk: 'минуло' },
  }
  const said = kind ? kinds[kind]?.[locale] : undefined
  if (!said) return null
  const happened = outcome ? outcomes[outcome]?.[locale] : undefined
  return happened ? `${said} ${happened}` : said
}

/** The memory sentences worth showing, newest facts as the server ordered them, at most twelve. */
export function memoryLines(facts: readonly PlanMemoryFact[], locale: Locale): readonly Readonly<{ fact: PlanMemoryFact; text: string }>[] {
  return facts
    .map((fact) => ({ fact, text: memorySentence(fact, locale) }))
    .filter((line): line is { fact: PlanMemoryFact; text: string } => line.text !== null)
    .slice(0, 12)
}

/**
 * A citation as a person reads it: the kind of record, a version by its
 * number (the one id a person knows); the record's own id is never printed.
 */
export function citationLabel(cite: PlanMemoryCitation, locale: Locale): string {
  const word = RESULTS_COPY[locale].cites[cite.kind]
  const number = cite.kind === 'version' ? (cite.id.split('#').pop() ?? '') : ''
  return /^\d+$/.test(number) ? `${word} ${number}` : word
}

/* ---- one plan ---- */

/** The results feed narrowed to one plan — what a plan's own «Результати» opens; the whole feed without a plan. */
export function forPlan(feed: PlanResultsResponse, planId: string | null): PlanResultsResponse {
  if (!planId) return feed
  return {
    ...feed,
    results: feed.results.filter((row) => row.planId === planId),
    outcomes: feed.outcomes.filter((row) => row.planId === planId),
    positions: feed.positions.filter((row) => row.planId === planId),
  }
}

/* ---- «Автоінвест»: what each rule's reminders came to ---- */

/**
 * A reminder as it stands this minute — the server's state, with the one
 * reading the rest of the app makes (`rule-model.ts`): a reminder is open only
 * while its window has not passed and the rule is on. A `due` one whose window
 * passed without a signature is missed (never caught up); a `deferred` one
 * whose window passed was held back by the price to the end — said so, never
 * as the person's miss; a paused rule's open window is said as paused.
 */
export type ShownState = 'open' | 'deferred' | 'pending' | 'paused' | 'bought' | 'missed' | 'held' | 'priceHeld'

export function shownStateOf(rule: AutoinvestRule, occurrence: RuleOccurrence, nowMs: number): ShownState {
  const state = occurrence.state
  if (state !== 'due' && state !== 'deferred') return state
  const until = Date.parse(occurrence.openUntil)
  if (!Number.isFinite(until) || until <= nowMs) return state === 'due' ? 'missed' : 'priceHeld'
  if (rule.status !== 'active') return 'paused'
  return state === 'due' ? 'open' : 'deferred'
}

export type RuleTally = Readonly<{
  rule: AutoinvestRule
  /** The reminders the server keeps for the rule, newest first. */
  reminders: readonly RuleOccurrence[]
  /** Each reminder's state as it stands now, in the same order. */
  shown: readonly ShownState[]
  bought: number
  /** The reminders that are over — bought, missed, held back by the price or by the budget: what «Куплено N з M» counts against. */
  settled: number
  /** The dollars the bought reminders spent; null when one of them did not state it. */
  spentUsd: number | null
  /** How many reminders stand each other way, in the order they are said. */
  others: readonly Readonly<{ state: Exclude<ShownState, 'bought'>; count: number }>[]
  /** When the newest reminder came. */
  lastAt: string
}>

const OTHER_ORDER: readonly Exclude<ShownState, 'bought'>[] = ['open', 'deferred', 'pending', 'paused', 'missed', 'priceHeld', 'held']
const SETTLED: ReadonlySet<ShownState> = new Set<ShownState>(['bought', 'missed', 'priceHeld', 'held'])

/**
 * Each rule's reminders against what was bought — «Куплено 3 з 5 · $3» — over
 * exactly the occurrences the server states (it keeps the newest few, so the
 * count is said as *the last N*). Only reminders that are over count against
 * the purchases; an open one, one on its way or one deferred by the price is
 * said beside, never as a miss. A rule no reminder has come for yet has no
 * result and is left out. The spent sum adds the settled purchases' own
 * dollars and is a dash the moment one of them did not state its sum.
 */
export function ruleTallies(rules: readonly AutoinvestRule[], nowMs: number): readonly RuleTally[] {
  return rules
    .filter((rule) => rule.occurrences.length > 0)
    .map((rule) => {
      const reminders = rule.occurrences
      const shown = reminders.map((occurrence) => shownStateOf(rule, occurrence, nowMs))
      const bought = reminders.filter((occurrence) => occurrence.state === 'bought')
      const spentUsd = bought.some((occurrence) => occurrence.spentUsd === null)
        ? null
        : Math.round(bought.reduce((sum, occurrence) => sum + (occurrence.spentUsd ?? 0), 0) * 100) / 100
      const others = OTHER_ORDER.map((state) => ({ state, count: shown.filter((candidate) => candidate === state).length })).filter(
        (entry) => entry.count > 0,
      )
      const lastAt = reminders.reduce(
        (latest, occurrence) => (Date.parse(occurrence.dueAt) > Date.parse(latest) ? occurrence.dueAt : latest),
        reminders[0]!.dueAt,
      )
      const settled = shown.filter((state) => SETTLED.has(state)).length
      return { rule, reminders, shown, bought: bought.length, settled, spentUsd, others, lastAt }
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
}

/** The tally's figure — «Куплено 2 з 3» over the reminders that are over; null while none is. */
export function tallyFigure(tally: RuleTally, locale: Locale): string | null {
  return tally.settled === 0 ? null : RESULTS_COPY[locale].boughtOf(tally.bought, tally.settled)
}

/** The tally's second line: the dollars spent, then what else became of the reminders. */
export function tallyLine(tally: RuleTally, locale: Locale): string {
  const copy = RESULTS_COPY[locale]
  const parts: string[] = []
  if (tally.bought > 0) parts.push(copy.spentLine(tally.spentUsd === null ? '—' : dollarsText(tally.spentUsd, locale)))
  for (const entry of tally.others) parts.push(copy.counted[entry.state](entry.count))
  return parts.join(' · ')
}

/** A reminder's state as a chip tone. */
export function occurrenceTone(state: ShownState): Tone {
  if (state === 'bought') return 'success'
  if (state === 'missed' || state === 'paused' || state === 'priceHeld') return 'neutral'
  if (state === 'open') return 'brand'
  return 'warning'
}

/** What one reminder asked for: its own sum (a «З оплат» reminder's gathered sum), else the rule's. */
export function reminderSum(rule: AutoinvestRule, occurrence: RuleOccurrence): number {
  return occurrence.amountUsd ?? rule.amountUsd
}

/** Whether anything at all is there to show — the plans' rows, the memory or a rule's reminders. */
export function hasAnything(feed: PlanResultsResponse | null, tallies: readonly RuleTally[], memory: number): boolean {
  if (tallies.length > 0 || memory > 0) return true
  if (!feed) return false
  return feed.results.length > 0 || feed.outcomes.length > 0 || feed.positions.length > 0
}
