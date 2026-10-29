/**
 * The monitoring surface as the phone reads it — pure.
 *
 * The server owns every decision: which plan is watched, what needs
 * attention, which note exists, whether it was read. This module only turns
 * the server's records into what a screen draws and where a tap leads. A
 * note is information, never authorization: nothing here prepares, signs or
 * refreshes a trade; the exact plan opens and its own Review asks for
 * today's figures.
 */

import type { MonitoringCard, MonitoringNote, MonitoringSurface, QuietHours, TradingPlan } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { reminderOfNote } from '../autoinvest/rule-model.ts'

/** The `n` of the web's deep link `/app/alerts/open?n=<id>`: an inbox note or a monitor. */
export type NoteRef = Readonly<{ kind: 'note' | 'monitor'; id: string }>

const NOTE_ID = /^inb_[0-9a-f]{24}$/
const MONITOR_ID = /^mon_[0-9a-f]{24}$/

export function parseNoteRef(value: string | null | undefined): NoteRef | null {
  if (typeof value !== 'string') return null
  if (NOTE_ID.test(value)) return { kind: 'note', id: value }
  if (MONITOR_ID.test(value)) return { kind: 'monitor', id: value }
  return null
}

/** The `n` inside a web href such as `/app/alerts/open?n=inb_…`, or null when the href names no note. */
export function noteRefOfHref(href: string | null | undefined): NoteRef | null {
  if (typeof href !== 'string') return null
  const match = /[?&]n=((?:inb_|mon_)[0-9a-f]{24})(?:&|$)/.exec(href)
  return match ? parseNoteRef(match[1]) : null
}

/**
 * Where a note or a card leads on the phone.
 *
 * `plan` is the one owned plan the record speaks of. `choose` says the
 * surface names a plan only by its symbol (line A request 22) and more than
 * one of the wallet's plans wears it — the person picks, the phone never
 * guesses. `web` is a record the phone has no surface for (a paper
 * prediction plan until its row lands). `gone` is a plan no longer among
 * the wallet's plans. `unknown` is a note that is not in this wallet's inbox.
 */
export type NoteTarget =
  | Readonly<{ kind: 'plan'; planId: string; symbol: string }>
  | Readonly<{ kind: 'choose'; symbol: string; planIds: readonly string[] }>
  | Readonly<{ kind: 'web'; href: string }>
  | Readonly<{ kind: 'gone'; symbol: string | null }>
  | Readonly<{ kind: 'unknown' }>
  /** An autoinvest rule's reminder (M16): its company, with the rule and the occurrence — the rule is read afresh there. */
  | Readonly<{ kind: 'rule'; ruleId: string; dueAt: string | null; symbol: string | null }>
  /** The month's autoinvest budget, spent (1.13.0): Home, with the budget's sheet open — the note's one action, «Змінити бюджет». */
  | Readonly<{ kind: 'budget' }>
  /**
   * An issuer's window to swap a token the wallet holds (1.15.0, `issuer-event`; M19): the token's page with the
   * swap's sheet open — its one action, «Обміняти на SpaceX (SPCXx)»; the page reads the wallet afresh.
   */
  | Readonly<{ kind: 'issuer'; mint: string }>
  /**
   * A spot limit's note (1.42.0, `limit-order`; C3): «Ордер виконано» or «Квитанція готова» — «Мої ордери» on the
   * order its subject names, the same list the web shows; the note never signs anything.
   */
  | Readonly<{ kind: 'orders'; order: string }>
  /** A morning brief's note (1.46.0, `assistant-brief`, `id` the person's day): the brief, opened on that day. */
  | Readonly<{ kind: 'brief'; day: string }>
  /** A token watch's note (1.57.0, `token-watch`, `id` the watch): «Стежу» with that watch in view. */
  | Readonly<{ kind: 'watch'; watchId: string }>
  /** A «Доручення»'s note (1.59.0, `assistant-task`, `id` the task): the task's conversation, every run's answer. */
  | Readonly<{ kind: 'task'; taskId: string }>
  /**
   * A followed wallet's trade (1.63.0, `wallet-watch`, `id` the wallet): the phone has no «Гаманці», so the note itself
   * is shown, with its words and its token, and how the wallet's trades are told.
   */
  | Readonly<{ kind: 'walletWatch'; wallet: string }>

export type Resolved = Readonly<{
  target: NoteTarget
  note: MonitoringNote | null
  card: MonitoringCard | null
}>

export const WEB_ORIGIN = 'https://ryntra.io'

/** The web's own ownership-safe link for a record — the fallback when the phone has no surface for it. */
export function webHrefFor(ref: NoteRef): string {
  return `${WEB_ORIGIN}/app/alerts/open?n=${ref.id}`
}

export function cardsOf(surface: MonitoringSurface): readonly MonitoringCard[] {
  return [...surface.attention, ...surface.watching]
}

export function cardById(surface: MonitoringSurface, monitorId: string): MonitoringCard | null {
  return cardsOf(surface).find((card) => card.monitorId === monitorId) ?? null
}

export function noteById(surface: MonitoringSurface, noteId: string): MonitoringNote | null {
  return surface.recent.find((note) => note.id === noteId) ?? null
}

/**
 * The plan a card means. The card carries the plan's symbol, not its id; a
 * monitor stands for exactly one plan, so one plan on the symbol is that
 * plan. A card that is not paused watches an active plan, so the active
 * ones are asked first; a paused card means a draft or a closed plan.
 */
export function planForCard(card: MonitoringCard, plans: readonly TradingPlan[]): NoteTarget {
  if (card.paper) return { kind: 'web', href: webHrefFor({ kind: 'monitor', id: card.monitorId }) }
  const symbol = card.label
  const wearing = plans.filter((plan) => plan.asset.symbol === symbol)
  if (wearing.length === 0) return { kind: 'gone', symbol }
  if (wearing.length === 1) return { kind: 'plan', planId: wearing[0]!.id, symbol }
  const preferred =
    card.status === 'paused'
      ? wearing.filter((plan) => plan.status !== 'active')
      : wearing.filter((plan) => plan.status === 'active')
  if (preferred.length === 1) return { kind: 'plan', planId: preferred[0]!.id, symbol }
  const among = preferred.length > 1 ? preferred : wearing
  return { kind: 'choose', symbol, planIds: among.map((plan) => plan.id) }
}

/**
 * Where a note that is not a plan's leads (1.12.0–1.13.0): an autoinvest
 * reminder to its company's purchase under the rule; the month's autoinvest
 * budget, spent, to Home with the budget's sheet — as the web's own link does
 * (`/app/home?budget=edit`). Null for a plan's note — a rule is not a monitor,
 * so its reminder never names a plan.
 */
export function autoinvestTarget(note: MonitoringNote): NoteTarget | null {
  const reminder = reminderOfNote(note)
  if (reminder) return { kind: 'rule', ...reminder }
  if (note.subject?.kind === 'autoinvest-rule') return { kind: 'unknown' }
  if (note.subject?.kind === 'autoinvest-budget') return { kind: 'budget' }
  return null
}

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Where an issuer's event note leads (1.15.0): the token its subject names —
 * the page with the swap's sheet, as the web's own link opens it
 * (`/app/stocks/SPACEX?convert=1`). A note that names no token is unknown.
 * Null for any other note.
 */
export function issuerTarget(note: MonitoringNote): NoteTarget | null {
  if (note.subject?.kind !== 'issuer-event') return null
  const mint = note.subject.id
  return typeof mint === 'string' && MINT.test(mint) ? { kind: 'issuer', mint } : { kind: 'unknown' }
}

/**
 * Where a spot limit's note leads (1.42.0): «Мої ордери» on the order its
 * subject names (`id` the order account). A note that names no order is
 * unknown. Null for any other note.
 */
export function limitTarget(note: MonitoringNote): NoteTarget | null {
  if (note.subject?.kind !== 'limit-order') return null
  const order = note.subject.id
  return typeof order === 'string' && MINT.test(order) ? { kind: 'orders', order } : { kind: 'unknown' }
}

/**
 * Where a morning brief's note leads (1.46.0): Ryntra with the brief open — the note's own words are the brief's text,
 * there is no plan behind it to explain. Null for any other note.
 */
export function briefTarget(note: MonitoringNote): NoteTarget | null {
  if (note.subject?.kind !== 'assistant-brief') return null
  const day = note.subject.id
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? { kind: 'brief', day } : { kind: 'unknown' }
}

/**
 * Where a note of the assistant leads (1.57.0–1.63.0): a token watch's to «Стежу» on that watch, a task's to its
 * conversation, a followed wallet's to the note itself. A note that names nothing it can open is unknown. Null for
 * any other note.
 */
export function assistantTarget(note: MonitoringNote): NoteTarget | null {
  const id = note.subject?.id
  switch (note.subject?.kind) {
    case 'token-watch':
      return typeof id === 'string' && /^wch_[0-9a-f]{24}$/.test(id)
        ? { kind: 'watch', watchId: id }
        : { kind: 'unknown' }
    case 'assistant-task':
      return typeof id === 'string' && /^t_[0-9a-f]{12}$/.test(id) ? { kind: 'task', taskId: id } : { kind: 'unknown' }
    case 'wallet-watch':
      return typeof id === 'string' && MINT.test(id) ? { kind: 'walletWatch', wallet: id } : { kind: 'unknown' }
    default:
      return null
  }
}

/** The newest note of a followed wallet in the inbox — a push names the wallet, not the note. */
export function latestWalletNote(surface: MonitoringSurface, wallet: string): MonitoringNote | null {
  return (
    surface.recent
      .filter((note) => note.subject?.kind === 'wallet-watch' && note.subject.id === wallet)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  )
}

/** The phone's Home with the month's budget sheet open — where the budget's note and its Telegram button land. */
export const BUDGET_EDIT_PATH = '/(tabs)/home?budget=edit'

/** Resolve a deep link's `n` against the wallet's own surface and plans. */
export function resolveNote(ref: NoteRef, surface: MonitoringSurface, plans: readonly TradingPlan[]): Resolved {
  if (ref.kind === 'note') {
    const note = noteById(surface, ref.id)
    if (!note) return { target: { kind: 'unknown' }, note: null, card: null }
    const other =
      autoinvestTarget(note) ?? issuerTarget(note) ?? limitTarget(note) ?? briefTarget(note) ?? assistantTarget(note)
    if (other) return { target: other, note, card: null }
    const card = cardById(surface, note.monitorId)
    if (!card) {
      // The monitor is not on the surface any more; the note still names the label it was written for.
      if (note.paper) return { target: { kind: 'web', href: webHrefFor(ref) }, note, card: null }
      const wearing = plans.filter((plan) => plan.asset.symbol === note.context)
      const target: NoteTarget =
        wearing.length === 1
          ? { kind: 'plan', planId: wearing[0]!.id, symbol: note.context }
          : wearing.length > 1
            ? { kind: 'choose', symbol: note.context, planIds: wearing.map((plan) => plan.id) }
            : { kind: 'gone', symbol: note.context || null }
      return { target, note, card: null }
    }
    return { target: planForCard(card, plans), note, card }
  }
  const card = cardById(surface, ref.id)
  if (!card) return { target: { kind: 'unknown' }, note: null, card: null }
  return { target: planForCard(card, plans), note: null, card }
}

/** The unread count is the server's; the notes are only checked when the server said nothing. */
export function unreadCount(surface: MonitoringSurface | null | undefined): number {
  if (!surface) return 0
  if (typeof surface.unread === 'number' && Number.isFinite(surface.unread)) return Math.max(0, surface.unread)
  return surface.recent.filter((note) => note.unread).length
}

/** The one unread note a card is showing — the note its `href` opens — or null when the card shows its status alone. */
export function unreadNoteOfCard(card: MonitoringCard, surface: MonitoringSurface): MonitoringNote | null {
  const ref = noteRefOfHref(card.href)
  if (!ref || ref.kind !== 'note') return null
  const note = noteById(surface, ref.id)
  return note && note.unread ? note : null
}

/** The last time the server checked any of the wallet's monitors, or null. */
export function lastCheckedAt(surface: MonitoringSurface | null | undefined): string | null {
  if (!surface) return null
  let latest: string | null = null
  for (const card of cardsOf(surface)) {
    if (card.lastCheckedAt && (!latest || card.lastCheckedAt > latest)) latest = card.lastCheckedAt
  }
  return latest
}

/* ---- quiet hours ---- */

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** The contract's own rule: `HH:MM` twice and a timezone of at most 64 characters. */
export function isValidQuietHours(value: QuietHours | null | undefined): value is QuietHours {
  if (!value) return false
  return (
    CLOCK.test(value.start) &&
    CLOCK.test(value.end) &&
    typeof value.timezone === 'string' &&
    value.timezone.length > 0 &&
    value.timezone.length <= 64
  )
}

/** `9:5` → `09:05`; anything that is not a clock time stays as typed, for the field to refuse. */
export function normalizeClock(value: string): string {
  const match = /^\s*(\d{1,2})[:.](\d{1,2})\s*$/.exec(value) ?? /^\s*(\d{1,2})(\d{2})\s*$/.exec(value)
  if (!match) return value.trim()
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return value.trim()
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** The device's IANA timezone, as the contract wants it; UTC when the runtime does not say. */
export function deviceTimezone(
  resolved: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const zone = resolved()
    return typeof zone === 'string' && zone.length > 0 && zone.length <= 64 ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

export const QUIET_PRESETS: readonly Readonly<{ start: string; end: string }>[] = [
  { start: '22:00', end: '07:00' },
  { start: '23:00', end: '08:00' },
  { start: '00:00', end: '09:00' },
]

function minutesOnClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function localMinutes(nowMs: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}

/** True when `nowMs` falls inside the window in its timezone — the server's rule, mirrored for the "quiet now" chip only. */
export function inQuietHours(nowMs: number, hours: QuietHours | null | undefined): boolean {
  if (!isValidQuietHours(hours)) return false
  const local = localMinutes(nowMs, hours.timezone)
  if (local === null) return false
  const start = minutesOnClock(hours.start)
  const end = minutesOnClock(hours.end)
  if (start === end) return false
  if (start < end) return local >= start && local < end
  return local >= start || local < end
}

/** `22:00–07:00` — the window as a figure; the timezone travels beside it when it is not the device's own. */
export function quietHoursText(hours: QuietHours | null | undefined): string | null {
  if (!isValidQuietHours(hours)) return null
  return `${hours.start}–${hours.end}`
}

/** The language a note was written in, when the server says and it is not the one on screen (request 20). */
export function noteLanguageMismatch(note: MonitoringNote, locale: Locale): boolean {
  return typeof note.locale === 'string' && note.locale !== locale
}

/**
 * The phone's own names for the places the server's words still call by the web's: a spot limit's note says
 * «Мої ордери» / «My orders» (1.42.0), and on the phone that place is «Ордери» / «Orders» — «Портфель · Ордери»
 * (NEW-LOOK §3, one name per thing). The server keeps its words for the web; request 57 (a) asks it for the phone's.
 */
export function phonePlaceNames(text: string): string {
  return text.replace(/Мої ордери/g, 'Ордери').replace(/\bMy orders\b/g, 'Orders')
}

/**
 * A note's words in the reader's language, where the server keeps them in both
 * (a reminder is written in its rule's language; `text` carries the other);
 * otherwise the words as written, and whether they are in another language —
 * the places named as the phone names them.
 */
export function noteWords(
  note: MonitoringNote,
  locale: Locale,
): Readonly<{ title: string; reason: string; foreign: boolean }> {
  const own = note.text?.[locale]
  if (own && typeof own.title === 'string' && own.title.length > 0)
    return {
      title: phonePlaceNames(own.title),
      reason: typeof own.reason === 'string' ? phonePlaceNames(own.reason) : '',
      foreign: false,
    }
  return {
    title: phonePlaceNames(note.title),
    reason: phonePlaceNames(note.reason),
    foreign: noteLanguageMismatch(note, locale),
  }
}
