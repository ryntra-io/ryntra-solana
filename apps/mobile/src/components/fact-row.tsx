import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Txt, type Tone } from '@/components/txt'

export type FactRowProps = {
  label: string
  /** Already formatted; unknown arrives as a dash. */
  value: string
  /** One short line under the value: a time, a source, a state word. */
  detail?: string | null
  tone?: Tone
  /** Figures and addresses are mono; words are not. */
  mono?: boolean
  right?: ReactNode
  last?: boolean
}

/** One fact per line: the label on the left, the value on the right, its qualifier under it. */
export function FactRow({ label, value, detail, tone = 'fg', mono = true, right, last }: FactRowProps) {
  return (
    <View className={`flex-row items-start justify-between gap-4 py-2.5 ${last ? '' : 'border-b border-line'}`}>
      <Txt variant="ui" tone="muted" className="shrink-0 pt-px">
        {label}
      </Txt>
      <View className="flex-1 items-end gap-0.5">
        {right ?? (
          <Txt variant={mono ? 'data' : 'ui'} tone={tone} className="text-right" selectable>
            {value}
          </Txt>
        )}
        {detail ? (
          <Txt variant="labelSm" tone="faint" className="text-right">
            {detail}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}
