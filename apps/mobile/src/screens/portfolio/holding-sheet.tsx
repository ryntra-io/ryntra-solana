import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import type { PortfolioCopy } from '@/features/portfolio/copy'
import { amountTextOf, shownRaw, type PortfolioRow } from '@/features/portfolio/portfolio-model'
import type { RowEvent } from '@/screens/portfolio/holding-row'
import type { Locale } from '@/lib/i18n'
import { EventBanner } from '@/screens/invest/event-ui'
import { DASH, formatAge, formatClock, formatPercent, formatPrice, formatUsd } from '@/utils/format'

export type HoldingSheetProps = {
  row: PortfolioRow | null
  observedAt: string | null
  now: number
  locale: Locale
  copy: PortfolioCopy
  /** The issuer's window on this token (M19): its line, and the swap and the sale that replace a plain Sell. */
  event?: RowEvent | null
  onClose: () => void
  /** A company's position sold on its own sheet, as on its page; crypto is sold in Trade. */
  onSell?: (row: PortfolioRow) => void
}

/**
 * One position, one tap deep: its figures with their time, its state, and
 * the doors that are really open for it — the asset, a Buy, a Sell, its
 * history, a plan on a listed stock. A door the venue does not offer is not
 * drawn (one version since canon v5.3 В28: the plan is a quiet door here for
 * everyone).
 */
export function HoldingSheet({ row, observedAt, now, locale, copy, event = null, onClose, onSell }: HoldingSheetProps) {
  const router = useRouter()
  if (!row) return null
  const go = (href: Parameters<typeof router.push>[0]) => {
    onClose()
    router.push(href)
  }
  const goTrade = (side: 'buy' | 'sell' | null) => {
    onClose()
    router.push(
      side ? { pathname: '/trade', params: { mint: row.mint, symbol: row.symbol, side } } : { pathname: '/trade' },
    )
  }
  const spendableDiffers = row.spendableRaw !== row.amountRaw
  const at = observedAt ? `${formatClock(observedAt)} · ${formatAge(observedAt, now, locale)}` : null
  return (
    <Sheet visible title={row.symbol} subtitle={row.name ?? undefined} onClose={onClose} scroll>
      <View className="flex-row items-center gap-3 pb-2">
        <AssetIcon symbol={row.symbol} icon={row.icon} size={48} />
        <View className="flex-1 gap-1">
          <Txt variant="dataLg">{row.value === null ? DASH : formatUsd(row.value)}</Txt>
          <View className="flex-row flex-wrap gap-1.5">
            <Chip label={copy.groups[row.group]} />
            {row.verified === true ? <Chip label={copy.verified} tone="success" /> : null}
            {row.verified === false ? <Chip label={copy.unverified} /> : null}
            {row.suspicious ? <Chip label={copy.flagged} tone="warning" /> : null}
          </View>
        </View>
      </View>
      {event ? (
        <View className="pb-3">
          <EventBanner line={event.line} actions={event.actions} />
        </View>
      ) : null}
      <FactRow label={copy.amount} value={`${row.amountText} ${row.symbol}`} />
      {spendableDiffers ? (
        <FactRow
          label={copy.spendable}
          value={`${amountTextOf(shownRaw(row.spendableRaw, row.multiplier), row.decimals)} ${row.symbol}`}
        />
      ) : null}
      <FactRow
        label={copy.value}
        value={row.value === null ? DASH : formatUsd(row.value)}
        detail={row.value === null ? copy.unpriced : at}
        tone={row.value === null ? 'muted' : 'fg'}
      />
      <FactRow label={copy.price} value={formatPrice(row.price)} detail={row.price === null ? null : at} />
      <FactRow
        label={copy.change24h}
        value={formatPercent(row.dayChangePct)}
        tone={
          row.dayChangePct === null
            ? 'muted'
            : row.dayChangePct > 0
              ? 'success'
              : row.dayChangePct < 0
                ? 'danger'
                : 'fg'
        }
        last
      />
      {!row.listed ? (
        <Txt variant="ui" tone="faint" className="pt-3">
          {copy.notListed}
        </Txt>
      ) : null}
      <View className="flex-row flex-wrap gap-2 pt-4">
        {row.listed ? (
          <Button
            title={copy.asset}
            variant="secondary"
            onPress={() => go({ pathname: '/asset/[mint]', params: { mint: row.mint, symbol: row.symbol } })}
            className="flex-1"
          />
        ) : null}
        {row.tradeable && row.group !== 'cash' ? (
          <>
            <Button title={copy.buy} variant="secondary" onPress={() => goTrade('buy')} className="flex-1" />
            {/* The watch's sale stands above, in its own words: no second Sell beside it. */}
            {row.amountRaw !== '0' && !event?.actions ? (
              <Button
                title={copy.sell}
                variant="secondary"
                onPress={() => (row.group === 'stock' && row.listed && onSell ? onSell(row) : goTrade('sell'))}
                className="flex-1"
              />
            ) : null}
          </>
        ) : null}
        {row.tradeable && row.group === 'cash' ? (
          <Button title={copy.trade} variant="secondary" onPress={() => goTrade(null)} className="flex-1" />
        ) : null}
      </View>
      <View className="flex-row gap-2 pt-2">
        <Button
          title={copy.assetHistory}
          variant="secondary"
          onPress={() => go({ pathname: '/history', params: { mint: row.mint, symbol: row.symbol } })}
          className="flex-1"
        />
        {row.group === 'stock' && row.listed ? (
          <Button
            title={copy.createPlan}
            variant="secondary"
            onPress={() => go({ pathname: '/plans/new', params: { mint: row.mint, symbol: row.symbol } })}
            className="flex-1"
          />
        ) : null}
      </View>
    </Sheet>
  )
}
