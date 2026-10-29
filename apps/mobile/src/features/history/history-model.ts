/**
 * History as values — pure. The server's ledger of a wallet's operations,
 * folded into the rows of a statement: what kind of operation, what left
 * and what arrived in the asset's own units, what it cost where the record
 * says, the state as a word, the identity on the chain. A leg whose
 * decimals the record does not carry is resolved from what the app already
 * knows — the holdings, the market rows — or shown without a figure rather
 * than with a wrong one. Nothing here reads the network.
 */

import { SOL_MINT, USDC_MINT, type ActionMovement, type WalletAction } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatAmount, formatUsd, shortAddress } from '../../utils/format.ts'
import { formatUnits } from '../trade/trade-model.ts'

/** The system program stands for native SOL in a Send's record. */
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

export type HistoryKind = 'buy' | 'sell' | 'swap' | 'send' | 'receive' | 'bridge' | 'crossSwap' | 'other'
export type HistoryStatus = 'done' | 'pending' | 'failed' | 'needsYou'

/** What the app knows of a mint on its own: for the legs the record left without decimals or a name. */
export type MintFacts = Readonly<{ decimals: number | null; symbol: string | null }>
export type KnownMints = ReadonlyMap<string, MintFacts>

/** Native SOL and USDC are known without a read. */
export const BUILT_IN_MINTS: KnownMints = new Map([
  [SOL_MINT, { decimals: 9, symbol: 'SOL' }],
  [SYSTEM_PROGRAM, { decimals: 9, symbol: 'SOL' }],
  [USDC_MINT, { decimals: 6, symbol: 'USDC' }],
])

export type HistoryLeg = Readonly<{
  /** The market's address; native SOL answers to wrapped SOL's. */
  mint: string | null
  symbol: string
  amountRaw: string
  decimals: number | null
  /** The amount in the asset's units, or a dash when the decimals are unknown. */
  amountText: string
}>

export type HistoryFee = Readonly<{
  collected: boolean
  /** "0.017104 USDC", "0.50%" or a dash — the most exact fact the record carries. */
  text: string
  basisPoints: number | null
  usd: number | null
}>

export type HistoryRow = Readonly<{
  id: string
  kind: HistoryKind
  status: HistoryStatus
  at: string
  updatedAt: string
  out: HistoryLeg | null
  in: HistoryLeg | null
  fee: HistoryFee | null
  /** The provider's own dollar figure for the fill, never a price read later. */
  statedUsd: number | null
  signature: string | null
  sourceTx: string | null
  destinationTx: string | null
  destination: string | null
  /** Every mint the row touches, for the filter by asset. */
  mints: readonly string[]
  plan: Readonly<{ planId: string; version: number }> | null
  /** A purchase made under an autoinvest reminder (`origin.rule`, 1.12.0) — the receipt's mark of the rule. */
  rule: boolean
  /** A launch's trade (`origin.surface` `LAUNCH`, 1.34.0): the token and where it ran. */
  launch: Readonly<{ token: string | null; venue: 'curve' | 'pool' | null }> | null
}>

export function historyStatus(outcome: string): HistoryStatus {
  switch (outcome) {
    case 'DONE':
      return 'done'
    case 'FAILED':
      return 'failed'
    case 'NEEDS_YOU':
      return 'needsYou'
    default:
      return 'pending'
  }
}

export function historyKind(action: WalletAction): HistoryKind {
  switch (action.lane) {
    case 'SWAP':
      return action.origin?.side === 'BUY' ? 'buy' : action.origin?.side === 'SELL' ? 'sell' : 'swap'
    case 'SEND':
      return 'send'
    case 'RECEIVE':
      return 'receive'
    case 'BRIDGE':
      return 'bridge'
    case 'CROSS_SWAP':
      return 'crossSwap'
    default:
      return 'other'
  }
}

/** The market address a leg answers to: the system program and a null mint with SOL's symbol both mean native SOL. */
function marketMint(movement: ActionMovement): string | null {
  if (movement.mint === SYSTEM_PROGRAM) return SOL_MINT
  if (movement.mint === null) return movement.symbol === 'SOL' || movement.decimals === 9 ? SOL_MINT : null
  return movement.mint
}

/**
 * An amount in units, never a false zero: a crumb below the last place shown is «< 0,000001» — the rule every
 * figure of History and the receipts keeps (a fee of 0,00000055 ETH is not «0 ETH»). Display only.
 */
export function unitsText(raw: string, decimals: number, places: number, locale: Locale): string {
  const text = formatUnits(raw, decimals, places, locale)
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n || /[1-9]/.test(text)) return text
  return `< ${formatAmount(10 ** -places, places, locale)}`
}

function legOf(movement: ActionMovement | null, known: KnownMints, locale: Locale): HistoryLeg | null {
  if (movement === null) return null
  const mint = marketMint(movement)
  const facts = mint ? (known.get(mint) ?? BUILT_IN_MINTS.get(mint) ?? null) : null
  const decimals = movement.decimals ?? facts?.decimals ?? null
  const symbol = movement.symbol ?? facts?.symbol ?? (mint ? shortAddress(mint) : DASH)
  return {
    mint,
    symbol,
    amountRaw: movement.amountRaw,
    decimals,
    amountText: decimals === null ? DASH : unitsText(movement.amountRaw, decimals, Math.min(6, decimals), locale),
  }
}

function feeOf(action: WalletAction, known: KnownMints, locale: Locale): HistoryFee | null {
  const fee = action.fee ?? null
  if (!fee) return null
  const assetMint = fee.asset ?? null
  const facts = assetMint ? (known.get(assetMint) ?? BUILT_IN_MINTS.get(assetMint) ?? null) : null
  const decimals = fee.decimals ?? facts?.decimals ?? null
  const symbol = fee.symbol ?? facts?.symbol ?? null
  let text = DASH
  if (fee.amountRaw && decimals !== null && symbol)
    text = `${unitsText(fee.amountRaw, decimals, Math.min(6, decimals), locale)} ${symbol}`
  else if (fee.usd !== null && Number.isFinite(fee.usd)) text = feeUsdText(fee.usd, locale)
  else if (fee.basisPoints !== null) text = `${formatAmount(fee.basisPoints / 100, 2, locale)}%`
  return { collected: fee.collected, text, basisPoints: fee.basisPoints, usd: fee.usd }
}

/** A dollar fee under a dollar to four places; a crumb below them is «< $0,0001», never «$0». */
function feeUsdText(usd: number, locale: Locale): string {
  if (usd >= 1) return formatUsd(usd, locale)
  const text = formatAmount(usd, 4, locale)
  return usd > 0 && !/[1-9]/.test(text) ? `< $${formatAmount(0.0001, 4, locale)}` : `$${text}`
}

export function historyRow(action: WalletAction, locale: Locale, known: KnownMints = BUILT_IN_MINTS): HistoryRow {
  const out = legOf(action.out, known, locale)
  const arrived = legOf(action.in, known, locale)
  const mints = [out?.mint ?? null, arrived?.mint ?? null].filter((mint): mint is string => mint !== null)
  return {
    id: action.actionId,
    kind: historyKind(action),
    status: historyStatus(action.outcome),
    at: action.startedAt,
    updatedAt: action.updatedAt,
    out,
    in: arrived,
    fee: feeOf(action, known, locale),
    statedUsd: typeof action.statedUsd === 'number' && Number.isFinite(action.statedUsd) ? action.statedUsd : null,
    signature: action.signature ?? null,
    sourceTx: action.sourceTx ?? null,
    destinationTx: action.destinationTx ?? null,
    destination: action.destination ?? null,
    mints,
    plan: action.origin?.plan ? { planId: action.origin.plan.planId, version: action.origin.plan.version } : null,
    rule: Boolean(action.origin?.rule),
    launch:
      action.origin?.surface === 'LAUNCH'
        ? { token: action.origin.token ?? null, venue: action.origin.venue ?? null }
        : null,
  }
}

/** The mints whose decimals or name the records leave out — what the app should look up before drawing the rows. */
export function unresolvedMints(actions: readonly WalletAction[], known: KnownMints = BUILT_IN_MINTS): string[] {
  const out = new Set<string>()
  const consider = (mint: string | null, decimals: number | null, symbol: string | null) => {
    if (mint === null || (decimals !== null && symbol !== null)) return
    if (known.has(mint) || BUILT_IN_MINTS.has(mint)) return
    out.add(mint)
  }
  for (const action of actions) {
    for (const leg of [action.out, action.in]) if (leg) consider(marketMint(leg), leg.decimals, leg.symbol)
    if (action.fee?.asset) consider(action.fee.asset, action.fee.decimals, action.fee.symbol)
  }
  return [...out]
}

/** The statement, newest first, with what the app knows folded in. */
export function historyRows(
  actions: readonly WalletAction[],
  locale: Locale,
  known: KnownMints = BUILT_IN_MINTS,
): HistoryRow[] {
  return actions.map((action) => historyRow(action, locale, known)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** The rows that touched one asset. */
export function rowsForMint(rows: readonly HistoryRow[], mint: string): HistoryRow[] {
  return rows.filter((row) => row.mints.includes(mint))
}

export type HistoryDay = Readonly<{ day: string; rows: readonly HistoryRow[] }>

/** Rows grouped by the calendar day they started, in the order given. */
export function groupByDay(rows: readonly HistoryRow[]): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const row of rows) {
    const time = Date.parse(row.at)
    const date = Number.isNaN(time) ? new Date(0) : new Date(time)
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
    const last = days[days.length - 1]
    if (last && last.day === day) days[days.length - 1] = { day, rows: [...last.rows, row] }
    else days.push({ day, rows: [row] })
  }
  return days
}

/** The words a title needs, in one language. */
export type HistoryWords = Readonly<{
  bought: (symbol: string) => string
  sold: (symbol: string) => string
  swapped: (from: string, to: string) => string
  sent: (symbol: string) => string
  received: (symbol: string) => string
  bridged: (to: string | null) => string
  crossSwapped: (from: string, to: string) => string
  /**
   * The operation as a noun, for one that has not happened — failed, pending or waiting on the person: «Купівля STAIR»,
   * never «Куплено …». The asset is the one the operation is about; unknown, the noun stands alone.
   */
  purchase: (symbol: string | null) => string
  sale: (symbol: string | null) => string
  swap: (from: string, to: string) => string
  transfer: (symbol: string) => string
  incoming: (symbol: string) => string
  bridge: (to: string | null) => string
  operation: string
}>

/**
 * One line that says what happened, in the asset's names. Only a confirmed operation is said as done; any other is
 * named by its noun. A purchase is named by what it bought and a sale by what it sold — never by the other side, so
 * a failed STAIR buy paid in USDC is «Купівля» (or «Купівля STAIR»), never «Куплено USDC».
 */
export function historyTitle(row: HistoryRow, words: HistoryWords): string {
  const outSymbol = row.out?.symbol ?? DASH
  const inSymbol = row.in?.symbol ?? DASH
  const done = row.status === 'done'
  switch (row.kind) {
    case 'buy': {
      const bought = row.in?.symbol ?? null
      return done && bought !== null ? words.bought(bought) : words.purchase(bought)
    }
    case 'sell': {
      const sold = row.out?.symbol ?? null
      return done && sold !== null ? words.sold(sold) : words.sale(sold)
    }
    case 'swap':
      return done ? words.swapped(outSymbol, inSymbol) : words.swap(outSymbol, inSymbol)
    case 'send':
      return done ? words.sent(outSymbol) : words.transfer(outSymbol)
    case 'receive':
      return done ? words.received(inSymbol) : words.incoming(inSymbol)
    case 'bridge':
      return done ? words.bridged(destinationNetwork(row)) : words.bridge(destinationNetwork(row))
    case 'crossSwap':
      return words.crossSwapped(outSymbol, inSymbol)
    default:
      return words.operation
  }
}

/** The one line under the title: what moved, in units — "0.02 SOL → 1.921719 USDC". */
export function historyAmounts(row: HistoryRow): string {
  const leg = (value: HistoryLeg | null) => (value ? `${value.amountText} ${value.symbol}` : null)
  const out = leg(row.out)
  const arrived = leg(row.in)
  if (out && arrived) return `${out} → ${arrived}`
  return out ?? arrived ?? DASH
}

/** Which chain a transaction's identity is shaped for: an EVM hash, a Solana signature, or neither. */
export function hashChain(hash: string | null): 'evm' | 'solana' | null {
  if (hash === null) return null
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return 'evm'
  if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(hash)) return 'solana'
  return null
}

const EVM_DESTINATIONS: ReadonlySet<string> = new Set(['BASE', 'ETHEREUM', 'ROBINHOOD'])

/**
 * The network the money went to, as the record names it — or none where the record contradicts itself: a row that
 * says «Solana» while its destination transaction is an EVM hash (the ledger files a chain it has no word for under
 * Solana), or an EVM chain with a Solana signature. A guessed network is never printed.
 */
export function destinationNetwork(row: Pick<HistoryRow, 'destination' | 'destinationTx'>): string | null {
  if (row.destination === null) return null
  const chain = hashChain(row.destinationTx)
  if (row.destination === 'SOLANA' && chain === 'evm') return null
  if (EVM_DESTINATIONS.has(row.destination) && chain === 'solana') return null
  return row.destination
}

/** The source chain's transaction, when it is not the row's own signature already shown. */
export function sourceTxShown(row: Pick<HistoryRow, 'signature' | 'sourceTx'>): string | null {
  return row.sourceTx !== null && row.sourceTx !== row.signature ? row.sourceTx : null
}

/** The explorer page of a Solana signature — the proof, one tap deep. */
export function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}`
}
