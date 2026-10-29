import { Pressable, View } from 'react-native'

import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { explorerUrl } from '@/features/history/history-model'
import { launchWords } from '@/features/launch/copy'
import { useLaunchPresets, useLaunchToken } from '@/features/launch/use-launch'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromLaunch, docTimes, feeText, gaveWord, legText, type ReceiptDoc } from '@/features/receipts/receipt-doc'
import { useCopy, useLocale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { DASH, shortAddress } from '@/utils/format'

import { DOC_STATUS_TONE } from './receipt-picture'
import { ReceiptModes } from './receipt-modes'
import { ShareReceiptButton } from './share-receipt'

/** A receipt's whole card: every leg and fee, who started it, the time twice, the transaction one tap further, and the share. */
export function DocCard({
  doc,
  loading = false,
  share = true,
}: {
  doc: ReceiptDoc
  loading?: boolean
  /** Off where the card is «Детально» of a receipt that shares itself. */
  share?: boolean
}) {
  const copy = useCopy(RECEIPTS_COPY)
  const locale = useLocale()
  const times = docTimes(doc.at, locale)
  const rows: { key: string; label: string; value: string; detail?: string | null; mono?: boolean; muted?: boolean }[] =
    []
  doc.gave.forEach((leg, index) =>
    rows.push({ key: `gave-${index}`, label: copy[gaveWord(doc.kind)], value: legText(leg, true) }),
  )
  doc.got.forEach((leg, index) => rows.push({ key: `got-${index}`, label: copy.got, value: legText(leg, true) }))
  for (const part of doc.parts)
    rows.push({
      key: `part-${part.kind}`,
      label: `${copy.bySource} · ${copy.parts[part.kind]}`,
      value: legText(part.leg, true),
    })
  for (const fee of doc.fees)
    rows.push({
      key: `fee-${fee.kind}`,
      label: `${copy.fees} · ${copy.feeKinds[fee.kind]}`,
      value: feeText(fee, true, locale),
      detail: fee.collected ? null : copy.feeNotCollected,
      muted: !fee.collected,
    })
  if (doc.initiator)
    rows.push({ key: 'initiator', label: copy.initiatorLabel, value: copy.initiators[doc.initiator], mono: false })
  rows.push({ key: 'time', label: copy.time, value: times.local, detail: times.utc === DASH ? null : times.utc })
  if (doc.signature) rows.push({ key: 'signature', label: copy.signature, value: shortAddress(doc.signature, 8) })

  return (
    <View className="pb-2">
      <View className="flex-row items-center justify-between pb-2">
        <Chip label={copy.statuses[doc.status]} tone={DOC_STATUS_TONE[doc.status]} />
        <Txt variant="labelSm" tone="faint" caps>
          {copy.kinds[doc.kind]}
        </Txt>
      </View>
      {loading ? (
        <View className="gap-3 py-3" accessibilityRole="progressbar" accessibilityLabel={copy.loading}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </View>
      ) : null}
      {rows.map((row, index) => (
        <FactRow
          key={row.key}
          label={row.label}
          value={row.value}
          detail={row.detail ?? null}
          mono={row.mono ?? true}
          tone={row.muted ? 'muted' : 'fg'}
          last={index === rows.length - 1 && !doc.signature}
        />
      ))}
      {doc.signature ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={copy.explorer}
          onPress={() => openLink(explorerUrl(doc.signature!))}
          className="min-h-11 flex-row items-center gap-3 border-b border-line py-3 active:bg-hover"
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
      {loading || !share ? null : <ShareReceiptButton doc={doc} />}
    </View>
  )
}

/** A launch listed from «Мої лаунчі» is read once more for its receipt — the first buy and the transaction — before it is drawn. */
function LaunchDoc({ doc }: { doc: ReceiptDoc }) {
  const locale = useLocale()
  const mint = doc.mints[0] ?? null
  const token = useLaunchToken(mint)
  const presets = useLaunchPresets()
  const data = token.data ?? null
  const pair = data ? (presets.data?.presets.find((entry) => entry.id === data.preset)?.pair ?? null) : null
  if (!data) return <DocCard doc={doc} loading={token.isPending} />
  return <DocCard doc={docFromLaunch(data, pair, doc.title, locale)} />
}

/** The sheet a receipt of the list opens. */
export function ReceiptDocSheet({ doc, onClose }: { doc: ReceiptDoc | null; onClose: () => void }) {
  const copy = useCopy(RECEIPTS_COPY)
  if (!doc) return null
  const unread = doc.kind === 'launch' && doc.signature === null
  return (
    <Sheet visible title={doc.title} subtitle={copy.receipt} onClose={onClose} scroll>
      {unread ? <LaunchDoc doc={doc} /> : <ReceiptModes doc={doc} detailed={<DocCard doc={doc} share={false} />} />}
    </Sheet>
  )
}

/** The launch's own words of a journal mark, for the picture of an entry. */
export function journalMarkWords(locale: 'en' | 'uk'): Readonly<Record<string, string>> {
  const word = launchWords(locale)
  return { rule: word('enforce_rule'), policy: word('enforce_policy'), observed: word('enforce_observed') }
}
