import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip, type ChipTone } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useCopy } from '@/lib/i18n'
import { formatClock, shortAddress } from '@/utils/format'

/** The receipt's state — each one a word of the components' copy. */
export type ReceiptStatus = 'settled' | 'pending' | 'failed' | 'recovered'

const statusTone: Record<ReceiptStatus, ChipTone> = {
  settled: 'success',
  pending: 'warning',
  failed: 'danger',
  recovered: 'evidence',
}

export type ReceiptCardProps = {
  status: ReceiptStatus
  /** "Buy SPYx", "Swap SOL to USDC". */
  title: string
  /** Formatted amounts of the actual fill. */
  paid: string
  received: string
  at: string | null
  /** The transaction signature — one tap deep, never on the resting surface. */
  signature?: string | null
}

/** What actually happened: the status, the fill, the time; the proof one tap deep. */
export function ReceiptCard({ status, title, paid, received, at, signature }: ReceiptCardProps) {
  const [open, setOpen] = useState(false)
  const words = useCopy(COMPONENT_COPY)
  return (
    <Card padded={false}>
      <View className="flex-row items-center justify-between gap-3 px-4 pt-4">
        <Txt variant="title" className="shrink">
          {title}
        </Txt>
        <Chip label={words[status]} tone={statusTone[status]} />
      </View>
      <View className="flex-row gap-3 px-4 pb-4 pt-3">
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.paid}
          </Txt>
          <Txt variant="data">{paid}</Txt>
        </View>
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.received}
          </Txt>
          <Txt variant="data" tone={status === 'failed' ? 'muted' : 'fg'}>
            {received}
          </Txt>
        </View>
        <View className="items-end gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.time}
          </Txt>
          <Txt variant="data">{formatClock(at)}</Txt>
        </View>
      </View>
      {signature ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={words.details}
          onPress={() => setOpen((value) => !value)}
          className="flex-row items-center justify-between border-t border-line px-4 py-3 active:bg-hover"
        >
          <Txt variant="ui" tone="muted">
            {words.details}
          </Txt>
          <View className="flex-row items-center gap-2">
            {open ? (
              <Txt variant="data" tone="muted">
                {shortAddress(signature, 6)}
              </Txt>
            ) : null}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
          </View>
        </Pressable>
      ) : null}
    </Card>
  )
}
