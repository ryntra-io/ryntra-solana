import { View, type ViewProps } from 'react-native'

import { cn } from '@/utils/cn'

export type CardProps = ViewProps & {
  /** `surface` is the resting card; `elevated` sits one layer up (sheets, receipts). */
  level?: 'surface' | 'elevated'
  padded?: boolean
}

/** A surface separated from the ground by tone, a 1px line and spacing — never by glow. */
export function Card({ level = 'surface', padded = true, className, ...props }: CardProps) {
  return (
    <View
      {...props}
      className={cn(
        'rounded-sm border border-line',
        level === 'surface' ? 'bg-surface' : 'bg-elevated',
        padded && 'p-4',
        className,
      )}
    />
  )
}
