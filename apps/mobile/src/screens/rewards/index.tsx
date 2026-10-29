import { useRouter } from 'expo-router'
import { useState } from 'react'
import { RefreshControl, ScrollView, Share, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StatTile } from '@/components/stat-tile'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { REWARDS_COPY } from '@/features/rewards/copy'
import { referralShare, type RewardsView } from '@/features/rewards/rewards-model'
import { useRewards } from '@/features/rewards/use-rewards'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatAt, formatCount, formatMoment } from '@/utils/format'

function LoadingBody({ label }: { label: string }) {
  return (
    <View className="gap-3 px-4" accessibilityRole="progressbar" accessibilityLabel={label}>
      <Skeleton className="h-24 rounded-sm" />
      <View className="flex-row gap-3">
        <Skeleton className="h-20 flex-1 rounded-sm" />
        <Skeleton className="h-20 flex-1 rounded-sm" />
      </View>
      <Skeleton className="h-36 rounded-sm" />
      <Skeleton className="h-28 rounded-sm" />
    </View>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps className="px-1 pt-3">
      {children}
    </Txt>
  )
}

function PointsCard({ view }: { view: RewardsView }) {
  const copy = useCopy(REWARDS_COPY)
  const locale = useLocale()
  const points = view.points
  if (!points) {
    return (
      <Card className="gap-1">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.points}
        </Txt>
        <Txt variant="ui" tone="muted">
          {copy.pointsUnavailable}
        </Txt>
      </Card>
    )
  }
  return (
    <Card className="gap-3">
      <View className="flex-row items-end justify-between">
        <View className="gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.points}
          </Txt>
          <Txt variant="dataLg">{points.points}</Txt>
        </View>
        <Chip label={copy.level(points.level)} tone="brand" />
      </View>
      <View className="gap-1.5">
        <View className="h-1.5 overflow-hidden rounded-pill bg-track">
          <View
            className="h-full rounded-pill bg-brand"
            style={{ width: `${Math.round((points.progress ?? 1) * 100)}%` }}
          />
        </View>
        <Txt variant="labelSm" tone="faint">
          {points.nextLevelAt ? copy.nextLevelAt(points.nextLevelAt) : copy.topLevel}
          {' · '}
          {points.rank !== null && !points.excluded ? copy.rank(points.rank, points.ranked) : copy.notRanked}
        </Txt>
      </View>
      {/* The tiles stand as tall as the tallest; each figure sits at its tile's foot, so a label that wraps
          («АКТИВНИХ ДНІВ») never sets its figure lower than its neighbours'. */}
      <View className="flex-row gap-2">
        <StatTile label={copy.volume} value={points.volume} className="flex-1 justify-between" />
        <StatTile label={copy.trades} value={formatCount(points.trades, locale)} className="flex-1 justify-between" />
        <StatTile
          label={copy.activeDays}
          value={formatCount(points.activeDays, locale)}
          className="flex-1 justify-between"
        />
      </View>
    </Card>
  )
}

/**
 * What this wallet has earned, as the server confirms it: available,
 * pending, earned in total; where it came from; the points and their
 * level; the invite link with the Android share sheet; who was invited;
 * the recent entries. Read-only — claiming lives on ryntra.io — and private
 * to the wallet's own session.
 */
export function RewardsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(REWARDS_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const { query, view } = useRewards(account.session, locale)
  const [sharing, setSharing] = useState(false)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))

  const share = async () => {
    if (!view?.referral) return
    setSharing(true)
    try {
      const payload = referralShare(view.referral, { invite: copy.shareInvite, subject: copy.shareSubject })
      await Share.share({ message: payload.message, title: payload.title }, { dialogTitle: payload.title })
    } catch {
      // The sheet was dismissed or refused; nothing to say.
    } finally {
      setSharing(false)
    }
  }

  let body
  if (!account.session) {
    body = null
  } else if (query.isPending) {
    body = <LoadingBody label={copy.loading} />
  } else if (query.isError && !view) {
    body = (
      <StateView
        icon={isNetworkError(query.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(query.error) ? shared.noConnection : copy.didNotLoad}
        detail={isNetworkError(query.error) ? shared.needsNetwork : query.error.message}
        action={{ title: shared.tryAgain, onPress: () => void query.refetch(), loading: query.isFetching }}
      />
    )
  } else if (view) {
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isPending}
            onRefresh={() => void query.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {query.isError ? <Chip label={shared.refreshFailed} tone="warning" caps={false} /> : null}
        <StatTile label={copy.available} value={view.available} size="lg" note={view.claimNote ?? copy.claimOnWeb} />
        <View className="flex-row gap-3">
          <StatTile label={copy.pending} value={view.pending} className="flex-1 justify-between" />
          <StatTile label={copy.lifetime} value={view.lifetime} className="flex-1 justify-between" />
        </View>
        {/* Every figure carries its time: the moment this read of the rewards arrived. */}
        <Txt variant="labelSm" tone="faint">
          {copy.readAt(formatAt(new Date(query.dataUpdatedAt).toISOString(), now, locale))}
        </Txt>
        {!view.started ? (
          <Txt variant="ui" tone="faint">
            {copy.notStarted}
          </Txt>
        ) : null}

        <SectionLabel>{copy.sources}</SectionLabel>
        <Card>
          {view.sources.map((source, index) => (
            <FactRow
              key={source.id}
              label={copy.source[source.id]}
              value={source.text}
              last={index === view.sources.length - 1}
            />
          ))}
        </Card>

        <PointsCard view={view} />

        <SectionLabel>{copy.referral}</SectionLabel>
        <Card className="gap-3">
          {view.referral ? (
            <>
              <View className="flex-row items-center justify-between gap-3">
                <View className="gap-0.5">
                  <Txt variant="labelSm" tone="faint" caps>
                    {copy.yourCode}
                  </Txt>
                  <Txt variant="dataLg" selectable>
                    {view.referral.code}
                  </Txt>
                </View>
                <Icon name="gift-outline" size={26} color="brand" />
              </View>
              <Txt variant="data" tone="muted" selectable numberOfLines={1}>
                {view.referral.link.replace(/^https?:\/\//, '')}
              </Txt>
              <Button title={copy.share} onPress={() => void share()} loading={sharing} />
            </>
          ) : (
            <Txt variant="body" tone="muted">
              {copy.noReferral}
            </Txt>
          )}
          <Txt variant="ui" tone="faint">
            {copy.invited(view.invited.level1, view.invited.level2)}
            {view.invitedBy ? ` · ${copy.invitedBy(view.invitedBy)}` : ''}
          </Txt>
        </Card>

        <SectionLabel>{copy.recent}</SectionLabel>
        {view.entries.length === 0 ? (
          <Card>
            <Txt variant="ui">{copy.noEntries}</Txt>
          </Card>
        ) : (
          <Card padded={false} className="px-4">
            {view.entries.map((entry, index) => (
              <FactRow
                key={`${entry.kind}-${entry.at}-${index}`}
                label={copy.entry[entry.kind]}
                value={entry.display}
                detail={[entry.detail, formatMoment(entry.at, now, locale)].filter(Boolean).join(' · ')}
                tone={entry.valued ? (entry.display.startsWith('−') ? 'muted' : 'success') : 'muted'}
                last={index === view.entries.length - 1}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader title={copy.title} onBack={back} backLabel={shared.back} />
      <SessionGate what={copy.title}>{body}</SessionGate>
    </View>
  )
}
