/**
 * The «Кредити» tab's pure rules: what a package says, which entries of the history are shown, an order's state in
 * words, when an order is read again and when it may be paid, and when the badge shows. Nothing here counts credits —
 * every figure is the server's; nothing here signs.
 */

import type {
  AssistantCreditEntry,
  AssistantCreditOrder,
  AssistantCreditPackage,
  AssistantCredits,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatAt, formatClock, formatCount, localizeFigures, shortAddress } from '../../utils/format.ts'
import { creditsText } from './credits-model.ts'
import type { CreditsCopy } from './credits-copy.ts'

/** An order on screen is read again every four seconds while a payment can still arrive. */
export const ORDER_POLL_MS = 4_000
/** After the order's window it is read a little longer — a payment signed at the last second still lands. */
export const ORDER_POLL_AFTER_MS = 5 * 60_000

/* ── Packages ───────────────────────────────────────────────────────── */

export type PackageLabel = Readonly<{ price: string; credits: string; bonus: string | null }>

/** One package as its tile reads: «$5», «5 500 кредитів», «+10 %» — the server's figures, never computed here. */
export function packageLabel(pkg: AssistantCreditPackage, locale: Locale): PackageLabel {
  return {
    price: `$${localizeFigures(pkg.usdc, locale)}`,
    credits: creditsText(pkg.credits, locale),
    bonus: pkg.bonusPercent > 0 ? `+${pkg.bonusPercent} %` : null,
  }
}

/* ── The balance ────────────────────────────────────────────────────── */

/** The day's ceiling is said only when the day's spend is near it: four fifths or more. */
export function nearDayCap(credits: AssistantCredits): boolean {
  const { used, cap } = credits.dailySpend
  return cap > 0 && used >= cap * 0.8
}

/** How many free questions a day pays for — `floor(free.daily / prices.question)`; 0 when a question is free. */
export function freeQuestionsDaily(credits: AssistantCredits): number {
  return credits.prices.question > 0 ? Math.floor(credits.free.daily / credits.prices.question) : 0
}

/* ── The history ────────────────────────────────────────────────────── */

/** A hold and its release net to nothing: the history shows what was added, spent and moved — as the web does. */
export function entryShown(entry: AssistantCreditEntry): boolean {
  return (
    entry.kind === 'grant' ||
    ((entry.kind === 'merge-in' || entry.kind === 'merge-out') && entry.credits !== 0) ||
    (entry.kind === 'capture' && (entry.charged ?? 0) > 0)
  )
}

export function shownEntries(entries: readonly AssistantCreditEntry[], limit = 30): AssistantCreditEntry[] {
  return entries.filter(entryShown).slice(0, limit)
}

/** What an entry moved: a capture is what was charged, taken away; anything else its credits as they came. */
export function entryDelta(entry: AssistantCreditEntry): number {
  return entry.kind === 'capture' ? -(entry.charged ?? 0) : entry.credits
}

/** «+500», «−20», «0» in the language's digits. */
export function entryAmount(entry: AssistantCreditEntry, locale: Locale): string {
  const value = entryDelta(entry)
  if (value > 0) return `+${formatCount(value, locale)}`
  if (value < 0) return `−${formatCount(-value, locale)}`
  return '0'
}

/** An entry in words: «Куплено», «Списано · Питання», «Додано · вітальні». */
export function entryLabel(entry: AssistantCreditEntry, copy: CreditsCopy): string {
  if (entry.kind === 'merge-out' && entry.reason === 'welcome') return copy.entrySecondWelcome
  if (entry.kind === 'grant' && entry.reason === 'purchase') return copy.entryPurchase
  const kind = copy.entry[entry.kind]
  if (entry.action) return `${kind} · ${copy.priceRows[entry.action]}`
  if (entry.kind === 'grant' && entry.reason) return `${kind} · ${copy.reason[entry.reason]}`
  return kind
}

/* ── An order ───────────────────────────────────────────────────────── */

/**
 * Whether a payment of this order left the phone and its final word is not in yet: «Підписати в гаманці» is held back
 * for the server's window, and the order is read meanwhile whatever its status says.
 */
export function payHeld(heldAt: number | null | undefined, now: number, holdMs: number): boolean {
  return heldAt != null && now - heldAt < holdMs
}

/**
 * Whether the order is read again: never once paid; while it waits or is checked, until a little past its window;
 * once expired or short, only while a payment of ours is still out without its final word.
 */
export function orderPolls(order: AssistantCreditOrder, now: number, held: boolean): boolean {
  if (order.status === 'paid') return false
  if (held) return true
  if (order.status === 'awaiting' || order.status === 'checking') {
    const ends = Date.parse(order.expiresAt)
    return Number.isNaN(ends) || now < ends + ORDER_POLL_AFTER_MS
  }
  return false
}

/**
 * Whether «Підписати в гаманці» is offered: the order waits, nothing has arrived for it, its window is open, and no
 * payment of ours is out — so it is never paid twice.
 */
export function orderPayable(order: AssistantCreditOrder, now: number, held: boolean): boolean {
  if (held) return false
  if (order.status !== 'awaiting' || order.payments.length > 0 || /[1-9]/.test(order.received.raw)) return false
  const ends = Date.parse(order.expiresAt)
  return !Number.isNaN(ends) && now < ends
}

/** Whole minutes left in the order's window, rounded up; null once it closed or when the time is not a time. */
export function minutesLeft(order: AssistantCreditOrder, now: number): number | null {
  const ends = Date.parse(order.expiresAt)
  if (Number.isNaN(ends) || ends <= now) return null
  return Math.ceil((ends - now) / 60_000)
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export function orderTone(order: AssistantCreditOrder): StatusTone {
  if (order.status === 'paid') return 'success'
  if (order.status === 'underpaid' || order.status === 'checking') return 'warning'
  return 'neutral'
}

/** The order's state in one line, the web's words: what arrived, what was credited, what to expect. */
export function orderStatusLine(order: AssistantCreditOrder, copy: CreditsCopy, locale: Locale): string {
  switch (order.status) {
    case 'paid':
      return copy.credited(creditsText(order.credited, locale))
    case 'underpaid':
      return copy.underpaid(
        localizeFigures(order.received.display, locale),
        localizeFigures(order.amount.display, locale),
        creditsText(order.credited, locale),
      )
    case 'checking':
      return copy.checking
    case 'expired':
      return copy.expired
    case 'awaiting':
      return copy.awaitingUntil(formatClock(order.expiresAt))
  }
}

/** The order's title: «5 USDC — 5 500 кредитів». */
export function orderTitle(order: AssistantCreditOrder, copy: CreditsCopy, locale: Locale): string {
  return copy.orderTitle(localizeFigures(order.amount.display, locale), creditsText(order.package.credits, locale))
}

/** A receipt's line for one payment: «5 USDC · 4kQ2…9xYz», its time apart. */
export function paymentLine(payment: AssistantCreditOrder['payments'][number], locale: Locale): string {
  return `${localizeFigures(payment.amount, locale)} USDC · ${shortAddress(payment.signature)}`
}

export function paymentTime(payment: AssistantCreditOrder['payments'][number], now: number, locale: Locale): string {
  return payment.at ? formatAt(payment.at, now, locale) : DASH
}

/** The orders as they are now: `order` in place of its older copy, or first when it is new. */
export function withOrder(
  orders: readonly AssistantCreditOrder[],
  order: AssistantCreditOrder,
): AssistantCreditOrder[] {
  return orders.some((entry) => entry.id === order.id)
    ? orders.map((entry) => (entry.id === order.id ? order : entry))
    : [order, ...orders]
}

/** The order to show when none was named: the newest one a payment can still arrive for. */
export function openOrderOf(orders: readonly AssistantCreditOrder[], now: number): AssistantCreditOrder | null {
  return orders.find((order) => order.status !== 'paid' && orderPolls(order, now, false)) ?? null
}

/** Whether a read of an order added credits the screen has not taken in yet. */
export function creditedMore(before: number | undefined, after: number): boolean {
  return before === undefined ? after > 0 : after > before
}

/* ── Refusals ───────────────────────────────────────────────────────── */

export type OrderRefusal = 'orderLimit' | 'buyClosed' | 'orderFailed'

export function orderRefusalOf(code: string | null): OrderRefusal {
  if (code === 'RATE_LIMITED') return 'orderLimit'
  if (code === 'CAPABILITY_UNAVAILABLE') return 'buyClosed'
  return 'orderFailed'
}

export type WelcomeRefusal = 'welcomeTaken' | 'welcomeNo' | 'welcomeLater'

/** A refusal of the welcome credits; taken and not eligible are final — the ask is not offered again. */
export function welcomeRefusalOf(code: string | null): Readonly<{ key: WelcomeRefusal; final: boolean }> {
  if (code === 'WELCOME_TAKEN') return { key: 'welcomeTaken', final: true }
  if (code === 'WELCOME_NOT_ELIGIBLE') return { key: 'welcomeNo', final: true }
  return { key: 'welcomeLater', final: false }
}

/* ── The badge ──────────────────────────────────────────────────────── */

/** The badge shows only for a proven wallet whose balance is above zero; an unknown balance shows nothing. */
export function badgeVisible(proven: boolean, credits: AssistantCredits | null | undefined): boolean {
  return proven && credits != null && Number.isFinite(credits.balance) && credits.balance > 0
}

/** The balance in the room of a word: «950», «9 500», «28,7 тис.» / «28.7K». */
export function badgeText(balance: number, locale: Locale): string {
  if (balance < 10_000) return formatCount(balance, locale)
  if (balance < 1_000_000) {
    const tenths = Math.floor(balance / 100) / 10
    const figure = new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 1 }).format(
      tenths,
    )
    return locale === 'uk' ? `${figure} тис.` : `${figure}K`
  }
  const tenths = Math.floor(balance / 100_000) / 10
  const figure = new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 1 }).format(tenths)
  return locale === 'uk' ? `${figure} млн` : `${figure}M`
}
