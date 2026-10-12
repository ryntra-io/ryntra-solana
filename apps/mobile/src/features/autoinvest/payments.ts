/**
 * «З кожної оплати» on the phone — the pure half (as
 * the web's, contract 1.19.0).
 *
 * The third kind of «Автоінвест» rule sets money aside from the wallet's own
 * USDC on Solana: every payment rounded up to the next $1 or $5, a sum from
 * every payment, or a per cent of every USDC that comes in. The money stays
 * in the wallet; what the rule takes gathers until its minimum, and then one
 * reminder opens on exactly that sum — a fresh «Перевірка», the wallet's own
 * signature, the receipt. What an event is, and what never counts (a swap,
 * Ryntra's own purchase, a transfer between the person's own accounts, a
 * bridge, dust), is the server's: its watch reads the chain, numbers each
 * event once and lists the newest; the other side of a transfer never reaches
 * the wire, and no shop is ever named.
 *
 * The share a rule takes is the web's own arithmetic (`lib/autoinvest/
 * payments.ts`, `contributionCents`), so the sheet's example — «Оплата $3,40 →
 * $0,60 в Apple» — is what the tick will count; the bounds are the server's
 * (`capabilities.rules.payments`), the contract's own until they are read.
 * Pure: nothing here reads the network.
 */

import type {
  AutoinvestRule,
  RuleCreateRequest,
  RulePaymentDirection,
  RulePaymentEvent,
  RulePaymentMode,
  RulePayments,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { parseDollars } from '../invest/buy-model.ts'

/* ---- the bounds (`capabilities.rules.payments`) ---- */

/** `roundup` — every payment rounded up · `fixed` — a sum from every payment · `percent` — a per cent of every USDC that comes in. */
export const RULE_PAYMENT_MODES: readonly RulePaymentMode[] = ['roundup', 'fixed', 'percent']
/** The steps a payment rounds up to, the fixed sum's bounds, the per cent's bounds, how many events a rule lists — the contract's, as production states them. */
export const PAYMENT_ROUNDUP_STEPS_USD = [1, 5] as const
export const PAYMENT_FIXED_MIN_USD = 0.1
export const PAYMENT_FIXED_MAX_USD = 100
export const PAYMENT_PERCENT_MIN = 1
export const PAYMENT_PERCENT_MAX = 50
export const PAYMENT_EVENTS_KEPT = 12
/** The per cents the sheet offers, and the one it opens on (10 %) — the web's own. */
export const PAYMENT_PERCENT_PRESETS = [5, 10, 20] as const
export const PAYMENT_PERCENT_DEFAULT = 10
/** The least a movement is to be an event at all — a cent. */
export const PAYMENT_EVENT_MIN_USD = 0.01
/** How many of the listed events the rule's sheet names; the rest count all the same. The web's own. */
export const PAYMENT_EVENTS_SHOWN = 6
/** The payment and the incoming transfer the sheet's example reads — «Оплата $3,40 → $0,60 в Apple». The web's own. */
export const PAYMENT_EXAMPLE_USD: Readonly<Record<RulePaymentDirection, number>> = { out: 3.4, in: 100 }

export type PaymentBounds = Readonly<{
  modes: readonly RulePaymentMode[]
  roundToUsd: readonly number[]
  fixedMinUsd: number
  fixedMaxUsd: number
  percentMin: number
  percentMax: number
  eventsKept: number
}>

const BOUNDS: PaymentBounds = {
  modes: RULE_PAYMENT_MODES,
  roundToUsd: PAYMENT_ROUNDUP_STEPS_USD,
  fixedMinUsd: PAYMENT_FIXED_MIN_USD,
  fixedMaxUsd: PAYMENT_FIXED_MAX_USD,
  percentMin: PAYMENT_PERCENT_MIN,
  percentMax: PAYMENT_PERCENT_MAX,
  eventsKept: PAYMENT_EVENTS_KEPT,
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/**
 * The bounds as the server's capabilities state them (never hard-wired where
 * the server says otherwise), or the contract's own while they are unread or
 * state something a rule cannot be. A mode the phone does not know is left
 * out; the three it knows keep the web's order.
 */
export function paymentBounds(stated: unknown): PaymentBounds {
  if (!stated || typeof stated !== 'object') return BOUNDS
  const s = stated as Record<string, unknown>
  const modes = Array.isArray(s.modes)
    ? RULE_PAYMENT_MODES.filter((mode) => (s.modes as unknown[]).some((m) => m === mode))
    : []
  const steps = Array.isArray(s.roundToUsd)
    ? [...new Set((s.roundToUsd as unknown[]).filter((step): step is number => whole(step) && step >= 1))].sort(
        (a, b) => a - b,
      )
    : []
  if (modes.length === 0 || (modes.includes('roundup') && steps.length === 0)) return BOUNDS
  if (!positive(s.fixedMinUsd) || !positive(s.fixedMaxUsd) || s.fixedMinUsd > s.fixedMaxUsd) return BOUNDS
  if (
    !whole(s.percentMin) ||
    !whole(s.percentMax) ||
    s.percentMin < 1 ||
    s.percentMax > 100 ||
    s.percentMin > s.percentMax
  )
    return BOUNDS
  if (!whole(s.eventsKept) || s.eventsKept < 1) return BOUNDS
  return {
    modes,
    roundToUsd: steps,
    fixedMinUsd: s.fixedMinUsd,
    fixedMaxUsd: s.fixedMaxUsd,
    percentMin: s.percentMin,
    percentMax: s.percentMax,
    eventsKept: s.eventsKept,
  }
}

/** The per cents the sheet offers — the web's, within the bounds. */
export function percentChoices(bounds: PaymentBounds): readonly number[] {
  const presets = PAYMENT_PERCENT_PRESETS.filter((pct) => pct >= bounds.percentMin && pct <= bounds.percentMax)
  return presets.length > 0 ? presets : [bounds.percentMin]
}

/** The per cent a new rule opens on: the web's 10 %, or the nearest the bounds allow. */
export function defaultPercent(bounds: PaymentBounds): number {
  const choices = percentChoices(bounds)
  return choices.includes(PAYMENT_PERCENT_DEFAULT) ? PAYMENT_PERCENT_DEFAULT : (choices[0] ?? bounds.percentMin)
}

/* ---- the terms ---- */

/** A rule's terms: the mode and its one figure, the others null — as the contract carries them. */
export type PaymentTerms = Readonly<{
  mode: RulePaymentMode
  roundToUsd: number | null
  fixedUsd: number | null
  percent: number | null
}>

/** The terms of the mode picked, from the sheet's three figures: only the mode's own is kept. */
export function termsOf(
  mode: RulePaymentMode,
  figures: Readonly<{ roundToUsd: number; fixedUsd: number | null; percent: number }>,
): PaymentTerms {
  return {
    mode,
    roundToUsd: mode === 'roundup' ? figures.roundToUsd : null,
    fixedUsd: mode === 'fixed' ? figures.fixedUsd : null,
    percent: mode === 'percent' ? figures.percent : null,
  }
}

/** A sum typed for «$ з оплати», in dollars and cents within the bounds ($0,10–$100), or null. */
export function fixedOfInput(text: string, locale: Locale, bounds: PaymentBounds = BOUNDS): number | null {
  const value = parseDollars(text, locale)
  if (value === null) return null
  const cents = Math.round(value * 100) / 100
  return cents >= bounds.fixedMinUsd - 1e-9 && cents <= bounds.fixedMaxUsd + 1e-9 ? cents : null
}

/** Which way a mode reads the wallet's USDC: a payment for the round-up and the fixed sum, money that came in for the per cent. */
export function directionOfMode(mode: RulePaymentMode): RulePaymentDirection {
  return mode === 'percent' ? 'in' : 'out'
}

/* ---- the share a rule takes — the web's own arithmetic ---- */

const MICRO_PER_CENT = 10_000n
const MIN_EVENT_MICRO = BigInt(Math.round(PAYMENT_EVENT_MIN_USD * 1_000_000))

/** Micro-dollars (USDC's own unit) to whole cents, half up. */
export function centsOfMicro(micro: bigint): number {
  if (micro <= 0n) return 0
  return Number((micro + MICRO_PER_CENT / 2n) / MICRO_PER_CENT)
}

/**
 * What a rule takes from one event, in whole cents: the round-up of a payment
 * to the next step (nothing when it is already on the step), a fixed sum from
 * a payment, or a per cent of money that came in. An event of the other
 * direction, and a movement under a cent, take nothing.
 */
export function contributionCents(
  terms: PaymentTerms,
  movement: Readonly<{ direction: RulePaymentDirection; amountMicro: bigint }>,
): number {
  if (movement.amountMicro < MIN_EVENT_MICRO) return 0
  if (terms.mode === 'percent') {
    if (movement.direction !== 'in' || terms.percent === null) return 0
    return centsOfMicro((movement.amountMicro * BigInt(terms.percent)) / 100n)
  }
  if (movement.direction !== 'out') return 0
  if (terms.mode === 'fixed') return terms.fixedUsd === null ? 0 : Math.round(terms.fixedUsd * 100)
  if (terms.roundToUsd === null) return 0
  const step = BigInt(Math.round(terms.roundToUsd)) * 1_000_000n
  const remainder = movement.amountMicro % step
  return remainder === 0n ? 0 : centsOfMicro(step - remainder)
}

/**
 * The sheet's example on the terms picked — a $3,40 payment, or a $100
 * incoming transfer for the per cent — and what the rule would set aside from
 * it, counted the way the tick counts it.
 */
export function exampleOf(
  terms: PaymentTerms,
): Readonly<{ direction: RulePaymentDirection; amountUsd: number; addUsd: number }> {
  const direction = directionOfMode(terms.mode)
  const amountUsd = PAYMENT_EXAMPLE_USD[direction]
  const addUsd = contributionCents(terms, { direction, amountMicro: BigInt(Math.round(amountUsd * 1_000_000)) }) / 100
  return { direction, amountUsd, addUsd }
}

/* ---- the request ---- */

/**
 * «З кожної оплати» as the server takes it (1.19.0): the terms and the phone's
 * own zone; the rule's sum is the least a reminder opens at — a dollar, or the
 * company's own minimum where a dollar does not route. «Умова ціни»: the
 * limit, or null for none; no key where the sheet said nothing of it.
 */
export function paymentsRequest(
  input: Readonly<{
    mint: string
    minimumUsd: number
    terms: PaymentTerms
    timeZone: string
    locale: Locale
    limitPct?: number | null
  }>,
): RuleCreateRequest {
  const { terms } = input
  return {
    asset: { mint: input.mint },
    amountUsd: Math.round(input.minimumUsd * 100) / 100,
    kind: 'payments',
    payments: {
      mode: terms.mode,
      roundToUsd: terms.roundToUsd,
      fixedUsd: terms.fixedUsd === null ? null : Math.round(terms.fixedUsd * 100) / 100,
      percent: terms.percent,
      timeZone: input.timeZone,
    },
    ...(input.limitPct === undefined
      ? {}
      : { priceCondition: input.limitPct === null ? null : { limitPct: input.limitPct } }),
    locale: input.locale,
  }
}

/* ---- a rule as it stands ---- */

/** The rule's «З кожної оплати» terms and what waits, or null for the other kinds. */
export function paymentsOf(rule: Pick<AutoinvestRule, 'payments'>): RulePayments | null {
  return rule.payments ?? null
}

/** The events the rule's sheet names — the newest first, as the server lists them — and whether each still waits for a reminder. */
export function shownEvents(payments: RulePayments): readonly Readonly<RulePaymentEvent & { waiting: boolean }>[] {
  return payments.events.slice(0, PAYMENT_EVENTS_SHOWN).map((event) => ({ ...event, waiting: event.dueAt === null }))
}

/** Whether the wallet's last read proved itself: nothing to say when it did (or before any), else why not. */
export function readNote(payments: RulePayments): 'partial' | 'unavailable' | null {
  const state = payments.read?.state
  return state === 'partial' || state === 'unavailable' ? state : null
}
