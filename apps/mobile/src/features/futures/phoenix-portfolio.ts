/**
 * Perps in «Портфель» (C4f, the web's SOL-C6: `app/app/portfolio-value.ts` and `holdings/phoenix-block.tsx` on line A) —
 * pure. A trade opened on the computer must be found on the phone where a person looks
 * for their money. The Phoenix account is read by the wallet's address (`/api/solana/futures/account`), so a position
 * opened anywhere — the web, phoenix.trade — is the same position here.
 *
 * Portfolio's value counts the collateral on Phoenix: its USDC, and SOL posted there at the wallet's own SOL price. A
 * position's unrealised result is margin, not a balance: it is never in the sum, only beside the positions. A part not
 * read is named, never counted as zero.
 */

import { freeCollateralUsd } from './perp-order-model.ts'
import type { FuturesAccount, FuturesMarket, FuturesOrder, FuturesPosition } from './futures-model.ts'

/** The account states that hold nothing: Phoenix never saw the wallet, or the account was never opened. */
const NO_ACCOUNT: ReadonlySet<string> = new Set(['none', 'uninitialized'])

const sameSymbol = (left: string, right: string) => left.toUpperCase() === right.toUpperCase()

/** A position's unrealised result at the market's mark, USD; null when its size, entry or the mark is unknown. */
export function positionResultUsd(position: FuturesPosition, mark: number | null): number | null {
  if (position.size === null || position.entryPrice === null || mark === null) return null
  return (mark - position.entryPrice) * position.size * (position.side === 'long' ? 1 : -1)
}

export type PhoenixPositionView = Readonly<{ position: FuturesPosition; mark: number | null; resultUsd: number | null }>

export type PhoenixHolding = Readonly<{
  collateralUsd: number | null
  collateralSol: number | null
  /** What may still go into a trade: the account's value over the margin its positions hold. */
  freeUsd: number | null
  positions: readonly PhoenixPositionView[]
  orders: readonly FuturesOrder[]
  /** Every position's result together; null when one of them is not known — a part would read as the whole. */
  resultUsd: number | null
  riskTier: string | null
  observedAt: number
}>

/**
 * The account as Portfolio shows it; null when there is nothing to show — no account, or one that holds no collateral,
 * no position and no order.
 */
export function phoenixHolding(
  account: FuturesAccount | null | undefined,
  markets: readonly Pick<FuturesMarket, 'symbol' | 'markPrice'>[],
): PhoenixHolding | null {
  if (!account || NO_ACCOUNT.has(account.state)) return null
  const holds =
    (account.collateralUsd !== null && account.collateralUsd > 0) ||
    (account.collateralSol !== null && account.collateralSol > 0) ||
    account.positions.length > 0 ||
    account.orders.length > 0
  if (!holds) return null
  const positions = account.positions.map((position) => {
    const mark = markets.find((market) => sameSymbol(market.symbol, position.symbol))?.markPrice ?? null
    return { position, mark, resultUsd: positionResultUsd(position, mark) }
  })
  const results = positions.map((entry) => entry.resultUsd)
  const resultUsd =
    results.length > 0 && results.every((value) => value !== null)
      ? results.reduce<number>((sum, value) => sum + (value as number), 0)
      : null
  return {
    collateralUsd: account.collateralUsd,
    collateralSol: account.collateralSol,
    freeUsd: freeCollateralUsd(account.margin),
    positions,
    orders: account.orders,
    resultUsd,
    riskTier: account.margin?.riskTier ?? null,
    observedAt: account.observedAt,
  }
}

/**
 * The collateral's dollars: its USDC, and SOL posted at the wallet's SOL price. Null when the account did not state its
 * dollars, or SOL is posted and there is no SOL price — never counted as zero.
 */
export function collateralValueUsd(
  account: FuturesAccount | null | undefined,
  solPriceUsd: number | null,
): number | null {
  if (!account || NO_ACCOUNT.has(account.state) || account.collateralUsd === null) return null
  const sol = account.collateralSol ?? 0
  if (sol > 0 && (solPriceUsd === null || !(solPriceUsd > 0))) return null
  return account.collateralUsd + (sol > 0 ? sol * (solPriceUsd as number) : 0)
}

/** How the Phoenix part of the value stands: counted in, still being read, not read, or there is none. */
export type PhoenixPart = 'counted' | 'reading' | 'unread' | 'none'

export type ValueWithPhoenix = Readonly<{
  /** The wallet's value plus the collateral when it was read; the wallet's alone otherwise; null without the wallet's. */
  total: number | null
  /** The collateral counted, USD; null when it is not in the total. */
  phoenixUsd: number | null
  phoenix: PhoenixPart
}>

/**
 * Portfolio's value with the collateral on Phoenix (SOL-C6): the wallet decides whether there is a number; the account
 * adds its USDC and its SOL at the wallet's SOL price. An account that is there but did not state its dollars, or SOL
 * posted with no SOL price, is not read — the number then stands for the wallet, and says so.
 */
export function valueWithPhoenix(
  walletTotal: number | null,
  /** The account's read; a failed refresh that keeps the last account is that account (`use-futures`'s rule). */
  read: Readonly<{ status: 'pending' | 'error' | 'success'; account: FuturesAccount | null | undefined }> | null,
  solPriceUsd: number | null,
): ValueWithPhoenix {
  const alone = (phoenix: PhoenixPart): ValueWithPhoenix => ({ total: walletTotal, phoenixUsd: null, phoenix })
  // No number for the wallet: nothing is said to be «in» a dash.
  if (read === null || walletTotal === null) return alone('none')
  if (!read.account) return alone(read.status === 'pending' ? 'reading' : 'unread')
  const account = read.account
  if (NO_ACCOUNT.has(account.state)) return alone('none')
  const phoenixUsd = collateralValueUsd(account, solPriceUsd)
  if (phoenixUsd === null) return alone('unread')
  if (phoenixUsd <= 0) return { total: walletTotal, phoenixUsd: null, phoenix: 'none' }
  return { total: walletTotal === null ? null : walletTotal + phoenixUsd, phoenixUsd, phoenix: 'counted' }
}
