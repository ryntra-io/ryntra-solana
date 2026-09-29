import { View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { Txt, type Tone } from '@/components/txt'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAge } from '@/utils/format'

export type ReviewRow = {
  label: string
  /** Already formatted. */
  value: string
  tone?: Tone
  /** The one row the eye lands on: the minimum received. */
  emphasis?: boolean
}

export type ReviewBlockProps = {
  rows: readonly ReviewRow[]
  /** When the quote was made; the block says its age and refuses when stale. */
  quotedAt?: string | null
  /** Seconds after which the quote can only be refreshed, never signed. */
  quoteTtlSeconds?: number
  warnings?: readonly string[]
  /** Overrides the ticking clock — for a frozen sample. */
  now?: number
}

/**
 * The terms of an operation before it is signed: expected and minimum
 * received, every known cost, the quote's age and its warnings. What is
 * signed is exactly what is shown.
 */
export function ReviewBlock({
  rows,
  quotedAt,
  quoteTtlSeconds = 30,
  warnings = [],
  now: nowOverride,
}: ReviewBlockProps) {
  const tick = useNow(1000)
  const now = nowOverride ?? tick
  const locale = useLocale()
  const words = useCopy(COMPONENT_COPY)
  const age = quotedAt ? Math.max(0, Math.round((now - Date.parse(quotedAt)) / 1000)) : null
  const stale = age !== null && age > quoteTtlSeconds
  return (
    <Card level="elevated" padded={false}>
      <View className="px-4">
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={`flex-row items-center justify-between gap-4 py-3 ${index < rows.length - 1 ? 'border-b border-line' : ''}`}
          >
            <Txt variant="ui" tone={row.emphasis ? 'fg' : 'muted'}>
              {row.label}
            </Txt>
            <Txt variant={row.emphasis ? 'dataLg' : 'data'} tone={row.tone ?? 'fg'}>
              {row.value}
            </Txt>
          </View>
        ))}
      </View>
      {quotedAt || warnings.length > 0 ? (
        <View className="gap-2 border-t border-line px-4 py-3">
          {quotedAt ? (
            <View className="flex-row items-center justify-between">
              <Txt variant="labelSm" tone="faint" caps>
                {words.quote}
              </Txt>
              <Chip
                label={stale ? words.quoteStale : formatAge(quotedAt, now, locale)}
                tone={stale ? 'warning' : 'neutral'}
                caps={false}
              />
            </View>
          ) : null}
          {warnings.map((warning) => (
            <View key={warning} className="flex-row items-start gap-2">
              <Chip label={words.note} tone="warning" />
              <Txt variant="ui" tone="muted" className="flex-1">
                {warning}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  )
}
