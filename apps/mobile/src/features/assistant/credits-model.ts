import type { AssistantCredits } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { formatCount } from '../../utils/format.ts'

/** «кредит · кредити · кредитів» by the number; «credit · credits» in English. */
export function creditUnit(count: number, locale: Locale): string {
  if (locale !== 'uk') return count === 1 ? 'credit' : 'credits'
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return 'кредит'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'кредити'
  return 'кредитів'
}

/** A count of credits as a person reads it: «2 кредити», «1 500 credits». */
export function creditsText(count: number, locale: Locale): string {
  return `${formatCount(count, locale)} ${creditUnit(count, locale)}`
}

/**
 * Whether a paid action at `price` can be paid now, and from what: the day's free credits, the balance, or neither —
 * the free ones first, as the server spends them; the day's ceiling counts the balance's part only.
 */
export type PaidBy =
  | Readonly<{ kind: 'free' }>
  | Readonly<{ kind: 'balance'; rest: number }>
  | Readonly<{ kind: 'short' }>
  | Readonly<{ kind: 'dayCap'; resetsAt: string }>

export function paidBy(credits: AssistantCredits, price: number): PaidBy {
  const rest = Math.max(0, price - Math.max(0, credits.free.left))
  if (rest === 0) return { kind: 'free' }
  if (rest > credits.balance) return { kind: 'short' }
  if (credits.dailySpend.used + rest > credits.dailySpend.cap) return { kind: 'dayCap', resetsAt: credits.dailySpend.resetsAt }
  return { kind: 'balance', rest }
}

/** Roughly how many questions the balance pays for — `floor(balance / prices.question)`; null when a question is free. */
export function questionsOf(credits: AssistantCredits): number | null {
  return credits.prices.question > 0 ? Math.floor(credits.balance / credits.prices.question) : null
}
