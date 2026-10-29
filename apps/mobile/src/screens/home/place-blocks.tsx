import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { AssetRow } from '@/components/asset-row'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Holdable } from '@/components/holdable'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useAmountsHidden } from '@/features/home/last-look'
import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { HISTORY_COPY } from '@/features/history/copy'
import type { HistoryRow } from '@/features/history/history-model'
import { useHistory } from '@/features/history/use-history'
import { useShelfNames } from '@/features/invest/use-shelf'
import { launchWords } from '@/features/launch/copy'
import { formatBps } from '@/features/launch/launch-format'
import { cabinetTradeStatus } from '@/features/launch/market-view'
import { useCreatorCabinet } from '@/features/launch/use-launch'
import { marketsPath } from '@/features/markets/screener'
import { PORTFOLIO_HISTORY_PATH } from '@/features/shell/shell'
import type { Session } from '@/lib/api'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useWatchlistMarkets } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { issuerLabel } from '@/lib/stocks'
import { HistoryRowView } from '@/screens/history/history-row'
import { ReceiptSheet } from '@/screens/history/receipt-sheet'
import { formatAt } from '@/utils/format'

import { BlockError, BlockSkeleton, QuietLine } from './blocks'

/** How many rows a block of Home draws before its «all» door (NEW-LOOK §3). */
export const FAVOURITES_ON_HOME = 4
export const LAUNCHES_ON_HOME = 3
export const RECENT_ON_HOME = 3

/**
 * A block of the new look's Home: its name as a heading, one quiet door on the right, then its rows. Holding any part
 * of it arranges Home (C2); a block with nothing to say returns nothing at all, so no empty gap stands in its place.
 */
function PlaceBlock({
  title,
  action,
  onHold,
  children,
}: {
  title: string
  action?: Readonly<{ label: string; onPress: () => void }>
  onHold: () => void
  children: ReactNode
}) {
  return (
    <Holdable onHold={onHold}>
      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="title" accessibilityRole="header" className="flex-1">
            {title}
          </Txt>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              hitSlop={8}
              className="min-h-11 shrink-0 flex-row items-center gap-1 active:opacity-80"
            >
              <Txt variant="ui" tone="muted" numberOfLines={1}>
                {action.label}
              </Txt>
              <Icon name="chevron-forward" size={14} color="fgMuted" />
            </Pressable>
          ) : null}
        </View>
        {children}
      </View>
    </Holdable>
  )
}

/** «Обране»: up to four of the person's starred assets with the price and its day, and «Усе обране» (not over an empty list). */
export function FavouritesBlock({ onHold }: { onHold: () => void }) {
  const router = useRouter()
  const words = useCopy(PLACE_HOME_COPY)
  const shared = useSharedCopy()
  const watchlist = useWatchlist()
  const read = useWatchlistMarkets(watchlist.mints)
  // A company by the name Markets and its page give it («NVIDIA», not the token's «NVIDIA xStock»), its issuer short.
  const nameOf = useShelfNames()
  const openAll = () => router.navigate(marketsPath('watchlist') as never)
  const rows = (read.data?.rows ?? []).slice(0, FAVOURITES_ON_HOME)
  let body: ReactNode
  if (watchlist.mints.length === 0) {
    body = (
      <QuietLine
        text={words.favouritesEmpty}
        icon="star-outline"
        onPress={() => router.navigate(marketsPath('all') as never)}
      />
    )
  } else if (rows.length > 0) {
    body = (
      <Card padded={false} className="px-4">
        {rows.map((row, index) => (
          <AssetRow
            key={row.mint}
            asset={{
              ...row,
              name: nameOf(row.mint) ?? row.name,
              issuer: row.issuer ? { label: issuerLabel(row.issuer.tag) } : null,
            }}
            onPress={() => router.push({ pathname: '/asset/[mint]', params: { mint: row.mint, symbol: row.symbol } })}
            last={index === rows.length - 1}
          />
        ))}
      </Card>
    )
  } else if (read.isError) {
    body = (
      <BlockError
        text={shared.didNotLoad}
        retry={() => void read.refetch()}
        retrying={read.isFetching}
        label={shared.tryAgain}
      />
    )
  } else {
    body = <BlockSkeleton label={words.favourites} rows={Math.min(watchlist.mints.length, FAVOURITES_ON_HOME)} />
  }
  return (
    <PlaceBlock
      title={words.favourites}
      // «Усе обране» opens «Ринки · Обране»; over an empty list the line under it is the one door — to «Усі».
      action={watchlist.mints.length > 0 ? { label: words.allFavourites, onPress: openAll } : undefined}
      onHold={onHold}
    >
      {body}
    </PlaceBlock>
  )
}

/**
 * «Мої ринки»: the wallet's launches — where each stands on its way to the DEX and whether fees wait to be claimed —
 * and «Мої лаунчі». A wallet that launched nothing reads no block at all; nor is one drawn before the chain is read.
 */
export function MyMarketsBlock({ address, onHold }: { address: string; onHold: () => void }) {
  const router = useRouter()
  const words = useCopy(PLACE_HOME_COPY)
  const locale = useLocale()
  const launchWord = launchWords(locale)
  const cabinet = useCreatorCabinet(address)
  const launches = (cabinet.data?.launches ?? []).slice(0, LAUNCHES_ON_HOME)
  if (launches.length === 0) return null
  return (
    <PlaceBlock
      title={words.myMarkets}
      action={{ label: words.myLaunches, onPress: () => router.push('/launch/mine' as never) }}
      onHold={onHold}
    >
      <Card padded={false} className="px-4">
        {launches.map((row, index) => {
          // The one status every launch list says, in Launch's own words; how full the curve is, a figure beside it.
          const status = cabinetTradeStatus(row)
          const statusWord = status === 'notRead' ? launchWord('notRead') : launchWord(`tradeStatus_${status}`)
          const state =
            status === 'trading' && row.migrated === false && row.progressBps !== null
              ? `${statusWord} · ${launchWord('filled', { pct: formatBps(row.progressBps, locale) })}`
              : statusWord
          return (
            <Pressable
              key={row.token}
              accessibilityRole="button"
              accessibilityLabel={[`$${row.symbol}`, state, row.claimable ? words.feesToClaim : null]
                .filter(Boolean)
                .join(', ')}
              onPress={() => router.push({ pathname: '/launch/[mint]', params: { mint: row.token } })}
              className={`flex-row items-center gap-3 py-3 active:bg-hover ${index === launches.length - 1 ? '' : 'border-b border-line'}`}
            >
              <AssetIcon symbol={row.symbol} icon={row.image} />
              {/* The fees' chip rides the symbol's line (ST-5), so the state below has the row's whole width and wraps
                  rather than cut: «Торгується · заповнено 42 %» keeps its figure. */}
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center justify-between gap-2">
                  <Txt variant="ui" numberOfLines={1} className="shrink">{`$${row.symbol}`}</Txt>
                  {row.claimable ? <Chip label={words.feesToClaim} tone="brand" caps={false} /> : null}
                </View>
                <Txt variant="ui" tone="faint">
                  {state}
                </Txt>
              </View>
            </Pressable>
          )
        })}
      </Card>
    </PlaceBlock>
  )
}

/**
 * «Останнє»: the wallet's last three operations, each with its day and time; a tap opens that operation's receipt
 * where it stands, and «Уся історія» opens «Портфель · Історія» (NEW-LOOK §3, §5) — never the older History screen.
 */
export function RecentBlock({
  address,
  session,
  onHold,
}: {
  address: string
  session: Session | null
  onHold: () => void
}) {
  const router = useRouter()
  const words = useCopy(PLACE_HOME_COPY)
  const historyCopy = useCopy(HISTORY_COPY)
  const locale = useLocale()
  const now = useNow(60_000)
  const history = useHistory(address, session)
  const hidden = useAmountsHidden()
  const [picked, setPicked] = useState<HistoryRow | null>(null)
  const rows = history.rows.slice(0, RECENT_ON_HOME)
  if (rows.length === 0) return null
  const openHistory = () => router.navigate(PORTFOLIO_HISTORY_PATH as never)
  return (
    <PlaceBlock title={words.recent} action={{ label: words.allHistory, onPress: openHistory }} onHold={onHold}>
      <Card padded={false} className="px-4">
        {rows.map((row, index) => (
          <HistoryRowView
            key={row.id}
            item={row}
            time={formatAt(row.at, now, locale)}
            onPress={() => setPicked(row)}
            last={index === rows.length - 1}
            hidden={hidden}
          />
        ))}
      </Card>
      <ReceiptSheet row={picked} now={now} locale={locale} copy={historyCopy} onClose={() => setPicked(null)} />
    </PlaceBlock>
  )
}
