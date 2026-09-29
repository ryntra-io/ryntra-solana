import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Chip } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { Txt } from '@/components/txt'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatPercent, formatPrice, signOf } from '@/utils/format'

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
}>

export type AssetRowProps = {
  asset: AssetRowAsset
  onPress?: () => void
  /** The last row of a group draws no hairline. */
  last?: boolean
}

/**
 * One market in a list: identity on the left, the price and its 24h move on
 * the right, the issuer of a tokenized stock under the name. Rows group with
 * hairlines, not cards. The marks and the figures speak the person's language.
 */
export function AssetRow({ asset, onPress, last }: AssetRowProps) {
  const locale = useLocale()
  const words = useCopy(COMPONENT_COPY)
  const move = signOf(asset.change24hPct)
  const subtitle = [asset.name, asset.issuer?.label ?? null, asset.note ?? null].filter(Boolean).join(' · ')
  const price = formatPrice(asset.price, locale)
  const change = formatPercent(asset.change24hPct, locale)
  const states = [
    asset.halted ? words.halted : null,
    asset.suspicious ? words.flagged : null,
    asset.verified === false ? words.unverified : null,
  ].filter((state): state is string => state !== null)
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={words.rowA11y(asset.symbol, asset.name, price, change, states)}
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <AssetIcon symbol={asset.symbol} icon={asset.icon} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Txt variant="ui">{asset.symbol}</Txt>
          {asset.halted ? <Chip label={words.halted} tone="danger" /> : null}
          {asset.suspicious ? <Chip label={words.flagged} tone="warning" /> : null}
          {asset.verified === false ? <Chip label={words.unverified} /> : null}
        </View>
        <Txt variant="ui" tone="faint" numberOfLines={2}>
          {subtitle}
        </Txt>
      </View>
      <View className="items-end gap-1">
        <Txt variant="data">{price}</Txt>
        <Chip label={change} tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'neutral'} mono />
      </View>
    </Pressable>
  )
}
