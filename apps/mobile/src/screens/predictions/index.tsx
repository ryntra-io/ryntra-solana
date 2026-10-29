import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native'

import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { HelpDot } from '@/components/help-dot'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { PREDICTIONS_COPY, type PredictionsCopy } from '@/features/predictions/predictions-copy'
import {
  chanceText,
  CLOSE_SOON_MS,
  joinPages,
  leftText,
  outcomeWord,
  PREDICTION_SORTS,
  tradable,
  type PredictionEventRow,
  type PredictionSort,
} from '@/features/predictions/predictions-model'
import { usePredictionHub } from '@/features/predictions/use-predictions'
import { useNow } from '@/hooks/use-now'
import { useRefreshOnOpen } from '@/hooks/use-refresh-on-open'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatClock, formatDay } from '@/utils/format'

import { PredictionsAccountCard } from './account-card'

/** The pull's spinner stands over the list's top; while it spins the list stands this much lower (as Ринки's does). */
const PULL_ROOM = 56

/** When an event closes: what is left under two days («Закриття через 1 д 7 год»), its day beyond. */
export function closesLine(endsAt: string | null, now: number, words: PredictionsCopy, locale: Locale): string | null {
  if (endsAt === null) return null
  const at = Date.parse(endsAt)
  if (at - now < CLOSE_SOON_MS) {
    const left = leftText(at, now, locale)
    if (left !== null) return words.closesIn(left)
  }
  return words.closes(formatDay(endsAt, now, locale))
}

/** An event's picture, or its first letters on the quiet ground when it has none or it does not load. */
export function EventImage({ uri, title, size = 44 }: { uri: string | null; title: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const shown = uri && uri !== failed ? uri : null
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-sm bg-elevated"
      style={{ width: size, height: size }}
    >
      <Txt variant="label" tone="faint">
        {title.slice(0, 2)}
      </Txt>
      {shown ? (
        <Image
          key={shown}
          recyclingKey={shown}
          source={{ uri: shown }}
          style={{ position: 'absolute', width: size, height: size }}
          contentFit="cover"
          transition={120}
          onError={() => setFailed(shown)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  )
}

/** One event: its picture, its title and its lead market, when it closes; on the right the lead outcome's chance. */
export function EventRow({
  row,
  now,
  onPress,
  last,
}: {
  row: PredictionEventRow
  now: number
  onPress: () => void
  last?: boolean
}) {
  const words = useCopy(PREDICTIONS_COPY)
  const locale = useLocale()
  const lead = row.leading
  const label = lead ? outcomeWord(lead.label, locale) : words.yes
  const chance = chanceText(lead?.probability ?? null, locale)
  const line = [row.lead, closesLine(row.endsAt, now, words, locale)].filter(Boolean).join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}${row.lead ? `, ${row.lead}` : ''}, ${words.chanceA11y(chance, label)}`}
      onPress={onPress}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <EventImage uri={row.image} title={row.title} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={2}>
          {row.title}
        </Txt>
        {line ? (
          <Txt variant="labelSm" tone="faint" numberOfLines={1}>
            {line}
          </Txt>
        ) : null}
      </View>
      <View className="items-end" style={{ minWidth: 56 }}>
        <Txt variant="dataLg">{chance}</Txt>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {label}
        </Txt>
      </View>
    </Pressable>
  )
}

/**
 * «Торгівля → Прогнози» (M12; decisions 56, 57 and 58): AGG's markets on outcomes inside Ryntra on Solana — the same
 * events the web's hub lists, in its three orders and by category, each opening its own page; over them the wallet's
 * simulated account. Orders are a simulation for now, said in the head; what that means sits behind «?».
 */
export function PredictionsScreen() {
  const router = useRouter()
  const words = useCopy(PREDICTIONS_COPY)
  const { colors } = useTheme()
  const now = useNow(60_000)
  const [sort, setSort] = useState<PredictionSort>('volume24h')
  const [category, setCategory] = useState<string | null>(null)
  const hub = usePredictionHub(sort, category)
  useRefreshOnOpen([hub])
  const [pulled, setPulled] = useState(false)
  const pull = () => {
    setPulled(true)
    void hub.refetch().finally(() => setPulled(false))
  }
  const open = (id: string) => router.push({ pathname: '/predictions/[eventId]', params: { eventId: id } } as never)

  const pages = hub.data?.pages
  // Browsed lists show only what can still be traded, as the web's hub does; a closed or past event stays reachable
  // from its own link and from the account.
  const rows = useMemo(() => (pages ? joinPages(pages).filter((row) => tradable(row, now)) : []), [pages, now])
  const categories = pages?.[0]?.categories ?? []
  const readAt = pages?.[0]?.readAt ?? null

  const sortChoices: readonly Choice<PredictionSort>[] = PREDICTION_SORTS.map((value) => ({
    value,
    label: words.sorts[value],
  }))
  const categoryChoices: readonly Choice<string>[] = [
    { value: '', label: words.all },
    ...categories.map((entry) => ({ value: entry.slug, label: entry.name })),
  ]

  const head = (
    <View className="flex-row items-center gap-2 px-4 pb-2">
      <Txt variant="labelSm" tone="faint" numberOfLines={1} className="flex-1">
        {readAt !== null ? `${words.simulation} · ${formatClock(new Date(readAt).toISOString())}` : words.simulation}
      </Txt>
      <HelpDot title={words.helpTitle} body={words.help} />
    </View>
  )

  const filters = (
    <View className="gap-2 pb-2">
      <ChoiceChips choices={sortChoices} value={sort} onChange={setSort} role="tablist" scroll size="sm" />
      {categories.length > 0 ? (
        <ChoiceChips
          choices={categoryChoices}
          value={category ?? ''}
          onChange={(value) => setCategory(value === '' ? null : value)}
          scroll
          quiet
          size="sm"
        />
      ) : null}
    </View>
  )

  let list
  if (hub.isPending) {
    list = (
      <View className="gap-3 pt-2" accessibilityRole="progressbar" accessibilityLabel={words.loading}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-sm" />
        ))}
      </View>
    )
  } else if (!hub.data) {
    const offline = isNetworkError(hub.error)
    list = (
      <StateView
        icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={offline ? words.noConnection : words.down}
        detail={offline ? words.needsNetwork : words.downLine}
        action={{ title: words.tryAgain, onPress: () => void hub.refetch(), loading: hub.isFetching }}
      />
    )
  }

  return (
    <View className="flex-1 bg-ground">
      {head}
      <FlatList
        data={list ? [] : rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <EventRow row={item} now={now} onPress={() => open(item.id)} last={index === rows.length - 1} />
        )}
        contentContainerClassName="px-4 pb-6"
        contentContainerStyle={pulled ? { paddingTop: PULL_ROOM } : undefined}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hub.hasNextPage && !hub.isFetchingNextPage) void hub.fetchNextPage()
        }}
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            onRefresh={pull}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <PredictionsAccountCard onOpen={open} />
            {filters}
            {list}
          </View>
        }
        ListEmptyComponent={list ? null : <StateView icon="list-outline" title={words.noEvents} />}
        ListFooterComponent={
          hub.isFetchingNextPage ? (
            <View className="items-center py-4" accessibilityLabel={words.loadingMore}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : null
        }
      />
    </View>
  )
}
