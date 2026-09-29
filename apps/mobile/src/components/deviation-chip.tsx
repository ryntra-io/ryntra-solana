import { Chip, type ChipTone } from '@/components/chip'
import { formatPercent } from '@/utils/format'

export type DeviationChipProps = {
  /** Token price against the issuer's reference, percent; null when unknown. */
  deviationPct: number | null
  /** What the reference is — an exchange, an index, a NAV. */
  reference: string
}

function toneFor(deviationPct: number | null): ChipTone {
  if (deviationPct === null || !Number.isFinite(deviationPct)) return 'neutral'
  const size = Math.abs(deviationPct)
  if (size < 0.5) return 'neutral'
  if (size < 2) return 'warning'
  return 'danger'
}

/** How far the on-chain price sits from its reference — the one number a stock buyer reads first. */
export function DeviationChip({ deviationPct, reference }: DeviationChipProps) {
  return (
    <Chip
      label={`${formatPercent(deviationPct)} vs ${reference}`}
      tone={toneFor(deviationPct)}
      mono
      accessibilityLabel={`Deviation ${formatPercent(deviationPct)} against ${reference}`}
    />
  )
}
