import { View, type ViewProps } from 'react-native'

import { Txt } from '@/components/txt'
import { cn } from '@/utils/cn'

export type ChipTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'evidence'

const surfaces: Record<ChipTone, string> = {
  neutral: 'bg-elevated border-line',
  brand: 'bg-brand-chip border-brand-chip-line',
  success: 'bg-success-soft border-transparent',
  danger: 'bg-danger-soft border-transparent',
  warning: 'bg-warning-soft border-transparent',
  evidence: 'bg-evidence-soft border-evidence-line',
}

const inks = {
  neutral: 'muted',
  brand: 'brand',
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  evidence: 'evidence',
} as const

export type ChipProps = ViewProps & {
  label: string
  tone?: ChipTone
  /** Small caps label for categories; figures stay in their own case. */
  caps?: boolean
  mono?: boolean
}

/**
 * A pill that names a state. Status is never colour-only: the label is the
 * fact, the tone only underlines it.
 */
export function Chip({ label, tone = 'neutral', caps = true, mono = false, className, ...props }: ChipProps) {
  return (
    <View
      {...props}
      accessibilityRole="text"
      className={cn('self-start rounded-pill border px-2.5 py-[3px]', surfaces[tone], className)}
    >
      <Txt variant={mono ? 'data' : 'labelSm'} tone={inks[tone]} caps={caps && !mono} tabular={mono}>
        {label}
      </Txt>
    </View>
  )
}
