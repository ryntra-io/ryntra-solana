import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/components/chip'
import { Icon, type IconName } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import {
  groupByDay,
  historyAmounts,
  historyTitle,
  rowsForMint,
  type HistoryKind,
  type HistoryRow,
} from '@/features/history/history-model'
import { useHistory } from '@/features/history/use-history'
import { useAccount } from '@/features/session/use-account'
import { useAttempt } from '@/features/trade/trade-store'
import { WalletGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isMint, isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatClock, formatDayHeading } from '@/utils/format'

import { ReceiptSheet, STATUS_TONE } from './receipt-sheet'

const KIND_ICON: Readonly<Record<HistoryKind, IconName>> = {
  buy: 'arrow-down-circle-outline',
  sell: 'arrow-up-circle-outline',
  swap: 'swap-horizontal-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  bridge: 'git-merge-outline',
  crossSwap: 'shuffle-outline',
  other: 'ellipse-outline',
}

function LoadingRows({ label }: { label: string }) {
  return (
    <View className="px-4" accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: 7 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
          <Skeleton className="h-9 w-9 rounded-pill" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </View>
          <View className="items-end gap-2">
            <Skeleton className="h-4 w-16 rounded-pill" />
            <Skeleton className="h-3 w-10" />
          </View>
        </View>
      ))}
    </View>
  )
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/**
 * The statement: every operation of the wallet from the server's ledger,
 * newest first, grouped by day — what happened, what moved, its state and
 * its time; the whole receipt one tap deep. Opened for one asset, it shows
 * that asset's rows with the filter named and clearable. Public by address;
 * the wallet's reward rows join over its bearer.
 */
export function HistoryScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(HISTORY_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const params = useLocalSearchParams<{ mint?: string | string[]; symbol?: string | string[] }>()
  const mintParam = first(params.mint)
  const symbolParam = first(params.symbol)
  const [mint, setMint] = useState<string | null>(isMint(mintParam) ? mintParam : null)
  const [picked, setPicked] = useState<HistoryRow | null>(null)

  const account = useAccount()
  const history = useHistory(account.address, account.session)
  const attempt = useAttempt(account.address)

  const rows = useMemo(() => (mint ? rowsForMint(history.rows, mint) : history.rows), [history.rows, mint])
  const sections = useMemo(
    () => groupByDay(rows).map((day) => ({ title: formatDayHeading(day.day, now, locale), data: day.rows })),
    [rows, now, locale],
  )
  const query = history.activity

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/portfolio'))

  // The compiler memoizes this; a manual useCallback here would name the wrong dependencies.
  const renderItem = ({
    item,
    index,
    section,
  }: {
    item: HistoryRow
    index: number
    section: { data: readonly HistoryRow[] }
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${historyTitle(item, copy.words)}, ${historyAmounts(item)}, ${copy.status[item.status]}, ${formatClock(item.at)}`}
      onPress={() => setPicked(item)}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${index === section.data.length - 1 ? '' : 'border-b border-line'}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-elevated">
        <Icon name={KIND_ICON[item.kind]} size={18} color="fg" />
      </View>
      <View className="flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={1}>
          {historyTitle(item, copy.words)}
        </Txt>
        <Txt variant="data" tone="faint" numberOfLines={1}>
          {historyAmounts(item)}
        </Txt>
      </View>
      <View className="items-end gap-1">
        {/* A settled row needs no badge — that is what a statement is; anything else says its state. */}
        {item.status !== 'done' ? <Chip label={copy.status[item.status]} tone={STATUS_TONE[item.status]} /> : null}
        <Txt variant="labelSm" tone="faint">
          {formatClock(item.at)}
        </Txt>
      </View>
    </Pressable>
  )

  let body
  if (!account.address) {
    body = null
  } else if (query.isPending) {
    body = <LoadingRows label={copy.loading} />
  } else if (query.isError && !query.data) {
    body = (
      <StateView
        icon={isNetworkError(query.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(query.error) ? shared.noConnection : copy.didNotLoad}
        detail={isNetworkError(query.error) ? shared.needsNetwork : query.error.message}
        action={{ title: shared.tryAgain, onPress: () => void query.refetch(), loading: query.isFetching }}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <StateView
        icon="receipt-outline"
        title={mint ? copy.emptyForAsset(symbolParam ?? '') : copy.emptyTitle}
        detail={copy.emptyDetail}
        action={mint ? { title: copy.all, onPress: () => setMint(null) } : undefined}
      />
    )
  } else {
    const notices = [history.complete ? null : copy.incomplete, query.isError ? shared.refreshFailed : null].filter(
      (notice): notice is string => notice !== null,
    )
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View className="bg-ground pb-1 pt-4">
            <Txt variant="labelSm" tone="faint" caps>
              {section.title}
            </Txt>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerClassName="px-4 pb-8"
        initialNumToRender={16}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isPending}
            onRefresh={() => void query.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          <View className="gap-2">
            {attempt ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/trade')}
                className="flex-row items-center gap-3 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3 active:opacity-80"
              >
                <Icon name="alert-circle-outline" size={18} color="warningInk" />
                <Txt variant="ui" tone="warning" className="flex-1">
                  {copy.unresolved}
                </Txt>
                <Icon name="chevron-forward" size={16} color="warningInk" />
              </Pressable>
            ) : null}
            {notices.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {notices.map((notice) => (
                  <Chip key={notice} label={notice} tone="warning" caps={false} />
                ))}
              </View>
            ) : null}
          </View>
        }
      />
    )
  }

  const subtitle = mint
    ? `${symbolParam ?? ''} · ${rows.length}`
    : query.data
      ? `${copy.coverage} · ${rows.length}`
      : query.isError
        ? shared.didNotLoad
        : shared.loading

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
            subtitle={subtitle}
            right={
              mint ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.all}
                  onPress={() => setMint(null)}
                  className="h-8 flex-row items-center gap-1 rounded-pill border border-brand-chip-line bg-brand-chip px-3 active:opacity-80"
                >
                  <Txt variant="labelSm" tone="brand">
                    {symbolParam ?? mint.slice(0, 4)}
                  </Txt>
                  <Icon name="close" size={14} color="brand" />
                </Pressable>
              ) : undefined
            }
          />
        </View>
      </View>
      <WalletGate what={copy.title}>{body}</WalletGate>
      <ReceiptSheet row={picked} now={now} locale={locale} copy={copy} onClose={() => setPicked(null)} />
    </View>
  )
}
