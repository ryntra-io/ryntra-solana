import { View } from 'react-native'

import { Chip, type ChipTone } from '@/components/chip'
import { SessionChip } from '@/components/session-chip'
import { Skeleton } from '@/components/skeleton'
import { StatTile } from '@/components/stat-tile'
import { Txt } from '@/components/txt'
import { DETAILS_COPY } from '@/features/invest/details-copy'
import type { ReferenceState, StockAsset } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { isScaled, issuerLabel, judgeReference, referenceWord, unitsLine } from '@/lib/stocks'
import { formatClock, formatPercent, formatPrice } from '@/utils/format'

const REFERENCE_TONES: Record<ReferenceState, ChipTone> = {
  current: 'success',
  'last-available': 'neutral',
  'confirmed-close': 'neutral',
  stale: 'warning',
  unavailable: 'neutral',
}

export function StockBlockLoading() {
  const words = useCopy(DETAILS_COPY)
  return (
    <View className="gap-2" accessibilityRole="progressbar" accessibilityLabel={words.loadingIssuer}>
      <View className="flex-row gap-2">
        <Skeleton className="h-20 flex-1 rounded-sm" />
        <Skeleton className="h-20 flex-1 rounded-sm" />
      </View>
      <Skeleton className="h-6 w-40 rounded-pill" />
    </View>
  )
}

/** The stock the token stands for is not on the issuer's list — the one fact a copy must not hide. */
export function StockUnconfirmed() {
  const words = useCopy(DETAILS_COPY)
  return (
    <View className="flex-row flex-wrap items-center gap-2 rounded-sm border border-line bg-surface px-4 py-3">
      <Chip label={words.notConfirmed} tone="danger" caps={false} />
      <Txt variant="ui" tone="muted" className="flex-1">
        {words.notConfirmedLine}
      </Txt>
    </View>
  )
}

/**
 * Reference · deviation · session · units — the web's semantics for a
 * tokenized stock, in two tiles and a chip row. The reference's state is
 * judged again now from its fetch time; the deviation is the list basis,
 * an orientation; the quote for an amount sits below in its own card. The
 * words and figures are in the person's language.
 */
export function StockBlock({ asset, now }: { asset: StockAsset; now: number }) {
  const locale = useLocale()
  const words = useCopy(DETAILS_COPY)
  const { row } = asset
  const rep = row.representation
  const multiplier = asset.chainMultiplier ?? row.multiplier
  const state = judgeReference({
    perShare: row.reference.perShare,
    fetchedAt: row.reference.fetchedAt,
    exchangeOpen: row.session.exchangeOpen,
    nowMs: now,
  })
  const referenceLabel = issuerLabel(row.reference.source.id === 'issuer-xstocks' ? 'xstocks' : rep.issuer.id)
  const units = unitsLine(rep.symbol, rep.underlying.symbol, multiplier?.current ?? null, locale)
  const activation =
    multiplier?.pending !== null && multiplier?.effectiveAt ? formatClock(multiplier.effectiveAt) : null
  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <StatTile
          label={words.referencePerShare}
          value={formatPrice(row.reference.perShare, locale)}
          at={row.reference.fetchedAt}
          note={
            row.reference.perShare === null
              ? words.unavailable
              : state === 'current'
                ? null
                : referenceWord(state, locale)
          }
          noteTone={REFERENCE_TONES[state]}
          className="flex-1"
        />
        <StatTile
          label={words.deviation}
          value={formatPercent(row.deviationPct, locale)}
          note={row.deviationPct === null ? null : words.versus(referenceLabel)}
          tone={
            row.deviationPct === null || Math.abs(row.deviationPct) < 0.5
              ? 'fg'
              : Math.abs(row.deviationPct) < 2
                ? 'warning'
                : 'danger'
          }
          className="flex-1"
        />
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <SessionChip period={row.session.period} nextChangeAt={row.session.nextChangeAt} />
        {rep.tradingHalted ? <Chip label={words.haltedByIssuer} tone="danger" caps={false} /> : null}
        {asset.multiplierAgreement === 'differ' ? <Chip label={words.unitsDiffer} tone="warning" caps={false} /> : null}
        {activation ? <Chip label={words.unitsChange(activation)} tone="warning" caps={false} /> : null}
      </View>
      {units ? (
        <Txt variant="labelSm" tone="faint">
          {isScaled(multiplier?.current)
            ? `${units} · ${words.perShare(formatPrice(row.tokenPerShareUsd, locale))}`
            : units}
        </Txt>
      ) : null}
    </View>
  )
}
