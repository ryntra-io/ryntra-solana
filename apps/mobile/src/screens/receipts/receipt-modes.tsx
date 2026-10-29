import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { MODES_COPY, RECEIPT_MODES, type ReceiptMode } from '@/features/receipts/modes-copy'
import { docTimes, gaveWord, legText, type ReceiptDoc } from '@/features/receipts/receipt-doc'
import { useCopy, useLocale } from '@/lib/i18n'
import { cn } from '@/utils/cn'

import { DOC_STATUS_TONE } from './receipt-picture'
import { ShareReceiptButton } from './share-receipt'

/**
 * A receipt in two views (NEW-LOOK §5): **Просто** — the sum large under its
 * word, the other side with its own, the date and the state; **Детально** — every line the
 * record holds (`detailed`, the surface's own), the transaction a tap away, and
 * «Технічні дані (JSON)» folded a tap deeper. The figures are the record's own;
 * nothing is worked out here. The share is the picture of M38.3, in both.
 */
export function ReceiptModes({ doc, detailed }: { doc: ReceiptDoc; detailed: ReactNode }) {
  const words = useCopy(MODES_COPY)
  const copy = useCopy(RECEIPTS_COPY)
  const locale = useLocale()
  const [mode, setMode] = useState<ReceiptMode>('glance')
  const [raw, setRaw] = useState(false)
  const main = doc.got[0] ?? doc.gave[0] ?? null
  const other = doc.got[0] ? (doc.gave[0] ?? null) : null
  // Each figure says what it is: «Отримано» over the sum, «Сплачено» / «Надіслано» / «Продано» before the other side.
  const left = gaveWord(doc.kind)
  const leftWord = left === 'sent' ? copy.sent : left === 'sold' ? copy.sold : copy.gave
  const mainWord = doc.got[0] ? copy.got : leftWord
  const times = docTimes(doc.at, locale)
  return (
    <View className="gap-3 pb-2">
      <View
        accessibilityRole="tablist"
        accessibilityLabel={words.modesA11y}
        className="flex-row gap-1 rounded-lg border border-line bg-surface p-1"
      >
        {RECEIPT_MODES.map((value) => {
          const on = value === mode
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setMode(value)}
              className={cn(
                'h-12 flex-1 items-center justify-center rounded-md',
                on ? 'border border-line-strong bg-elevated' : 'active:bg-hover',
              )}
            >
              <Txt variant="ui" tone={on ? 'fg' : 'muted'}>
                {words.modes[value]}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      {mode === 'glance' ? (
        <View className="items-center gap-2 py-3">
          {/* The sheet's head already names the operation: the title is not said twice (ST-5). */}
          {main ? (
            <>
              <Txt variant="ui" tone="muted" className="text-center">
                {mainWord}
              </Txt>
              <Txt variant="display" tabular className="text-center">
                {legText(main, true)}
              </Txt>
            </>
          ) : doc.detail ? (
            // A journal entry moves no leg of its own: its line is what it says.
            <Txt variant="ui" className="text-center">
              {doc.detail.shown}
            </Txt>
          ) : null}
          {other ? (
            <Txt variant="data" tone="muted" className="text-center">
              {`${leftWord} ${legText(other, true)}`}
            </Txt>
          ) : null}
          <Txt variant="labelSm" tone="faint" tabular>
            {times.local}
          </Txt>
          <Chip
            label={copy.statuses[doc.status]}
            tone={DOC_STATUS_TONE[doc.status]}
            caps={false}
            className="self-center"
          />
        </View>
      ) : (
        <View className="gap-2">
          {detailed}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: raw }}
            accessibilityLabel={raw ? words.hideTechnical : words.technical}
            onPress={() => setRaw((was) => !was)}
            className="min-h-12 flex-row items-center justify-between active:opacity-80"
          >
            <Txt variant="ui" tone="muted">
              {raw ? words.hideTechnical : words.technical}
            </Txt>
            <Icon name={raw ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
          </Pressable>
          {raw ? (
            <View className="rounded-md border border-line bg-ground p-3">
              <Txt variant="data" selectable style={{ fontSize: 12, lineHeight: 18 }}>
                {JSON.stringify(doc, null, 2)}
              </Txt>
            </View>
          ) : null}
        </View>
      )}
      <ShareReceiptButton doc={doc} className="border-t border-line" />
    </View>
  )
}
