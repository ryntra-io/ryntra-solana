import { useNavigation, useRoute, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PixelRatio, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { Button } from '@/components/button'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { chartLimited, chartLimitWaitMs, noChart } from '@/features/invest/chart-asks'
import { assetPageBeneath, useAssetActions, type AssetAction } from '@/features/pro-chart/asset-actions'
import {
  BRIDGE_VERSION,
  injectionOf,
  isProTimeframe,
  parsePageMessage,
  PRO_TIMEFRAMES,
  type AppMessage,
  type CandlesMessage,
  type ProTimeframe,
} from '@/features/pro-chart/bridge'
import { PRO_CHART_COPY } from '@/features/pro-chart/copy'
import {
  coverOf,
  PAGE_ORIGIN,
  pageHtmlFor,
  pageMayLoad,
  pageSpeaks,
  pageThemeOf,
  type FirstTrouble,
} from '@/features/pro-chart/page-view'
import { useCandles, useMarket } from '@/hooks/use-market'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'
import { BuyWarning } from '@/screens/asset'
import { useTheme } from '@/theme'

import { CHART_PAGE_HTML, CHART_PAGE_NOTICES } from '../../../chart-page/page.generated'

const TIMEFRAME_KEY = 'chart.pro.timeframe'
/** How long the page may take to say «ready» before the app says it did not open. */
const READY_WITHIN_MS = 20_000

/**
 * The chart engine's notices, word for word as the core ships them (KLineChart is Apache-2.0: whoever receives the
 * bundled code gets its NOTICE and the licence) — one press deep inside the «?» sheet.
 */
export function ChartLicences({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((shown) => !shown)}
        className="min-h-10 flex-row items-center gap-1.5 self-start rounded-pill px-1 active:bg-hover"
      >
        <Icon name="document-text-outline" size={16} color="muted" />
        <Txt variant="ui" tone="muted">
          {label}
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color="muted" />
      </Pressable>
      {open
        ? CHART_PAGE_NOTICES.map((entry) => (
            <View key={entry.name} className="gap-2">
              <Txt variant="label">{`${entry.name} ${entry.version} · ${entry.license}`}</Txt>
              <Txt variant="labelSm" tone="muted" selectable>
                {entry.notice.trim()}
              </Txt>
              <Txt variant="labelSm" tone="faint" selectable>
                {entry.licenseText.trim()}
              </Txt>
            </View>
          ))
        : null}
    </View>
  )
}

/** One read of one interval as the page takes it: the bridge's `candles` message without its envelope. */
export type CoreChartRead = Omit<CandlesMessage, 'v' | 'type'>

/**
 * The core's chart (`@ryntra/core/chart`, the web's own) in a WebView (CH-21) — one chart for the professional chart
 * and a Phoenix market's page (C4c). The caller reads the candles and puts each read in (`read`); the chart's own
 * interval switch says which interval it wants (`onTimeframe`). The theme and the language are the app's; a change in
 * Settings reaches the open chart at once. The page loads nothing from the network and can say only «ready», an
 * interval, or «failed» (`features/pro-chart/bridge.ts`).
 *
 * Each WebView it opens is one instance: «ready» and «failed» belong to the instance that said them, so a page opened
 * again starts from nothing and is told its market again. The WebView stays mounted while a read fails; the app's words
 * cover it only until the chart has drawn once (`coverOf`), and after that the chart's interval switch is always in
 * reach — an empty interval is the chart's «no candles yet», a failed one a strip with «Спробувати ще».
 *
 * It draws no order and drafts none: trading is the screen's own buttons, with their Review, where the wallet signs.
 */
export function CoreChart({
  market,
  timeframe,
  onTimeframe,
  read,
  answered = read !== null,
  live = null,
  trouble,
  retrying,
  onRetry,
  onReopen,
  label,
  nested = false,
  className,
}: {
  /** The market on the chart: its name for the page (a Solana address's shape), what it is called, whether a stock. */
  market: Readonly<{ mint: string; symbol: string; stock: boolean }>
  timeframe: ProTimeframe
  onTimeframe: (next: ProTimeframe) => void
  /** The newest read of the chosen interval — or an interval said empty — put in as it comes; null while none. */
  read: CoreChartRead | null
  /** Whether the chosen interval has an answer the chart can draw, candles or none; by default, whether `read` is. */
  answered?: boolean
  /** A last price closing the bar of the moment, with the server's time it came with; null puts none in. */
  live?: Readonly<{ price: number | null; at: number }> | null
  /** Why the chosen interval's read did not come: it covers the place until the chart has drawn, a strip after. */
  trouble: FirstTrouble
  retrying: boolean
  onRetry: () => void
  /** A page opened again on «Спробувати ще» after it broke: the caller may ask its read again. */
  onReopen?: () => void
  label: string
  /** Inside a scrolling screen: the chart's own drags stay the chart's. */
  nested?: boolean
  className?: string
}) {
  const words = useCopy(PRO_CHART_COPY)
  const locale = useLocale()
  const { name: themeName, colors } = useTheme()
  const theme = pageThemeOf(themeName)
  const { mint, symbol, stock } = market

  /* One WebView instance at a time: its number is its key, and what its page said is kept with that number. */
  const view = useRef<WebView>(null)
  const [instance, setInstance] = useState(0)
  const [readyFor, setReadyFor] = useState<number | null>(null)
  const [failedFor, setFailedFor] = useState<number | null>(null)
  const [drawnFor, setDrawnFor] = useState<number | null>(null)
  const ready = readyFor === instance
  const pageFailed = failedFor === instance
  // The page has a chart to show once it is ready and has an interval's answer — candles, or an interval said empty
  // (state adjusted during render, as React prescribes).
  if (ready && answered && drawnFor !== instance) setDrawnFor(instance)
  const drawn = drawnFor === instance

  /* The look the page opens in, written into its HTML; a change later comes through the bridge, never a reload. */
  const [openLook, setOpenLook] = useState(() => ({ theme, lang: locale }))
  const html = useMemo(() => pageHtmlFor(CHART_PAGE_HTML, openLook.theme, openLook.lang), [openLook])

  const post = useCallback((message: AppMessage) => {
    view.current?.injectJavaScript(injectionOf(message))
  }, [])

  // The page that never says «ready» did not open: said in the app's words, with one way to try again.
  useEffect(() => {
    if (ready || pageFailed) return
    const timer = setTimeout(() => setFailedFor(instance), READY_WITHIN_MS)
    return () => clearTimeout(timer)
  }, [ready, pageFailed, instance])

  // The market and the look: when the page is ready, and again whenever the theme, the language or the name changes.
  useEffect(() => {
    if (!ready) return
    post({ v: BRIDGE_VERSION, type: 'market', mint, symbol, stock, theme, lang: locale, timeframe })
  }, [ready, post, mint, symbol, stock, theme, locale, timeframe])

  // Each read of the chosen interval, as it comes.
  useEffect(() => {
    if (!ready || !read) return
    post({ v: BRIDGE_VERSION, type: 'candles', ...read })
  }, [ready, post, read])

  useEffect(() => {
    if (!ready || !live) return
    post({ v: BRIDGE_VERSION, type: 'live', price: live.price, at: live.at })
  }, [ready, post, live])

  const onMessage = (event: WebViewMessageEvent) => {
    // Only the page the app opened speaks: a message from anywhere else is not read.
    if (!pageSpeaks(event.nativeEvent.url)) return
    const message = parsePageMessage(event.nativeEvent.data)
    if (!message) return
    if (message.type === 'ready') setReadyFor(instance)
    else if (message.type === 'failed') setFailedFor(instance)
    else if (isProTimeframe(message.timeframe) && message.timeframe !== timeframe) onTimeframe(message.timeframe)
  }

  /* A page opened again: a new instance in the look of now, which says «ready» for itself. */
  const openAgain = () => {
    setOpenLook({ theme, lang: locale })
    setInstance((count) => count + 1)
    onReopen?.()
  }

  const cover = coverOf({ pageFailed, ready, drawn, firstTrouble: trouble })
  let covering = null
  if (cover === 'failed')
    covering = (
      <StateView
        icon="alert-circle-outline"
        title={words.notOpened}
        tone="danger"
        action={{ title: words.tryAgain, onPress: openAgain }}
      />
    )
  else if (cover === 'offline' || cover === 'down')
    covering = (
      <StateView
        icon={cover === 'offline' ? 'cloud-offline-outline' : 'time-outline'}
        title={cover === 'offline' ? words.noConnection : words.notLoaded}
        action={{ title: words.tryAgain, onPress: onRetry, loading: retrying }}
      />
    )
  else if (cover === 'loading')
    covering = (
      <View className="flex-1 px-4 pt-2">
        <Skeleton
          className="h-full w-full rounded-sm"
          accessibilityRole="progressbar"
          accessibilityLabel={words.loading}
        />
      </View>
    )

  return (
    <View className={className}>
      {drawn && trouble ? (
        // An interval whose read failed after the chart has drawn: said over the chart, which keeps its switch.
        <View className="flex-row items-center gap-3 border-b border-line px-4 py-2">
          <Icon name={trouble === 'offline' ? 'cloud-offline-outline' : 'time-outline'} size={16} />
          <Txt variant="ui" tone="muted" className="flex-1" numberOfLines={1}>
            {trouble === 'offline' ? words.noConnection : words.notLoaded}
          </Txt>
          <Button title={words.tryAgain} variant="secondary" size="sm" loading={retrying} onPress={onRetry} />
        </View>
      ) : null}
      <View className="flex-1">
        {pageFailed ? null : (
          <WebView
            key={instance}
            ref={view}
            source={{ html, baseUrl: PAGE_ORIGIN }}
            // Every address comes to `pageMayLoad`, which refuses all but the page: the library would hand an address
            // outside its list to the system's browser, and nothing here leaves the WebView.
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(request) => pageMayLoad(request.url)}
            onMessage={onMessage}
            onError={() => setFailedFor(instance)}
            onRenderProcessGone={() => setFailedFor(instance)}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            geolocationEnabled={false}
            thirdPartyCookiesEnabled={false}
            mediaPlaybackRequiresUserAction
            allowsLinkPreview={false}
            overScrollMode="never"
            nestedScrollEnabled={nested}
            // The chart's words follow the phone's font size, as the app's own do.
            textZoom={Math.round(PixelRatio.getFontScale() * 100)}
            webviewDebuggingEnabled={__DEV__}
            style={{ flex: 1, backgroundColor: colors.ground }}
            containerStyle={{ backgroundColor: colors.ground }}
            accessibilityLabel={label}
          />
        )}
        {covering ? <View className="absolute inset-0 bg-ground">{covering}</View> : null}
      </View>
    </View>
  )
}

/**
 * The professional chart (CH-21): the core's chart ({@link CoreChart}) on the candles the app reads from the Ryntra
 * API — the asset page's simple chart stays native.
 *
 * Trading stays the asset page's: «Купити» and «Продати» show only where the page under the chart offers them, and
 * run the page's own flow — the ticket or the company's sheet, with its Review, where the wallet signs. The chart
 * itself draws no order and drafts none.
 */
export function ProChartScreen({ mint, symbol: givenSymbol }: { mint: string; symbol?: string }) {
  const router = useRouter()
  const words = useCopy(PRO_CHART_COPY)
  const insets = useSafeAreaInsets()
  const market = useMarket(mint)
  const detail = market.data?.market ?? null
  const symbol = detail?.symbol || givenSymbol || '—'
  const stock = detail?.category === 'stock'
  // The asset page right under the chart, if it is this asset's: its own Buy and Sell, never a page further down.
  const own = useRoute().key
  const beneath = assetPageBeneath(useNavigation().getState() ?? { routes: [] }, own, mint)
  const actions = useAssetActions(beneath)

  const [timeframe, setTimeframeState] = useState<ProTimeframe>(() =>
    readPreference(TIMEFRAME_KEY, PRO_TIMEFRAMES, '1h'),
  )
  const setTimeframe = (next: ProTimeframe) => {
    setTimeframeState(next)
    writePreference(TIMEFRAME_KEY, next)
  }
  const candles = useCandles(mint, timeframe)
  const read = candles.data
  const limited = chartLimited(candles.error)
  const emptyInterval = !read && noChart(candles.error)
  const readFailed = !read && candles.isError && !limited && !emptyInterval

  // The page's one live price — the asset page's own — closes the bar of the moment while it is fresh.
  const livePrice = market.data && !market.data.stale && !market.isError ? (detail?.price ?? null) : null
  const liveAt = market.data ? Date.parse(market.data.observedAt) : NaN

  /* Each read of the chosen interval, as it comes. A refresh that failed keeps the last read and says it is stale —
     aged from that read — never a silent old line. An interval the route has no candles for (its 404) is the chart's
     own «no candles yet»: the person switches to another interval in the chart. It is dated by the server's last answer
     about this market and names no source — neither is the phone's guess; without a server's time it is not put in,
     and the chart waits. */
  const refreshFailed = candles.isError && !limited
  const chartRead = useMemo((): CoreChartRead | null => {
    if (read) {
      const observed = Date.parse(read.observedAt)
      return {
        timeframe: read.timeframe,
        candles: read.candles,
        observedAt: Number.isFinite(observed) ? observed : null,
        stale: read.stale || refreshFailed,
        pool: read.pool.name,
        source: read.source.label,
      }
    }
    if (emptyInterval && Number.isFinite(liveAt))
      return { timeframe, candles: [], observedAt: liveAt, stale: false, pool: null, source: null }
    return null
  }, [read, refreshFailed, emptyInterval, liveAt, timeframe])
  // A price without the server's time is not put on the chart: its age would be the phone's guess.
  const live = useMemo(() => (Number.isFinite(liveAt) ? { price: livePrice, at: liveAt } : null), [livePrice, liveAt])

  // A limiter's refusal is a quiet wait for its window, then one ask (ST-5 r10) — never «не відповідає».
  const limitWait = limited ? chartLimitWaitMs(candles.error) : 0
  const refetch = candles.refetch
  useEffect(() => {
    if (!limited) return
    const timer = setTimeout(() => void refetch(), limitWait)
    return () => clearTimeout(timer)
  }, [limited, limitWait, refetch, candles.errorUpdatedAt])

  const back = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: '/asset/[mint]', params: { mint } })
  /* The asset page's own action, run on the page right under the chart: back to it, then its flow — the ticket or the
     company's sheet. `actions` exists only when that page is directly beneath. */
  const acted = useRef(false)
  const act = (action: AssetAction) => {
    // Once: a second tap while the chart slides out would go back past the asset page.
    if (!actions || acted.current) return
    acted.current = true
    router.back()
    actions.run(action)
  }

  const trouble: FirstTrouble = readFailed ? (isNetworkError(candles.error) ? 'offline' : 'down') : null

  const warning = actions?.buy ? actions.warning : null
  const foot =
    actions === null ? (
      // No page of this asset under the chart (a link opened it): its page is one press away, with its own actions.
      <Button
        title={words.openAsset}
        variant="secondary"
        size="lg"
        className="flex-1"
        onPress={() => router.replace({ pathname: '/asset/[mint]', params: { mint } })}
      />
    ) : actions.buy || actions.sell ? (
      <>
        {actions.sell ? (
          <Button title={words.sell} variant="secondary" size="lg" className="flex-1" onPress={() => act('sell')} />
        ) : null}
        {actions.buy ? <Button title={words.buy} size="lg" className="flex-1" onPress={() => act('buy')} /> : null}
      </>
    ) : null

  return (
    <Screen
      title={symbol}
      subtitle={words.subtitle}
      onBack={back}
      scroll={false}
      right={
        <HelpDot title={words.helpTitle} body={words.help}>
          <ChartLicences label={words.licences} />
        </HelpDot>
      }
    >
      <CoreChart
        className="flex-1"
        market={{ mint, symbol, stock }}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        read={chartRead}
        answered={read !== undefined || emptyInterval}
        live={live}
        trouble={trouble}
        retrying={candles.isFetching}
        onRetry={() => void candles.refetch()}
        onReopen={() => {
          if (candles.isError) void candles.refetch()
        }}
        label={`${symbol} · ${words.subtitle}`}
      />
      {foot ? (
        <View
          className="gap-3 border-t border-line bg-ground px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {/* The asset page's own line over its «Купити» (a look-alike, a pool far from the share), said here too. */}
          {warning ? <BuyWarning text={warning} /> : null}
          <View className="flex-row gap-3">{foot}</View>
        </View>
      ) : null}
    </Screen>
  )
}
