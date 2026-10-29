import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Chip } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { Txt } from '@/components/txt'
import { useCopy, useLocale, type Copy } from '@/lib/i18n'
import { useSpace } from '@/theme'
import { formatListPrice, formatPercent, percentSignOf, saidFigure } from '@/utils/format'

export type AssetRowAsset = Readonly<{
  symbol: string
  name: string
  icon: string | null
  price: number | null
  change24hPct: number | null
  issuer?: Readonly<{ label: string }> | null
  verified?: boolean
  suspicious?: boolean
  /** One more fact after the issuer: the session of a stock. */
  note?: string | null
  /** The issuer has halted trading — the one state a stock row must say. */
  halted?: boolean
  /** The company whose ticker or name this token borrows while it is not that stock (ST-5 r4). */
  lookalikeOf?: string | null
  /**
   * A stock token whose pool price stands far from the issuer's reference for the share, by the row's own deviation and
   * reference (ST-5 r8: «SGOVx · $2 090,43» right under «SGOVon · $100,75») — never claimed where the row has none.
   */
  poolFar?: boolean
}>

/**
 * The row's own words: the mark for a token that takes a stock's ticker or name (whatever the venue's check, it is not
 * the stock), and the day's move as a screen reader says it.
 */
const ROW_COPY: Copy<Readonly<{ notTheStock: string; poolFar: string; daySaid: (change: string) => string }>> = {
  en: {
    notTheStock: 'Not the stock',
    poolFar: 'Pool price far from the share',
    daySaid: (change) => `${change} in 24 hours`,
  },
  uk: { notTheStock: 'Не акція', poolFar: 'Ціна пулу далека від акції', daySaid: (change) => `${change} за 24 год` },
}

/** The parts of a row's label that say something, each once: an empty name or issuer leaves no stray comma. */
const spoken = (parts: readonly (string | null | undefined)[]): string =>
  parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(', ')

export type AssetRowProps = {
  asset: AssetRowAsset
  onPress?: () => void
  /** The last row of a group draws no hairline. */
  last?: boolean
  /** A row that only names what pays (the pay-from picker): no price column, never a «—» read as unknown (ST-5 r9). */
  bare?: boolean
}

/** A word too long for a line of a row at 400 dp — «NotInEmploymentEducationTraining»: the line ends in «…», never cut mid-word. */
const LONG_WORD = /\S{22,}/

/**
 * One market in a list: identity on the left, the price and its 24h move on
 * the right, the issuer of a tokenized stock under the name. Rows group with
 * hairlines, not cards. The marks and the figures speak the person's language.
 * The left column gives way and its marks wrap, the figures never move: «Не акція»
 * says more than «Не підтверджено», so the second is not drawn beside it — a screen
 * reader still says both (ST-5 r5), and every part of the line under the name (ST-5 r7).
 */
export function AssetRow({ asset, onPress, last, bare = false }: AssetRowProps) {
  const locale = useLocale()
  const words = useCopy(COMPONENT_COPY)
  const rowWords = useCopy(ROW_COPY)
  const space = useSpace()
  const move = percentSignOf(asset.change24hPct)
  const subtitleParts = [asset.name, asset.issuer?.label ?? null, asset.note ?? null]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
  const subtitle = subtitleParts.join(' · ')
  const price = formatListPrice(asset.price, locale)
  const change = formatPercent(asset.change24hPct, locale)
  const states = [
    asset.halted ? words.halted : null,
    asset.suspicious ? words.flagged : null,
    asset.lookalikeOf ? rowWords.notTheStock : null,
    asset.poolFar ? rowWords.poolFar : null,
    asset.verified === false ? words.unverified : null,
  ].filter((state): state is string => state !== null)
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      // Everything the row shows, in its order — the issuer and the session too («SPCX, SpaceX, Backpack, Біржа зачинена,
      // …»), as a screen reader says it (ST-5 r7).
      accessibilityLabel={spoken([
        asset.symbol,
        ...subtitleParts,
        bare ? null : saidFigure(price, locale),
        bare ? null : rowWords.daySaid(saidFigure(change, locale)),
        ...states,
      ])}
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center gap-3 ${space.row} active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <AssetIcon symbol={asset.symbol} icon={asset.icon} />
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
          <Txt variant="ui" numberOfLines={1} className="shrink">
            {asset.symbol}
          </Txt>
          {asset.halted ? <Chip label={words.halted} tone="danger" /> : null}
          {asset.suspicious ? <Chip label={words.flagged} tone="warning" /> : null}
          {asset.lookalikeOf ? <Chip label={rowWords.notTheStock} tone="warning" /> : null}
          {/* In sentence case, wrapping under the ticker — a long mark never pushes the figures (ST-5 r8). */}
          {asset.poolFar ? <Chip label={rowWords.poolFar} tone="warning" caps={false} /> : null}
          {asset.verified === false && !asset.lookalikeOf ? <Chip label={words.unverified} /> : null}
        </View>
        <Txt variant="ui" tone="faint" numberOfLines={LONG_WORD.test(subtitle) ? 1 : 2} ellipsizeMode="tail">
          {subtitle}
        </Txt>
      </View>
      {bare ? null : (
        <View className="shrink-0 items-end gap-1">
          <Txt variant="data">{price}</Txt>
          <Chip label={change} tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'neutral'} mono />
        </View>
      )}
    </Pressable>
  )
}
