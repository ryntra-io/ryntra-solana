import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { DoorRow } from '@/components/door-row'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { RULES_KEY } from '@/features/autoinvest/use-rules'
import { BOTS_COPY, BOTS_TABS, botsTabOf, planResultLine, type BotsTab } from '@/features/bots/bots'
import { marketsPath } from '@/features/markets/screener'
import { noteRefOfHref, planForCard } from '@/features/monitoring/monitoring-model'
import { useOpenNote } from '@/features/monitoring/use-monitoring'
import { PLANS_COPY } from '@/features/plans/copy'
import { attentionSymbols, groupPlans, plansForCard, sharedSymbols } from '@/features/plans/plan-model'
import { usePlans, useSurface } from '@/features/plans/use-plans'
import { NO_TRADE_LABELS, RESULTS_COPY } from '@/features/results/copy'
import { usePlanResults } from '@/features/results/use-results'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type MonitoringCard, type TradingPlan } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { RulesBlock } from '@/screens/autoinvest/rules-block'
import { AttentionCard, PlanRow } from '@/screens/plans/plan-row'
import { useTheme } from '@/theme'
import { formatUsd, formatUsdSigned } from '@/utils/format'

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <View>
      <Txt variant="labelSm" tone="faint" caps className="px-1 pb-1 pt-3">
        {title} · {count}
      </Txt>
      {children}
    </View>
  )
}

function SectionTitle({ title, line }: { title: string; line?: string }) {
  return (
    <View className="gap-0.5">
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {line ? (
        <Txt variant="ui" tone="faint">
          {line}
        </Txt>
      ) : null}
    </View>
  )
}

/**
 * The person's trade plans, each with its result on its card: what
 * needs attention first (the monitoring's own cards), then the active plans,
 * the drafts and the closed ones; a new plan starts from a stock.
 */
function MyPlans() {
  const router = useRouter()
  const locale = useLocale()
  const copy = useCopy(PLANS_COPY)
  const bots = useCopy(BOTS_COPY)
  const results = useCopy(RESULTS_COPY)
  const noTrade = useCopy(NO_TRADE_LABELS)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const plans = usePlans(account.session)
  const feed = usePlanResults(account.session)
  const surface = useSurface(account.session, locale)
  const openNote = useOpenNote(account.session, 'plans')

  const open = (plan: TradingPlan) => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })
  // A card opens the exact plan and marks its note read; two plans on one symbol ask, never guess.
  const openCard = (card: MonitoringCard) =>
    openNote(
      planForCard(card, plans.data?.plans ?? []),
      noteRefOfHref(card.href) ?? { kind: 'monitor', id: card.monitorId },
    )
  const newPlan = () => router.push('/plans/pick')
  const resultOf = (plan: TradingPlan) =>
    planResultLine(feed.data ?? null, plan.id, {
      open: bots.positionOpen,
      closed: bots.positionClosed,
      costBasis: results.costBasis,
      realised: results.realised,
      noTrade,
      usd: (value) => formatUsd(value, locale),
      signed: (value) => formatUsdSigned(value, locale),
    })

  let body: ReactNode
  if (plans.isPending) {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel={copy.loading}>
        {Array.from({ length: 3 }, (_, index) => (
          <View key={index} className="gap-2 border-b border-line py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-48" />
          </View>
        ))}
      </View>
    )
  } else if (plans.isError && !plans.data) {
    body = (
      <View className="items-start gap-2 py-2">
        <Txt variant="ui" tone="muted">
          {isNetworkError(plans.error) ? shared.needsNetwork : copy.couldNotLoad}
        </Txt>
        <Button
          title={shared.tryAgain}
          variant="secondary"
          size="sm"
          loading={plans.isFetching}
          onPress={() => void plans.refetch()}
        />
      </View>
    )
  } else if ((plans.data?.plans.length ?? 0) === 0) {
    body = (
      <View className="items-start gap-2 py-2">
        <Txt variant="ui" tone="muted">
          {copy.noPlansDetail}
        </Txt>
        <Button title={bots.createPlan} variant="secondary" size="sm" onPress={newPlan} />
      </View>
    )
  } else {
    const all = plans.data!.plans
    const groups = groupPlans(all)
    const attention = attentionSymbols(surface)
    // A row wears the chip only when the symbol's card can be its own (one active plan on the symbol).
    const sharedCards = sharedSymbols(all)
    const cards = (surface?.attention ?? []).filter((card) => !card.paper && plansForCard(card, all).length > 0)
    const rows = (list: readonly TradingPlan[], marked = false) =>
      list.map((plan, index) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          copy={copy}
          locale={locale}
          now={now}
          attention={marked && attention.has(plan.asset.symbol) && !sharedCards.has(plan.asset.symbol)}
          result={resultOf(plan)}
          onPress={() => open(plan)}
          last={index === list.length - 1}
        />
      ))
    body = (
      <View>
        {plans.isError ? (
          <View className="pt-2">
            <Chip label={shared.refreshFailed} tone="warning" caps={false} />
          </View>
        ) : null}
        {cards.length > 0 ? (
          <View className="gap-2 pt-3">
            {cards.map((card) => (
              <AttentionCard
                key={card.monitorId}
                card={card}
                lastChecked={copy.lastChecked}
                locale={locale}
                now={now}
                onPress={() => openCard(card)}
              />
            ))}
          </View>
        ) : null}
        <Group title={copy.active} count={groups.active.length}>
          {rows(groups.active, true)}
        </Group>
        <Group title={copy.drafts} count={groups.drafts.length}>
          {rows(groups.drafts)}
        </Group>
        <Group title={copy.closed} count={groups.closed.length}>
          {rows(groups.closed)}
        </Group>
        <Button title={bots.createPlan} variant="secondary" onPress={newPlan} className="mt-4" />
      </View>
    )
  }

  return (
    <View className="gap-1">
      <SectionTitle title={bots.plans} line={bots.plansLead} />
      {body}
    </View>
  )
}

/** «Мої боти»: the recurring-buy rules, the trade plans with their results, and the results a tap deeper. */
function Mine() {
  const router = useRouter()
  const { colors } = useTheme()
  const bots = useCopy(BOTS_COPY)
  const account = useAccount()
  const plans = usePlans(account.session)
  const feed = usePlanResults(account.session)
  const queryClient = useQueryClient()
  const refreshing = (plans.isFetching && !plans.isPending) || (feed.isFetching && !feed.isPending)
  const refresh = () => {
    void plans.refetch()
    void feed.refetch()
    void queryClient.invalidateQueries({ queryKey: RULES_KEY })
  }
  return (
    <SessionGate what={bots.gateWhat}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-10 pt-1"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <Txt variant="ui" tone="muted">
          {bots.mineLead}
        </Txt>
        <RulesBlock session={account.session} place="bots" />
        <MyPlans />
        <Card padded={false}>
          <DoorRow
            icon="analytics-outline"
            label={bots.results}
            line={bots.resultsLead}
            onPress={() => router.push('/results')}
            last
          />
        </Card>
      </ScrollView>
    </SessionGate>
  )
}

/** «Каталог»: what can be set up today — the recurring buy for any token with liquidity, and a trade plan. */
function Catalog({ onMine }: { onMine: () => void }) {
  const router = useRouter()
  const bots = useCopy(BOTS_COPY)
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-10 pt-1">
      <Txt variant="ui" tone="muted">
        {bots.catalogLead}
      </Txt>
      <Card className="gap-3">
        <Txt variant="title">{bots.recurring}</Txt>
        <Txt variant="ui" tone="muted">
          {bots.recurringWhat}
        </Txt>
        {/* Any token with liquidity (1.31.0): what a rule may name, and the floor a meme or a new token stands on. */}
        <Txt variant="ui" tone="faint">
          {bots.recurringFor}
        </Txt>
        <Txt variant="ui" tone="faint">
          {bots.recurringHow}
        </Txt>
        <View className="flex-row gap-2">
          <Button
            title={bots.pickToken}
            variant="secondary"
            className="flex-1"
            onPress={() => router.navigate(marketsPath('all') as never)}
          />
          <Button title={bots.myRules} variant="ghost" className="flex-1" onPress={onMine} />
        </View>
      </Card>
      <Card className="gap-3">
        <Txt variant="title">{bots.planName}</Txt>
        <Txt variant="ui" tone="muted">
          {bots.planWhat}
        </Txt>
        <Button title={bots.createPlan} variant="secondary" onPress={() => router.push('/plans/pick')} />
      </Card>
    </ScrollView>
  )
}

/**
 * «Боти» — a row of «Ще», the web's `/app/bots`: everything
 * that runs on the person's rule in one place. «Мої боти» gathers the
 * recurring-buy rules (Ryntra reminds, the person signs every buy) and the
 * trade plans, each with its result; «Каталог» holds what can be set up.
 * `?tab=catalog` opens the catalog. The old addresses of the plans, the
 * results and «Автоінвест» lead here.
 */
export function BotsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const bots = useCopy(BOTS_COPY)
  const shared = useSharedCopy()
  const account = useAccount()
  const params = useLocalSearchParams<{ tab?: string }>()
  // Until a tap or a link chooses, the tab follows the session as it loads: «Мої боти» signed in, «Каталог» for a guest.
  const [chosen, setChosen] = useState<BotsTab | null>(() => (params.tab ? botsTabOf(params.tab) : null))
  const [askedSeen, setAskedSeen] = useState(params.tab)
  if (params.tab !== askedSeen) {
    setAskedSeen(params.tab)
    if (params.tab) setChosen(botsTabOf(params.tab))
  }
  const tab: BotsTab = chosen ?? (account.session ? 'mine' : 'catalog')
  const setTab = (next: BotsTab) => setChosen(next)
  // The ask is spent once read, so the same link opens its tab again.
  useEffect(() => {
    if (params.tab) router.setParams({ tab: undefined })
  }, [params.tab, router])
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  const tabs: readonly Choice<BotsTab>[] = BOTS_TABS.map((value) => ({ value, label: bots.tabs[value] }))
  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={bots.title}
        onBack={back}
        backLabel={shared.back}
        right={
          <AskRyn
            context={{ kind: 'page', page: 'strategies' }}
            label={bots.askRyntra}
            className="h-9 w-9 border border-line bg-surface"
          />
        }
      />
      <ChoiceChips choices={tabs} value={tab} onChange={setTab} role="tablist" quiet className="px-4 pb-3" />
      {tab === 'mine' ? <Mine /> : <Catalog onMine={() => setTab('mine')} />}
    </View>
  )
}
