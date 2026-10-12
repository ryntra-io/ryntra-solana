import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/components/chip'
import { Icon, type IconName } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { SearchInput } from '@/components/search-field'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import { historyTitle } from '@/features/history/history-model'
import { useHistory } from '@/features/history/use-history'
import { useCreatorCabinet } from '@/features/launch/use-launch'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import {
  docFromClaim,
  docFromHistory,
  docFromLaunchRow,
  legText,
  matchesQuery,
  mergeDocs,
  type DocKind,
  type ReceiptDoc,
} from '@/features/receipts/receipt-doc'
import { useAccount } from '@/features/session/use-account'
import { WalletGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { DASH, formatClock, formatDayHeading } from '@/utils/format'

import { ReceiptDocSheet } from './doc-sheet'
import { DOC_STATUS_TONE } from './receipt-picture'

const KIND_ICON: Readonly<Record<DocKind, IconName>> = {
  buy: 'arrow-down-circle-outline',
  sell: 'arrow-up-circle-outline',
  swap: 'swap-horizontal-outline',
  launch: 'rocket-outline',
  claim: 'download-outline',
  launchBuy: 'arrow-down-circle-outline',
  launchSell: 'arrow-up-circle-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  bridge: 'git-merge-outline',
  crossSwap: 'shuffle-outline',
  journal: 'reader-outline',
  other: 'ellipse-outline',
}

/** The line under a receipt's title: what moved — «0,02 SOL → 1,92 USDC». */
function amountsLine(doc: ReceiptDoc): string {
  const gave = doc.gave.map((leg) => legText(leg, true)).join(' + ')
  const got = doc.got.map((leg) => legText(leg, true)).join(' + ')
  if (gave && got) return `${gave} → ${got}`
  return gave || got || DASH
}

/** One receipt in the list: what kind, what happened, what moved, its state when it is not settled, its time. */
export function ReceiptRow({ doc, last, onPress }: { doc: ReceiptDoc; last: boolean; onPress: () => void }) {
  const copy = useCopy(RECEIPTS_COPY)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${doc.title}, ${amountsLine(doc)}, ${copy.statuses[doc.status]}, ${formatClock(doc.at)}`}
      onPress={onPress}
      className={`min-h-14 flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-elevated">
        <Icon name={KIND_ICON[doc.kind]} size={18} color="fg" />
      </View>
      <View className="flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={1}>
          {doc.title}
        </Txt>
        <Txt variant="data" tone="faint" numberOfLines={1}>
          {amountsLine(doc)}
        </Txt>
      </View>
      <View className="items-end gap-1">
        {doc.status !== 'done' ? <Chip label={copy.statuses[doc.status]} tone={DOC_STATUS_TONE[doc.status]} /> : null}
        <Txt variant="labelSm" tone="faint">
          {formatClock(doc.at)}
        </Txt>
      </View>
    </Pressable>
  )
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
          <Skeleton className="h-3 w-10" />
        </View>
      ))}
    </View>
  )
}

/**
 * «Квитанції» — every receipt of the wallet in one list: the purchases,
 * sales, swaps, launch trades and transfers from the server's ledger, and the
 * launches and «Забрати» from «Мої лаунчі»; searched by asset — a ticker or a
 * market's address. Each opens its card, and the card shares as a picture.
 */
export function ReceiptsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(RECEIPTS_COPY)
  const historyCopy = useCopy(HISTORY_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ReceiptDoc | null>(null)

  const account = useAccount()
  const history = useHistory(account.address, account.session)
  const cabinet = useCreatorCabinet(account.address)
  const activity = history.activity

  const docs = useMemo(() => {
    const fromHistory = history.rows.map((row) => docFromHistory(row, historyTitle(row, historyCopy.words)))
    const data = cabinet.data
    const launches = (data?.launches ?? [])
      .filter((row) => row.role === 'creator')
      .map((row) => docFromLaunchRow(row, copy.launched(row.symbol)))
    const claims = (data?.receipts ?? []).map((receipt) => docFromClaim(receipt, copy.claimed(receipt.symbol), locale))
    return mergeDocs(fromHistory, launches, claims)
  }, [history.rows, cabinet.data, historyCopy, copy, locale])

  const shown = useMemo(() => docs.filter((doc) => matchesQuery(doc, query)), [docs, query])
  const sections = useMemo(() => {
    const days: { title: string; data: ReceiptDoc[] }[] = []
    for (const doc of shown) {
      const title = formatDayHeading(doc.at, now, locale)
      const last = days[days.length - 1]
      if (last && last.title === title) last.data.push(doc)
      else days.push({ title, data: [doc] })
    }
    return days
  }, [shown, now, locale])

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/portfolio'))
  const refresh = () => {
    void activity.refetch()
    void cabinet.refetch()
  }

  const renderItem = ({
    item,
    index,
    section,
  }: {
    item: ReceiptDoc
    index: number
    section: { data: readonly ReceiptDoc[] }
  }) => <ReceiptRow doc={item} last={index === section.data.length - 1} onPress={() => setPicked(item)} />

  let body
  if (!account.address) {
    body = null
  } else if (activity.isPending) {
    body = <LoadingRows label={copy.loading} />
  } else if (activity.isError && !activity.data && docs.length === 0) {
    body = (
      <StateView
        icon={isNetworkError(activity.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(activity.error) ? shared.noConnection : copy.didNotLoad}
        detail={isNetworkError(activity.error) ? shared.needsNetwork : undefined}
        action={{ title: shared.tryAgain, onPress: refresh, loading: activity.isFetching }}
      />
    )
  } else {
    const notices = [
      history.complete ? null : copy.partial,
      cabinet.isError ? copy.launchesNotRead : null,
      activity.isError ? (activity.data ? shared.refreshFailed : copy.ledgerNotRead) : null,
    ].filter((notice): notice is string => notice !== null)
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
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-4 pb-8"
        initialNumToRender={16}
        refreshControl={
          <RefreshControl
            refreshing={(activity.isFetching && !activity.isPending) || cabinet.isRefetching}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          <View className="gap-2 pt-1">
            {docs.length > 0 ? (
              <View className="flex-row">
                <SearchInput
                  value={query}
                  onChangeText={setQuery}
                  onClear={() => setQuery('')}
                  placeholder={copy.search}
                  label={copy.searchA11y}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
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
        ListEmptyComponent={
          docs.length === 0 ? (
            // «None yet» only when everything was read; a list that was read in part says so above, not «none».
            history.complete && !cabinet.isError && !cabinet.isPending ? (
              <StateView icon="receipt-outline" title={copy.emptyTitle} detail={copy.emptyDetail} />
            ) : null
          ) : (
            <Txt variant="ui" tone="muted" className="py-6 text-center">
              {copy.noMatch(query.trim())}
            </Txt>
          )
        }
      />
    )
  }

  const subtitle =
    docs.length > 0
      ? copy.subtitle(docs.length)
      : activity.data
        ? copy.coverage
        : activity.isError
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
          <ScreenHeader title={copy.title} subtitle={subtitle} />
        </View>
      </View>
      <WalletGate what={copy.title}>{body}</WalletGate>
      <ReceiptDocSheet doc={picked} onClose={() => setPicked(null)} />
    </View>
  )
}
