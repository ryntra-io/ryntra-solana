import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import { groupByDay, rowsForMint, type HistoryRow } from '@/features/history/history-model'
import { useHistory } from '@/features/history/use-history'
import { useAccount } from '@/features/session/use-account'
import { useAttempt } from '@/features/trade/trade-store'
import { WalletGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isMint, isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatClock, formatDayHeading } from '@/utils/format'

import { HistoryRowView } from './history-row'
import { ReceiptSheet } from './receipt-sheet'

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
export function HistoryScreen({
  embedded = false,
  asset = null,
  onAllAssets,
}: {
  embedded?: boolean
  /** Inside «Портфель · Історія»: one asset's statement, asked from its position — the place keys the screen by it. */
  asset?: Readonly<{ mint: string; symbol: string }> | null
  onAllAssets?: () => void
} = {}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(HISTORY_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const params = useLocalSearchParams<{ mint?: string | string[]; symbol?: string | string[] }>()
  const mintParam = asset?.mint ?? first(params.mint)
  const symbolParam = asset?.symbol ?? first(params.symbol)
  const [mint, setMintState] = useState<string | null>(isMint(mintParam) ? mintParam : null)
  // «Усі» leaves the asset: here, and in the place that asked for it.
  const setMint = (next: string | null) => {
    setMintState(next)
    if (next === null) onAllAssets?.()
  }
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
    <HistoryRowView
      item={item}
      time={formatClock(item.at)}
      onPress={() => setPicked(item)}
      last={index === section.data.length - 1}
    />
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
  } else if (rows.length === 0 && embedded && !mint) {
    // Inside «Портфель · Історія» an empty statement is one quiet line, as «Активи» (NEW-LOOK §3).
    body = (
      <Txt variant="ui" tone="muted" className="px-4 py-2 text-center">
        {copy.emptyTitle}
      </Txt>
    )
  } else if (rows.length === 0) {
    body = (
      <StateView
        icon="receipt-outline"
        title={mint ? copy.emptyForAsset(symbolParam ?? '') : copy.emptyTitle}
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

  // Without a wallet nothing is read — no «Loading» over «Під'єднати гаманець» (ST-5).
  const subtitle = !account.address
    ? undefined
    : mint
      ? `${symbolParam ?? ''} · ${rows.length}`
      : query.data
        ? undefined
        : query.isError
          ? shared.didNotLoad
          : shared.loading

  // Inside «Портфель · Історія» the place draws the head; the statement and its receipts are the same — one asset's
  // with its chip to leave it.
  if (embedded) {
    return (
      <View className="flex-1">
        {mint ? (
          <View className="flex-row px-4 pb-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${symbolParam ?? mint.slice(0, 4)}, ${copy.all}`}
              onPress={() => setMint(null)}
              hitSlop={8}
              className="h-9 flex-row items-center gap-1 rounded-pill border border-brand-chip-line bg-brand-chip px-3 active:opacity-80"
            >
              <Txt variant="labelSm" tone="brand">
                {symbolParam ?? mint.slice(0, 4)}
              </Txt>
              <Icon name="close" size={14} color="brand" />
            </Pressable>
          </View>
        ) : null}
        <WalletGate what={copy.title}>{body}</WalletGate>
        <ReceiptSheet row={picked} now={now} locale={locale} copy={copy} onClose={() => setPicked(null)} />
      </View>
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
