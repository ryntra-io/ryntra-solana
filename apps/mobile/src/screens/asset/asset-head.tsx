import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Icon, type IconName } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import type { ExchangeState } from '@/features/invest/buy-model'
import type { InvestCopy } from '@/features/invest/copy'
import { useNow } from '@/hooks/use-now'
import type { Locale } from '@/lib/i18n'
import { Change } from '@/screens/invest/shelf-ui'
import { formatAt, formatPrice, isToday } from '@/utils/format'

export type AssetWarning = Readonly<{ key: string; text: string; tone: 'warning' | 'danger' }>

/**
 * A company's page at rest, on the beginner's path: its logo and its
 * name — never the ticker as a title — and under the name who the company is,
 * as the web's head says it: the ticker on its exchange («NVDA ·
 * Nasdaq»), «Приватна компанія», or a public company's private token
 * («SPACEX · токен PreStocks»); one price in dollars, the day's change and the
 * local time of the price. A private company says what its token is not under
 * its name, before any figure — its issuer's own line («Це не акція OpenAI ·
 * комісія емітента 3% на кожен переказ · емітент може заморозити чи забрати
 * токен» — and under its price the one number it carries: the price against PreStocks'
 * own valuation. «Шлях компанії» (M24, as the web's
 * draws it) stands under the name, where the company has
 * a path to say. An issuer's event about the token — a window to swap it before
 * a cut-off — stands between the name and the price: before any figure;
 * where the path stands, the event is the path's own line. Warnings stay at
 * rest: the beginner's path never hides a risk, only the technical words around
 * it.
 */
export function AssetHead({
  name,
  subline = null,
  icon,
  price,
  change,
  observedAt,
  stale,
  privateLine,
  markLine = null,
  markPending = false,
  path = null,
  issuerPending = false,
  event = null,
  copy,
  locale,
  warnings,
}: {
  name: string
  /** Who the company is, under its name: «NVDA · Nasdaq», «Приватна компанія»; null for a coin. */
  subline?: string | null
  icon: string | null
  price: number | null
  change: number | null
  observedAt: string | null
  /** The price on screen is the last one read: said with its time. */
  stale: boolean
  /** Null for a listed company or a coin; the private company's line of truth otherwise. */
  privateLine: string | null
  /** A private company's price against its issuer's valuation; null when there is none to say. */
  markLine?: string | null
  /** The valuation is still being read: its line is a shape holding its place. */
  markPending?: boolean
  /** «Шлях компанії» under the name, where the company has a path; null for none. */
  path?: ReactNode
  /** The issuer's read is still on its way: the line under the name is a shape until it lands, so nothing moves. */
  issuerPending?: boolean
  /** The issuer's event and, for a holder, its actions — before any figure; null for none. */
  event?: ReactNode
  copy: InvestCopy
  locale: Locale
  warnings: readonly AssetWarning[]
}) {
  // A price kept from another day names its day.
  const now = useNow(60_000)
  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-3">
        <AssetIcon symbol={name} icon={icon} size={48} />
        <View className="flex-1 gap-0.5">
          <Txt variant="headline" accessibilityRole="header" numberOfLines={2}>
            {name}
          </Txt>
          {subline ? (
            <Txt variant="ui" tone="muted" numberOfLines={2}>
              {subline}
            </Txt>
          ) : issuerPending ? (
            <Skeleton className="mt-1 h-3.5 w-28" />
          ) : null}
          {privateLine ? (
            <Txt variant="ui" tone="warning">
              {privateLine}
            </Txt>
          ) : null}
        </View>
      </View>
      {path}
      {event}
      <View className="gap-1">
        <Txt variant="display" tabular>
          {formatPrice(price, locale)}
        </Txt>
        {/* «−2,93% · вчора о 23:58 · не оновилися»: the change, the price's time, its state — no label repeats the figure. */}
        <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <Change value={change} locale={locale} />
          <Txt variant="ui" tone="faint">
            {`${isToday(observedAt, now) ? copy.today : ''} · ${formatAt(observedAt, now, locale)}`.trimStart()}
          </Txt>
          {stale ? (
            <Txt variant="ui" tone="warning">
              {`· ${copy.notUpdated}`}
            </Txt>
          ) : null}
        </View>
        {markLine ? (
          <Txt variant="ui" tone="muted">
            {markLine}
          </Txt>
        ) : markPending ? (
          <Skeleton className="mt-1 h-3.5 w-48" />
        ) : null}
      </View>
      {warnings.map((warning) => (
        <View key={warning.key} className="flex-row items-start gap-2">
          <Icon
            name={warning.tone === 'danger' ? 'alert-circle-outline' : 'warning-outline'}
            size={16}
            color={warning.tone === 'danger' ? 'dangerInk' : 'warningInk'}
            style={{ marginTop: 1 }}
          />
          <Txt variant="ui" tone={warning.tone} className="flex-1">
            {warning.text}
          </Txt>
        </View>
      ))}
    </View>
  )
}

/**
 * What a listed company's token is, as the label from its issuer's documents
 * — «Трекер із забезпеченням» — its line waiting in «Що ти купуєш»
 * below, as the web's purchase card has it on a phone, so «Купити» stands on
 * the first screen — and whether the exchange the share lists on is open:
 * closed, the token still trades and its price may drift from the
 * share's.
 */
export function TruthBlock({
  label,
  exchange,
  words,
}: {
  label: string | null
  exchange: ExchangeState | null
  words: Readonly<{ exchangeOpen: string; exchangeClosed: string; exchangeExtended: string; exchangeOvernight: string }>
}) {
  if (!label && !exchange) return null
  return (
    <View className="gap-2">
      {label ? (
        <View className="self-start rounded-pill border border-line-strong bg-elevated px-3 py-1">
          <Txt variant="ui">{label}</Txt>
        </View>
      ) : null}
      {exchange ? (
        <View className="flex-row items-center gap-2">
          <View
            className={exchange === 'open' ? 'h-2 w-2 rounded-pill bg-success' : 'h-2 w-2 rounded-pill bg-warning'}
          />
          <Txt variant="ui" tone="faint">
            {exchange === 'open'
              ? words.exchangeOpen
              : exchange === 'extended'
                ? words.exchangeExtended
                : exchange === 'overnight'
                  ? words.exchangeOvernight
                  : words.exchangeClosed}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

/** The page's head while the market is read: the name when the shelf already knows it, the shapes otherwise. */
export function AssetHeadLoading({ name }: { name: string | null }) {
  return (
    <View className="gap-4" accessibilityRole="progressbar">
      <View className="flex-row items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-pill" />
        <View className="flex-1">
          {name ? <Txt variant="headline">{name}</Txt> : <Skeleton className="h-6 w-32" />}
        </View>
      </View>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-3.5 w-48" />
    </View>
  )
}

/** The page's name over a failed read — the name or the ticker the list carried — so the person knows what failed. */
export function AssetHeadName({ name }: { name: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <AssetIcon symbol={name} icon={null} size={48} />
      <Txt variant="headline" accessibilityRole="header" numberOfLines={2} className="flex-1">
        {name}
      </Txt>
    </View>
  )
}

/** A quiet door with an icon — «Спитати Ryntra», «Деталі». Never orange: that is the page's one action. */
export function QuietDoor({
  icon,
  label,
  onPress,
  trailing,
  expanded,
}: {
  icon: IconName
  label: string
  onPress: () => void
  trailing?: IconName
  expanded?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
    >
      <Icon name={icon} size={18} color="muted" />
      <Txt variant="ui" className="flex-1">
        {label}
      </Txt>
      {trailing ? <Icon name={trailing} size={16} color="fgMuted" /> : null}
    </Pressable>
  )
}
