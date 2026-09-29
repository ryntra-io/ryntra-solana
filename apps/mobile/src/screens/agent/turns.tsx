import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import {
  handoffView,
  isDraftCard,
  rynTurnView,
  turnLead,
  type HandoffView,
  type SentenceView,
  type SourceView,
} from '@/features/agent/agent-model'
import type { AgentCopy } from '@/features/agent/copy'
import type { AgentTurn } from '@/lib/api'
import { useTheme } from '@/theme'
import { formatMoment } from '@/utils/format'

import { AgentCardView, type CardContext } from './cards'

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

/** A source number as a superscript mark: small, beside the sentence, never louder than it. */
function markOf(n: number): string {
  return String(n)
    .split('')
    .map((digit) => SUPERSCRIPT[Number(digit)] ?? digit)
    .join('')
}

function Sentences({
  sentences,
  tone = 'fg',
  marks = true,
}: {
  sentences: readonly SentenceView[]
  tone?: 'fg' | 'muted'
  /** The numbers of the sources each sentence stands on — shown where the sources are (M27). */
  marks?: boolean
}) {
  return (
    <View className="gap-2">
      {sentences.map((sentence, index) => (
        <Txt key={index} variant="body" tone={tone} selectable>
          {sentence.text}
          {marks && sentence.marks.length > 0 ? (
            <Txt variant="body" tone="brand">
              {` ${sentence.marks.map(markOf).join(' ')}`}
            </Txt>
          ) : null}
        </Txt>
      ))}
    </View>
  )
}

/** The person's own words, as they asked them. */
export function PersonTurn({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <View
      className="rounded-md border border-line bg-elevated px-4 py-3"
      style={{ alignSelf: 'flex-end', maxWidth: '88%', opacity: pending ? 0.75 : 1 }}
    >
      <Txt variant="body" selectable>
        {text}
      </Txt>
    </View>
  )
}

/** Ryntra reading: the one moving thing on the screen while an answer is composed. */
export function ReadingTurn({ copy }: { copy: AgentCopy }) {
  const { colors } = useTheme()
  return (
    <View className="flex-row items-center gap-2 py-1" accessibilityRole="progressbar" accessibilityLabel={copy.reading}>
      <ActivityIndicator size="small" color={colors.brand} />
      <Txt variant="ui" tone="muted">
        {copy.reading}
      </Txt>
    </View>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps>
      {children}
    </Txt>
  )
}

function Sources({ sources, copy, now, locale }: { sources: readonly SourceView[]; copy: AgentCopy; now: number; locale: CardContext['locale'] }) {
  return (
    <View className="gap-3 pb-3">
      {sources.map((source) => (
        <View key={source.n} className="flex-row gap-3">
          <Txt variant="data" tone="brand" className="w-6">
            {markOf(source.n)}
          </Txt>
          <View className="flex-1 gap-1">
            <Txt variant="ui">{source.source}</Txt>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Txt variant="labelSm" tone="faint">
                {source.observedAt ? formatMoment(source.observedAt, now, locale) : copy.noTime}
              </Txt>
              <Chip label={copy.state[source.state]} tone={source.state === 'stale' ? 'warning' : 'neutral'} />
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

function handoffTitle(view: HandoffView, copy: AgentCopy): string {
  switch (view.words.kind) {
    case 'server':
      return view.handoff.label
    case 'asset':
      return copy.openAsset(view.words.symbol)
    default:
      return copy.open[view.words.kind]
  }
}

/** How many of the answer's points stand at rest; the others, with the next steps, are under «Деталі» (M27). */
const LEAD_AT_REST = 1

/**
 * The assistant's turn. At rest: who spoke and when, the headline, a refusal
 * or an honest *not enough data*, the answer's first point with the numbers
 * of the sources it stands on, a draft to act on and the doors. One tap deeper,
 * under «Деталі»: the rest of what is known, the figures Ryntra read and the
 * next steps (M27); what could
 * make it wrong, the risks and what to check; the sources with their times and
 * states. `emphasis` gives the
 * turn the screen's one orange action; without it every button is quiet.
 */
export function RynTurn({ turn, context, emphasis = false }: { turn: AgentTurn; context: CardContext; emphasis?: boolean }) {
  const { copy, now, locale, onOpen } = context
  const view = rynTurnView(turn)
  const lead = emphasis ? turnLead(turn) : null
  const [deeperOpen, setDeeperOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  // At rest the answer says its first point; the rest of what it knows and the next steps are one tap deeper (M27).
  const [allOpen, setAllOpen] = useState(false)
  const leadShown = allOpen ? view.lead : view.lead.slice(0, LEAD_AT_REST)
  // The figures Ryntra read (a market, a stock, the evidence) are the answer's grounds, one tap deeper; a draft — the
  // place where the person acts — stays at rest (M27).
  const readCards = view.cards.filter((card) => !isDraftCard(card)).length
  const folded = view.lead.length > LEAD_AT_REST || view.actions.length > 0 || readCards > 0
  // Two web pages can be one screen on the phone (Spot and the asset passport are both the asset): offered once.
  const handoffs = view.handoffs
    .map((handoff) => handoffView(handoff, turn.cards))
    .filter((entry): entry is HandoffView => entry !== null)
    .filter((entry, index, all) => all.findIndex((other) => other.path === entry.path) === index)
  const weakest = view.weakest && view.weakest !== 'current' ? copy.weakest[view.weakest] : null

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon name="sparkles" size={14} color="brand" />
        <Txt variant="labelSm" tone="brand" caps>
          {copy.who}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {formatMoment(view.at, now, locale)}
        </Txt>
      </View>
      <Txt variant="title">{view.headline}</Txt>

      {view.refusal || view.insufficient || weakest ? (
        <View className="flex-row flex-wrap gap-1.5">
          {/* A refusal is said once, as a state; the answer's own words explain it. */}
          {view.refusal ? (
            <Chip label={view.refusal === 'execute' ? copy.refusedExecute : copy.refusedSecret} tone="brand" caps={false} />
          ) : null}
          {view.insufficient ? <Chip label={copy.insufficient} tone="warning" caps={false} /> : null}
          {weakest ? <Chip label={weakest} tone="warning" caps={false} /> : null}
        </View>
      ) : null}

      {leadShown.length > 0 ? <Sentences sentences={leadShown} marks={allOpen || !folded} /> : null}

      {view.cards.map((card, index) =>
        allOpen || isDraftCard(card) ? (
          <AgentCardView
            key={`${card.kind}-${index}`}
            card={card}
            context={context}
            lead={lead?.kind === 'card' && lead.index === index}
          />
        ) : null,
      )}

      {allOpen && view.actions.length > 0 ? (
        <View className="gap-1.5">
          <SectionTitle>{copy.actions}</SectionTitle>
          <Sentences sentences={view.actions} tone="muted" />
        </View>
      ) : null}

      {handoffs.length > 0 ? (
        <View className="gap-2">
          {handoffs.map((handoff) => (
            <Button
              key={handoff.handoff.href}
              title={handoffTitle(handoff, copy)}
              variant={lead?.kind === 'handoff' && lead.href === handoff.handoff.href ? 'primary' : 'secondary'}
              onPress={() => onOpen(handoff.path)}
            />
          ))}
        </View>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {folded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: allOpen }}
            onPress={() => setAllOpen((open) => !open)}
            hitSlop={6}
            className="flex-row items-center gap-1 py-1 active:opacity-80"
          >
            <Txt variant="ui" tone="muted">
              {allOpen ? copy.hideDetails : copy.details}
            </Txt>
            <Icon name={allOpen ? 'chevron-up' : 'chevron-down'} size={14} color="fgMuted" />
          </Pressable>
        ) : null}
        {view.deeperCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDeeperOpen(true)}
            hitSlop={6}
            className="flex-row items-center gap-1 py-1 active:opacity-80"
          >
            <Txt variant="ui" tone="muted">
              {copy.deeper(view.deeperCount)}
            </Txt>
            <Icon name="chevron-forward" size={14} color="fgMuted" />
          </Pressable>
        ) : null}
        {view.sources.length > 0 && (allOpen || !folded) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSourcesOpen(true)}
            hitSlop={6}
            className="flex-row items-center gap-1 py-1 active:opacity-80"
          >
            <Txt variant="ui" tone="muted">
              {copy.sources(view.sources.length)}
            </Txt>
            <Icon name="chevron-forward" size={14} color="fgMuted" />
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={deeperOpen} title={copy.deeperTitle} onClose={() => setDeeperOpen(false)} scroll>
        <View className="gap-5 pb-3">
          {view.deeper.counter.length > 0 ? (
            <View className="gap-2">
              <SectionTitle>{copy.counter}</SectionTitle>
              <Sentences sentences={view.deeper.counter} />
            </View>
          ) : null}
          {view.deeper.risks.length > 0 ? (
            <View className="gap-2">
              <SectionTitle>{copy.risks}</SectionTitle>
              <Sentences sentences={view.deeper.risks} />
            </View>
          ) : null}
          {view.deeper.checks.length > 0 ? (
            <View className="gap-2">
              <SectionTitle>{copy.checks}</SectionTitle>
              <Sentences sentences={view.deeper.checks} />
            </View>
          ) : null}
        </View>
      </Sheet>
      <Sheet
        visible={sourcesOpen}
        title={copy.sourcesTitle}
        subtitle={view.composedBy === 'model' ? copy.composedModel : copy.composedReads}
        onClose={() => setSourcesOpen(false)}
        scroll
      >
        <Sources sources={view.sources} copy={copy} now={now} locale={locale} />
      </Sheet>
    </View>
  )
}
