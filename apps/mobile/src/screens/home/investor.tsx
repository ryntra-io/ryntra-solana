import { useFocusEffect, useRouter } from 'expo-router'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { HelpDot } from '@/components/help-dot'
import { Holdable } from '@/components/holdable'
import { Icon, type IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { availableBlocks, shownBlocks, type HomeBlockId } from '@/features/home/home-blocks'
import { accountState, HIDDEN_AMOUNT } from '@/features/home/home-model'
import { setAmountsHidden, useAmountsHidden } from '@/features/home/last-look'
import { PLACE_HOME_COPY, type HomeAction } from '@/features/home/place-copy'
import { useHomeLayout } from '@/features/home/use-home-layout'
import { recoveryDoor } from '@/features/invest/buy-model'
import { INVEST_COPY } from '@/features/invest/copy'
import { useCompanyShelf, useShelfNames } from '@/features/invest/use-shelf'
import { recordJourney } from '@/features/journeys/journey-store'
import { noteWords, unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { useSkrName } from '@/features/seeker/use-seeker'
import { useAccount } from '@/features/session/use-account'
import { INBOX_PATH } from '@/features/shell/places'
import { PORTFOLIO_PATH, SWAP_PATH } from '@/features/shell/shell'
import { useAttempt } from '@/features/trade/trade-store'
import { failureLine, signInFailureLine } from '@/features/wallet/signing-copy'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import {
  DASH,
  formatAt,
  formatPercent,
  isToday,
  formatUsd,
  formatUsdSigned,
  shortAddress,
  signOf,
} from '@/utils/format'

import { ArrangeSheet } from './arrange-sheet'
import { BuyPickSheet } from './buy-pick-sheet'
import { FavouritesBlock, MyMarketsBlock, RecentBlock } from './place-blocks'
import { AccountMark, ProfileSheet } from './profile-sheet'
import { TopUpSheet } from './top-up-sheet'

type Door = 'connect' | 'portfolio' | 'inbox' | 'trade' | 'search' | 'profile' | 'note' | 'topUp' | HomeAction

/**
 * Where each of Home's four actions leads (NEW-LOOK §3): «Купити» opens «Що купити» over Home — the search and the
 * popular coins and companies — «Обмін» is Торгівля · Обмін, «Надіслати» the send's first step, «Отримати» the address.
 */
const ACTION_PATHS: Readonly<Record<Exclude<HomeAction, 'buy'>, string>> = {
  swap: SWAP_PATH,
  send: '/money/send',
  receive: '/money/receive',
}

const ACTION_ICONS: Readonly<Record<HomeAction, IconName>> = {
  buy: 'add',
  swap: 'swap-vertical',
  send: 'paper-plane-outline',
  receive: 'arrow-down',
}

const ACTIONS: readonly HomeAction[] = ['buy', 'swap', 'send', 'receive']

/** A round icon button of the header: search, the inbox with its count. */
function HeaderButton({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: IconName
  label: string
  badge?: number
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      className="h-11 w-11 items-center justify-center rounded-pill active:bg-hover"
    >
      <Icon name={icon} size={22} color="fg" />
      {badge !== undefined && badge > 0 ? (
        <View className="absolute right-1 top-1 h-4 min-w-4 items-center justify-center rounded-pill bg-brand px-1">
          <Txt variant="labelSm" tone="onBrand" maxFontSizeMultiplier={1.3} style={{ letterSpacing: 0 }}>
            {badge > 9 ? '9+' : String(badge)}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  )
}

/**
 * Home — the new look's.
 * The header holds the account (a tap opens «Профіль»), search and «Вхідні»
 * with the unread count. A wallet reads «Усього» with the eye that hides
 * every sum, the day's change and when it was read; then four actions of one
 * look — Купити · Обмін · Надіслати · Отримати — and one card of attention:
 * a signature whose outcome is not known yet, else the newest unread note.
 * Nothing waits — no card. Below, the person's blocks (C2): Обране, Мої
 * ринки, Останнє — the prototype's three — switched and moved by holding any
 * part of Home. The popular companies live in «Що купити», the recurring buys
 * in «Боти». A guest reads one promise and «Під’єднати гаманець» in the head's
 * place.
 */
export function InvestorHome() {
  const router = useRouter()
  const { colors } = useTheme()
  const copy = useCopy(INVEST_COPY)
  // The holdings' change is the venue's 24 hours: said «за добу» here as in Portfolio, never «за день».
  const portfolioWords = useCopy(PORTFOLIO_COPY)
  const words = useCopy(PLACE_HOME_COPY)
  const locale = useLocale()
  // A read kept from another day names its day; the minute's tick carries that across midnight.
  const now = useNow(60_000)
  const account = useAccount()
  const accountName = useSkrName(account.address, account.session)
  const state = accountState(account.address, account.session)
  const hidden = useAmountsHidden()
  const holdings = usePortfolio(account.address)
  const attempt = useAttempt(account.address)
  const surface = useSurface(account.session, locale)
  const unread = unreadCount(surface)
  // The shelf names a company a signature was left on (the recovery's door); «Популярне» is the server's own list.
  useCompanyShelf()
  const nameOf = useShelfNames()
  const layout = useHomeLayout()
  const [arranging, setArranging] = useState(false)
  const [profile, setProfile] = useState(false)
  const [picking, setPicking] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const arrange = () => setArranging(true)

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
  const act = (action: HomeAction) =>
    go(action, () => (action === 'buy' ? setPicking(true) : router.push(ACTION_PATHS[action] as never)))

  const refreshing = holdings.query.isFetching && !holdings.query.isPending
  const refresh = () => {
    if (account.address) void holdings.query.refetch()
  }

  /* ---- the one card of attention: a signature without an answer, else the newest unread note ---- */
  // A company's purchase in dollars is checked where it was made — its page, the purchase open; anything else in Trade.
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
  const note = surface?.recent.find((item) => item.unread) ?? null
  let attention: ReactNode = null
  if (attempt && attempt.state !== 'SETTLED') {
    attention = <AttentionCard icon="time-outline" tone="warning" title={copy.unfinished} onPress={openUnfinished} />
  } else if (note) {
    const said = noteWords(note, locale)
    attention = (
      <AttentionCard
        icon="notifications-outline"
        tone="neutral"
        title={said.title}
        line={said.reason || null}
        onPress={() => go('note', () => router.push({ pathname: '/monitoring/open', params: { n: note.id } }))}
      />
    )
  }

  /* ---- the head: a guest's promise, or «Усього» and the four actions ---- */
  let head: ReactNode
  const failure = account.signInFailure
    ? signInFailureLine(account.signInFailure, locale)
    : account.failure
      ? failureLine(account.failure.message, locale)
      : null
  if (state === 'guest') {
    head = (
      <View className="gap-4 pt-1">
        <Txt variant="display" accessibilityRole="header">
          {copy.guestHeadline}
        </Txt>
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
      </View>
    )
  } else {
    const view = holdings.view
    // A day's move belongs to its day: a read kept from an earlier day shows its value and its time, not «today».
    const change = view && isToday(view.observedAt, now) ? view.dayChange : null
    const move = signOf(change?.usd)
    // A read that saw less than the whole wallet is a warning; balances the venue cannot price (dust, airdrops) are only said.
    const notice: Readonly<{ text: string; tone: 'warning' }> | null = view
      ? holdings.heldBack
        ? { text: copy.heldBack(formatAt(view.observedAt, now, locale)), tone: 'warning' }
        : view.coverage !== 'COMPLETE'
          ? { text: copy.partlyRead, tone: 'warning' }
          : null
      : null
    let balance: ReactNode
    if (view && !view.pricesRead) {
      // The balances came back before the venue's prices: the total is being read, never every asset «without a price».
      balance = (
        <View className="gap-1">
          <Skeleton className="h-10 w-44" accessibilityRole="progressbar" />
          <Txt variant="ui" tone="faint">
            {copy.readingPrices}
          </Txt>
        </View>
      )
    } else if (view) {
      // A wallet read whole that holds nothing but an empty native balance is worth a known zero, not an unknown.
      const total = view.empty ? 0 : view.total
      balance = (
        <View className="gap-1">
          <Txt variant="display" tabular tone={total === null && !hidden ? 'muted' : 'fg'}>
            {hidden ? HIDDEN_AMOUNT : total === null ? DASH : formatUsd(total, locale)}
          </Txt>
          {change ? (
            <Txt variant="ui" tabular tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'faint'}>
              {`${hidden ? '' : `${formatUsdSigned(change.usd, locale)} · `}${formatPercent(change.pct, locale)} ${portfolioWords.overDay}`}
            </Txt>
          ) : null}
          {/* Balances without a price are a status: said short beside the read's time, explained behind «?» (ST-4). */}
          <View className="flex-row flex-wrap items-center gap-x-1">
            <Txt variant="labelSm" tone={holdings.query.isError ? 'warning' : 'faint'}>
              {[
                words.updated(formatAt(view.observedAt, now, locale)),
                holdings.query.isError ? copy.notUpdated : null,
                view.pricesRead && view.unpriced > 0 && !view.empty ? copy.unpriced(view.unpriced) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Txt>
            {view.pricesRead && view.unpriced > 0 && !view.empty ? (
              <HelpDot title={copy.unpricedTitle} body={copy.unpricedHelp(view.unpriced, view.rows.length)} />
            ) : null}
          </View>
          {view.empty ? (
            // An empty wallet's next step is the money itself: «Поповнити» opens the address and the network's one rule.
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-2 pt-1">
              <Txt variant="ui" tone="muted" className="flex-1">
                {copy.emptyWallet}
              </Txt>
              <Button
                title={copy.topUp}
                variant="secondary"
                size="sm"
                hitSlop={6}
                onPress={() => go('topUp', () => setToppingUp(true))}
              />
            </View>
          ) : null}
          {notice ? (
            <Txt variant="ui" tone={notice.tone}>
              {notice.text}
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
      balance = <Skeleton className="h-10 w-44" accessibilityRole="progressbar" />
    }
    head = (
      <View className="gap-5 pt-1">
        <View className="gap-1.5">
          <View className="flex-row items-center gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={words.total}
              onPress={() => go('portfolio', () => router.navigate(PORTFOLIO_PATH as never))}
              hitSlop={6}
              className="active:opacity-80"
            >
              <Txt variant="ui" tone="muted" accessibilityRole="header">
                {words.total}
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hidden ? copy.showAmounts : copy.hideAmounts}
              accessibilityState={{ selected: hidden }}
              onPress={() => setAmountsHidden(!hidden)}
              hitSlop={4}
              className="h-11 w-11 items-center justify-center rounded-pill active:bg-hover"
              style={{ marginVertical: -10 }}
            >
              <Icon name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color="muted" />
            </Pressable>
          </View>
          {balance}
        </View>
        <View className="flex-row" accessibilityRole="toolbar">
          {ACTIONS.map((action) => (
            <Pressable
              key={action}
              accessibilityRole="button"
              accessibilityLabel={words.actions[action]}
              onPress={() => act(action)}
              className="flex-1 items-center gap-2 active:opacity-80"
            >
              <View className="h-14 w-14 items-center justify-center rounded-lg border border-line bg-elevated">
                <Icon name={ACTION_ICONS[action]} size={22} color="fg" />
              </View>
              <Txt variant="labelSm" numberOfLines={1} style={{ letterSpacing: 0 }}>
                {words.actions[action]}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
    )
  }

  /* ---- the blocks under the head: on or off and in the person's order; holding any part of Home arranges them ---- */
  const available = availableBlocks(state !== 'guest')
  const address = account.address
  // The new look's blocks hold themselves, and draw nothing when they have nothing to say (no launches, no operations).
  const blocks: Readonly<Record<HomeBlockId, ReactNode>> = {
    favourites: <FavouritesBlock onHold={arrange} />,
    myMarkets: address ? <MyMarketsBlock address={address} onHold={arrange} /> : null,
    recent: address ? <RecentBlock address={address} session={account.session} onHold={arrange} /> : null,
  }

  /* ---- the header: the account on the left — its `.skr` name when it has one (M41.2) — search and «Вхідні» on the right ---- */
  const lead = address ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${words.profile}, ${accountName ?? shortAddress(address)}`}
      onPress={() => go('profile', () => setProfile(true))}
      className="-ml-1 min-h-12 flex-row items-center gap-2.5 self-start rounded-pill py-1 pl-1 pr-3 active:bg-hover"
    >
      <AccountMark size={38} />
      <Txt variant="ui" tabular={!accountName} numberOfLines={1}>
        {accountName ?? shortAddress(address)}
      </Txt>
    </Pressable>
  ) : undefined
  const right = (
    <View className="flex-row">
      <HeaderButton icon="search" label={words.search} onPress={() => go('search', () => router.push('/search'))} />
      {state === 'signed-in' ? (
        <HeaderButton
          icon="notifications-outline"
          label={unread > 0 ? words.inboxCount(unread) : words.inbox}
          badge={unread}
          onPress={() => go('inbox', () => router.push(INBOX_PATH as never))}
        />
      ) : null}
    </View>
  )

  return (
    <>
      <Screen
        title={copy.homeTitle}
        lead={lead}
        rhythm="page"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        right={right}
      >
        <Holdable onHold={arrange}>{head}</Holdable>
        {attention}
        {shownBlocks(layout, available).map((id) => (
          <Fragment key={id}>{blocks[id]}</Fragment>
        ))}
      </Screen>
      <ArrangeSheet visible={arranging} available={available} onClose={() => setArranging(false)} />
      <BuyPickSheet visible={picking} onClose={() => setPicking(false)} />
      <TopUpSheet
        visible={toppingUp}
        address={account.address}
        purpose="top-up"
        onClose={() => setToppingUp(false)}
        onConnect={() => void account.connect()}
        connecting={account.busy === 'connect'}
      />
      <ProfileSheet visible={profile} onClose={() => setProfile(false)} />
    </>
  )
}

/** The one card of attention: what waits, one line of why, and the way to it. */
function AttentionCard({
  icon,
  tone,
  title,
  line = null,
  onPress,
}: {
  icon: IconName
  tone: 'warning' | 'neutral'
  title: string
  line?: string | null
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line ? `${title}, ${line}` : title}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg border border-line bg-surface p-4 active:bg-hover"
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-pill ${tone === 'warning' ? 'bg-warning-soft' : 'bg-elevated'}`}
      >
        <Icon name={icon} size={20} color={tone === 'warning' ? 'warningInk' : 'fg'} />
      </View>
      <View className="flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={2}>
          {title}
        </Txt>
        {line ? (
          <Txt variant="ui" tone="faint" numberOfLines={2}>
            {line}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={16} color="fgMuted" />
    </Pressable>
  )
}
