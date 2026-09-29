import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import type { Locale } from '@/lib/i18n'
import { formatPercent, formatPrice, signOf } from '@/utils/format'

/**
 * The shelf's two shapes (canon v5.1 §2: a company by its logo and its name, a
 * price in dollars, the day's change — nothing else at rest; no ticker, no
 * issuer badge, no session, no clock on the card). A private company adds its
 * mark, «Це не акція», and one number: its price against PreStocks' own
 * valuation (canon v5.2 В27).
 *
 * A **tile** is Home's «Популярні компанії»: two to a row, a thumb's target.
 * A **row** is Markets': one company to a row. Both open the company's page.
 */

export type ShelfItem = Readonly<{
  key: string
  name: string
  mint: string
  icon: string | null
  price: number
  change24h: number | null
  /** A short mark under the name — «Це не акція» on a private company. */
  note?: string
  /** One quiet line under the row — a private company's price against PreStocks' valuation (canon v5.2 В27). */
  detail?: string
}>

export function companyItem(
  card: Readonly<{
    mint: string
    name: string
    icon: string | null
    price: number
    change24h: number | null
  }>,
  note?: string,
  detail?: string | null,
): ShelfItem {
  return {
    key: card.mint,
    name: card.name,
    mint: card.mint,
    icon: card.icon,
    price: card.price,
    change24h: card.change24h,
    note,
    detail: detail ?? undefined,
  }
}

export function coinItem(
  coin: Readonly<{ mint: string; name: string; icon: string | null; price: number; change24h: number | null }>,
): ShelfItem {
  return {
    key: coin.mint,
    name: coin.name,
    mint: coin.mint,
    icon: coin.icon,
    price: coin.price,
    change24h: coin.change24h,
  }
}

/** The day's change as a figure in its tone — green up, red down, quiet when flat or unknown (a dash, never a zero). */
export function Change({
  value,
  locale,
  variant = 'ui',
}: {
  value: number | null
  locale: Locale
  variant?: 'ui' | 'labelSm'
}) {
  const move = signOf(value)
  return (
    <Txt variant={variant} tabular tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'faint'}>
      {formatPercent(value, locale)}
    </Txt>
  )
}

function spoken(item: ShelfItem, locale: Locale, today: string): string {
  return [
    item.name,
    item.note ?? null,
    item.detail ?? null,
    formatPrice(item.price, locale),
    `${formatPercent(item.change24h, locale)} ${today}`,
  ]
    .filter(Boolean)
    .join(', ')
}

export function ShelfTile({
  item,
  locale,
  today,
  onPress,
}: {
  item: ShelfItem
  locale: Locale
  /** The period of the change, said to a screen reader: «за день». */
  today: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken(item, locale, today)}
      onPress={onPress}
      className="flex-1 gap-3 rounded-sm border border-line bg-surface p-3 active:bg-hover"
    >
      <View className="flex-row items-center gap-2.5">
        <AssetIcon symbol={item.name} icon={item.icon} size={32} />
        <Txt variant="ui" numberOfLines={1} className="flex-1">
          {item.name}
        </Txt>
      </View>
      <View className="flex-row flex-wrap items-baseline justify-between gap-x-2">
        <Txt variant="title" tabular numberOfLines={1}>
          {formatPrice(item.price, locale)}
        </Txt>
        <Change value={item.change24h} locale={locale} />
      </View>
    </Pressable>
  )
}

/** Tiles two to a row; an odd last tile keeps its half. */
export function TileGrid({ children }: { children: readonly ReactNode[] }) {
  const rows: ReactNode[][] = []
  children.forEach((child, index) => {
    if (index % 2 === 0) rows.push([child])
    else rows[rows.length - 1]!.push(child)
  })
  return (
    <View className="gap-2">
      {rows.map((row, index) => (
        <View key={index} className="flex-row gap-2">
          {row}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  )
}

export function ShelfRow({
  item,
  locale,
  today,
  onPress,
  last,
}: {
  item: ShelfItem
  locale: Locale
  today: string
  onPress: () => void
  last?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken(item, locale, today)}
      onPress={onPress}
      className={`gap-1 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="flex-row items-center gap-3">
        <AssetIcon symbol={item.name} icon={item.icon} size={36} />
        <View className="flex-1 gap-0.5">
          <Txt variant="ui" numberOfLines={1}>
            {item.name}
          </Txt>
          {item.note ? (
            <Txt variant="labelSm" tone="warning">
              {item.note}
            </Txt>
          ) : null}
        </View>
        <View className="items-end gap-0.5">
          <Txt variant="ui" tabular>
            {formatPrice(item.price, locale)}
          </Txt>
          <Change value={item.change24h} locale={locale} variant="labelSm" />
        </View>
      </View>
      {item.detail ? (
        // Under the name's column, the whole width of the row: the one number a private company carries.
        <Txt variant="labelSm" tone="muted" style={{ paddingLeft: 48 }}>
          {item.detail}
        </Txt>
      ) : null}
    </Pressable>
  )
}

/** The shape of what is coming — never a spinner (canon §2, rule 14). */
export function TileSkeleton({ count }: { count: number }) {
  return (
    <TileGrid>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="flex-1 gap-3 rounded-sm border border-line bg-surface p-3">
          <View className="flex-row items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-pill" />
            <Skeleton className="h-3.5 flex-1" />
          </View>
          <Skeleton className="h-5 w-20" />
        </View>
      ))}
    </TileGrid>
  )
}

export function RowSkeleton({ count }: { count: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
          <Skeleton className="h-9 w-9 rounded-pill" />
          <Skeleton className="h-3.5 flex-1" />
          <View className="items-end gap-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-12" />
          </View>
        </View>
      ))}
    </View>
  )
}
