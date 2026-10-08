import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { AppState, Pressable, RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { HOME_COPY } from '@/features/home/copy'
import { money, TRENDING_CLASSES, type AttentionItem, type BriefLine } from '@/features/home/home-model'
import { writeLastLook } from '@/features/home/last-look'
import { useHome } from '@/features/home/use-home'
import { recordJourney } from '@/features/journeys/journey-store'
import { marketsPath } from '@/features/markets/screener'
import { noteRefOfHref } from '@/features/monitoring/monitoring-model'
import { useOpenNote } from '@/features/monitoring/use-monitoring'
import { PLANS_COPY } from '@/features/plans/copy'
import { attentionSymbols, sharedSymbols } from '@/features/plans/plan-model'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import type { MarketRow } from '@/lib/api'
import { useCopy, useSharedCopy } from '@/lib/i18n'
import { PlanRow } from '@/screens/plans/plan-row'
import { useTheme } from '@/theme'
import { formatClock, formatMoment, formatPercent, formatUsdSigned, isToday } from '@/utils/format'

import { AttentionRow, Block, blockGate, BriefRow, MoverPill, MoveRow, QuietLine } from './blocks'

type Door =
  'asset' | 'plan' | 'plans' | 'new-plan' | 'portfolio' | 'inbox' | 'trade' | 'markets' | 'watchlist' | 'choose'

/**
 * «Що змінилося» — Home one tap deeper (M10's command centre,
 * a screen of its own since one version). It answers one question: what
 * changed, and what needs a look. The unfinished operation first (M3's recovery), then the
 * plans that need attention (M7's cards, honest about a card two plans
 * share), the portfolio in one line (M4's read), the active plans,
 * the watchlist's moves since the person last looked, and a short list of
 * what changed with its doors. A guest sees the markets and one next
 * action; a wallet without a session sees its public figures and the one
 * action that unlocks the rest. Nothing here trades, prepares or decides:
 * every door leads to the surface that does, on fresh figures.
 */
export function HomeScreen({ onBack, backLabel }: { onBack?: () => void; backLabel?: string } = {}) {
  const router = useRouter()
  const { colors } = useTheme()
  const copy = useCopy(HOME_COPY)
  const shared = useSharedCopy()
  const plansCopy = useCopy(PLANS_COPY)
  const portfolioCopy = useCopy(PORTFOLIO_COPY)
  const home = useHome()
  const { account, state, locale, now, hidden } = home
  const openNote = useOpenNote(account.session, 'home')

  // The rows Home last showed, for the snapshot written on leaving; a ref because the write happens outside render.
  const rowsRef = useRef<readonly MarketRow[]>([])
  const stateRef = useRef(state)
  useEffect(() => {
    rowsRef.current = home.watch.rows
  }, [home.watch.rows])
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const address = account.address
  const ready = account.ready
  useFocusEffect(
    useCallback(() => {
      // The view is counted once the session store has answered, so a cold start is not a guest for a moment.
      if (ready) recordJourney('home_view', { state: stateRef.current, from: 'changes' })
      // Leaving the app while on Home is leaving Home: the look ends there.
      const subscription = AppState.addEventListener('change', (next) => {
        if (next !== 'active') writeLastLook(address, rowsRef.current)
      })
      return () => {
        subscription.remove()
        writeLastLook(address, rowsRef.current)
      }
    }, [address, ready]),
  )

  const go = useCallback((door: Door, open: () => void) => {
    recordJourney('home_go', { state: stateRef.current, from: 'changes', to: door })
    open()
  }, [])
  const openAsset = (row: MarketRow) =>
    go('asset', () => router.push({ pathname: '/asset/[mint]', params: { mint: row.mint, symbol: row.symbol } }))
  const openPlan = (id: string) => go('plan', () => router.push({ pathname: '/plans/[id]', params: { id } }))
  const openPlans = () => go('plans', () => router.push('/bots'))
  const openNewPlan = () => go('new-plan', () => router.push('/plans/pick'))
  const openPortfolio = () => go('portfolio', () => router.navigate('/(tabs)/portfolio'))
  const openInbox = () => go('inbox', () => router.push('/monitoring'))
  const openTrade = () => go('trade', () => router.push('/trade'))
  const openMarkets = () => go('markets', () => router.navigate('/(tabs)/markets'))
  const openWatchlist = () => go('watchlist', () => router.navigate(marketsPath('watchlist') as never))
  const openAttention = (item: AttentionItem) => {
    if (item.kind === 'recovery') return openTrade()
    if (item.kind === 'entry-expired') return openPlan(item.plan.id)
    // A card opens the exact plan through the one resolver — or asks, when two plans wear its symbol.
    go(item.shared ? 'choose' : 'plan', () =>
      openNote(item.target, noteRefOfHref(item.card.href) ?? { kind: 'monitor', id: item.card.monitorId }),
    )
  }

  const subtitle = home.offline
    ? copy.offline
    : home.asOf
      ? copy.asOf(formatMoment(home.asOf, now, locale))
      : state === 'guest' && home.watch.total === 0 && !home.trending.on
        ? undefined
        : shared.loading

  const retryAttention = () => {
    void home.monitoring.refetch()
    void home.plansQuery.refetch()
  }

  /* ---- what needs attention ---- */
  let attention: ReactNode = null
  // A wallet with nothing watched and nothing to do is not told so in a block of its own; the plans block says what comes first.
  const quietAndEmpty =
    home.attentionState === 'ready' &&
    home.attention.length === 0 &&
    home.surface !== null &&
    home.surface.watching.length === 0 &&
    home.surface.attention.length === 0 &&
    home.unread === 0
  if (state === 'signed-in' && !quietAndEmpty) {
    const gate = blockGate({
      state: home.attentionState,
      label: copy.attention,
      errorText: copy.couldNotRead,
      retry: retryAttention,
      retrying: home.monitoring.isFetching || home.plansQuery.isFetching,
      retryLabel: shared.tryAgain,
    })
    attention = (
      <Block
        title={copy.attention}
        fact={home.attention.length > 0 ? String(home.attention.length) : null}
        action={home.unread > 0 ? { label: `${copy.monitoring} · ${home.unread}`, onPress: openInbox } : null}
      >
        {gate ??
          (home.attention.length === 0 ? (
            <QuietLine
              text={
                home.lastChecked
                  ? `${copy.nothingNeedsYou} · ${copy.lastChecked(formatMoment(home.lastChecked, now, locale))}`
                  : home.surface && home.surface.watching.length === 0 && home.surface.attention.length === 0
                    ? copy.nothingNeedsYou
                    : `${copy.nothingNeedsYou} · ${copy.notChecked}`
              }
              onPress={openInbox}
            />
          ) : (
            <View className="gap-2">
              {home.attention.map((item) => (
                <AttentionRow
                  key={
                    item.kind === 'card'
                      ? item.card.monitorId
                      : item.kind === 'recovery'
                        ? item.attempt.requestId
                        : item.plan.id
                  }
                  item={item}
                  copy={copy}
                  locale={locale}
                  now={now}
                  onPress={() => openAttention(item)}
                />
              ))}
            </View>
          ))}
      </Block>
    )
  } else if (state === 'connected' && home.attention.length > 0) {
    // A wallet without a session may still carry an unfinished operation of its own: the one thing said before sign-in.
    attention = (
      <Block title={copy.attention}>
        <View className="gap-2">
          {home.attention.map((item) => (
            <AttentionRow
              key={item.kind}
              item={item}
              copy={copy}
              locale={locale}
              now={now}
              onPress={() => openAttention(item)}
            />
          ))}
        </View>
      </Block>
    )
  }

  /* ---- the portfolio ---- */
  let portfolio: ReactNode = null
  if (state !== 'guest') {
    const view = home.portfolio
    const gate = blockGate({
      state: home.portfolioState,
      label: copy.portfolio,
      errorText: portfolioCopy.didNotLoad,
      retry: () => void home.holdings.refetch(),
      retrying: home.holdings.isFetching,
      retryLabel: shared.tryAgain,
    })
    // A day's move belongs to its day.
    const change = view && isToday(view.observedAt, now) ? view.dayChange : null
    const notices = view
      ? [
          home.heldBack ? portfolioCopy.heldBack(formatMoment(view.observedAt, now, locale)) : null,
          view.coverage === 'PARTIAL' ? portfolioCopy.partlyRead : null,
          view.coverage === 'UNAVAILABLE' ? portfolioCopy.notRead : null,
          home.holdings.isError ? shared.refreshFailed : null,
        ].filter((notice): notice is string => notice !== null)
      : []
    portfolio = (
      <Block
        title={copy.portfolio}
        fact={view ? formatMoment(view.observedAt, now, locale) : null}
        action={
          view ? { label: portfolioCopy.history, onPress: () => go('portfolio', () => router.push('/history')) } : null
        }
      >
        {gate ??
          (view && view.empty ? (
            <QuietLine text={copy.emptyPortfolio} icon="pie-chart-outline" onPress={openPortfolio} />
          ) : view ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.portfolio}, ${money(view.total, hidden, locale)}`}
              onPress={openPortfolio}
              className="gap-2 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
            >
              <View className="flex-row items-center justify-between gap-3">
                <Txt variant="dataLg" tone={view.total === null && !hidden ? 'muted' : 'fg'}>
                  {money(view.total, hidden, locale)}
                </Txt>
                <Icon name="chevron-forward" size={18} color="fgMuted" />
              </View>
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                {change ? (
                  <Chip
                    label={`${hidden ? '' : `${formatUsdSigned(change.usd, locale)} · `}${formatPercent(change.pct, locale)} ${portfolioCopy.today}`}
                    tone={change.usd > 0 ? 'success' : change.usd < 0 ? 'danger' : 'neutral'}
                    mono
                  />
                ) : null}
                <Txt variant="labelSm" tone="faint">
                  {portfolioCopy.priced(view.priced, view.rows.length)}
                  {view.unpriced > 0 ? ` · ${portfolioCopy.withoutPrice(view.unpriced)}` : ''}
                </Txt>
              </View>
              {notices.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {notices.map((notice) => (
                    <Chip key={notice} label={notice} tone="warning" caps={false} />
                  ))}
                </View>
              ) : null}
            </Pressable>
          ) : null)}
      </Block>
    )
  }

  /* ---- the plans ---- */
  let plans: ReactNode = null
  if (state === 'signed-in') {
    const block = home.plans
    const gate = blockGate({
      state: home.plansState,
      label: copy.plans,
      errorText: plansCopy.couldNotLoad,
      retry: () => void home.plansQuery.refetch(),
      retrying: home.plansQuery.isFetching,
      retryLabel: shared.tryAgain,
    })
    const attentionOn = attentionSymbols(home.surface)
    const sharedOn = home.plansQuery.data ? sharedSymbols(home.plansQuery.data.plans) : new Set<string>()
    plans = (
      <Block
        title={copy.plans}
        fact={block ? `${block.activeTotal}${block.drafts > 0 ? ` · ${copy.drafts(block.drafts)}` : ''}` : null}
        action={block && block.total > 0 ? { label: copy.allPlans(block.total), onPress: openPlans } : null}
      >
        {gate ??
          (block && block.total === 0 ? (
            <View className="gap-2">
              <QuietLine text={copy.noPlans} icon="git-branch-outline" />
              <Button title={plansCopy.pickStock} variant="secondary" onPress={openNewPlan} />
            </View>
          ) : block && block.active.length === 0 ? (
            <QuietLine text={copy.noPlans} icon="git-branch-outline" onPress={openPlans} />
          ) : block ? (
            <Card padded={false} className="px-4">
              {block.active.map((plan, index) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  copy={plansCopy}
                  locale={locale}
                  now={now}
                  attention={attentionOn.has(plan.asset.symbol) && !sharedOn.has(plan.asset.symbol)}
                  hideMoney={hidden}
                  onPress={() => openPlan(plan.id)}
                  last={index === block.active.length - 1}
                />
              ))}
            </Card>
          ) : null)}
      </Block>
    )
  }

  /* ---- the watchlist ---- */
  const watch = home.watch
  const periodWord = home.period.kind === 'since' ? copy.since(formatClock(home.period.at)) : copy.over24h
  const watchGate = blockGate({
    state: watch.state,
    label: copy.watchlist,
    errorText: shared.didNotLoad,
    retry: () => void watch.query.refetch(),
    retrying: watch.query.isFetching,
    retryLabel: shared.tryAgain,
  })
  const watchNotices = [
    watch.stale ? copy.stale : null,
    watch.missing > 0 ? copy.notListed(watch.missing) : null,
    watch.query.isError && watch.query.data ? shared.refreshFailed : null,
  ].filter((notice): notice is string => notice !== null)
  const watchlist = (
    <Block
      title={copy.watchlist}
      fact={watch.total > 0 ? periodWord : null}
      action={watch.total > 0 ? { label: copy.allWatchlist(watch.total), onPress: openWatchlist } : null}
    >
      {watch.total === 0 ? (
        <QuietLine text={copy.emptyWatchlist} icon="star-outline" onPress={openMarkets} />
      ) : (
        (watchGate ?? (
          <Card padded={false} className="px-4">
            {watchNotices.length > 0 ? (
              <View className="flex-row flex-wrap gap-2 pt-3">
                {watchNotices.map((notice) => (
                  <Chip key={notice} label={notice} tone="warning" caps={false} />
                ))}
              </View>
            ) : null}
            {watch.moves.map((move, index) => (
              <MoveRow
                key={move.row.mint}
                move={move}
                period={home.period}
                copy={copy}
                onPress={() => openAsset(move.row)}
                last={index === watch.moves.length - 1}
              />
            ))}
          </Card>
        ))
      )}
    </Block>
  )

  /* ---- the markets' movers, for a person with nothing of their own to watch yet ---- */
  let movers: ReactNode = null
  if (home.trending.on) {
    const gate = blockGate({
      state: home.trending.state,
      label: copy.movers,
      errorText: shared.didNotLoad,
      retry: () => void home.trending.query.refetch(),
      retrying: home.trending.query.isFetching,
      retryLabel: shared.tryAgain,
    })
    const picks = home.trending.picks
    const any = TRENDING_CLASSES.some((klass) => picks[klass].length > 0)
    movers = (
      <Block
        title={copy.movers}
        fact={home.trending.query.data ? formatMoment(home.trending.query.data.observedAt, now, locale) : null}
        action={{ label: copy.openMarkets, onPress: openMarkets }}
      >
        {gate ??
          (any ? (
            <Card className="gap-3">
              {TRENDING_CLASSES.filter((klass) => picks[klass].length > 0).map((klass) => (
                <View key={klass} className="gap-1.5">
                  <Txt variant="labelSm" tone="faint" caps>
                    {copy.classes[klass]}
                  </Txt>
                  <View className="flex-row flex-wrap gap-2">
                    {picks[klass].map((row) => (
                      <MoverPill key={row.mint} row={row} onPress={() => openAsset(row)} />
                    ))}
                  </View>
                </View>
              ))}
            </Card>
          ) : (
            <QuietLine text={copy.noMovers} icon="trending-up-outline" onPress={openMarkets} />
          ))}
      </Block>
    )
  }

  /* ---- what changed ---- */
  const briefText = (line: BriefLine): string => {
    switch (line.kind) {
      case 'notes':
        return copy.notesLine(line.count, line.since ? formatClock(line.since) : null)
      case 'plan':
        return copy.planLine(
          line.plan.asset.symbol,
          plansCopy.version(line.plan.version),
          formatMoment(line.plan.updatedAt, now, locale),
        )
      case 'portfolio':
        return copy.portfolioLine(
          hidden ? formatPercent(line.change.pct, locale) : formatUsdSigned(line.change.usd, locale),
          formatPercent(line.change.pct, locale),
        )
      case 'watch':
        return copy.watchLine(
          line.move.row.symbol,
          formatPercent(line.move.pct, locale),
          line.period.kind === 'since' ? copy.since(formatClock(line.period.at)) : copy.over24h,
        )
      default:
        return copy.coverageLine[line.coverage]
    }
  }
  const briefIcon = (line: BriefLine) =>
    line.kind === 'notes'
      ? 'notifications-outline'
      : line.kind === 'plan'
        ? 'git-branch-outline'
        : line.kind === 'watch'
          ? 'star-outline'
          : 'pie-chart-outline'
  const briefOpen = (line: BriefLine) => {
    switch (line.kind) {
      case 'notes':
        return openInbox()
      case 'plan':
        return openPlan(line.plan.id)
      case 'watch':
        return openAsset(line.move.row)
      default:
        return openPortfolio()
    }
  }
  const briefKey = (line: BriefLine) =>
    line.kind === 'plan' ? `plan:${line.plan.id}` : line.kind === 'watch' ? `watch:${line.move.row.mint}` : line.kind
  const showBrief = state !== 'guest' || watch.total > 0
  const brief = showBrief ? (
    <Block title={copy.changed} fact={home.look ? copy.since(formatClock(home.look.at)) : null}>
      {home.brief.length === 0 ? (
        <QuietLine
          text={home.look ? copy.nothingChanged(formatClock(home.look.at)) : copy.firstLook}
          icon={home.look ? 'checkmark-circle-outline' : 'eye-outline'}
        />
      ) : (
        <Card padded={false}>
          {home.brief.map((line, index) => (
            <BriefRow
              key={briefKey(line)}
              icon={briefIcon(line)}
              text={briefText(line)}
              onPress={() => briefOpen(line)}
              last={index === home.brief.length - 1}
            />
          ))}
        </Card>
      )}
    </Block>
  ) : null

  /* ---- the account's one next action ---- */
  const failure = account.signInFailure?.message ?? account.failure?.message ?? null
  const accountCard =
    state === 'guest' ? (
      <Card className="gap-3">
        <View className="gap-1">
          <Txt variant="title">{shared.connectTitle}</Txt>
          <Txt variant="body" tone="muted">
            {copy.guestDetail}
          </Txt>
        </View>
        {failure ? (
          <Txt variant="ui" tone="danger">
            {failure}
          </Txt>
        ) : null}
        <Button
          title={shared.connectWallet}
          loading={account.busy === 'connect'}
          onPress={() => void account.connect()}
        />
      </Card>
    ) : state === 'connected' ? (
      <Card className="gap-3">
        <Txt variant="body" tone="muted">
          {copy.connectedDetail}
        </Txt>
        {failure ? (
          <Txt variant="ui" tone="danger">
            {failure}
          </Txt>
        ) : null}
        <Button title={shared.signIn} loading={account.signingIn} onPress={() => void account.signIn()} />
      </Card>
    ) : null

  return (
    <Screen
      title={copy.title}
      subtitle={subtitle}
      onBack={onBack}
      backLabel={backLabel}
      contentClassName="gap-5"
      refreshControl={
        <RefreshControl
          refreshing={home.refreshing}
          onRefresh={() => void home.refresh()}
          tintColor={colors.brand}
          colors={[colors.brand]}
          progressBackgroundColor={colors.surface}
        />
      }
      right={
        account.address ? (
          <View className="flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hidden ? copy.showAmounts : copy.hideAmounts}
              accessibilityState={{ selected: hidden }}
              onPress={() => home.setHidden(!hidden)}
              className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
            >
              <Icon name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color="muted" />
            </Pressable>
            {state === 'signed-in' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={home.unread > 0 ? `${copy.monitoring}, ${home.unread}` : copy.monitoring}
                onPress={openInbox}
                className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
              >
                {/* Unread is said by the filled bell, never in orange: the screen keeps one orange action (as on Home). */}
                <Icon
                  name={home.unread > 0 ? 'notifications' : 'notifications-outline'}
                  size={18}
                  color={home.unread > 0 ? 'fg' : 'muted'}
                />
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
    >
      {accountCard}
      {attention}
      {portfolio}
      {plans}
      {watchlist}
      {movers}
      {brief}
    </Screen>
  )
}
