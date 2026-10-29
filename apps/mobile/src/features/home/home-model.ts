/**
 * Home as values — pure. Home answers one question: what changed, and what
 * needs a look. Nothing here reads the network or decides anything the
 * server owns: the monitoring's cards, the plans, the holdings and the
 * market rows arrive as the other features already read them, and this
 * module only orders them into the blocks a screen draws — the unfinished
 * operation first, then the plans that need a look, the portfolio in one
 * line, the active plans, the watchlist's moves, and a short, deterministic
 * list of what changed since the person last looked, each line with the
 * place it leads to. An unknown figure is a dash, a period is named, and a
 * plan the surface cannot pin to one record is said to be shared — never
 * guessed.
 */

import type { MarketRow, MonitoringCard, MonitoringSurface, Session, TradingPlan } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatUsd, isToday } from '../../utils/format.ts'
import { planForCard, type NoteTarget } from '../monitoring/monitoring-model.ts'
import { entryExpired, groupPlans, plansForCard } from '../plans/plan-model.ts'
import type { DayChange, PortfolioView } from '../portfolio/portfolio-model.ts'
import type { TradeAttempt } from '../trade/trade-model.ts'

/* ---- the account as Home sees it ---- */

/** Guest (no wallet), connected (an address, no live session — public reads only), signed in (the bearer stands). */
export type AccountState = 'guest' | 'connected' | 'signed-in'

export function accountState(address: string | null, session: Session | null): AccountState {
  if (!address) return 'guest'
  return session ? 'signed-in' : 'connected'
}

/* ---- what needs attention ---- */

export type AttentionItem =
  /** A signature the wallet gave whose outcome is not known — M3's recovery, checked before anything else. */
  | Readonly<{ kind: 'recovery'; attempt: TradeAttempt }>
  /**
   * The monitoring's own card. `plans` are the wallet's active plans that
   * wear the card's symbol; `shared` says more than one does, so the card
   * cannot name one plan (line A request 22) and the person chooses.
   */
  | Readonly<{ kind: 'card'; card: MonitoringCard; plans: readonly TradingPlan[]; shared: boolean; target: NoteTarget }>
  /** An active plan whose entry rule has run out: its Review refuses until a new version. */
  | Readonly<{ kind: 'entry-expired'; plan: TradingPlan }>

export type AttentionInput = Readonly<{
  attempt: TradeAttempt | null
  surface: MonitoringSurface | null
  plans: readonly TradingPlan[] | null
  now: number
}>

/**
 * The attention list in the order it is acted on: the unfinished operation,
 * the server's attention cards (a card of a plan the wallet holds, paper
 * cards after — they open on ryntra.io), then the entry rules that expired
 * on plans no card already speaks of.
 */
export function attentionItems(input: AttentionInput): readonly AttentionItem[] {
  const items: AttentionItem[] = []
  if (input.attempt && input.attempt.state !== 'SETTLED') items.push({ kind: 'recovery', attempt: input.attempt })
  const plans = input.plans ?? []
  const cards = input.surface?.attention ?? []
  const spoken = new Set<string>()
  const owned = cards.filter((card) => !card.paper && plansForCard(card, plans).length > 0)
  const paper = cards.filter((card) => card.paper)
  for (const card of [...owned, ...paper]) {
    const wearing = plansForCard(card, plans)
    spoken.add(card.label)
    items.push({
      kind: 'card',
      card,
      plans: wearing,
      shared: wearing.length > 1,
      target: planForCard(card, plans),
    })
  }
  for (const plan of groupPlans(plans).active) {
    if (spoken.has(plan.asset.symbol)) continue
    if (entryExpired(plan, input.now)) items.push({ kind: 'entry-expired', plan })
  }
  return items
}

/* ---- the last look: the device's own record of when the person last looked, and what the figures were ---- */

export type LastLook = Readonly<{
  /** When the person last left Home (the device's clock, ISO). */
  at: string
  /** The prices the watchlist rows showed then, by mint — positive finite figures only. */
  prices: Readonly<Record<string, number>>
}>

const LAST_LOOK_LIMIT = 200
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** The snapshot to keep when leaving Home: only mints with a usable price, at most the watchlist's own limit. */
export function lastLookOf(at: string, rows: readonly Readonly<{ mint: string; price: number | null }>[]): LastLook {
  const prices: Record<string, number> = {}
  let count = 0
  for (const row of rows) {
    if (count >= LAST_LOOK_LIMIT) break
    if (!MINT.test(row.mint)) continue
    if (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0) continue
    prices[row.mint] = row.price
    count += 1
  }
  return { at, prices }
}

export function serializeLastLook(look: LastLook): string {
  return JSON.stringify(look)
}

/** Whatever the store held, back into a snapshot — or null, never a crash. */
export function parseLastLook(stored: string | null | undefined): LastLook | null {
  if (!stored) return null
  try {
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) return null
    if (!raw.prices || typeof raw.prices !== 'object') return null
    const prices: Record<string, number> = {}
    for (const [mint, price] of Object.entries(raw.prices as Record<string, unknown>)) {
      if (MINT.test(mint) && typeof price === 'number' && Number.isFinite(price) && price > 0) prices[mint] = price
    }
    return { at: raw.at, prices }
  } catch {
    return null
  }
}

/** The change of one price since the last look, in percent; null when either figure is unknown. */
export function changeSince(look: LastLook | null, mint: string, price: number | null | undefined): number | null {
  if (!look) return null
  const then = look.prices[mint]
  if (typeof then !== 'number' || then <= 0) return null
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null
  return ((price - then) / then) * 100
}

/** The period a move is measured over — the last look when the device holds one, the venue's 24 hours otherwise. */
export type MovePeriod = Readonly<{ kind: 'since'; at: string }> | Readonly<{ kind: '24h' }>

export function movePeriod(look: LastLook | null): MovePeriod {
  return look ? { kind: 'since', at: look.at } : { kind: '24h' }
}

/* ---- the watchlist's moves ---- */

export type WatchMove = Readonly<{
  row: MarketRow
  /** The move over the period; null when the period is the last look and the row was not priced then. */
  pct: number | null
  /** The venue's own 24-hour move, always beside it. */
  dayPct: number | null
}>

const magnitude = (value: number | null): number => (value === null ? Number.NEGATIVE_INFINITY : Math.abs(value))

/**
 * The watchlist's rows ordered by the size of their move over the period,
 * the biggest first and the unknown last; `limit` rows at most.
 */
export function watchlistMoves(rows: readonly MarketRow[], look: LastLook | null, limit: number): readonly WatchMove[] {
  const moves = rows.map((row): WatchMove => ({
    row,
    pct: look ? changeSince(look, row.mint, row.price) : (row.change24hPct ?? null),
    dayPct: row.change24hPct ?? null,
  }))
  return moves.sort((a, b) => magnitude(b.pct) - magnitude(a.pct)).slice(0, Math.max(0, limit))
}

/* ---- the brief: what changed, deterministic, each line with a door ---- */

export type BriefLine =
  | Readonly<{ kind: 'notes'; count: number; since: string | null }>
  | Readonly<{ kind: 'plan'; plan: TradingPlan }>
  | Readonly<{ kind: 'portfolio'; change: DayChange; total: number | null }>
  | Readonly<{ kind: 'watch'; move: WatchMove; period: MovePeriod }>
  | Readonly<{ kind: 'coverage'; coverage: PortfolioView['coverage'] }>

export type BriefInput = Readonly<{
  look: LastLook | null
  surface: MonitoringSurface | null
  plans: readonly TradingPlan[] | null
  portfolio: PortfolioView | null
  moves: readonly WatchMove[]
  now: number
}>

const BRIEF_PLANS = 3
const BRIEF_MOVES = 2
/** A watchlist move under this is not a change worth a line. */
const MOVE_FLOOR_PCT = 0.5

function after(iso: string, since: string | null): boolean {
  if (!since) return true
  const a = Date.parse(iso)
  const b = Date.parse(since)
  return Number.isFinite(a) && Number.isFinite(b) && a > b
}

/**
 * What changed, in the order a person reads it: the notes the wallet has
 * not read (the ones since the last look when the device holds one), the
 * plans that changed since then, the portfolio's day, the biggest
 * watchlist moves, and a holdings read that could not see everything.
 * Nothing is inferred: a line exists only where the data does.
 */
export function briefLines(input: BriefInput): readonly BriefLine[] {
  const lines: BriefLine[] = []
  const since = input.look?.at ?? null

  if (input.surface) {
    const unread = input.surface.recent.filter((note) => note.unread)
    const fresh = since ? unread.filter((note) => after(note.createdAt, since)) : unread
    const count = fresh.length > 0 ? fresh.length : unread.length
    if (count > 0) lines.push({ kind: 'notes', count, since: fresh.length > 0 ? since : null })
  }

  if (input.plans && since) {
    const changed = [...input.plans]
      .filter((plan) => after(plan.updatedAt, since))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, BRIEF_PLANS)
    for (const plan of changed) lines.push({ kind: 'plan', plan })
  }

  // A day's move belongs to its day: a read kept from an earlier day says nothing about today (M9).
  if (input.portfolio?.dayChange && isToday(input.portfolio.observedAt, input.now)) {
    lines.push({ kind: 'portfolio', change: input.portfolio.dayChange, total: input.portfolio.total })
  }

  const period = movePeriod(input.look)
  for (const move of input.moves
    .filter((move) => move.pct !== null && Math.abs(move.pct) >= MOVE_FLOOR_PCT)
    .slice(0, BRIEF_MOVES)) {
    lines.push({ kind: 'watch', move, period })
  }

  if (input.portfolio && input.portfolio.coverage !== 'COMPLETE') {
    lines.push({ kind: 'coverage', coverage: input.portfolio.coverage })
  }

  return lines
}

/* ---- trending: the three classes among the ranked list ---- */

export type TrendingClass = 'stock' | 'crypto' | 'meme'
export const TRENDING_CLASSES: readonly TrendingClass[] = ['stock', 'crypto', 'meme']

/**
 * The biggest 24-hour movers of each class among the venue's ranked rows —
 * verified rows only, nothing flagged, a finite move required. An empty
 * class stays empty; nothing is filled in from elsewhere.
 */
export function trending(
  rows: readonly MarketRow[],
  perClass = 3,
): Readonly<Record<TrendingClass, readonly MarketRow[]>> {
  const pick = (category: TrendingClass) =>
    rows
      .filter(
        (row) =>
          row.category === category &&
          row.verified &&
          !row.suspicious &&
          typeof row.change24hPct === 'number' &&
          Number.isFinite(row.change24hPct),
      )
      .sort((a, b) => Math.abs(b.change24hPct!) - Math.abs(a.change24hPct!))
      .slice(0, Math.max(0, perClass))
  return { stock: pick('stock'), crypto: pick('crypto'), meme: pick('meme') }
}

/** Trending is for a person with nothing of their own to watch yet — a guest, or a wallet without an active plan. */
export function showTrending(state: AccountState, activePlans: number): boolean {
  return state === 'guest' || activePlans === 0
}

/* ---- the plans block ---- */

export type PlansBlock = Readonly<{
  active: readonly TradingPlan[]
  activeTotal: number
  drafts: number
  total: number
}>

const HOME_PLANS = 3

/** The active plans, newest change first, three at most; the counts say what the list leaves out. */
export function plansBlock(plans: readonly TradingPlan[]): PlansBlock {
  const groups = groupPlans(plans)
  return {
    active: groups.active.slice(0, HOME_PLANS),
    activeTotal: groups.active.length,
    drafts: groups.drafts.length,
    total: plans.length,
  }
}

/* ---- amounts on a screen that may be read over a shoulder ---- */

export const HIDDEN_AMOUNT = '••••'

/** A USD figure as Home shows it: hidden when the person asked, a dash when unknown. */
export function money(value: number | null | undefined, hidden: boolean, locale: Locale): string {
  if (hidden) return HIDDEN_AMOUNT
  return formatUsd(value, locale)
}

/* ---- freshness ---- */

/** The latest of the times the blocks carry, or null when none is known — the header's "as of". */
export function freshestAt(...times: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null
  for (const time of times) {
    if (!time || !Number.isFinite(Date.parse(time))) continue
    if (!latest || Date.parse(time) > Date.parse(latest)) latest = time
  }
  return latest
}

export { DASH }
