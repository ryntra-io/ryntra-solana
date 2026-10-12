/**
 * What «Лаунчі на Ryntra» and a market's page say, decided once (contract
 * 1.36.0): a state's tone and its words, a rule's sentence, depth, holders,
 * concentration, the creator's lock, Ryntra's ladder and executor — the
 * web's own (`app/app/launch/market-view.ts`, `markets-board.tsx`,
 * `market-health.tsx` in the web app). A figure the server did not read is
 * `null` and said «Не прочитано»; a budget not accounted is «Ще не рахуємо»;
 * neither is ever drawn as zero. Pure: the screens and the tests read it.
 */

import type {
  LaunchJournalKind,
  LaunchMarketCardResponse,
  LaunchMarketCycleState,
  LaunchMarketHealthResponse,
  LaunchMarketKeeper,
  LaunchMarketLock,
  LaunchMarketRow,
  LaunchMarketRule,
  LaunchPairView,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/locale.ts'
import { hasLaunchWord, type LaunchWord, type LaunchWordKey } from './copy.ts'
import { formatCountShort, formatDate, formatMoneyShort, formatNumber, formatRaw } from './launch-format.ts'

type Health = LaunchMarketHealthResponse
type Pair = Pick<LaunchPairView, 'symbol' | 'decimals' | 'dollar'>

/**
 * How a state reads at a glance: on the curve, live on the DEX, Ryntra's
 * ladder at work, or worth a look. The colour is never the only sign — the
 * state's word stands beside it.
 */
export type StateTone = 'curve' | 'live' | 'ladder' | 'caution'

export function stateTone(code: LaunchMarketCycleState): StateTone {
  switch (code) {
    case 'CREATED':
    case 'PRICE_DISCOVERY':
    case 'GRADUATION_READY':
    case 'MIGRATING':
      return 'curve'
    case 'CORE_MARKET_LIVE':
    case 'ENDOWMENT_FUNDED':
    case 'MATURE':
      return 'live'
    case 'LADDER_ACTIVE':
    case 'MAINTAINING':
      return 'ladder'
    case 'PAUSED_RISK':
    case 'MIGRATION_FAILED':
    case 'ENDOWMENT_EXHAUSTED':
      return 'caution'
    default:
      // A state a later contract adds: the quiet tone, never a verdict the phone cannot know.
      return 'curve'
  }
}

/** Whether the phone has words for a state — one a later contract adds is «Не прочитано», never a raw code. */
export function knownState(code: string): boolean {
  return hasLaunchWord(`state_${code}`)
}

/**
 * The executor's stop in words: the operator's pause, a stop where its steps
 * stand, a risk limit — and any stop a later contract adds is said as a stop
 * (contract 1.37.0, «treat an unknown pause code as a stop»).
 */
export function pauseWord(pause: Readonly<{ code: string }>, word: LaunchWord): string {
  const key = `hPause_${pause.code}`
  // An unknown stop is said as the pause itself, true at any stage — never a ladder that may not stand.
  return hasLaunchWord(key) ? word(key) : word('stateHint_PAUSED_RISK')
}

/** The states of a full curve not yet on the DEX: it takes no sale until it moves. */
export const FULL_CURVE: ReadonlySet<LaunchMarketCycleState> = new Set([
  'GRADUATION_READY',
  'MIGRATING',
  'MIGRATION_FAILED',
])

/**
 * Whether the market lives on its DEX pool: the market's own read says it
 * moved, or the health's venue is the pool. Never from the state alone — a
 * pause is `PAUSED_RISK` at any stage, on the curve too (1.37.0), and a
 * paused curve keeps its way to the DEX.
 */
export function onDexNow(
  market: Readonly<{ progress: Readonly<{ migrated: boolean }> }>,
  health: Readonly<{ venue: string }> | null,
): boolean {
  return market.progress.migrated || health?.venue === 'pool'
}

/** A raw amount of the pair currency as money: «$148», «12,3 тис. COMM»; a crumb read is «< $0,01», never a false zero. */
export function pairMoney(raw: string, pair: Pair, locale: Locale): string {
  const value = Number(raw) / 10 ** pair.decimals
  if (value > 0 && value < 0.01) {
    const cent = locale === 'uk' ? '0,01' : '0.01'
    return pair.dollar ? `< $${cent}` : `< ${cent} ${pair.symbol}`
  }
  return formatMoneyShort(value, locale, pair.dollar, pair.symbol)
}

/** A share in whole per cent where it is whole: «60 %», «2 %», «12,5 %». */
export function pct(bps: number, locale: Locale): string {
  const value = bps / 100
  const text = formatNumber(value, locale, Number.isInteger(value) ? 0 : 1)
  return locale === 'uk' ? `${text} %` : `${text}%`
}

/** Whole days, said as days: «менше доби», «3 дн.», “1 day”, “3 days”. */
export function daysText(days: number, word: LaunchWord): string {
  if (days === 0) return word('underADay')
  return word(days === 1 ? 'daysOne' : 'daysMany', { n: days })
}

/** How long ago, in whole units as the web says it: «щойно» within a minute, «2 год тому»; a date beyond a month. */
export function sinceText(at: string, word: LaunchWord, locale: Locale, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000))
  if (seconds >= 30 * 86_400) return formatDate(at, locale)
  if (seconds < 60) return word('justNow')
  const time =
    seconds < 3600
      ? word('min', { n: Math.floor(seconds / 60) })
      : seconds < 86_400
        ? word('hour', { n: Math.floor(seconds / 3600) })
        : word('day', { n: Math.floor(seconds / 86_400) })
  return word('ago', { time })
}

/** When a state began: «з 7 жовт.» from a day back, «3 год тому» within the day. */
export function sinceShort(at: string, word: LaunchWord, locale: Locale, now: number): string {
  if (now - Date.parse(at) < 86_400_000) return sinceText(at, word, locale, now)
  const date = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'short' }).format(
    new Date(at),
  )
  return word('stateSince', { when: date })
}

/**
 * The state's own sentence, as the web's state line; when Ryntra last moved
 * its steps, said in time. A pause says trading goes on (the web's «…на
 * паузі; торгівля йде далі») — over a full curve, which takes no trade, it
 * says what a full curve says; its reason — the operator's, a risk limit —
 * stands with the executor one tap deeper.
 */
export function stateLine(
  state: Health['state'],
  word: LaunchWord,
  locale: Locale,
  now: number,
  /** The curve is full by its own progress: a pause over it never says trading goes on — a full curve takes none. */
  full = false,
): string | null {
  if (!knownState(state.code)) return null
  if (state.code === 'PAUSED_RISK' && full) return word('stateHint_GRADUATION_READY')
  if (state.code === 'MAINTAINING' && state.since)
    return word('stateLine_MAINTAINING', { ago: sinceText(state.since, word, locale, now) })
  // On the DEX the card's own line says the pool and its lock: its sentence names neither a program nor a lock.
  if (CARD_SENTENCE.has(state.code)) return word(`stateCard_${state.code}` as LaunchWordKey)
  return word(`stateHint_${state.code}` as LaunchWordKey)
}

/** The states whose web sentence names the pool's program or its lock — the card says them in its own words. */
const CARD_SENTENCE: ReadonlySet<LaunchMarketCycleState> = new Set(['CORE_MARKET_LIVE', 'ENDOWMENT_EXHAUSTED'])

/**
 * What the market's page reads again when the market's own read moves (the
 * web's key: the trades read, the newest trade, the way to the DEX): the
 * health on any change; the card too once the way to the DEX ends, for the
 * pool and its locked positions. Nothing on the first read.
 */
export function marketKey(
  market: Readonly<{
    trades: Readonly<{ read: number; rows: readonly Readonly<{ signature: string }>[] }>
    progress: Readonly<{ migrated: boolean }>
  }>,
): string {
  return `${market.trades.read}:${market.trades.rows[0]?.signature ?? ''}:${market.progress.migrated}`
}

export function readsOnChange(before: string | null, key: string): Readonly<{ health: boolean; card: boolean }> {
  if (before === null || before === key) return { health: false, card: false }
  return { health: true, card: before.split(':').pop() !== key.split(':').pop() }
}

/**
 * What comes next, where nothing else on the card says it: on the curve the
 * way to the threshold says it («До виходу ще …»); a full curve's move —
 * Ryntra sends it only while its executor acts here; the pool once the
 * network confirms. On the DEX the pool and the ladder lines say where the
 * market stands; a stop's reason stands with the executor in the sheet. Never
 * a promise the server's data does not hold.
 */
export function nextLine(health: Health, word: LaunchWord): string | null {
  switch (health.state.code) {
    // A failed move's own sentence already says Ryntra sends it again while its executor runs.
    case 'GRADUATION_READY':
      return health.engine.acts ? word('next_ready') : null
    case 'MIGRATING':
      return word('next_migrating')
    default:
      return null
  }
}

const KEEPER_WORD: Readonly<Record<LaunchMarketKeeper, LaunchWordKey>> = {
  'token-2022': 'keeper_token2022',
  'meteora-dbc': 'keeper_meteoraDbc',
  'meteora-damm-v2': 'keeper_meteoraDammV2',
  'met-lock': 'keeper_metLock',
  'dynamic-fee-sharing': 'keeper_feeSharing',
  ryntra: 'keeper_ryntra',
}

export function keeperWord(by: LaunchMarketKeeper, word: LaunchWord): string {
  // A keeper a later contract adds is not named — the rule's own sentence and its source still stand.
  const key = KEEPER_WORD[by] as LaunchWordKey | undefined
  return key ? word(key) : ''
}

/**
 * The rules «Чесний лаунч» shows on this very page, from the marks its
 * receipt holds — the token's own, the curve holding the money, the pool's
 * locks, the creator's lock: «Що тримає ринок» says the rest rather than
 * saying them twice.
 */
export function rulesShownInMarks(marks: readonly string[]): ReadonlySet<string> {
  return new Set(marks.map((code) => (code === 'CREATOR_BUY_LOCKED' ? 'CREATOR_LOCK' : code)))
}

/** The rules «Що тримає ринок» lists: what the market keeps now, without those «Чесний лаунч» already shows. */
export function rulesToShow(health: Health, marks: readonly string[]): readonly LaunchMarketRule[] {
  const shown = rulesShownInMarks(marks)
  // A rule, or a mark of who keeps it, a later contract adds with no words on the phone yet is left out — never a code.
  return health.rules.filter(
    (rule) => !shown.has(rule.code) && knownRule(rule.code) && hasLaunchWord(`enforce_${rule.enforcement}`),
  )
}

/** Whether the phone can say a rule: its own sentence, or the token's mark «Чесний лаунч» says it with. */
export function knownRule(code: string): boolean {
  return hasLaunchWord(`rule_${code}`) || hasLaunchWord(`mark_${code}`)
}

/** A rule's sentence, its figures put in: the threshold as money, a share, a date. */
export function ruleText(rule: LaunchMarketRule, pair: Pair, word: LaunchWord, locale: Locale, now: number): string {
  const value = (name: string) => rule.values[name]
  switch (rule.code) {
    // A figure the rule does not carry is not said — never a zero in its place.
    case 'GRADUATION_AT_THRESHOLD': {
      const threshold = value('thresholdRaw')
      return threshold === undefined
        ? word('rule_GRADUATION_AT_THRESHOLD_unread')
        : word('rule_GRADUATION_AT_THRESHOLD', { amount: pairMoney(String(threshold), pair, locale) })
    }
    case 'CREATOR_LOCK': {
      // Whole until the cliff, then freed step by step until the end of the vesting.
      const cliff = value('cliffAt')
      const ends = value('endsAt')
      if (typeof cliff === 'number' && cliff * 1000 > now)
        return word('rule_CREATOR_LOCK', { date: formatDate(cliff * 1000, locale) })
      if (typeof ends === 'number') return word('rule_CREATOR_LOCK_vesting', { date: formatDate(ends * 1000, locale) })
      return word('rule_CREATOR_LOCK_unread')
    }
    case 'CREATOR_FIRST_BUY_CAP': {
      const cap = value('capBps')
      return cap === undefined
        ? word('rule_CREATOR_FIRST_BUY_CAP_unread')
        : word('rule_CREATOR_FIRST_BUY_CAP', { pct: pct(Number(cap), locale) })
    }
    case 'CONCENTRATION_MARK': {
      const mark = value('markBps')
      return mark === undefined
        ? word('rule_CONCENTRATION_MARK_unread')
        : word('rule_CONCENTRATION_MARK', { pct: pct(Number(mark), locale) })
    }
    case 'LP_LOCKED_FOREVER':
      // Whose share it is: the creator's, or Ryntra's as the config's partner.
      return value('owner') === 'creator'
        ? word('mark_LP_LOCKED_FOREVER_creator')
        : value('owner') === 'partner'
          ? word('mark_LP_LOCKED_FOREVER_partner')
          : word('rule_LP_LOCKED_FOREVER')
    // The token's own rules read as «Чесний лаунч» says them.
    case 'MINT_REVOKED':
    case 'NO_FREEZE':
    case 'METADATA_FIXED':
    case 'NO_TRANSFER_HOOK':
      return word(`mark_${rule.code}`)
    default:
      return hasLaunchWord(`rule_${rule.code}`) ? word(`rule_${rule.code}` as LaunchWordKey) : ''
  }
}

/** Holders over $1: a count, a floor «щонайменше» / «4+», «Не пораховано» for a floor of none, else «Не прочитано». */
export type HoldersView =
  | Readonly<{ kind: 'count'; count: number; atLeast: boolean }>
  | Readonly<{ kind: 'uncounted' }>
  | Readonly<{ kind: 'notRead' }>

export function holdersView(count: number | null, atLeast: boolean): HoldersView {
  if (count !== null) return { kind: 'count', count, atLeast }
  return atLeast ? { kind: 'uncounted' } : { kind: 'notRead' }
}

/** The list's depth at −5 %: a full curve takes no sale; null is not read, never zero. */
export type DepthView =
  Readonly<{ kind: 'curveFull' }> | Readonly<{ kind: 'notRead' }> | Readonly<{ kind: 'raw'; raw: string }>

/**
 * Whether a curve is full and takes no sale until it moves: by its state, or
 * by its own progress — a pause (1.37.0) is `PAUSED_RISK` over any state, and
 * a curve that filled under it stays full.
 */
export function curveFull(
  venue: string | null,
  state: string | null,
  progress: Readonly<{ bps: number; migrated: boolean }> | null,
): boolean {
  if (venue !== 'curve') return false
  if (state !== null && FULL_CURVE.has(state as LaunchMarketCycleState)) return true
  return progress !== null && !progress.migrated && progress.bps >= 10_000
}

export function rowDepth(row: LaunchMarketRow): DepthView {
  if (curveFull(row.venue, row.state?.code ?? null, row.progress)) return { kind: 'curveFull' }
  return row.depth5Raw === null ? { kind: 'notRead' } : { kind: 'raw', raw: row.depth5Raw }
}

/** The page's depth at −5 %, from the health's three drops; `progress` — the market's own read of its curve. */
export function healthDepth5(
  health: Health,
  progress: Readonly<{ bps: number; migrated: boolean }> | null = null,
): DepthView {
  if (curveFull(health.venue, health.state.code, progress)) return { kind: 'curveFull' }
  const level = health.depth.find((entry) => entry.dropBps === 500)
  return !level || level.pairRaw === null ? { kind: 'notRead' } : { kind: 'raw', raw: level.pairRaw }
}

/** A curve that holds little gives all of it to the first drop: the same figure three times, said once in words. */
export function depthAllSame(health: Health): string | null {
  const first = health.depth[0]?.pairRaw ?? null
  if (health.venue !== 'curve' || first === null || first === '0') return null
  return health.depth.every((level) => level.pairRaw === first) ? first : null
}

/** A market not read yet: «Читаємо з ланцюга…» for a minute after the list opened, its figures «Не прочитано» after. */
export const READING_MS = 60_000

export function rowReading(row: LaunchMarketRow, openedAt: number, now: number): boolean {
  return !row.read && now - openedAt < READING_MS
}

/** The oldest read among the rows read: every figure on the list is at least this fresh. */
export function oldestRead(rows: readonly LaunchMarketRow[]): string | null {
  const reads = rows.filter((row) => row.read).map((row) => Date.parse(row.observedAt))
  return reads.length ? new Date(Math.min(...reads)).toISOString() : null
}

/**
 * The creator's lock in words: whole until its cliff, then freed step by
 * step to its end; a lock whose dates were not read is said locked; a row
 * not read knows only the lock its record holds — no lock there is not read,
 * never «no lock».
 */
export function creatorLockText(
  lock: LaunchMarketLock | null,
  read: boolean,
  word: LaunchWord,
  locale: Locale,
  now: number,
): Readonly<{ text: string; locked: boolean }> {
  if (!lock) return read ? { text: word('creatorNoLock'), locked: false } : { text: word('notRead'), locked: false }
  if (lock.cliffAt && Date.parse(lock.cliffAt) > now)
    return { text: word('creatorLockedUntil', { date: formatDate(lock.cliffAt, locale) }), locked: true }
  if (lock.endsAt && Date.parse(lock.endsAt) > now)
    return { text: word('creatorVestingUntil', { date: formatDate(lock.endsAt, locale) }), locked: true }
  if (lock.cliffAt || lock.endsAt) return { text: word('creatorNoLock'), locked: false }
  return { text: word('creatorLockUnread'), locked: true }
}

/** The creator's sales: what share of their buy, or of the supply; null is not read. */
export function creatorSoldText(creator: Health['creator'], word: LaunchWord, locale: Locale): string {
  if (creator.sold === true)
    return creator.soldBps !== null
      ? word(creator.soldOf === 'supply' ? 'hCreatorSoldSupply' : 'hCreatorSold', { pct: pct(creator.soldBps, locale) })
      : word('creatorSoldYes')
  return creator.sold === false ? word('creatorSoldNo') : word('creatorSoldUnread')
}

/** A price in a sentence: «$0,000071» or «0,000071 USDC». */
export function priceText(value: number, pair: Pair, locale: Locale): string {
  const text = new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
    maximumSignificantDigits: 4,
    maximumFractionDigits: 20,
  }).format(value)
  return pair.dollar ? `$${text}` : `${text} ${pair.symbol}`
}

/**
 * Ryntra's ladder in one line: what of it the deepest drop reaches; else
 * where its steps stand against the price — deeper than the drop, or bought
 * through and holding the token. With no steps nothing is said, as on the
 * web — whether a ladder will ever stand is not in the answer; steps not
 * read on the DEX are said so. Never «$0» for steps that are there.
 */
export function ladderLine(
  health: Health,
  word: LaunchWord,
  locale: Locale,
  /** `card` — on the market's card, where no depth stands beside it: what the steps hold, said by itself. */
  where: 'card' | 'sheet' = 'sheet',
): string | null {
  const ladder = health.ladder
  if (!ladder) {
    // No steps: nothing is said, as on the web — whether a ladder will ever stand here is not in the answer. Steps that
    // were not read are said so, on the DEX.
    return health.venue === 'pool' && health.budget.ladder === 'UNREAD' ? word('ladderUnread') : null
  }
  if (where === 'card') {
    if (ladder.pairFrom === null || ladder.pairTo === null) return word('hLadderUsed', { symbol: health.pair.symbol })
    const amount = pairMoney(ladder.pairRaw, health.pair, locale)
    // «Працює» only while Ryntra's executor acts here and nothing stops it: else what the steps hold, and no more.
    return health.engine.acts && !health.engine.pause
      ? word('ladderWorks', { amount })
      : word('ladderHolds', { amount })
  }
  const deepest = health.depth.find((level) => level.dropBps === 1000) ?? null
  const inReach = deepest?.ladderRaw ? BigInt(deepest.ladderRaw) : 0n
  if (inReach > 0n)
    return word('hDepthLadder', { amount: pairMoney(String(inReach), health.pair, locale), pct: pct(1000, locale) })
  if (ladder.pairFrom === null || ladder.pairTo === null) return word('hLadderUsed', { symbol: health.pair.symbol })
  const values = {
    from: priceText(ladder.pairFrom, health.pair, locale),
    to: priceText(ladder.pairTo, health.pair, locale),
    price: priceText(health.price.pair, health.pair, locale),
  }
  return word(ladder.pairTo < health.price.pair * 0.9 ? 'hLadderDeeper' : 'hLadderRange', values)
}

/** What the log says Ryntra's executor did, in a few words. */
const ACTION_WORD: Readonly<Record<LaunchJournalKind | 'CREATOR_BOUGHT' | 'FEE_CLAIMED', LaunchWordKey>> = {
  LAUNCHED: 'log_LAUNCHED',
  CREATOR_LOCKED: 'log_CREATOR_LOCKED',
  FEES_SHARED: 'log_FEES_SHARED',
  CREATOR_SOLD: 'log_CREATOR_SOLD',
  GRADUATED: 'log_GRADUATED',
  FLOOR_POOL: 'log_FLOOR_POOL',
  FLOOR_PLACED: 'log_FLOOR_PLACED',
  FLOOR_WITHDRAWN: 'log_FLOOR_WITHDRAWN',
  FLOOR_RAISED: 'log_FLOOR_RAISED',
  FLOOR_ADDED: 'log_FLOOR_ADDED',
  CREATOR_BOUGHT: 'log_CREATOR_BOUGHT',
  FEE_CLAIMED: 'log_FEE_CLAIMED',
}

/**
 * Ryntra's executor here: a stop first; then whether it acts on this
 * network now, and its last action on this market — the lines in order.
 * `mark` is a line worth a look.
 */
export type EngineLine = Readonly<{ text: string; mark?: boolean; quiet?: boolean; tx?: string; at?: string }>

export function engineLines(health: Health, word: LaunchWord): readonly EngineLine[] {
  const engine = health.engine
  if (engine.executor === null) return [{ text: word('hNoExecutor'), quiet: true }]
  const lines: EngineLine[] = []
  if (engine.pause) lines.push({ text: pauseWord(engine.pause, word), mark: true })
  // Not acting: said once — by the pause where its steps stand, else in a line that names what is left to anyone.
  if (!engine.acts && !engine.pause)
    lines.push({ text: word(health.venue === 'curve' ? 'hExecutorIdle' : 'hExecutorIdleDex'), quiet: true })
  // Acting here: what it does on this market, said before what it last did.
  if (engine.acts && !engine.pause)
    lines.push({ text: word(health.venue === 'curve' ? 'hExecutorActs_curve' : 'hExecutorActs_pool') })
  // An action a later contract adds is not named; its transaction stands with the last one the phone knows.
  const action =
    engine.lastAction && Object.hasOwn(ACTION_WORD, engine.lastAction.kind)
      ? ACTION_WORD[engine.lastAction.kind as keyof typeof ACTION_WORD]
      : undefined
  if (engine.lastAction) {
    if (action)
      lines.push({
        text: word('hLastAction', { action: word(action) }),
        tx: engine.lastAction.signature,
        at: engine.lastAction.at ?? undefined,
      })
  } else if (engine.acts && !engine.pause) lines.push({ text: word('hNoAction'), quiet: true })
  return lines
}

/**
 * Whether the DEX pool is said locked for ever: `all` when both shares of its
 * liquidity — the creator's and Ryntra's — are locked positions, `part` when
 * only one is, `none` without a locked position behind it. From the rules'
 * owners; else from the card's locked positions.
 */
export function poolLockState(health: Health, card: LaunchMarketCardResponse | null): 'all' | 'part' | 'none' {
  const owners = new Set(
    health.rules.filter((rule) => rule.code === 'LP_LOCKED_FOREVER').map((rule) => String(rule.values.owner ?? '')),
  )
  if (owners.size) return owners.has('creator') && owners.has('partner') ? 'all' : 'part'
  const positions = card?.addresses.lockedPositions.length ?? 0
  return positions >= 2 ? 'all' : positions === 1 ? 'part' : 'none'
}

export function poolLocked(health: Health, card: LaunchMarketCardResponse | null): boolean {
  return poolLockState(health, card) !== 'none'
}

/** The market's addresses one tap deep — each with its words, in the order a person follows the money. */
export type AddressRow = Readonly<{ key: LaunchWordKey; address: string }>

export function addressRows(card: LaunchMarketCardResponse): readonly AddressRow[] {
  const a = card.addresses
  const rows: AddressRow[] = [
    { key: 'addr_curve', address: a.curve },
    { key: 'addr_config', address: a.config },
  ]
  if (a.pool) rows.push({ key: 'addr_pool', address: a.pool })
  for (const locked of a.lockedPositions) rows.push({ key: 'addr_locked', address: locked.position })
  if (a.creatorLock) rows.push({ key: 'addr_creatorLock', address: a.creatorLock })
  if (a.feeVault) rows.push({ key: 'addr_feeVault', address: a.feeVault })
  if (a.ladder) rows.push({ key: 'addr_ladder', address: a.ladder.pool })
  if (a.executor) rows.push({ key: 'addr_executor', address: a.executor })
  return rows
}

/** A figure of the health with its words; `counted: false` — not read or not counted, drawn quiet, never as a zero. */
export type HealthFigure = Readonly<{ label: string; value: string; counted: boolean }>

/** The market's budget: earned · deployed · reserve — «Ще не рахуємо» while Ryntra does not account it. */
export function budgetRows(health: Health, word: LaunchWord, locale: Locale): readonly HealthFigure[] {
  const money = (raw: string) => pairMoney(raw, health.pair, locale)
  const budget = health.budget
  return [
    {
      label: word('hEarned'),
      value: budget.earnedRaw !== null ? money(budget.earnedRaw) : word('notCounted'),
      counted: budget.earnedRaw !== null,
    },
    {
      label: word('hDeployed'),
      // No ladder only when the answer says none; placed without its figure, or a value this phone does not know, is not read.
      value: budget.deployed
        ? money(budget.deployed.pairRaw)
        : budget.ladder === 'NONE'
          ? word('hNoLadder')
          : word('notRead'),
      counted: budget.deployed !== null,
    },
    {
      label: word('hReserve'),
      value: budget.reserveRaw !== null ? money(budget.reserveRaw) : word('notCounted'),
      counted: budget.reserveRaw !== null,
    },
  ]
}

/** Holders over $1 as the health says them: «Щонайменше 4», «12», «Не пораховано», «Не прочитано». */
export function holdersLine(
  health: Health,
  word: LaunchWord,
  locale: Locale,
): Readonly<{ text: string; counted: boolean }> {
  const view = holdersView(health.holders.count, health.holders.atLeast)
  if (view.kind === 'count') {
    const count = formatCountShort(view.count, locale)
    return { text: view.atLeast ? word('hAtLeast', { n: count }) : count, counted: true }
  }
  return { text: view.kind === 'uncounted' ? word('holdersUncounted') : word('notRead'), counted: false }
}

/** Concentration: the top ten's share (or a floor), and the mark above 60 % — a mark, never a pause. */
export function concentrationLines(
  health: Health,
  word: LaunchWord,
  locale: Locale,
): Readonly<{ share: string | null; mark: Readonly<{ text: string; marked: boolean }> | null }> {
  const c = health.concentration
  if (c.top10Bps === null) return { share: null, mark: null }
  return {
    share: word(c.atLeast ? 'hTop10AtLeast' : 'hTop10', { pct: pct(c.top10Bps, locale) }),
    mark:
      c.marked === null
        ? null
        : { text: word(c.marked ? 'hMarked' : 'hNotMarked', { pct: pct(c.markBps, locale) }), marked: c.marked },
  }
}

/** The health door's one line: the depth at −5 % as the market's first figure, or what stands for it. */
export function healthDoorLine(
  health: Health | null,
  failed: boolean,
  word: LaunchWord,
  locale: Locale,
  progress: Readonly<{ bps: number; migrated: boolean }> | null = null,
): string {
  if (!health) return failed ? word('healthUnread') : word('healthReading')
  const depth = healthDepth5(health, progress)
  const value =
    depth.kind === 'raw'
      ? pairMoney(depth.raw, health.pair, locale)
      : depth.kind === 'curveFull'
        ? word('curveFull')
        : word('notRead')
  return word('healthAt', { label: word('colDepth'), value })
}

/**
 * Whether the budget is said row by row: once any of it is counted, or its
 * ladder stands or was not read («Розгорнуто: Не прочитано» is not «Ще не
 * рахуємо»). With nothing counted and no ladder, one «Ще не рахуємо» says it.
 */
export function budgetInRows(health: Health): boolean {
  const budget = health.budget
  return budget.earnedRaw !== null || budget.reserveRaw !== null || budget.deployed !== null || budget.ladder !== 'NONE'
}

/** The depth's bars only where they compare something: not when the three drops read the same, nor when all are zero. */
export function depthBars(health: Health): boolean {
  const read = health.depth.filter((level) => level.pairRaw !== null).map((level) => level.pairRaw)
  return read.length > 1 && new Set(read).size > 1
}

/** Two markets of one name and ticker on the list: each says its own address, short, so neither is taken for the other. */
export function namesShared(rows: readonly LaunchMarketRow[]): ReadonlySet<string> {
  const seen = new Map<string, number>()
  for (const row of rows)
    seen.set(`${row.name}\u0000${row.symbol}`, (seen.get(`${row.name}\u0000${row.symbol}`) ?? 0) + 1)
  return new Set(rows.filter((row) => (seen.get(`${row.name}\u0000${row.symbol}`) ?? 0) > 1).map((row) => row.token))
}

/**
 * An amount on the way to the threshold — what the curve holds, what is
 * left: below a hundred, to the cent and rounded as every other figure on the
 * page («4,95», never «4» or «4,94»; «0,3», never «0» while some is left);
 * from a hundred in whole units, as the web writes it.
 */
export function reserveText(reserveRaw: string, decimals: number, locale: Locale): string {
  const value = Number(reserveRaw) / 10 ** decimals
  // A crumb is «< 0,01», never a «0» that says nothing is left.
  if (value > 0 && value < 0.01) return `< ${locale === 'uk' ? '0,01' : '0.01'}`
  if (BigInt(reserveRaw) < 100n * 10n ** BigInt(decimals)) return formatNumber(value, locale, 2)
  return formatRaw(reserveRaw, decimals, locale, 0)
}

/** The market's own holders in a cell: «12», a floor «4+»; a floor of none says it was not counted — never «0+». */
export function holdersFloor(count: number, atLeast: boolean, locale: Locale): string {
  if (atLeast && count === 0) return '—'
  return `${formatCountShort(count, locale)}${atLeast ? '+' : ''}`
}

/** A date in a dense line: «6 жовт.» this year, «6 жовт. 2027» another — the year only where it differs (the web's). */
export function shortDate(at: string, locale: Locale, now: number): string {
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  // A date never breaks across lines: its own spaces do not wrap.
  return new Intl.DateTimeFormat(
    locale === 'uk' ? 'uk-UA' : 'en-US',
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  )
    .format(date)
    .replace(/ /g, '\u00a0')
}

/**
 * The «Ринок» card's pool line: the pool and its lock — the card's sentence
 * names neither; a date beside «for ever» says since when, never until when;
 * a share locked is never said as the whole pool; with no lock and no date,
 * nothing (the link alone names the pool).
 */
export function poolLine(
  health: Health,
  card: LaunchMarketCardResponse | null,
  word: LaunchWord,
  locale: Locale,
  now: number,
): Readonly<{ text: string; locked: boolean }> | null {
  const lock = poolLockState(health, card)
  const graduated = health.survival.graduatedAt ? shortDate(health.survival.graduatedAt, locale, now) : null
  const since = graduated ? ` · ${word('sinceDate', { date: graduated })}` : ''
  if (lock === 'all') return { text: `${word('poolLockedForever')}${since}`, locked: true }
  if (lock === 'part') return { text: `${word('poolPartLocked')}${since}`, locked: true }
  return graduated ? { text: word('poolSince', { date: graduated }), locked: false } : null
}

/**
 * The pool the market lives in: the card's address once read, else the
 * market's own once it says it moved — never the curve's address under the
 * pool's name; null while neither is known.
 */
export function poolAddressOf(
  card: LaunchMarketCardResponse | null,
  market: Readonly<{ progress: Readonly<{ migrated: boolean }>; trading: Readonly<{ pool: string }> }>,
): string | null {
  return card?.addresses.pool ?? (market.progress.migrated ? market.trading.pool : null)
}

/** When the state began, in the card's header: not for a state the phone does not know, nor beside a sentence that says it. */
export function headerSince(health: Health, word: LaunchWord, locale: Locale, now: number): string | null {
  if (!health.state.since || !knownState(health.state.code) || health.state.code === 'MAINTAINING') return null
  return sinceShort(health.state.since, word, locale, now)
}
