import { Image } from 'expo-image'
import type { ReactNode, Ref } from 'react'
import { View } from 'react-native'

import { Chip, type ChipTone } from '@/components/chip'
import { Txt } from '@/components/txt'
import type { ReceiptsCopy } from '@/features/receipts/copy'
import { gaveWord, type DocStatus, type ShareFace } from '@/features/receipts/receipt-doc'

const ICON = require('../../../assets/images/icon.png')

/** The width the picture is drawn at; the phone's density makes the pixels. */
export const PICTURE_WIDTH = 340

export const DOC_STATUS_TONE: Readonly<Record<DocStatus, ChipTone>> = {
  done: 'success',
  pending: 'warning',
  failed: 'danger',
  partial: 'warning',
  needsYou: 'warning',
}

const MARK_TONE = { rule: 'success', policy: 'evidence', observed: 'neutral' } as const satisfies Record<
  string,
  ChipTone
>

function Line({ label, value, mono = true, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-1.5">
      <Txt variant="ui" tone="muted" className="shrink-0">
        {label}
      </Txt>
      <Txt variant={mono ? 'data' : 'ui'} tone={muted ? 'muted' : 'fg'} className="flex-1 text-right">
        {value}
      </Txt>
    </View>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="border-t border-line pt-2.5">
      <Txt variant="labelSm" tone="faint" caps className="pb-0.5">
        {title}
      </Txt>
      {children}
    </View>
  )
}

/**
 * The receipt as a picture: Ryntra's mark, what kind of operation and its
 * state, the figure that arrived, what was paid, the fees each on its row,
 * the time in UTC. What it is drawn
 * from holds no address and no transaction; the amounts are there only when
 * the person turned them on.
 */
export function ReceiptPicture({
  face,
  copy,
  markWords,
  width = PICTURE_WIDTH,
  ref,
}: {
  face: ShareFace
  copy: ReceiptsCopy
  /** A journal entry's mark in the launch's own words: «Правило» · «Політика» · «Спостереження». */
  markWords?: Readonly<Record<string, string>>
  /** Narrower on a small screen; never wider than `PICTURE_WIDTH`. */
  width?: number
  ref?: Ref<View>
}) {
  return (
    // A square ground around the card: the PNG has no transparent corners for a messenger to fill.
    <View ref={ref} collapsable={false} style={{ width }} className="bg-elevated p-3">
      <View className="gap-3 rounded-lg border border-line bg-surface px-5 pb-4 pt-5">
        <View className="flex-row items-center gap-2">
          <Image source={ICON} style={{ width: 24, height: 24, borderRadius: 6 }} accessibilityIgnoresInvertColors />
          <Txt variant="ui" className="flex-1">
            Ryntra
          </Txt>
          <Txt variant="labelSm" tone="faint" caps>
            {face.subject ?? copy.receipt}
          </Txt>
        </View>

        <View className="gap-2">
          {/* The title already says what happened; only a journal entry needs to say where it is from. */}
          {face.kind === 'journal' ? (
            <Txt variant="labelSm" tone="faint" caps>
              {copy.kinds.journal}
            </Txt>
          ) : null}
          <Txt variant="headline">{face.title}</Txt>
          {face.hero ? <Txt variant="dataLg">{face.hero}</Txt> : null}
          <View className="flex-row flex-wrap gap-2">
            {/* A journal entry is a record of the chain, not an operation with a state of its own. */}
            {face.kind === 'journal' ? null : (
              <Chip label={copy.statuses[face.status]} tone={DOC_STATUS_TONE[face.status]} />
            )}
            {face.mark && markWords?.[face.mark] ? (
              <Chip label={markWords[face.mark]!} tone={MARK_TONE[face.mark]} />
            ) : null}
          </View>
          {face.detail ? (
            <Txt variant="body" tone="muted">
              {face.detail}
            </Txt>
          ) : null}
        </View>

        {face.gave.length + face.got.length > 0 ? (
          <View className="border-t border-line pt-1.5">
            {face.gave.map((text, index) => (
              <Line key={`gave-${index}`} label={copy[gaveWord(face.kind)]} value={text} />
            ))}
            {face.got.map((text, index) => (
              <Line key={`got-${index}`} label={copy.got} value={text} />
            ))}
          </View>
        ) : null}

        {face.parts.length > 0 ? (
          <Group title={copy.bySource}>
            {face.parts.map((part) => (
              <Line key={part.kind} label={copy.parts[part.kind]} value={part.text} />
            ))}
          </Group>
        ) : null}

        {face.fees.length > 0 ? (
          <Group title={copy.fees}>
            {face.fees.map((fee) => (
              <Line
                key={fee.kind}
                label={copy.feeKinds[fee.kind]}
                value={fee.collected ? fee.text : `${fee.text} · ${copy.feeNotCollected}`}
                muted={!fee.collected}
              />
            ))}
          </Group>
        ) : null}

        <View className="border-t border-line pt-1.5">
          <Line label={copy.time} value={face.time} />
        </View>

        <Txt variant="labelSm" tone="faint" className="pt-1 text-center">
          {copy.footer}
        </Txt>
      </View>
    </View>
  )
}
