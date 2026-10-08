import { Pressable, View } from 'react-native'

import { Chip, type ChipTone } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import type { HistoryCopy } from '@/features/history/copy'
import { explorerUrl, historyTitle, type HistoryRow, type HistoryStatus } from '@/features/history/history-model'
import type { Locale } from '@/lib/i18n'
import { DASH, formatAmount, formatMoment, formatUsd, shortAddress } from '@/utils/format'
import { openLink } from '@/lib/open-link'

export const STATUS_TONE: Readonly<Record<HistoryStatus, ChipTone>> = {
  done: 'success',
  pending: 'warning',
  failed: 'danger',
  needsYou: 'warning',
}

export type ReceiptSheetProps = {
  row: HistoryRow | null
  now: number
  locale: Locale
  copy: HistoryCopy
  onClose: () => void
}

/** The whole record of one operation: every leg, the cost, the state, the time, the identity on the chain, the proof one tap further. */
export function ReceiptSheet({ row, now, locale, copy, onClose }: ReceiptSheetProps) {
  if (!row) return null
  const facts: {
    label: string
    value: string
    detail?: string | null
    tone?: 'fg' | 'muted' | 'success' | 'danger'
    mono?: boolean
  }[] = []
  if (row.out) facts.push({ label: copy.paid, value: `${row.out.amountText} ${row.out.symbol}` })
  if (row.in) {
    facts.push({
      label: copy.received,
      value: `${row.in.amountText} ${row.in.symbol}`,
      tone: row.status === 'failed' ? 'muted' : 'fg',
    })
  }
  if (row.fee) {
    facts.push({
      label: copy.fee,
      value: row.fee.text,
      detail:
        [
          row.fee.basisPoints !== null && !row.fee.text.endsWith('%')
            ? `${formatAmount(row.fee.basisPoints / 100, 2, locale)}%`
            : null,
          row.fee.collected ? null : copy.feeNotCollected,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    })
  }
  if (row.statedUsd !== null)
    facts.push({ label: copy.value, value: formatUsd(row.statedUsd, locale), detail: copy.valueDetail })
  facts.push({ label: copy.time, value: formatMoment(row.at, now, locale) })
  const updated = formatMoment(row.updatedAt, now, locale)
  if (updated !== formatMoment(row.at, now, locale)) facts.push({ label: copy.updated, value: updated })
  if (row.destination && row.kind !== 'receive') {
    facts.push({ label: copy.destination, value: copy.destinations[row.destination] ?? row.destination, mono: false })
  }
  if (row.plan) facts.push({ label: copy.plan, value: copy.planVersion(row.plan.version), mono: false })
  if (row.rule) facts.push({ label: copy.autoinvest, value: copy.byRule, mono: false })
  if (row.signature) facts.push({ label: copy.signature, value: shortAddress(row.signature, 8) })
  if (row.sourceTx) facts.push({ label: copy.sourceTx, value: shortAddress(row.sourceTx, 8) })
  if (row.destinationTx) facts.push({ label: copy.destinationTx, value: shortAddress(row.destinationTx, 8) })

  const proof = row.signature ?? (row.destinationTx && !row.destinationTx.startsWith('0x') ? row.destinationTx : null)

  return (
    <Sheet visible title={historyTitle(row, copy.words)} subtitle={copy.receipt} onClose={onClose} scroll>
      <View className="flex-row items-center justify-between pb-2">
        <Chip label={copy.status[row.status]} tone={STATUS_TONE[row.status]} />
        <Txt variant="labelSm" tone="faint">
          {formatMoment(row.at, now, locale)}
        </Txt>
      </View>
      {facts.map((fact, index) => (
        <FactRow
          key={fact.label}
          label={fact.label}
          value={fact.value}
          detail={fact.detail ?? null}
          tone={fact.tone ?? 'fg'}
          mono={fact.mono ?? true}
          last={index === facts.length - 1 && !proof}
        />
      ))}
      {proof ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={copy.explorer}
          onPress={() => openLink(explorerUrl(proof))}
          className="flex-row items-center gap-3 py-3 active:bg-hover"
        >
          <Icon name="open-outline" size={18} />
          <Txt variant="ui" className="flex-1">
            {copy.explorer}
          </Txt>
          <Txt variant="labelSm" tone="faint">
            solscan.io
          </Txt>
        </Pressable>
      ) : null}
      {facts.length === 0 && !proof ? (
        <Txt variant="ui" tone="faint" className="py-3">
          {DASH}
        </Txt>
      ) : null}
    </Sheet>
  )
}
