import { useQueryClient } from '@tanstack/react-query'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { Icon, type IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AGENT_COPY } from '@/features/agent/copy'
import { RULES_KEY } from '@/features/autoinvest/use-rules'
import { accountState, HIDDEN_AMOUNT } from '@/features/home/home-model'
import { setAmountsHidden, useAmountsHidden } from '@/features/home/last-look'
import { recoveryDoor } from '@/features/invest/buy-model'
import { INVEST_COPY } from '@/features/invest/copy'
import { POPULAR_COUNT } from '@/features/invest/shelf'
import { usePopularCompanies } from '@/features/invest/use-popular'
import { useCompanyShelf, useShelfNames } from '@/features/invest/use-shelf'
import { recordJourney } from '@/features/journeys/journey-store'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { CHANGES_PATH, PLACES_COPY } from '@/features/shell/places'
import { useAttempt } from '@/features/trade/trade-store'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale } from '@/lib/i18n'
import { RulesBlock } from '@/screens/autoinvest/rules-block'
import { companyItem, ShelfTile, TileGrid, TileSkeleton } from '@/screens/invest/shelf-ui'
import { useTheme } from '@/theme'
import { DASH, formatAt, formatPercent, isToday, formatUsd, formatUsdSigned, signOf } from '@/utils/format'

import { TopUpSheet } from './top-up-sheet'

type Door = 'connect' | 'buy' | 'top-up' | 'ask' | 'changes' | 'company' | 'markets' | 'portfolio' | 'inbox' | 'trade'

/** A quiet door under the head: an icon and a word, never a button's weight. */
function QuietLink({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      className="flex-row items-center gap-2 py-1 active:opacity-80"
    >
      <Icon name={icon} size={16} color="muted" />
      <Txt variant="ui" tone="muted">
        {label}
      </Txt>
    </Pressable>
  )
}

/**
 * Home — the investor's Home, for everyone (canon v5.1 §2, §3; M14; one
 * version since v5.3 В28). A person knows in five seconds what to do: a
 * guest reads one promise and one action, «Під'єднати гаманець»; a wallet
 * reads what it holds — «Твої інвестиції»
 * with its time — and does one thing, «Купити», the screen's one orange
 * action, with «Поповнити» beside it and «Спитати Ryntra» quiet under them.
 * «Популярні компанії» are the same eight cards for everyone, in the
 * published order. A signature whose outcome is not known yet is the one
 * line said before anything else. A connected wallet reads its «Автоінвест»
 * between them — the month's budget as its own line and the rules with their
 * switches (M16; canon v5.3 В29, M20), the same block Portfolio draws; a
 * wallet not signed in reads there one line and a quiet «Увійти гаманцем».
 * What changed and what needs a look — the plans, the watchlist's moves, the
 * markets' movers, the brief — is one quiet tap deeper, «Що змінилося»
 * (M10's Home).
 */
export function InvestorHome() {
  const router = useRouter()
  const { colors } = useTheme()
  const copy = useCopy(INVEST_COPY)
  const agentCopy = useCopy(AGENT_COPY)
  const places = useCopy(PLACES_COPY)
  const locale = useLocale()
  // A read kept from another day names its day; the minute's tick carries that across midnight (M9).
  const now = useNow(60_000)
  const account = useAccount()
  const state = accountState(account.address, account.session)
  const hidden = useAmountsHidden()
  const holdings = usePortfolio(account.address)
  const attempt = useAttempt(account.address)
  const surface = useSurface(account.session, locale)
  const unread = unreadCount(surface)
  // The shelf names a company a signature was left on (the recovery's door); «Популярне» is the server's own list.
  useCompanyShelf()
  const nameOf = useShelfNames()
  const popularRead = usePopularCompanies()
  const queryClient = useQueryClient()
  const [topUp, setTopUp] = useState(false)

  // The state the view is counted in; a ref because the count happens in the focus callback, outside render.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const ready = account.ready
  useFocusEffect(
    useCallback(() => {
      if (ready) recordJourney('home_view', { state: stateRef.current })
    }, [ready]),
  )
  const go = (door: Door, open: () => void) => {
    recordJourney('home_go', { state, to: door })
    open()
  }
  const openMarkets = (door: Door) => go(door, () => router.navigate('/(tabs)/markets'))
  // What changed and what needs a look — M10's Home, one tap deeper (canon v5.3 §3).
  const changes = (
    <QuietLink
      icon="pulse-outline"
      label={places.whatChanged}
      onPress={() => go('changes', () => router.push(CHANGES_PATH as never))}
    />
  )
  const openCompany = (mint: string, ticker: string) =>
    go('company', () => router.push({ pathname: '/asset/[mint]', params: { mint, symbol: ticker } }))

  const refreshing =
    (holdings.query.isFetching && !holdings.query.isPending) ||
    (popularRead.isFetching && popularRead.data !== undefined)
  const refresh = () => {
    if (account.address) void holdings.query.refetch()
    void popularRead.refetch()
    if (account.session) void queryClient.invalidateQueries({ queryKey: RULES_KEY })
  }

  /* ---- a signature without an answer: said first, one line, one door ---- */
  // A company's purchase in dollars is checked where it was made — its page, the purchase open (M15); anything else in Trade.
  const openUnfinished = () => {
    const door = recoveryDoor(attempt?.context, (mint) => nameOf(mint) !== null)
    if (door.kind === 'company') {
      const { mint, symbol } = door
      go('trade', () =>
        router.push({ pathname: '/asset/[mint]', params: { mint, symbol, category: 'stock', buy: '1' } }),
      )
      return
    }
    go('trade', () => router.push('/trade'))
  }
  const unfinished =
    attempt && attempt.state !== 'SETTLED' ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.unfinished}
        onPress={openUnfinished}
        className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
      >
        <Icon name="time-outline" size={18} color="warningInk" />
        <Txt variant="ui" tone="warning" className="flex-1">
          {copy.unfinished}
        </Txt>
        <Icon name="chevron-forward" size={16} color="fgMuted" />
      </Pressable>
    ) : null

  /* ---- the head: a guest's promise, or what the wallet holds ---- */
  let head: ReactNode
  const failure = account.signInFailure?.message ?? account.failure?.message ?? null
  if (state === 'guest') {
    head = (
      <View className="gap-4 pt-1">
        <View className="gap-2">
          <Txt variant="display" accessibilityRole="header">
            {copy.guestHeadline}
          </Txt>
          <Txt variant="body" tone="muted">
            {copy.guestLine}
          </Txt>
        </View>
        {failure ? (
          <Txt variant="ui" tone="danger">
            {failure}
          </Txt>
        ) : null}
        <Button
          title={copy.connectWallet}
          size="lg"
          loading={account.busy === 'connect'}
          onPress={() => go('connect', () => void account.connect())}
        />
        <View className="flex-row">{changes}</View>
      </View>
    )
  } else {
    const view = holdings.view
    // A day's move belongs to its day: a read kept from an earlier day shows its value and its time, not «today» (M9).
    const change = view && isToday(view.observedAt, now) ? view.dayChange : null
    const move = signOf(change?.usd)
    // A read that saw less than the whole wallet is a warning; balances the venue cannot price (dust, airdrops) are only said.
    const note: Readonly<{ text: string; tone: 'warning' | 'faint' }> | null = view
      ? holdings.heldBack
        ? { text: copy.heldBack(formatAt(view.observedAt, now, locale)), tone: 'warning' }
        : view.coverage !== 'COMPLETE'
          ? { text: copy.partlyRead, tone: 'warning' }
          : view.unpriced > 0 && !view.empty
            ? { text: copy.unpriced(view.unpriced), tone: 'faint' }
            : null
      : null
    let balance: ReactNode
    if (view) {
      // A wallet read whole that holds nothing but an empty native balance is worth a known zero, not an unknown.
      const total = view.empty ? 0 : view.total
      balance = (
        <View className="gap-1">
          <Txt variant="display" tabular tone={total === null && !hidden ? 'muted' : 'fg'}>
            {hidden ? HIDDEN_AMOUNT : total === null ? DASH : formatUsd(total, locale)}
          </Txt>
          {change ? (
            <Txt variant="ui" tabular tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'faint'}>
              {`${hidden ? '' : `${formatUsdSigned(change.usd, locale)} · `}${formatPercent(change.pct, locale)} ${copy.today}`}
            </Txt>
          ) : null}
          {view.empty ? (
            <Txt variant="ui" tone="muted">
              {copy.emptyWallet}
            </Txt>
          ) : null}
          {note ? (
            <Txt variant="ui" tone={note.tone}>
              {note.text}
            </Txt>
          ) : null}
        </View>
      )
    } else if (holdings.query.isError) {
      balance = (
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Txt variant="ui" tone="muted">
            {copy.walletUnread}
          </Txt>
          <Pressable accessibilityRole="button" onPress={() => void holdings.query.refetch()} hitSlop={6}>
            <Txt variant="ui" tone="fg">
              {copy.tryAgain}
            </Txt>
          </Pressable>
        </View>
      )
    } else {
      balance = <Skeleton className="h-9 w-44" accessibilityRole="progressbar" />
    }
    head = (
      <View className="gap-4 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.yourInvestments}
          onPress={() => go('portfolio', () => router.navigate('/(tabs)/portfolio'))}
          className="gap-1.5 active:opacity-80"
        >
          <View className="flex-row items-center gap-1.5">
            <Txt variant="ui" tone="muted" accessibilityRole="header">
              {copy.yourInvestments}
            </Txt>
            {view ? (
              <Txt variant="ui" tone="faint">
                {`· ${formatAt(view.observedAt, now, locale)}`}
              </Txt>
            ) : null}
            {view && holdings.query.isError ? (
              <Txt variant="ui" tone="warning">
                {`· ${copy.notUpdated}`}
              </Txt>
            ) : null}
          </View>
          {balance}
        </Pressable>
        <View className="flex-row gap-2">
          <Button title={copy.buy} size="lg" className="flex-1" onPress={() => openMarkets('buy')} />
          <Button
            title={copy.topUp}
            variant="secondary"
            size="lg"
            className="flex-1"
            onPress={() => go('top-up', () => setTopUp(true))}
          />
        </View>
        <View className="flex-row flex-wrap items-center gap-x-6 gap-y-1">
          <QuietLink
            icon="sparkles-outline"
            label={agentCopy.askRyn}
            onPress={() => go('ask', () => router.navigate('/(tabs)/agent'))}
          />
          {changes}
        </View>
      </View>
    )
  }

  /* ---- the popular companies: eight cards, the same for everyone — the server's list, as the web's Home (1.20.0) ---- */
  const listed = popularRead.data ?? null
  const cards = listed?.companies.slice(0, POPULAR_COUNT) ?? []
  const shelfTime = listed ? formatAt(listed.fetchedAt, now, locale) : null
  // The list on screen carries its own time; a refresh that failed says so beside it, never as fresh.
  const shelfNote = listed
    ? popularRead.isError
      ? `${copy.pricesAt(shelfTime ?? DASH)} · ${copy.notUpdated}`
      : `${copy.byVolume} · ${shelfTime ?? DASH}`
    : copy.byVolume
  let tiles: ReactNode
  if (cards.length > 0) {
    tiles = (
      <TileGrid>
        {cards.map((card) => (
          <ShelfTile
            key={card.mint}
            item={companyItem(card)}
            locale={locale}
            today={copy.today}
            onPress={() => openCompany(card.mint, card.ticker)}
          />
        ))}
      </TileGrid>
    )
  } else if (popularRead.isError) {
    tiles = (
      <View className="items-start gap-3 rounded-sm border border-line bg-surface p-4">
        <Txt variant="ui" tone="muted">
          {copy.shelfDown}
        </Txt>
        <Button
          title={copy.reload}
          variant="secondary"
          size="sm"
          loading={popularRead.isFetching}
          onPress={() => void popularRead.refetch()}
        />
      </View>
    )
  } else {
    tiles = <TileSkeleton count={POPULAR_COUNT} />
  }
  const popular = (
    <View className="gap-3">
      <View className="gap-0.5">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="title" accessibilityRole="header" className="flex-1">
            {copy.popularCompanies}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.allCompanies}
            onPress={() => openMarkets('markets')}
            hitSlop={8}
            className="shrink-0 flex-row items-center gap-1 py-1 active:opacity-80"
          >
            <Txt variant="ui" tone="muted" numberOfLines={1}>
              {copy.allCompanies}
            </Txt>
            <Icon name="chevron-forward" size={14} color="fgMuted" />
          </Pressable>
        </View>
        <Txt variant="ui" tone="faint">
          {shelfNote}
        </Txt>
      </View>
      {tiles}
    </View>
  )

  return (
    <>
      <Screen
        title={copy.homeTitle}
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
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
                onPress={() => setAmountsHidden(!hidden)}
                className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
              >
                <Icon name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color="muted" />
              </Pressable>
              {state === 'signed-in' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={unread > 0 ? `${copy.inbox}, ${unread}` : copy.inbox}
                  onPress={() => go('inbox', () => router.push('/monitoring'))}
                  className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
                >
                  <Icon
                    name={unread > 0 ? 'notifications' : 'notifications-outline'}
                    size={18}
                    color={unread > 0 ? 'fg' : 'muted'}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : undefined
        }
      >
        {unfinished}
        {head}
        {state === 'guest' ? null : <RulesBlock session={account.session} place="home" />}
        {popular}
      </Screen>
      {account.address ? (
        <TopUpSheet visible={topUp} address={account.address} onClose={() => setTopUp(false)} />
      ) : null}
    </>
  )
}
