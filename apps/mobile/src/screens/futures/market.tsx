import { useQueryClient } from '@tanstack/react-query'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { CandleChart } from '@/components/candle-chart'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { barScale } from '@/components/price-chart'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { FUTURES_COPY, sessionWord } from '@/features/futures/futures-copy'
import { bookPick, chartIdOf, chartReadOf, viewOnlyReason } from '@/features/futures/futures-chart'
import {
  accountOn,
  bookView,
  dayChangePct,
  marketOf,
  sizeDecimals,
  type FuturesBook,
  type FuturesMarket,
} from '@/features/futures/futures-model'
import { ORDER_COPY } from '@/features/futures/order-copy'
import { useFuturesAccount, useFuturesBook, useFuturesCandles, useFuturesMarkets } from '@/features/futures/use-futures'
import { useOrderGate } from '@/features/futures/use-orders'
import { PRO_TIMEFRAMES, type ProTimeframe } from '@/features/pro-chart/bridge'
import { DETAILS_COPY } from '@/features/invest/details-copy'
import { PRO_CHART_COPY } from '@/features/pro-chart/copy'
import { useAccount } from '@/features/session/use-account'
import { useRefreshOnOpen } from '@/hooks/use-refresh-on-open'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'
import { ChartLicences, CoreChart } from '@/screens/pro-chart'
import { cn } from '@/utils/cn'
import {
  formatAmount,
  formatClock,
  formatPercent,
  formatPrice,
  formatUsdCompact,
  percentSignOf,
  saidFigure,
} from '@/utils/format'

import { OrderRow, PositionRow } from './account-card'
import { CollateralSheet } from './collateral-sheet'
import { actsOn, OrderSheet, type OrderIntent } from './order-sheet'

const TIMEFRAME_KEY = 'futures.timeframe'
/** The page's own chart: four intervals, as the asset page's; the full chart has every one. */
const PAGE_TIMEFRAMES = ['5m', '1h', '4h', '1d'] as const satisfies readonly ProTimeframe[]
type PageTimeframe = (typeof PAGE_TIMEFRAMES)[number]
const PRO_TIMEFRAME_KEY = 'futures.proTimeframe'

const clockOf = (at: number) => formatClock(new Date(at).toISOString())

/** The spread as a share of the middle; a spread under a hundredth of a percent is «< 0,01%», never a zero. */
const spreadShare = (pct: number, locale: Locale) =>
  pct > 0 && pct < 0.01
    ? `< ${formatPercent(0.01, locale).replace(/^\+/, '')}`
    : formatPercent(pct, locale).replace(/^\+/, '')

/**
 * The market's chart as a phone draws it: the candles of four intervals, a finger reading a bar, Phoenix and the time
 * of the read in one line under it. The full chart — the core's own, every interval, indicators and drawings — is one
 * press away on a screen of its own, where it has the room.
 */
function FuturesChart({ symbol }: { symbol: string }) {
  const router = useRouter()
  const words = useCopy(FUTURES_COPY)
  const details = useCopy(DETAILS_COPY)
  const proWords = useCopy(PRO_CHART_COPY)
  const locale = useLocale()
  const [timeframe, setTimeframeState] = useState<PageTimeframe>(() =>
    readPreference(TIMEFRAME_KEY, PAGE_TIMEFRAMES, '1h'),
  )
  const setTimeframe = (next: PageTimeframe) => {
    setTimeframeState(next)
    writePreference(TIMEFRAME_KEY, next)
  }
  const candles = useFuturesCandles(symbol, timeframe)
  const choices: readonly Choice<PageTimeframe>[] = PAGE_TIMEFRAMES.map((value) => ({
    value,
    label: details.timeframes[value].label,
    accessibilityLabel: details.timeframes[value].a11y,
  }))
  const data = candles.data
  let body
  if (data && data.candles.length > 0) {
    body = <CandleChart candles={data.candles} scale={barScale(timeframe)} locale={locale} />
  } else if (data) {
    body = (
      <Txt variant="ui" tone="muted" className="py-10 text-center">
        {details.chartNone}
      </Txt>
    )
  } else if (candles.isPending) {
    body = (
      <Skeleton className="h-60 w-full rounded-sm" accessibilityRole="progressbar" accessibilityLabel={words.loading} />
    )
  } else {
    body = (
      <View className="items-center gap-3 py-8">
        <Txt variant="ui" tone="muted" className="text-center">
          {isNetworkError(candles.error) ? words.noConnection : words.down}
        </Txt>
        <Button
          title={words.tryAgain}
          variant="secondary"
          size="sm"
          loading={candles.isFetching}
          onPress={() => void candles.refetch()}
        />
      </View>
    )
  }
  // Whose bars and when they were read, in one line; a refresh that failed keeps the last read and says it is stale.
  const status = data
    ? [words.readAt(clockOf(data.observedAt)), candles.isError ? details.chartStale : null].filter(Boolean).join(' · ')
    : null
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <ChoiceChips choices={choices} value={timeframe} onChange={setTimeframe} size="sm" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={proWords.doorA11y(words.perp(symbol))}
          onPress={() => router.push({ pathname: '/futures/chart/[symbol]', params: { symbol } } as never)}
          hitSlop={8}
          className="min-h-9 flex-row items-center gap-1.5 rounded-pill px-2 active:bg-hover"
        >
          <Icon name="expand-outline" size={16} color="muted" />
        </Pressable>
      </View>
      {body}
      {status ? (
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {status}
        </Txt>
      ) : null}
    </Card>
  )
}

/**
 * The full chart of a Phoenix market on a screen of its own: the core's chart (CH-21) on Phoenix's bars — every
 * interval, candle types, scales, indicators and drawings, its source and their time under it — with the room it needs.
 */
export function FuturesProChartScreen({ symbol }: { symbol: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const words = useCopy(FUTURES_COPY)
  const chartWords = useCopy(PRO_CHART_COPY)
  const [timeframe, setTimeframeState] = useState<ProTimeframe>(() =>
    readPreference(PRO_TIMEFRAME_KEY, PRO_TIMEFRAMES, '1h'),
  )
  const setTimeframe = (next: ProTimeframe) => {
    setTimeframeState(next)
    writePreference(PRO_TIMEFRAME_KEY, next)
  }
  const candles = useFuturesCandles(symbol, timeframe)
  // A refresh that failed keeps the last read and says it is stale.
  const read = useMemo(
    () => (candles.data ? chartReadOf(candles.data, timeframe, candles.isError) : null),
    [candles.data, timeframe, candles.isError],
  )
  const trouble = !candles.data && candles.isError ? (isNetworkError(candles.error) ? 'offline' : 'down') : null
  const market = useMemo(() => ({ mint: chartIdOf(symbol), symbol: words.perp(symbol), stock: false }), [symbol, words])
  const back = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: '/futures/[symbol]', params: { symbol } } as never)
  return (
    <Screen
      title={words.perp(symbol)}
      subtitle="Phoenix"
      onBack={back}
      scroll={false}
      right={
        <HelpDot title={chartWords.helpTitle} body={chartWords.help}>
          <ChartLicences label={chartWords.licences} />
        </HelpDot>
      }
    >
      <CoreChart
        className="flex-1"
        market={market}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        read={read}
        trouble={trouble}
        retrying={candles.isFetching}
        onRetry={() => void candles.refetch()}
        onReopen={() => {
          if (candles.isError) void candles.refetch()
        }}
        label={`${words.perp(symbol)} · ${words.chart}`}
      />
      <View style={{ height: Math.max(insets.bottom, 12) }} />
    </Screen>
  )
}

/** One figure of the head: its label over it. */
function HeadFigure({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <View className="w-1/2 gap-0.5 py-1 pr-3">
      <Txt variant="labelSm" tone="faint">
        {label}
      </Txt>
      <Txt variant="data" tone={tone}>
        {value}
      </Txt>
    </View>
  )
}

/**
 * The market's head, as the web's: the mark price large with the day's move, then the index, the open interest in
 * dollars, the day's volume and the highest leverage — all one read of Phoenix, its time beside the mark. No funding
 * rate here: Phoenix does not name its unit; the Review shows it from Phoenix's own view.
 */
function FuturesHead({ market, observedAt }: { market: FuturesMarket; observedAt: number | null }) {
  const words = useCopy(FUTURES_COPY)
  const locale = useLocale()
  const change = dayChangePct(market)
  const move = percentSignOf(change)
  const session = market.calendar ? sessionWord(market.session, words) : null
  return (
    <View className="gap-2">
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Txt variant="dataLg">{formatPrice(market.markPrice, locale)}</Txt>
          <Chip
            label={formatPercent(change, locale)}
            tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'neutral'}
            mono
          />
          {market.status === 'gated' ? <Chip label={words.gated} tone="warning" caps={false} /> : null}
          {session ? <Chip label={session} tone="neutral" caps={false} /> : null}
        </View>
        <Txt variant="labelSm" tone="faint">
          {observedAt !== null ? `${words.mark} · ${words.readAt(clockOf(observedAt))}` : words.mark}
        </Txt>
      </View>
      <View className="flex-row flex-wrap">
        <HeadFigure label={words.index} value={formatPrice(market.oraclePrice, locale)} />
        {/* No open interest: the web keeps it off its head until a live read says whether Phoenix counts one side (request 75). */}
        <HeadFigure label={words.volume} value={formatUsdCompact(market.dayVolumeUsd, locale)} />
        <HeadFigure
          label={words.leverage}
          value={market.maxLeverage !== null ? `${formatAmount(market.maxLeverage, 0, locale)}×` : '—'}
        />
      </View>
    </View>
  )
}

/**
 * The book's best eight levels a side, the asks over the bids so the two best prices meet at the spread; each level's
 * depth a quiet bar behind it. Re-read every five seconds while the page is in front; the time of the read beside it.
 * Where this wallet can trade here, a level pressed opens the ticket on Limit at its price — an ask a long, a bid a
 * short.
 */
function FuturesBookCard({
  symbol,
  book,
  onPick,
}: {
  symbol: string
  book: ReturnType<typeof useFuturesBook>
  onPick: ((side: 'bid' | 'ask', price: number) => void) | null
}) {
  const words = useCopy(FUTURES_COPY)
  const locale = useLocale()
  const level = (side: 'bid' | 'ask', price: number, size: number, share: number, digits: number) => {
    const shownPrice = formatPrice(price, locale)
    const shownSize = formatAmount(size, 4, locale, digits)
    const said = words.levelA11y(side, saidFigure(shownPrice, locale), saidFigure(shownSize, locale))
    return (
      <Pressable
        key={`${side}-${price}`}
        accessible
        accessibilityRole={onPick ? 'button' : undefined}
        accessibilityLabel={onPick ? `${said}. ${words.pickA11y(side, saidFigure(shownPrice, locale))}` : said}
        disabled={!onPick}
        onPress={onPick ? () => onPick(side, price) : undefined}
        className="h-8 flex-row items-center justify-between px-1 active:bg-hover"
      >
        <View
          pointerEvents="none"
          className={cn(
            'absolute bottom-0.5 right-0 top-0.5 rounded-xs',
            side === 'bid' ? 'bg-success-soft' : 'bg-danger-soft',
          )}
          style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
        />
        <Txt variant="data" tone={side === 'bid' ? 'success' : 'danger'}>
          {shownPrice}
        </Txt>
        <Txt variant="data" tone="muted">
          {shownSize}
        </Txt>
      </Pressable>
    )
  }
  let body
  if (book.data) {
    const view = bookView(book.data)
    const digits = sizeDecimals([...view.asks, ...view.bids].map((row) => row.size))
    body =
      view.asks.length === 0 && view.bids.length === 0 ? (
        <Txt variant="ui" tone="muted" className="py-4 text-center">
          {words.bookEmpty}
        </Txt>
      ) : (
        <View>
          <View className="flex-row justify-between px-1 pb-1">
            <Txt variant="labelSm" tone="faint">
              {words.price}
            </Txt>
            <Txt variant="labelSm" tone="faint">
              {words.sizeIn(symbol)}
            </Txt>
          </View>
          {view.asks.map((row) => level('ask', row.price, row.size, row.share, digits))}
          <View className="flex-row justify-between border-y border-line px-1 py-1.5">
            <Txt variant="labelSm" tone="faint">
              {words.spread}
            </Txt>
            <Txt variant="labelSm" tone="faint">
              {view.spread ? `${formatPrice(view.spread.usd, locale)} · ${spreadShare(view.spread.pct, locale)}` : '—'}
            </Txt>
          </View>
          {view.bids.map((row) => level('bid', row.price, row.size, row.share, digits))}
          {onPick ? (
            <Txt variant="labelSm" tone="faint" className="px-1 pt-2">
              {words.pickHint}
            </Txt>
          ) : null}
        </View>
      )
  } else if (book.isPending) {
    body = (
      <Skeleton
        className="h-64 w-full rounded-sm"
        accessibilityRole="progressbar"
        accessibilityLabel={words.loadingBook}
      />
    )
  } else {
    body = (
      <Txt variant="ui" tone="muted" className="py-4 text-center">
        {isNetworkError(book.error) ? words.noConnection : words.down}
      </Txt>
    )
  }
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title">{words.book}</Txt>
        {book.data ? (
          <Txt variant="labelSm" tone="faint">
            {words.readAt(clockOf(book.data.observedAt))}
          </Txt>
        ) : null}
      </View>
      {body}
    </Card>
  )
}

/**
 * The wallet's positions and resting orders on this market, by its address; not drawn without a wallet. Where orders
 * are open, each position of the cross-margin account carries its acts in its row — TP/SL, cut, close — and each
 * resting order its cancel, every one through the order sheet; an isolated position says it is managed on
 * phoenix.trade.
 */
function FuturesYoursCard({
  symbol,
  acts,
  onIntent,
}: {
  symbol: string
  acts: boolean
  onIntent: (intent: OrderIntent) => void
}) {
  const words = useCopy(FUTURES_COPY)
  const orderWords = useCopy(ORDER_COPY)
  const locale = useLocale()
  const wallet = useAccount()
  const account = useFuturesAccount(wallet.address)
  if (!wallet.address || (!account.data && !account.isError)) return null
  if (!account.data) {
    return (
      <Card className="gap-1">
        <Txt variant="title">{words.yours}</Txt>
        <Txt variant="ui" tone="muted" className="py-2">
          {isNetworkError(account.error) ? words.noConnection : words.down}
        </Txt>
      </Card>
    )
  }
  const { positions, orders } = accountOn(account.data, symbol)
  const total = positions.length + orders.length
  const edge = (index: number) => (index === total - 1 ? '' : 'border-b border-line')
  return (
    <Card className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title">{words.yours}</Txt>
        <Txt variant="labelSm" tone="faint">
          {words.readAt(clockOf(account.data.observedAt))}
        </Txt>
      </View>
      {total === 0 ? (
        <Txt variant="ui" tone="muted" className="py-2">
          {words.noneHere(symbol)}
        </Txt>
      ) : (
        <View>
          {positions.map((position, index) => {
            const legs =
              position.tpPrice !== null || position.slPrice !== null
                ? `TP ${formatPrice(position.tpPrice, locale)} · SL ${formatPrice(position.slPrice, locale)}`
                : null
            return (
              <View key={`${position.side}-${index}`} className={cn('pb-2.5', edge(index))}>
                <PositionRow position={position} words={words} locale={locale} last named={false} />
                {legs ? (
                  <Txt variant="labelSm" tone="faint" className="pb-2">
                    {legs}
                  </Txt>
                ) : null}
                {!actsOn(position) ? (
                  <Txt variant="labelSm" tone="faint">
                    {orderWords.isolatedHere}
                  </Txt>
                ) : acts ? (
                  <View className="flex-row gap-2">
                    <Button
                      title={orderWords.tpsl}
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onPress={() => onIntent({ kind: 'protect', position })}
                    />
                    <Button
                      title={orderWords.cut}
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onPress={() => onIntent({ kind: 'reduce', position })}
                    />
                    <Button
                      title={orderWords.close}
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onPress={() => onIntent({ kind: 'close', position })}
                    />
                  </View>
                ) : null}
              </View>
            )
          })}
          {orders.map((order, index) => (
            <View key={order.id} className={cn('pb-2.5', edge(positions.length + index))}>
              <OrderRow order={order} words={words} locale={locale} last named={false} />
              {acts && order.sequence && actsOn(order) ? (
                <Button
                  title={orderWords.cancelOrder}
                  variant="secondary"
                  size="sm"
                  onPress={() => onIntent({ kind: 'cancel', order })}
                />
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Card>
  )
}

/**
 * One Phoenix market (C4c), at the web's level and simpler: the head (mark, its day's move, index, open interest,
 * volume, leverage), the core's chart on Phoenix's bars, what the wallet holds here with its acts, and the book a price
 * of which opens the ticket on Limit. Long and short under it while this wallet can trade here; otherwise the page is
 * view only, and its «?» says why.
 */
export function FuturesMarketScreen({
  symbol,
  openSide = null,
}: {
  symbol: string
  /** The ticket asked for by the link, opened once the market can trade here (C4e). */
  openSide?: 'long' | 'short' | null
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const words = useCopy(FUTURES_COPY)
  const orderWords = useCopy(ORDER_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const wallet = useAccount()
  const account = useFuturesAccount(wallet.address)
  const gate = useOrderGate(wallet.address)
  const states = gate.states
  const [intent, setIntent] = useState<OrderIntent | null>(null)
  const [asked, setAsked] = useState(openSide)
  const [collateral, setCollateral] = useState<'deposit' | 'withdraw' | null>(null)
  const markets = useFuturesMarkets()
  useRefreshOnOpen([markets])
  // The book is read only while the page is in front: a page left behind under another one asks Phoenix nothing.
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  const book = useFuturesBook(symbol, focused)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/markets?seg=futures' as never))
  const market = markets.data ? marketOf(markets.data.markets, symbol) : null
  const title = market ? words.perp(market.symbol) : words.perp(symbol)
  /* The last market read stays under an open order sheet: a refresh that drops the market never takes a Review, an
     open wallet or a sent order's receipt with it (state adjusted during render, as React prescribes). */
  const [held, setHeld] = useState<FuturesMarket | null>(null)
  if (market && market !== held) setHeld(market)
  const sheetMarket = market ?? held

  if (markets.data && !market && intent === null) {
    return (
      <Screen title={title} onBack={back}>
        <StateView
          icon="search-outline"
          title={words.notFound}
          action={{ title: words.backToFutures, onPress: back }}
        />
      </Screen>
    )
  }

  /* Orders from here where Phoenix takes them on this market, Ryntra's cross margin can hold them (C4b) and the
     server's gate is open for this wallet; else view only, and the «?» says why. */
  const reason = viewOnlyReason(market, wallet.address, gate.read ? states.open : null, account.data?.state ?? null)
  const canTrade = market !== null && reason === null
  // The link's ticket, once (state adjusted during render, as React prescribes): decided as soon as the market, the
  // wallet's account and the gate are read — opened only where orders go from here, never later by surprise.
  if (asked !== null && market !== null && (wallet.address === null || (account.data && gate.read))) {
    setAsked(null)
    if (canTrade && intent === null) setIntent({ kind: 'open', side: asked })
  }
  // Whose market and how far it goes, in one line that fits a phone's width: «Phoenix · до 20× · Лише перегляд».
  const subtitle = [
    'Phoenix',
    market?.maxLeverage ? words.upTo(formatAmount(market.maxLeverage, 0, locale)) : null,
    reason ? words.viewOnly : null,
  ]
    .filter(Boolean)
    .join(' · ')
  // The «?» says why first; only the gate's reason goes on to say orders wait for Ryntra — the others keep what Perps are.
  const help = reason
    ? [words.whyViewOnly[reason], ...(reason === 'gate' ? words.help : words.helpOrders.slice(0, 2))]
    : words.helpOrders
  const pick = canTrade ? (side: 'bid' | 'ask', price: number) => setIntent(bookPick(side, price)) : null
  const bookRead: FuturesBook | null = book.data ?? null

  return (
    <View className="flex-1 bg-ground">
      <Screen title={title} subtitle={subtitle} onBack={back} right={<HelpDot title={words.helpTitle} body={help} />}>
        {market ? (
          <FuturesHead market={market} observedAt={markets.data?.observedAt ?? null} />
        ) : markets.isPending ? (
          <Skeleton
            className="h-28 w-full rounded-sm"
            accessibilityRole="progressbar"
            accessibilityLabel={words.loading}
          />
        ) : (
          <StateView
            icon={isNetworkError(markets.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
            tone="danger"
            title={isNetworkError(markets.error) ? words.noConnection : words.down}
            action={{ title: words.tryAgain, onPress: () => void markets.refetch(), loading: markets.isFetching }}
          />
        )}
        <FuturesChart symbol={market?.symbol ?? symbol} />
        <FuturesYoursCard
          symbol={symbol}
          acts={(gate.read ? states.open : true) && market?.status === 'active'}
          onIntent={setIntent}
        />
        <FuturesBookCard symbol={market?.symbol ?? symbol} book={book} onPick={pick} />
      </Screen>
      {canTrade || reason === 'wallet' ? (
        <View
          className="flex-row gap-3 border-t border-line bg-ground px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {canTrade ? (
            <>
              <Button
                title={orderWords.short}
                variant="secondary"
                size="lg"
                className="flex-1"
                onPress={() => setIntent({ kind: 'open', side: 'short' })}
              />
              <Button
                title={orderWords.long}
                size="lg"
                className="flex-1"
                onPress={() => setIntent({ kind: 'open', side: 'long' })}
              />
            </>
          ) : (
            // No wallet on a market that trades here: the one action that ends «view only».
            <Button
              title={shared.connectWallet}
              size="lg"
              className="flex-1"
              loading={wallet.busy === 'connect'}
              onPress={() => void wallet.connect()}
            />
          )}
        </View>
      ) : null}
      {sheetMarket ? (
        <OrderSheet
          market={sheetMarket}
          account={account.data ?? null}
          markAt={markets.data?.observedAt ?? null}
          book={bookRead}
          intent={intent}
          onIntent={setIntent}
          onClose={() => setIntent(null)}
          onDeposit={() => setCollateral('deposit')}
        />
      ) : null}
      {/* Over the ticket, which keeps what was typed: the collateral moved in, the ticket is where it was. */}
      {wallet.address ? (
        <CollateralSheet
          owner={wallet.address}
          action={collateral}
          account={account.data ?? null}
          onClose={() => setCollateral(null)}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ['futures', 'account'] })}
          // Here the deposit is asked from a ticket: no «Відкрити угоду» back into it — and the ticket closes before
          // the sheet leaves for USDC, so the next screen is not drawn under it.
          onLeave={() => setIntent(null)}
        />
      ) : null}
    </View>
  )
}
