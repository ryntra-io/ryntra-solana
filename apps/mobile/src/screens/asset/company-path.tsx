import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { CompanyPathView, PathLineView, PathSourceView, PathStepView } from '@/features/invest/company-path'
import type { CompanyPathCopy, PathStepState } from '@/features/invest/company-path-copy'
import type { PathToken } from '@/lib/api'
import { EventButtons, type EventActions } from '@/screens/invest/event-ui'
import { fonts, useTheme } from '@/theme'

/** The dot's size and the rail's place — the web's own 22 px column. */
const DOT = 22
const SEMIBOLD = { fontFamily: fonts.sansSemibold } as const

/**
 * «Шлях компанії» (M24; the web's `RYN-COMPANY-PATH-001`, as ryntra.io draws
 * it below 720 px) — one card under the company's name: Приватна · PreStocks →
 * IPO → Біржа → Solana, each step passed (a check), current (the orange dot)
 * or not announced (a dashed ring), with its day on the right. The page's own
 * token stands at its step as «цей токен»; the company's other token is a chip
 * that opens its page — SPACEX and SPCXx lead to each other — each saying what
 * it is. Under the steps, the one line that matters to a holder: the private
 * token's swap deadline with the issuer's minute, and on the private token's
 * own page a holder's swap and sale under it (M19's actions); for a company
 * still private, the issuer's rule. Where each fact was read is one tap
 * deeper, under «Джерела» — each source opens in the browser.
 */
export function CompanyPathStrip({
  view,
  words,
  onOpenToken,
  actions = null,
}: {
  view: CompanyPathView
  words: CompanyPathCopy
  /** Open the company's other token's page. */
  onOpenToken: (token: PathToken) => void
  /** A holder's swap and sale under the swap's line — the private token's own page only. */
  actions?: EventActions | null
}) {
  return (
    <Card className="gap-4">
      <Txt variant="title" accessibilityRole="header">
        {words.title}
      </Txt>
      <View>
        {view.steps.map((step, index) => (
          <PathStep
            key={step.step}
            step={step}
            last={index === view.steps.length - 1}
            words={words}
            onOpenToken={onOpenToken}
          />
        ))}
      </View>
      {view.line ? <PathLine line={view.line} actions={actions} /> : null}
      {view.sources.length > 0 ? <PathSources sources={view.sources} words={words} /> : null}
    </Card>
  )
}

/** One step: its dot and the rail to the next, its name, its day on the right, and its token under them. */
function PathStep({
  step,
  last,
  words,
  onOpenToken,
}: {
  step: PathStepView
  last: boolean
  words: CompanyPathCopy
  onOpenToken: (token: PathToken) => void
}) {
  const unannounced = step.state === 'unannounced'
  const label = [step.name, unannounced ? null : words.stepState[step.state], ...step.lines]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(', ')
  return (
    <View className="flex-row gap-3">
      <View style={{ width: DOT }}>
        <PathDot state={step.state} />
        {last ? null : <PathRail dashed={step.state !== 'passed'} />}
      </View>
      <View className="flex-1 gap-1" style={last ? null : { paddingBottom: 12 }}>
        <View
          accessible
          accessibilityLabel={label}
          className="flex-row items-start justify-between gap-3"
          style={{ minHeight: DOT, paddingTop: 2.5 }}
        >
          <Txt variant="ui" tone={unannounced ? 'muted' : 'fg'} className="shrink" style={SEMIBOLD}>
            {step.name}
          </Txt>
          {step.lines.length > 0 ? (
            <View className="shrink items-end gap-0.5">
              {step.lines.map((line) => (
                <Txt key={line} variant="ui" tone={unannounced ? 'muted' : 'faint'} tabular className="text-right">
                  {line}
                </Txt>
              ))}
            </View>
          ) : null}
        </View>
        {step.token ? (
          <View className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
            {step.token.here ? (
              <View className="min-h-8 flex-row items-center gap-1.5 rounded-pill border border-line bg-elevated px-3">
                <Txt variant="ui" style={SEMIBOLD}>
                  {step.token.symbol}
                </Txt>
                <Txt variant="ui" tone="muted">
                  {words.thisToken}
                </Txt>
              </View>
            ) : (
              <TokenLink token={step.token} words={words} onOpen={onOpenToken} />
            )}
            <Txt variant="labelSm" tone="muted">
              {step.token.nature}
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** The company's other token: its symbol and an arrow — one tap to its page. */
function TokenLink({
  token,
  words,
  onOpen,
}: {
  token: PathToken
  words: CompanyPathCopy
  onOpen: (token: PathToken) => void
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={words.openToken(token.symbol)}
      hitSlop={6}
      onPress={() => onOpen({ mint: token.mint, symbol: token.symbol })}
      className="min-h-8 flex-row items-center gap-1.5 rounded-pill border border-line-strong px-3 active:bg-hover"
    >
      <Txt variant="ui" style={SEMIBOLD}>
        {token.symbol}
      </Txt>
      <Icon name="arrow-forward" size={14} color="fg" />
    </Pressable>
  )
}

/** Passed — a check on the text colour; current — the orange dot with its glow; not announced — a dashed ring. */
function PathDot({ state }: { state: PathStepState }) {
  const { colors } = useTheme()
  if (state === 'passed')
    return (
      <View
        className="items-center justify-center rounded-pill bg-fg"
        style={{ width: DOT, height: DOT }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="checkmark" size={14} color="ground" />
      </View>
    )
  if (state === 'current')
    return (
      <View style={{ width: DOT, height: DOT }} accessibilityElementsHidden importantForAccessibility="no">
        <View
          style={{
            position: 'absolute',
            left: -4,
            top: -4,
            width: DOT + 8,
            height: DOT + 8,
            borderRadius: (DOT + 8) / 2,
            backgroundColor: colors.brandGlow,
          }}
        />
        <View className="rounded-pill bg-brand" style={{ width: DOT, height: DOT }} />
      </View>
    )
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: colors.lineStrong,
        backgroundColor: colors.surface,
      }}
    />
  )
}

/** The rail from a step to the next: solid past a step left behind, dashed from the step the company stands at. */
function PathRail({ dashed }: { dashed: boolean }) {
  const { colors } = useTheme()
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: DOT / 2 - 1, top: DOT + 4, bottom: 4, width: 2, overflow: 'hidden' }}
    >
      {dashed ? (
        <View style={{ gap: 4 }}>
          {Array.from({ length: 40 }, (_, index) => (
            <View key={index} style={{ height: 4, backgroundColor: colors.lineStrong }} />
          ))}
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.fgMuted }} />
      )}
    </View>
  )
}

/** The line under the steps — the swap's deadline with an hourglass, or the issuer's rule — and a holder's actions. */
function PathLine({ line, actions }: { line: PathLineView; actions: EventActions | null }) {
  return (
    <View className="gap-3 border-t border-line pt-3">
      {line.kind === 'swap' ? (
        <View className="flex-row items-start gap-2">
          <Icon name="hourglass-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
          <Txt variant="ui" className="flex-1" style={SEMIBOLD}>
            {line.text}
          </Txt>
        </View>
      ) : (
        <Txt variant="ui" tone="faint">
          {line.text}
        </Txt>
      )}
      {actions ? <EventButtons actions={actions} /> : null}
    </View>
  )
}

/** «Джерела»: closed at rest; open, each source with its days, a tap to its page in the browser. */
function PathSources({ sources, words }: { sources: readonly PathSourceView[]; words: CompanyPathCopy }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={words.sources}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen((value) => !value)}
        className="flex-row items-center gap-1.5 self-start py-1.5"
      >
        <Icon name={open ? 'caret-down' : 'caret-forward'} size={12} color="muted" />
        <Txt variant="ui" tone="muted">
          {words.sources}
        </Txt>
      </Pressable>
      {open ? (
        <View className="gap-1">
          {sources.map((source) => (
            <Pressable
              key={source.key}
              accessibilityRole="link"
              accessibilityHint={words.openSource}
              onPress={() => void Linking.openURL(source.url)}
              className="rounded-xs py-1.5 active:bg-hover"
            >
              <Txt variant="labelSm" tone="muted">
                {/* The arrow stays with the last word — never a line of its own. */}
                {`${source.line} ↗`}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}
