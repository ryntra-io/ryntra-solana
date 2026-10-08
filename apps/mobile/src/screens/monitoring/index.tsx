import { useRouter } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { useOpenRyn } from '@/features/agent/ask-ryn'
import { AGENT_COPY } from '@/features/agent/copy'
import { MONITORING_COPY } from '@/features/monitoring/copy'
import {
  lastCheckedAt,
  noteRefOfHref,
  planForCard,
  resolveNote,
  unreadCount,
  type NoteRef,
} from '@/features/monitoring/monitoring-model'
import { useMarkRead, useOpenNote } from '@/features/monitoring/use-monitoring'
import { useMonitoring, usePlans } from '@/features/plans/use-plans'
import { usePhoneState } from '@/features/notifications/use-notifications'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type MonitoringCard, type MonitoringNote } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { formatAge } from '@/utils/format'
import { AttentionCard } from '@/screens/plans/plan-row'
import { useTheme } from '@/theme'

import { NoteRow, WatchRow } from './rows'

function LoadingBody({ label }: { label: string }) {
  return (
    <View className="gap-3 px-4 pt-3" accessibilityRole="progressbar" accessibilityLabel={label}>
      <Skeleton className="h-20 rounded-sm" />
      <Skeleton className="h-14 rounded-sm" />
      <Skeleton className="h-14 rounded-sm" />
      <Skeleton className="h-24 rounded-sm" />
    </View>
  )
}

function SectionLabel({ title, count, right }: { title: string; count?: number; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between px-1 pb-1 pt-4">
      <Txt variant="labelSm" tone="faint" caps>
        {title}
        {typeof count === 'number' ? ` · ${count}` : ''}
      </Txt>
      {right}
    </View>
  )
}

/**
 * The inbox: what needs attention (the server's cards, one tap to the exact
 * plan), what is watched, and the durable notes with their read state. The
 * count and every mark are the server's; a tap opens the plan the note is
 * about and marks the note read, the way the web's link does — it never
 * opens a Review, never refreshes a quote, never signs. The words of a
 * note are the server's own.
 */
export function MonitoringScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(MONITORING_COPY)
  const agentCopy = useCopy(AGENT_COPY)
  const openRyn = useOpenRyn()
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const session = account.session
  const monitoring = useMonitoring(session, locale)
  const plans = usePlans(session)
  const markRead = useMarkRead(session)
  const openNote = useOpenNote(session, 'inbox')
  const surface = monitoring.data ?? null
  // The soft prompt is shown only while this phone could be turned on and is not.
  const phone = usePhoneState(session, surface?.preferences.push ?? null)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const settings = () => router.push('/monitoring/preferences')

  const openRef = (ref: NoteRef, card: MonitoringCard | null) => {
    if (!surface || !plans.data) {
      router.push({ pathname: '/monitoring/open', params: { n: ref.id } })
      return
    }
    const target =
      card && ref.kind === 'monitor'
        ? planForCard(card, plans.data.plans)
        : resolveNote(ref, surface, plans.data.plans).target
    openNote(target, ref)
  }
  const openCard = (card: MonitoringCard) =>
    openRef(noteRefOfHref(card.href) ?? { kind: 'monitor', id: card.monitorId }, card)
  const open = (note: MonitoringNote) => openRef({ kind: 'note', id: note.id }, null)
  const markAll = () => {
    for (const note of surface?.recent ?? []) if (note.unread) markRead.mutate(note.id)
  }

  const unread = unreadCount(surface)
  const checked = lastCheckedAt(surface)

  let body
  if (!session) {
    body = null
  } else if (monitoring.isPending) {
    body = <LoadingBody label={copy.loading} />
  } else if (monitoring.isError && !surface) {
    body = (
      <StateView
        icon={isNetworkError(monitoring.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(monitoring.error) ? shared.noConnection : copy.couldNotLoad}
        detail={isNetworkError(monitoring.error) ? shared.needsNetwork : undefined}
        action={{ title: shared.tryAgain, onPress: () => void monitoring.refetch(), loading: monitoring.isFetching }}
      />
    )
  } else if (surface && surface.attention.length + surface.watching.length + surface.recent.length === 0) {
    body = (
      <StateView
        icon="notifications-outline"
        title={copy.noPlansTitle}
        detail={copy.noPlansDetail}
        action={{ title: copy.openPlans, onPress: () => router.push('/bots') }}
      />
    )
  } else if (surface) {
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={monitoring.isFetching && !monitoring.isPending}
            onRefresh={() => void monitoring.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {monitoring.isError ? (
          <View className="pt-3">
            <Chip label={shared.refreshFailed} tone="warning" caps={false} />
          </View>
        ) : null}

        {phone.state === 'off' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.promptTitle}
            onPress={settings}
            className="mt-3 flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
          >
            <Icon name="phone-portrait-outline" size={20} color="brand" />
            <View className="flex-1 gap-0.5">
              <Txt variant="ui">{copy.promptTitle}</Txt>
              <Txt variant="labelSm" tone="faint">
                {copy.promptDetail}
              </Txt>
            </View>
            <Icon name="chevron-forward" size={18} color="fgMuted" />
          </Pressable>
        ) : null}

        <SectionLabel title={copy.attention} count={surface.attention.length} />
        {surface.attention.length === 0 ? (
          <Txt variant="ui" tone="faint" className="px-1">
            {copy.emptyAttention}
          </Txt>
        ) : (
          <View className="gap-2">
            {surface.attention.map((card) => (
              <AttentionCard
                key={card.monitorId}
                card={card}
                lastChecked={copy.lastChecked}
                locale={locale}
                now={now}
                onPress={() => openCard(card)}
                paperLabel={copy.paper}
              />
            ))}
          </View>
        )}

        <SectionLabel title={copy.watching} count={surface.watching.length} />
        {surface.watching.length === 0 ? (
          <Txt variant="ui" tone="faint" className="px-1">
            {copy.emptyWatching}
          </Txt>
        ) : (
          <Card padded={false} className="px-4">
            {surface.watching.map((card, index) => (
              <WatchRow
                key={card.monitorId}
                card={card}
                copy={copy}
                locale={locale}
                now={now}
                onPress={() => openCard(card)}
                last={index === surface.watching.length - 1}
              />
            ))}
          </Card>
        )}

        <SectionLabel
          title={copy.recent}
          count={surface.recent.length}
          right={
            unread > 0 ? (
              <Button
                title={copy.markAllRead}
                variant="ghost"
                size="sm"
                onPress={markAll}
                loading={markRead.isPending}
              />
            ) : undefined
          }
        />
        {surface.recent.length === 0 ? (
          <Txt variant="ui" tone="faint" className="px-1">
            {copy.emptyRecent}
          </Txt>
        ) : (
          <Card padded={false} className="px-4">
            {surface.recent.map((note, index) => (
              <NoteRow
                key={note.id}
                note={note}
                copy={copy}
                locale={locale}
                now={now}
                onPress={() => open(note)}
                onMarkRead={note.unread ? () => markRead.mutate(note.id) : undefined}
                onAsk={() => openRyn({ kind: 'note', inboxId: note.id })}
                askLabel={agentCopy.askAboutNote}
                last={index === surface.recent.length - 1}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
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
        <View className="flex-1">
          <ScreenHeader
            title={copy.title}
            subtitle={
              surface
                ? `${unread > 0 ? copy.unread(unread) : copy.allRead}${checked ? ` · ${copy.checked} ${formatAge(checked, now, locale)}` : ''}`
                : undefined
            }
            right={
              session ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.settings}
                  onPress={settings}
                  className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
                >
                  <Icon name="options-outline" size={20} color="fg" />
                </Pressable>
              ) : undefined
            }
          />
        </View>
      </View>
      <SessionGate what={copy.title}>{body}</SessionGate>
    </View>
  )
}
