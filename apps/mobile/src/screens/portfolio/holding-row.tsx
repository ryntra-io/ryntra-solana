import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Chip } from '@/components/chip'
import { Txt } from '@/components/txt'
import type { PortfolioCopy } from '@/features/portfolio/copy'
import type { PortfolioRow } from '@/features/portfolio/portfolio-model'
import { useLocale } from '@/lib/i18n'
import { EventBanner, type EventActions } from '@/screens/invest/event-ui'
import { useSpace } from '@/theme'
import { DASH, formatPercent, formatUsd, saidFigure, signOf } from '@/utils/format'

/** An issuer's event under a held position: the holder's line, and the swap and the sale while the window is open. */
export type RowEvent = Readonly<{ line: string; actions: EventActions | null }>

export type HoldingRowProps = {
  row: PortfolioRow
  copy: PortfolioCopy
  onPress: () => void
  last?: boolean
  /** The issuer's window on this token, said under the row; null for every other token. */
  event?: RowEvent | null
}

/**
 * One position: identity and amount on the left, value and the day's move on
 * the right. An unpriced row shows a dash where its value would be, never a
 * zero; a row the venue flags says so beside its name. A token whose issuer
 * opened a window to swap it carries the deadline under the row, as wide as
 * the row, with the swap and the quiet sale.
 */
export function HoldingRow({ row, copy, onPress, last, event = null }: HoldingRowProps) {
  const locale = useLocale()
  const space = useSpace()
  const move = signOf(row.dayChangePct)
  const value = row.value === null ? DASH : formatUsd(row.value, locale)
  const line = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.symbol}, ${row.amountText} ${row.symbol}, ${saidFigure(value, locale)}${row.dayChangePct === null ? '' : `, ${formatPercent(row.dayChangePct, locale)}`}`}
      onPress={onPress}
      className={`flex-row items-center gap-3 ${space.row} active:bg-hover ${last || event ? '' : 'border-b border-line'}`}
    >
      <AssetIcon symbol={row.symbol} icon={row.icon} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Txt variant="ui" numberOfLines={1} className="shrink">
            {row.symbol}
          </Txt>
          {row.suspicious ? <Chip label={copy.flagged} tone="warning" /> : null}
          {row.verified === false ? <Chip label={copy.unverified} /> : null}
        </View>
        <Txt variant="data" tone="faint" numberOfLines={1}>
          {row.amountText} {row.symbol}
        </Txt>
      </View>
      <View className="items-end gap-1">
        <Txt variant="data" tone={row.value === null ? 'faint' : 'fg'}>
          {value}
        </Txt>
        {row.dayChangePct === null || row.value === null || row.amountRaw === '0' ? (
          row.value === null ? (
            <Txt variant="labelSm" tone="faint">
              {copy.unpriced}
            </Txt>
          ) : null
        ) : (
          <Chip
            label={formatPercent(row.dayChangePct, locale)}
            tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'neutral'}
            mono
          />
        )}
      </View>
    </Pressable>
  )
  if (!event) return line
  return (
    <View className={last ? 'pb-3' : 'border-b border-line pb-3'}>
      {line}
      <EventBanner line={event.line} actions={event.actions} compact />
    </View>
  )
}
