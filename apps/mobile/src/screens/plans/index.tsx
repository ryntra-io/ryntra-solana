import { useRouter } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { noteRefOfHref, planForCard, unreadCount } from '@/features/monitoring/monitoring-model'
import { useOpenNote } from '@/features/monitoring/use-monitoring'
import { PLANS_COPY } from '@/features/plans/copy'
import { attentionSymbols, groupPlans, plansForCard, sharedSymbols } from '@/features/plans/plan-model'
import { usePlans, useSurface } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type MonitoringCard, type TradingPlan } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'

import { AttentionCard, PlanRow } from './plan-row'

function LoadingRows({ label }: { label: string }) {
  return (
    <View className="px-4" accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: 4 }, (_, index) => (
        <View key={index} className="gap-2 border-b border-line py-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-36" />
        </View>
      ))}
    </View>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <View>
      <Txt variant="labelSm" tone="faint" caps className="px-1 pb-1 pt-4">
        {title} · {count}
      </Txt>
      {children}
    </View>
  )
}

export type PlansScreenProps = {
  /** Drawn inside the tab (no back arrow) or as a stack screen. */
  embedded?: boolean
}

/**
 * The plans as a capability — the same screen behind Home, More and, later,
 * the Agent (`embedded` drew it inside the Strategies tab of the built
 * shell; the target shell has no such tab). What needs attention first (the
 * monitoring's own cards), then the active plans, the drafts and the
 * closed ones; a new plan starts from a stock. Private to the wallet's
 * session.
 */
export function PlansScreen({ embedded = false }: PlansScreenProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(PLANS_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const plans = usePlans(account.session)
  const surface = useSurface(account.session, locale)
  const openNote = useOpenNote(account.session, 'plans')
  const unread = unreadCount(surface)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  const open = (plan: TradingPlan) => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })
  // A card opens the exact plan and marks its note read; two plans on one symbol ask, never guess (M7).
  const openCard = (card: MonitoringCard) =>
    openNote(
      planForCard(card, plans.data?.plans ?? []),
      noteRefOfHref(card.href) ?? { kind: 'monitor', id: card.monitorId },
    )
  const openMonitoring = () => router.push('/monitoring')
  const newPlan = () => router.push('/plans/pick')

  let body
  if (!account.session) {
    body = null
  } else if (plans.isPending) {
    body = <LoadingRows label={copy.loading} />
  } else if (plans.isError && !plans.data) {
    body = (
      <StateView
        icon={isNetworkError(plans.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(plans.error) ? shared.noConnection : copy.couldNotLoad}
        detail={isNetworkError(plans.error) ? shared.needsNetwork : plans.error.message}
        action={{ title: shared.tryAgain, onPress: () => void plans.refetch(), loading: plans.isFetching }}
      />
    )
  } else if ((plans.data?.plans.length ?? 0) === 0) {
    body = (
      <StateView
        icon="git-branch-outline"
        title={copy.noPlansTitle}
        detail={copy.noPlansDetail}
        action={{ title: copy.pickStock, onPress: newPlan }}
      />
    )
  } else {
    const groups = groupPlans(plans.data!.plans)
    const attention = attentionSymbols(surface)
    // A row wears the chip only when the symbol's card can be its own (one active plan on the symbol).
    const sharedCards = sharedSymbols(plans.data!.plans)
    const cards = (surface?.attention ?? []).filter(
      (card) => !card.paper && plansForCard(card, plans.data!.plans).length > 0,
    )
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={plans.isFetching && !plans.isPending}
            onRefresh={() => void plans.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {plans.isError ? (
          <View className="pt-3">
            <Chip label={shared.refreshFailed} tone="warning" caps={false} />
          </View>
        ) : null}
        {cards.length > 0 ? (
          <View className="gap-2 pt-3">
            <Txt variant="labelSm" tone="faint" caps className="px-1">
              {copy.attention} · {cards.length}
            </Txt>
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
        <Section title={copy.active} count={groups.active.length}>
          {groups.active.map((plan, index) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              copy={copy}
              locale={locale}
              now={now}
              attention={attention.has(plan.asset.symbol) && !sharedCards.has(plan.asset.symbol)}
              onPress={() => open(plan)}
              last={index === groups.active.length - 1}
            />
          ))}
        </Section>
        <Section title={copy.drafts} count={groups.drafts.length}>
          {groups.drafts.map((plan, index) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              copy={copy}
              locale={locale}
              now={now}
              onPress={() => open(plan)}
              last={index === groups.drafts.length - 1}
            />
          ))}
        </Section>
        <Section title={copy.closed} count={groups.closed.length}>
          {groups.closed.map((plan, index) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              copy={copy}
              locale={locale}
              now={now}
              onPress={() => open(plan)}
              last={index === groups.closed.length - 1}
            />
          ))}
        </Section>
        <View className="pt-5">
          <Button title={copy.newPlan} onPress={newPlan} />
        </View>
      </ScrollView>
    )
  }

  const header = (
    <ScreenHeader
      title={copy.title}
      subtitle={plans.data ? copy.planCount(plans.data.total) : undefined}
      right={
        account.session ? (
          <View className="flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? `${copy.monitoring}, ${unread}` : copy.monitoring}
              onPress={openMonitoring}
              className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
            >
              <Icon
                name={unread > 0 ? 'notifications' : 'notifications-outline'}
                size={20}
                color={unread > 0 ? 'brand' : 'fg'}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.newPlan}
              onPress={newPlan}
              className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
            >
              <Icon name="add" size={20} color="fg" />
            </Pressable>
          </View>
        ) : undefined
      }
    />
  )

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      {embedded ? (
        header
      ) : (
        <View className="flex-row items-center gap-1 px-2 pt-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shared.back}
            onPress={back}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
          >
            <Icon name="arrow-back" size={22} color="fg" />
          </Pressable>
          <View className="flex-1">{header}</View>
        </View>
      )}
      <SessionGate what={copy.title}>{body}</SessionGate>
    </View>
  )
}
