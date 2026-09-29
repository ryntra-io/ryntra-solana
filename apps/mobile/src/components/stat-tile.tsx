import { View } from 'react-native'

import { Chip, type ChipTone } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { Txt, type Tone } from '@/components/txt'
import { useCopy } from '@/lib/i18n'
import { formatClock } from '@/utils/format'
import { cn } from '@/utils/cn'

export type StatTileProps = {
  label: string
  /** Already formatted; unknown arrives as a dash from the formatters. */
  value: string
  /** When the figure was observed. Shown with it, always. */
  at?: string | null
  stale?: boolean
  /** One word that qualifies the figure — a reference's state, a source. */
  note?: string | null
  noteTone?: ChipTone
  tone?: Tone
  size?: 'md' | 'lg'
  className?: string
}

/** One figure, its label and its time. The tile is the unit every summary is built from. */
export function StatTile({
  label,
  value,
  at,
  stale,
  note,
  noteTone = 'neutral',
  tone = 'fg',
  size = 'md',
  className,
}: StatTileProps) {
  const words = useCopy(COMPONENT_COPY)
  return (
    <View className={cn('gap-1 rounded-sm border border-line bg-surface px-4 py-3', className)}>
      <Txt variant="labelSm" tone="faint" caps>
        {label}
      </Txt>
      <Txt variant={size === 'lg' ? 'dataLg' : 'data'} tone={tone}>
        {value}
      </Txt>
      {at || stale || note ? (
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          {at ? (
            <Txt variant="labelSm" tone="faint">
              {formatClock(at)}
            </Txt>
          ) : null}
          {stale ? <Chip label={words.stale} tone="warning" /> : null}
          {note ? <Chip label={note} tone={noteTone} caps={false} /> : null}
        </View>
      ) : null}
    </View>
  )
}
