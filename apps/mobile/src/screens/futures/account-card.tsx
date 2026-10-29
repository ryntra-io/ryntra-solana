import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { COLLATERAL_COPY } from '@/features/futures/collateral-copy'
import { withdrawableOf, type CollateralAction } from '@/features/futures/collateral-model'
import { FUTURES_COPY, orderTypeWord, type FuturesCopy } from '@/features/futures/futures-copy'
import { freeCollateralUsd } from '@/features/futures/perp-order-model'
import {
  hasAccount,
  type FuturesAccount,
  type FuturesOrder,
  type FuturesPosition,
} from '@/features/futures/futures-model'
import { useFuturesAccount } from '@/features/futures/use-futures'
import { useAccount } from '@/features/session/use-account'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { DASH, formatAmount, formatClock, formatPrice, formatUsd, formatUsdSigned } from '@/utils/format'

import { CollateralSheet } from './collateral-sheet'

/**
 * The account states that limit what it may do — said on the card. `cold` and `active` both take market orders now
 * (Phoenix's `placeMarketOrder.immediate`): «Неактивний» beside a trading account read as «it does not work» (C4e).
 */
const LIMITING_STATES: ReadonlySet<string> = new Set(['reduceOnly', 'frozen', 'unknown'])

/** What the account may still put into a trade, as the ticket says it: «1,85 USDC», a dash when unknown. */
const freeText = (free: number | null, locale: Locale) =>
  free === null ? '—' : `${formatAmount(free, 2, locale, 2)} USDC`

/** How many positions the card shows before «Усі позиції»: a phone's screen, with the markets still under it. */
const POSITIONS_SHOWN = 5

/** A size in the base asset: up to four decimals, a dash when Phoenix's lots could not be read. */
const sizeOf = (size: number | null, locale: Locale) => formatAmount(size, 4, locale)

/** One position: its market, its side and its size, the entry under it. */
export function PositionRow({
  position,
  words,
  locale,
  onPress,
  last,
  named = true,
  result,
}: {
  position: FuturesPosition
  words: FuturesCopy
  locale: Locale
  onPress?: () => void
  last?: boolean
  /** On a market's own page the market is the page's title: the row names only its side. */
  named?: boolean
  /** The position's unrealised result at the mark, USD, where the row shows it (Portfolio, C4f); null — a dash. */
  result?: number | null
}) {
  const side = position.side === 'long' ? words.long : words.short
  const size = `${sizeOf(position.size, locale)} ${position.symbol}`
  const entry = formatPrice(position.entryPrice, locale)
  const shown = result === undefined ? null : result === null ? DASH : formatUsdSigned(result, locale)
  const said = shown === null ? null : `${words.result} ${shown}`
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[`${position.symbol}, ${side}, ${words.size} ${size}, ${words.entry} ${entry}`, said]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center justify-between gap-3 py-2.5 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="flex-row items-center gap-2">
        {named ? <Txt variant="ui">{position.symbol}</Txt> : null}
        <Chip label={side} tone={position.side === 'long' ? 'success' : 'danger'} />
      </View>
      <View className="items-end gap-0.5">
        <Txt variant="data">{size}</Txt>
        <Txt variant="labelSm" tone="faint">{`${words.entry} ${entry}`}</Txt>
        {shown !== null ? (
          <Txt
            variant="data"
            tone={result === null || result === undefined || result === 0 ? 'muted' : result > 0 ? 'success' : 'danger'}
          >
            {shown}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  )
}

/** One resting order: its market, its side and type, what is left at what price. */
export function OrderRow({
  order,
  words,
  locale,
  onPress,
  last,
  named = true,
}: {
  order: FuturesOrder
  words: FuturesCopy
  locale: Locale
  onPress?: () => void
  last?: boolean
  /** On a market's own page the market is the page's title: the row names only its side. */
  named?: boolean
}) {
  const side = order.side === 'buy' ? words.buy : words.sell
  const marks = [
    orderTypeWord(order.type, words),
    order.reduceOnly ? words.reduceOnly : null,
    order.stop ? words.stop : null,
  ]
    .filter((mark): mark is string => mark !== null)
    .join(' · ')
  const size = `${sizeOf(order.size, locale)} ${order.symbol}`
  const price = words.at(formatPrice(order.price, locale))
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${order.symbol}, ${side}, ${marks}, ${size} ${price}`}
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center justify-between gap-3 py-2.5 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          {named ? <Txt variant="ui">{order.symbol}</Txt> : null}
          <Txt variant="ui" tone={order.side === 'buy' ? 'success' : 'danger'}>
            {side}
          </Txt>
        </View>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {marks}
        </Txt>
      </View>
      <View className="items-end gap-0.5">
        <Txt variant="data">{size}</Txt>
        <Txt variant="labelSm" tone="faint">
          {price}
        </Txt>
      </View>
    </Pressable>
  )
}

/**
 * Whether the account has collateral to move: Phoenix's own figure of what may leave when the page holds it, else any
 * USDC collateral at all (what positions hold is then said inside «Вивести»).
 */
function hasWithdrawable(account: FuturesAccount): boolean {
  const withdrawable = withdrawableOf(account.margin)
  if (withdrawable !== null) return withdrawable > 0n
  return account.collateralUsd !== null && account.collateralUsd > 0
}

/**
 * «Поповнити» and «Вивести» under the account (C4c): an account Phoenix knows with nothing in it has one next action,
 * the deposit, with the line that says why; an account with collateral has both. A wallet Phoenix never saw gets
 * neither — the server opens no account (Phoenix's accounts are by invite) and its line says so, as the web's.
 */
function CollateralActions({
  account,
  onMove,
}: {
  account: FuturesAccount
  onMove: (action: CollateralAction) => void
}) {
  const words = useCopy(COLLATERAL_COPY)
  const empty = (account.collateralUsd === null || account.collateralUsd <= 0) && account.positions.length === 0
  const withdraw = !empty && hasWithdrawable(account)
  return (
    <View className="gap-2 pt-3">
      {empty ? (
        <Txt variant="ui" tone="muted">
          {words.emptyLine}
        </Txt>
      ) : null}
      <View className="flex-row gap-2">
        <Button title={words.deposit} variant="secondary" className="flex-1" onPress={() => onMove('deposit')} />
        {withdraw ? (
          <Button title={words.withdraw} variant="secondary" className="flex-1" onPress={() => onMove('withdraw')} />
        ) : null}
      </View>
    </View>
  )
}

/**
 * The connected wallet's Phoenix account over the markets: its state and collateral, its open positions — each opens
 * its market — how many orders rest in the book, and «Поповнити» · «Вивести» for its USDC collateral. Read by the
 * wallet's public address alone. Without a wallet, one line and the one action that ends it.
 */
export function FuturesAccountCard({ onOpen }: { onOpen: (symbol: string, side?: 'long' | 'short') => void }) {
  const words = useCopy(FUTURES_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const wallet = useAccount()
  const account = useFuturesAccount(wallet.address)
  const [everyPosition, setEveryPosition] = useState(false)
  const [move, setMove] = useState<CollateralAction | null>(null)
  /* «Відкрити угоду» from a deposit the wallet cannot make (C4e): only for an account that trades, on the market of its
     first cross-margin position, else SOL — the ticket opens there at once. */
  const trades =
    account.data != null &&
    hasAccount(account.data) &&
    account.data.state !== 'uninitialized' &&
    !LIMITING_STATES.has(account.data.state)
  const tradeSymbol = account.data?.positions.find((position) => position.subaccount === 0)?.symbol ?? 'SOL'

  if (!wallet.address) {
    return (
      <Card className="gap-3">
        <Txt variant="title">{words.account}</Txt>
        <Txt variant="ui" tone="muted">
          {words.connectLine}
        </Txt>
        <Button
          title={shared.connectWallet}
          variant="secondary"
          onPress={() => void wallet.connect()}
          loading={wallet.busy === 'connect'}
        />
      </Card>
    )
  }

  let body
  // Never seen by Phoenix, or a trader account not yet set up: no deposit opens one (the server answers ACCOUNT_NEEDED).
  if (account.data && (!hasAccount(account.data) || account.data.state === 'uninitialized')) {
    body = (
      <View>
        <Txt variant="ui" tone="muted">
          {words.noAccount}
        </Txt>
      </View>
    )
  } else if (account.data) {
    const { state, collateralUsd, collateralSol, positions, orders } = account.data
    // A desk that holds dozens of positions shows its first few; the rest one tap away, so the markets stay in reach.
    const folded = positions.length > POSITIONS_SHOWN && !everyPosition
    const shown = folded ? positions.slice(0, POSITIONS_SHOWN) : positions
    const hasMore = positions.length > POSITIONS_SHOWN
    body = (
      <View>
        {LIMITING_STATES.has(state) ? (
          <FactRow label={words.state} value={words.states[state === 'none' ? 'unknown' : state]} mono={false} />
        ) : null}
        <FactRow label={words.collateral} value={formatUsd(collateralUsd, locale)} />
        <FactRow label={words.free} value={freeText(freeCollateralUsd(account.data.margin), locale)} />
        {collateralSol !== null && collateralSol > 0 ? (
          <FactRow label={words.collateralSol} value={formatAmount(collateralSol, 4, locale)} />
        ) : null}
        <Txt variant="label" tone="faint" className="pt-3">
          {words.positions}
        </Txt>
        {positions.length === 0 ? (
          <Txt variant="ui" tone="muted" className="py-2.5">
            {words.noPositions}
          </Txt>
        ) : (
          shown.map((position, index) => (
            <PositionRow
              key={`${position.symbol}-${position.side}-${index}`}
              position={position}
              words={words}
              locale={locale}
              onPress={() => onOpen(position.symbol)}
              last={index === shown.length - 1 && !hasMore && orders.length === 0}
            />
          ))
        )}
        {hasMore ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setEveryPosition(folded)}
            className="flex-row items-center justify-between py-2.5 active:bg-hover"
          >
            <Txt variant="ui" tone="brand">
              {folded ? words.everyPosition(positions.length) : words.fewerPositions}
            </Txt>
          </Pressable>
        ) : null}
        {orders.length > 0 ? (
          <Txt variant="ui" tone="muted" className="pt-2.5">
            {words.ordersCount(orders.length)}
          </Txt>
        ) : null}
        <CollateralActions account={account.data} onMove={setMove} />
      </View>
    )
  } else if (account.isPending) {
    body = <Skeleton className="h-24 w-full rounded-sm" />
  } else {
    body = (
      <View className="gap-2">
        <Txt variant="ui" tone="muted">
          {words.down}
        </Txt>
        <Button title={words.tryAgain} variant="ghost" size="sm" onPress={() => void account.refetch()} />
      </View>
    )
  }

  return (
    <Card className="gap-2">
      {/* The account is read on its own clock: its own time beside its title, never the markets' (critic, C4). */}
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title">{words.account}</Txt>
        {account.data ? (
          <Txt variant="labelSm" tone="faint">
            {words.readAt(formatClock(new Date(account.data.observedAt).toISOString()))}
          </Txt>
        ) : null}
      </View>
      {body}
      <CollateralSheet
        owner={wallet.address}
        action={move}
        account={account.data ?? null}
        onClose={() => setMove(null)}
        onDone={() => void account.refetch()}
        onTrade={trades ? () => onOpen(tradeSymbol, 'long') : undefined}
      />
    </Card>
  )
}
