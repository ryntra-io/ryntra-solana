import { Chip, type ChipTone } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import type { SessionPeriod } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { sessionWord } from '@/lib/stocks'
import { formatClock } from '@/utils/format'

/**
 * Green is the exchange open; the evidence tone is a session the issuer
 * trades in while the exchange is not (extended, overnight) — information,
 * never a caution; grey is closed or unknown. Orange never stands in for a
 * market state, and the word is always there.
 */
const tones: Record<SessionPeriod, ChipTone> = {
  market: 'success',
  extended: 'evidence',
  overnight: 'evidence',
  closed: 'neutral',
  unknown: 'neutral',
}

export type SessionChipProps = {
  period: SessionPeriod
  /** When the period next changes, when the issuer says — shown as the chip's time. */
  nextChangeAt?: string | null
}

/** The issuer's market session for a tokenized stock, with the time it next changes. */
export function SessionChip({ period, nextChangeAt }: SessionChipProps) {
  const locale = useLocale()
  const words = useCopy(COMPONENT_COPY)
  const word = sessionWord(period, locale)
  const next = period !== 'unknown' && nextChangeAt ? formatClock(nextChangeAt) : null
  return (
    <Chip
      label={next ? words.until(word, next) : word}
      tone={tones[period]}
      caps={false}
      accessibilityLabel={words.sessionA11y(word, next)}
    />
  )
}
