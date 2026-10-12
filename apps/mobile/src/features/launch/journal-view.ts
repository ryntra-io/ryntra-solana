/**
 * What «Бортовий журнал» says on a market's page, decided once (contracts
 * 1.32.0 and 1.36.0, `GET /api/v1/launch/{mint}/journal`) — the web's own
 * (`app/app/launch/[mint]/flight-log.tsx` in the web app): the newest entry
 * first, each in words with its amounts, its mark — a program's rule,
 * Ryntra's policy, or what the log only observes — and its transaction; a
 * move up of Ryntra's ladder is one entry with the emptying before it;
 * «Чому?» names the rules of «Що тримає цей ринок» an entry stands on.
 * Ryntra's ladder is said only while it stands (`floor` not null), as
 * liquidity from Ryntra's fees — never as a price held. The kinds of 1.39.0
 * and 1.40.0 (`FEE_CLAIMED`, `CREATOR_BOUGHT`) are read from the answer in
 * the web's words while the pin stays 1.36.0. Pure: the screens and the
 * tests read it.
 */

import type {
  LaunchJournalEvent,
  LaunchJournalResponse,
  LaunchMarketHealthResponse,
  LaunchMarketRule,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/locale.ts'
import { hasLaunchWord, type LaunchWord } from './copy.ts'
import { formatRaw } from './launch-format.ts'
import { knownRule, pairMoney, pct, priceText } from './market-view.ts'

/** How many entries the market's page shows; the rest are behind «Усі». */
export const JOURNAL_AT_ONCE = 3

/** One row of the log: an entry, and for a move up of the ladder the emptying that came just before it. */
export type JournalRow = Readonly<{ entry: LaunchJournalEvent; emptied: LaunchJournalEvent | null }>

/** The log's entries as rows, the newest first: a move up with its emptying as one. */
export function journalRows(events: readonly LaunchJournalEvent[]): readonly JournalRow[] {
  const rows: JournalRow[] = []
  for (let index = 0; index < events.length; index += 1) {
    const entry = events[index]!
    const before = events[index + 1]
    if (entry.kind === 'FLOOR_RAISED' && before?.kind === 'FLOOR_WITHDRAWN') {
      rows.push({ entry, emptied: before })
      index += 1
    } else rows.push({ entry, emptied: null })
  }
  return rows
}

/** What governs an entry, said in words: a program's rule, Ryntra's policy, or an observation — none before 1.36.0. */
export type JournalMark = 'rule' | 'policy' | 'observed' | null

export function journalMark(entry: LaunchJournalEvent): JournalMark {
  if (entry.enforcement === 'rule' || entry.enforcement === 'policy') return entry.enforcement
  // `null` is what the log observes (a sale of the creator's); absent — a log before 1.36.0, which says nothing of it.
  return entry.enforcement === null ? 'observed' : null
}

/** An entry's name; a kind a later contract adds, with no words on the phone yet, is an entry on chain — never a code. */
export function journalName(entry: LaunchJournalEvent, word: LaunchWord): string {
  const key = `log_${entry.kind}`
  return hasLaunchWord(key) ? word(key) : word('log_unknown')
}

type Figures = Readonly<{
  money: (raw: string) => string
  tokens: (raw: string) => string
  price: (value: number) => string
}>

/** The amounts of a log in its own units: the pair currency as money, the token by its ticker, a price with its unit. */
export function journalFigures(log: LaunchJournalResponse, symbol: string, locale: Locale): Figures {
  return {
    money: (raw) => pairMoney(raw, log.pair, locale),
    // Less than one token is «< 1», never a «0» for an amount that is there.
    tokens: (raw) => {
      const whole = BigInt(raw) / 10n ** BigInt(log.tokenDecimals)
      return BigInt(raw) > 0n && whole === 0n
        ? `< 1 $${symbol}`
        : `${formatRaw(raw, log.tokenDecimals, locale, 0)} $${symbol}`
    },
    price: (value) => priceText(value, log.pair, locale),
  }
}

/** An entry's line under its name — what was bought, sold, locked or put in; nothing where the log did not read it. */
export function journalDetail(
  entry: LaunchJournalEvent,
  figures: Figures,
  word: LaunchWord,
  locale: Locale,
): string | null {
  const { money, tokens, price } = figures
  // Kinds of later contracts, beyond the pinned types: a purchase of the creator's, a fee collected for the budget.
  const later = entry as LaunchJournalEvent & Readonly<{ source?: string | null; budgetRaw?: string | null }>
  const kind: string = entry.kind
  if (kind === 'CREATOR_BOUGHT')
    return entry.tokensRaw && entry.pairRaw
      ? word('log_CREATOR_BOUGHT_detail', { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw) })
      : null
  if (kind === 'FEE_CLAIMED') {
    const key = `log_FEE_CLAIMED_${later.source ?? ''}`
    // The budget's part not read is no line — never «$0 to the budget».
    const needsBudget = later.source === 'curve' || later.source === 'lp'
    return entry.pairRaw && later.source && hasLaunchWord(key) && (!needsBudget || later.budgetRaw)
      ? word(key, { amount: money(entry.pairRaw), budget: later.budgetRaw ? money(later.budgetRaw) : '' })
      : null
  }
  switch (entry.kind) {
    case 'LAUNCHED':
      return entry.pairRaw && entry.tokensRaw
        ? word('log_LAUNCHED_buy', { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw) })
        : null
    case 'CREATOR_LOCKED':
      return entry.tokensRaw ? word('log_CREATOR_LOCKED_detail', { tokens: tokens(entry.tokensRaw) }) : null
    case 'FEES_SHARED':
      return word('log_FEES_SHARED_detail')
    case 'CREATOR_SOLD':
      if (!entry.tokensRaw || !entry.pairRaw || entry.soldBps === null) return null
      return word(entry.soldOf === 'supply' ? 'log_CREATOR_SOLD_supply' : 'log_CREATOR_SOLD_detail', {
        tokens: tokens(entry.tokensRaw),
        amount: money(entry.pairRaw),
        pct: soldShare(entry.soldBps, locale),
      })
    case 'GRADUATED':
      return entry.pairRaw
        ? word(
            entry.actor === 'ryntra'
              ? 'log_GRADUATED_ryntra'
              : entry.actor === 'meteora'
                ? 'log_GRADUATED_meteora'
                : 'log_GRADUATED_other',
            { amount: money(entry.pairRaw) },
          )
        : null
    case 'FLOOR_POOL':
      return entry.tokensRaw && entry.pairRaw && BigInt(entry.pairRaw) > 0n
        ? word('log_FLOOR_POOL_detail', { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw) })
        : null
    case 'FLOOR_WITHDRAWN':
      return entry.pairRaw ? word('log_FLOOR_WITHDRAWN_detail', { amount: money(entry.pairRaw) }) : null
    case 'FLOOR_PLACED':
    case 'FLOOR_RAISED':
    case 'FLOOR_ADDED':
      return entry.pairRaw && entry.priceLow !== null && entry.priceHigh !== null
        ? word(`log_${entry.kind}_detail`, {
            amount: money(entry.pairRaw),
            low: price(entry.priceLow),
            high: price(entry.priceHigh),
          })
        : null
    default:
      return null
  }
}

/** A share sold: a crumb of a sale is «< 0,1 %», never «0 %»; nearly all is «> 99,9 %», never «100 %». */
function soldShare(bps: number, locale: Locale): string {
  if (bps > 0 && bps < 10) return locale === 'uk' ? '< 0,1 %' : '< 0.1%'
  if (bps > 9990 && bps < 10000) return locale === 'uk' ? '> 99,9 %' : '> 99.9%'
  return pct(bps, locale)
}

/**
 * The rules of «Що тримає цей ринок» an entry stands on — what «Чому?»
 * opens: the launch on the config and the curve that holds the money (and
 * the cap on the creator's first buy, when they bought); the lock; the
 * shared fees; a sale of the creator's on the mark every such sale gets; the
 * move to the DEX on its threshold, Ryntra's executor when it sent it, and
 * the pool's locks; Ryntra's ladder on its policy. Only rules the market's
 * health lists now and the phone can say — none, and there is no «Чому?».
 */
export function whyRules(
  entry: LaunchJournalEvent,
  health: LaunchMarketHealthResponse | null,
): readonly LaunchMarketRule[] {
  if (!health) return []
  const codes = Object.hasOwn(WHY, entry.kind) ? WHY[entry.kind]!(entry) : []
  return codes.flatMap((code) => health.rules.filter((rule) => rule.code === code && knownRule(rule.code)))
}

const WHY: Readonly<Record<string, (entry: LaunchJournalEvent) => readonly string[]>> = {
  LAUNCHED: (entry) => ['CONFIG_FIXED', 'CURVE_HOLDS_FUNDS', ...(entry.pairRaw ? ['CREATOR_FIRST_BUY_CAP'] : [])],
  CREATOR_LOCKED: () => ['CREATOR_LOCK'],
  FEES_SHARED: () => ['CREATOR_FEES_SHARED'],
  CREATOR_SOLD: () => ['CREATOR_SALE_MARK'],
  GRADUATED: (entry) => [
    'GRADUATION_AT_THRESHOLD',
    ...(entry.actor === 'ryntra' ? ['GRADUATION_BY_RYNTRA'] : []),
    'LP_LOCKED_FOREVER',
  ],
  FLOOR_POOL: () => ['FEE_FUNDED_LADDER'],
  FLOOR_PLACED: () => ['FEE_FUNDED_LADDER'],
  FLOOR_WITHDRAWN: () => ['FEE_FUNDED_LADDER'],
  FLOOR_RAISED: () => ['FEE_FUNDED_LADDER'],
  FLOOR_ADDED: () => ['FEE_FUNDED_LADDER'],
  FEE_CLAIMED: () => ['FEE_FUNDED_LADDER'],
}

/**
 * Ryntra's ladder above the log, only while it stands: what its steps hold
 * from Ryntra's fees on this token and between which prices, what it has
 * bought and holds; a ladder there but not read now is said so. No ladder —
 * nothing.
 */
export type JournalFloor =
  Readonly<{ kind: 'stands'; line: string; bought: string | null; pool: string }> | Readonly<{ kind: 'unread' }> | null

export function journalFloor(log: LaunchJournalResponse, figures: Figures, word: LaunchWord): JournalFloor {
  if (log.floor) {
    const floor = log.floor
    return {
      kind: 'stands',
      line: word('floorLine', {
        amount: figures.money(floor.pairRaw),
        low: figures.price(floor.priceLow),
        high: figures.price(floor.priceHigh),
      }),
      bought: BigInt(floor.tokensRaw) > 0n ? word('floorBought', { tokens: figures.tokens(floor.tokensRaw) }) : null,
      pool: floor.pool,
    }
  }
  return log.floorUnread ? { kind: 'unread' } : null
}

/**
 * What the log says of itself under its entries: read in part (an entry
 * not read is not «none»); and, where the whole answer is shown (`all`),
 * «показано N з M» when the log holds more than the answer gives — never
 * under the page's three, where N would not be what is seen.
 */
export type JournalNote = Readonly<{ text: string; warn: boolean }>

export function journalNotes(log: LaunchJournalResponse, word: LaunchWord, all: boolean): readonly JournalNote[] {
  const notes: JournalNote[] = []
  if (all && log.total !== undefined && log.total > log.events.length)
    notes.push({ text: word('logTotal', { shown: log.events.length, total: log.total }), warn: false })
  if (!log.complete) notes.push({ text: word('logIncomplete'), warn: true })
  return notes
}
