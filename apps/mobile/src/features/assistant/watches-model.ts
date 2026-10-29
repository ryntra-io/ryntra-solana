/**
 * «Стежу» as values — pure (1.57.0). A watch is the person's own threshold on a token, judged on the server without a
 * model; this module only holds the form as typed, turns it into a rule the server accepts (or says which figure is
 * out of range), says where alerts may go, and names a refusal in the app's terms. Nothing here reads the network,
 * signs or spends.
 */

import { ApiError } from '../../lib/api.ts'
import type {
  AssistantWatch,
  AssistantWatchCreate,
  AssistantWatchPreset,
  AssistantWatchRule,
  AssistantWatchState,
  AssistantWatchesResponse,
} from '../../lib/api/v1/types.ts'

export type WatchKind = AssistantWatchRule['kind']

/** The rule as the form holds it: every figure a string while typed, a rule once it holds. */
export type WatchDraft = Readonly<{
  kind: WatchKind
  direction: 'below' | 'above'
  level: string
  window: 'm5' | 'h1' | 'h24'
  move: 'down' | 'up' | 'any'
  pct: string
  factor: string
  liqWindow: 'h1' | 'h24'
  liq: 'drop' | 'rise' | 'any'
  liqPct: string
  pool: string
}>

/** «Детально» opens on the web's own start: a 10 % fall over 24 hours. */
export const EMPTY_DRAFT: WatchDraft = {
  kind: 'move',
  direction: 'below',
  level: '',
  window: 'h24',
  move: 'down',
  pct: '10',
  factor: '3',
  liqWindow: 'h1',
  liq: 'drop',
  liqPct: '30',
  pool: '',
}

/** A watch's rule back into the form — «Змінити» on a card starts from what the watch holds. */
export function draftOf(rule: AssistantWatchRule): WatchDraft {
  switch (rule.kind) {
    case 'price':
      return { ...EMPTY_DRAFT, kind: 'price', direction: rule.direction, level: String(rule.level) }
    case 'move':
      return { ...EMPTY_DRAFT, kind: 'move', window: rule.window, move: rule.direction, pct: String(rule.pct) }
    case 'volume':
      return { ...EMPTY_DRAFT, kind: 'volume', factor: String(rule.factor) }
    case 'liquidity':
      return {
        ...EMPTY_DRAFT,
        kind: 'liquidity',
        liqWindow: rule.window,
        liq: rule.direction,
        liqPct: String(rule.pct),
        pool: rule.pool ?? '',
      }
  }
}

/** A typed figure as a number: a comma is a decimal point, spaces are thousands; NaN when it is not a figure. */
export function numberOf(text: string): number {
  const cleaned = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (cleaned === '' || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return Number.NaN
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : Number.NaN
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A Solana address as typed or pasted. */
export function isAddress(text: string): boolean {
  return ADDRESS.test(text.trim())
}

/** The figure of the draft that is out of the server's range, or null when the draft holds. */
export type DraftProblem = 'level' | 'pct' | 'factor' | 'liqPct' | 'pool'

export function draftProblem(draft: WatchDraft): DraftProblem | null {
  switch (draft.kind) {
    case 'price': {
      const level = numberOf(draft.level)
      return level > 0 && level <= 1e12 ? null : 'level'
    }
    case 'move': {
      const pct = numberOf(draft.pct)
      return pct >= 0.5 && pct <= 1_000 ? null : 'pct'
    }
    case 'volume': {
      const factor = numberOf(draft.factor)
      return factor >= 1.5 && factor <= 100 ? null : 'factor'
    }
    case 'liquidity': {
      const pool = draft.pool.trim()
      if (pool && !ADDRESS.test(pool)) return 'pool'
      const pct = numberOf(draft.liqPct)
      return pct >= 5 && pct <= 100 ? null : 'liqPct'
    }
  }
}

/** The rule the draft holds, as the server's schema takes it; null while a figure is out of range. */
export function ruleOf(draft: WatchDraft): AssistantWatchRule | null {
  if (draftProblem(draft) !== null) return null
  switch (draft.kind) {
    case 'price':
      return { kind: 'price', direction: draft.direction, level: numberOf(draft.level) }
    case 'move':
      return { kind: 'move', window: draft.window, direction: draft.move, pct: numberOf(draft.pct) }
    case 'volume':
      return { kind: 'volume', factor: numberOf(draft.factor) }
    case 'liquidity':
      return {
        kind: 'liquidity',
        window: draft.liqWindow,
        direction: draft.liq,
        pct: numberOf(draft.liqPct),
        pool: draft.pool.trim() || null,
      }
  }
}

/** The figure to mark under its field: only one the person has typed into — an empty field is not yet wrong. */
export function shownProblem(draft: WatchDraft): DraftProblem | null {
  const problem = draftProblem(draft)
  if (problem === null) return null
  const typed: Readonly<Record<DraftProblem, string>> = {
    level: draft.level,
    pct: draft.pct,
    factor: draft.factor,
    liqPct: draft.liqPct,
    pool: draft.pool,
  }
  return typed[problem].trim() === '' ? null : problem
}

/** The pauses between alerts the form offers, in minutes. */
export const COOLDOWNS = [15, 60, 240, 1_440] as const
export type Cooldown = (typeof COOLDOWNS)[number]
export const DEFAULT_COOLDOWN: Cooldown = 60

/** A watch's pause as one of the offered ones — the nearest, for a pause set elsewhere (5 min on the web's API). */
export function cooldownChoice(minutes: number): Cooldown {
  let best: Cooldown = DEFAULT_COOLDOWN
  for (const choice of COOLDOWNS) if (Math.abs(choice - minutes) < Math.abs(best - minutes)) best = choice
  return best
}

export type Channels = Readonly<{ telegram: boolean; push: boolean }>

/**
 * Where an alert may go besides the Inbox: only a channel the answer says is connected is offered; the rest are named
 * in one quiet line, never as a switch that does nothing.
 */
export function channelOffer(
  available: Channels,
): Readonly<{ telegram: boolean; push: boolean; missing: readonly string[] }> {
  const missing: string[] = []
  if (!available.telegram) missing.push('Telegram')
  if (!available.push) missing.push('Push')
  return { telegram: available.telegram, push: available.push, missing }
}

/** What is sent: a channel is on only when chosen and connected. */
export function channelsToSend(chosen: Channels, available: Channels): Channels {
  return { telegram: chosen.telegram && available.telegram, push: chosen.push && available.push }
}

/** The tokens most people start from, by mint — a press instead of a search (the web's own four). */
export const QUICK_TOKENS: readonly Readonly<{ symbol: string; mint: string }>[] = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
]

/** «Коли написати»: a server preset by its id, or «Детально» — the person's own rule. */
export type WatchChoice =
  Readonly<{ kind: 'preset'; preset: AssistantWatchPreset }> | Readonly<{ kind: 'rule'; draft: WatchDraft }>

/** The new watch's request — null until a token is chosen and the rule holds. */
export function createBody(
  mint: string | null,
  choice: WatchChoice,
  cooldownMinutes: number,
  channels: Channels,
  locale: 'en' | 'uk',
): AssistantWatchCreate | null {
  if (!mint) return null
  if (choice.kind === 'preset') return { mint, preset: choice.preset, cooldownMinutes, channels, locale }
  const rule = ruleOf(choice.draft)
  return rule ? { mint, rule, cooldownMinutes, channels, locale } : null
}

/** How many watches run now — paused ones do not. */
export function activeCount(read: AssistantWatchesResponse | null | undefined): number {
  return read ? read.watches.filter((watch) => watch.status === 'active').length : 0
}

/** The note's watch (`?watch=wch_…`) when this wallet still has it; `all`, null or a stranger's id — nothing. */
export function focusedWatch(focusId: string | null, watches: readonly AssistantWatch[]): string | null {
  if (!focusId || !focusId.startsWith('wch_')) return null
  return watches.some((watch) => watch.id === focusId) ? focusId : null
}

/** A state's chip tone: what rang is brand, what could not be read is a warning, the rest quiet. */
export function stateTone(state: AssistantWatchState): 'brand' | 'warning' | 'success' | 'neutral' {
  if (state === 'rang' || state === 'cooling') return 'brand'
  if (state === 'unread') return 'warning'
  if (state === 'armed') return 'success'
  return 'neutral'
}

export type WatchFailure =
  | 'full'
  | 'unknownToken'
  | 'suspicious'
  | 'unpriced'
  | 'noPrice'
  | 'duplicate'
  | 'changed'
  | 'gone'
  | 'invalid'
  | 'network'
  | 'signIn'
  | 'failed'

/** The server's refusal in the app's terms; anything unnamed is «could not save». */
export function watchFailureOf(error: unknown): WatchFailure {
  if (!(error instanceof ApiError)) return 'network'
  const message = error.message ?? ''
  switch (error.code) {
    case 'WATCH_LIMIT_REACHED':
      return 'full'
    case 'ASSET_UNCONFIRMED':
      return /suspicious/i.test(message) ? 'suspicious' : 'unknownToken'
    case 'PRICE_UNAVAILABLE':
      return /does not price/i.test(message) ? 'unpriced' : 'noPrice'
    case 'WATCH_VERSION_CONFLICT':
      return 'changed'
    case 'WATCH_NOT_FOUND':
      return 'gone'
    case 'VALIDATION_ERROR':
      return /already watch/i.test(message) ? 'duplicate' : 'invalid'
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return 'signIn'
    default:
      return 'failed'
  }
}

/** A refusal after which the list is read again, so the next press is on what is there. */
export function readAgainAfter(failure: WatchFailure): boolean {
  return failure === 'changed' || failure === 'gone'
}
