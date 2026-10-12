import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { ChoiceChips } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { LaunchWord, LaunchWordKey } from '@/features/launch/copy'
import type { FlowStep } from '@/features/launch/launch-flow'
import { shortKey } from '@/features/launch/launch-format'
import { canCopy, copyText } from '@/lib/clipboard'
import { cn } from '@/utils/cn'
import { openLink } from '@/lib/open-link'

/** Launch's three pages, one tap apart, at the top of each — as the web's: «Запустити токен» · «Лаунчі на Ryntra» · «Мої лаунчі». */
export function LaunchTabs({ word, current }: { word: LaunchWord; current: 'new' | 'markets' | 'mine' }) {
  const router = useRouter()
  return (
    <ChoiceChips
      role="tablist"
      scroll
      size="sm"
      tall
      choices={[
        { value: 'new', label: word('title') },
        { value: 'markets', label: word('tabMarkets') },
        { value: 'mine', label: word('mineTitle') },
      ]}
      value={current}
      onChange={(next) => {
        if (next !== current) router.replace(LAUNCH_TAB_PATH[next] as never)
      }}
    />
  )
}

const LAUNCH_TAB_PATH = { new: '/launch', markets: '/launch/markets', mine: '/launch/mine' } as const

/**
 * Launch's operator stop, said where a person meets it — in the page's own
 * tone, not an error's: nothing went wrong on the person's side, and no time
 * is promised. `launching` — only new launches wait; trades and claims go on.
 */
export function PausedNote({
  word,
  scope = 'all',
  onCheck,
}: {
  word: LaunchWord
  /** `form` — the form's own line, which promises nothing about trades and claims the phone cannot know. */
  scope?: 'all' | 'launching' | 'form'
  /** Read the stop again, where nothing reads it by itself. */
  onCheck?: () => void
}) {
  return (
    <View className="gap-3 rounded-sm border border-line bg-surface px-3 py-3">
      <View accessibilityRole="text" className="flex-row items-start gap-2.5">
        <Icon name="pause-circle-outline" size={18} color="muted" style={{ marginTop: 1 }} />
        <Txt variant="ui" tone="muted" className="flex-1" style={{ lineHeight: 20 }}>
          {scope === 'all' ? word('pausedNotice') : scope === 'form' ? word('pausedForm') : word('pausedLaunching')}
        </Txt>
      </View>
      {onCheck ? <Button title={word('retry')} variant="secondary" onPress={onCheck} /> : null}
    </View>
  )
}

const STEP_WORDS: Readonly<Record<FlowStep, LaunchWordKey>> = {
  prepare: 'stepPrepare',
  sign: 'stepSign',
  send: 'stepSend',
}

/** Where a send stands: prepared · in the wallet · on the network — done, now, next. */
export function Steps({
  word,
  phase,
  labels = {},
}: {
  word: LaunchWord
  phase: FlowStep
  labels?: Partial<Record<FlowStep, LaunchWordKey>>
}) {
  const order: FlowStep[] = ['prepare', 'sign', 'send']
  const at = order.indexOf(phase)
  return (
    <View className="gap-2" accessibilityLiveRegion="polite">
      {order.map((step, index) => {
        const state = index < at ? 'done' : index === at ? 'active' : 'next'
        return (
          <View key={step} className="flex-row items-center gap-2.5">
            <Icon
              name={state === 'done' ? 'checkmark-circle' : state === 'active' ? 'ellipse' : 'ellipse-outline'}
              size={16}
              color={state === 'done' ? 'successInk' : state === 'active' ? 'brand' : 'fgMuted'}
            />
            <Txt variant="ui" tone={state === 'next' ? 'faint' : 'fg'}>
              {word(labels[step] ?? STEP_WORDS[step])}
            </Txt>
          </View>
        )
      })}
    </View>
  )
}

/** The token's picture, served by its immutable address — or an empty square while there is none. */
export function TokenPicture({ uri, size = 48, className }: { uri: string | null; size?: number; className?: string }) {
  return (
    <View
      className={cn('items-center justify-center overflow-hidden rounded-sm border border-line bg-elevated', className)}
      style={{ width: size, height: size }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Icon name="image-outline" size={Math.round(size * 0.45)} color="fgMuted" />
      )}
    </View>
  )
}

/** The link a creator shares: one tap to copy, one to post. */
export function ShareLink({ word, link, symbol }: { word: LaunchWord; link: string; symbol: string }) {
  const [copied, setCopied] = useState(false)
  // Shown short — the address and the token's own key cut in the middle; the copy carries the whole link.
  const shown = link
    .replace(/^https?:\/\//, '')
    .replace(/\?.*$/, '')
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, (key) => shortKey(key))
  const post = `https://x.com/intent/post?text=${encodeURIComponent(word('shareText', { symbol }))}&url=${encodeURIComponent(link)}`
  return (
    <View className="gap-2">
      <Txt variant="labelSm" tone="faint" caps>
        {word('share')}
      </Txt>
      <Txt variant="data" tone="muted" numberOfLines={1} ellipsizeMode="middle">
        {shown}
      </Txt>
      <View className="flex-row gap-2">
        {canCopy ? (
          <Button
            title={copied ? word('copied') : word('copy')}
            variant="secondary"
            className="flex-1"
            onPress={() => {
              if (copyText(link)) setCopied(true)
            }}
          />
        ) : null}
        <Button title={word('shareOnX')} variant="secondary" className="flex-1" onPress={() => openLink(post)} />
      </View>
    </View>
  )
}

/** A line that opens what it names on Solscan — a transaction or an account, said by its words. */
export function ExplorerLink({
  label,
  url,
  accessibilityLabel,
}: {
  label: string
  url: string
  /** What a screen reader says where the label alone is an address: the row's name with it. */
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => openLink(url)}
      hitSlop={8}
      className="min-h-11 flex-row items-center gap-1 self-start"
    >
      <Txt variant="ui" tone="brand">
        {label}
      </Txt>
      <Icon name="open-outline" size={13} color="brand" />
    </Pressable>
  )
}

/** A label and its value on one line, the value on the right — a figure in mono, words in the reading face. */
export function Row({
  label,
  value,
  tone = 'fg',
  mono = true,
}: {
  label: string
  value: string
  tone?: 'fg' | 'muted' | 'danger'
  mono?: boolean
}) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-1.5">
      <Txt variant="ui" tone="muted" className="shrink">
        {label}
      </Txt>
      <Txt variant={mono ? 'data' : 'ui'} tone={tone} className="shrink text-right">
        {value}
      </Txt>
    </View>
  )
}
