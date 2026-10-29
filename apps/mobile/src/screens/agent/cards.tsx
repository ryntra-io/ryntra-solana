import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { destinationOfCard, figureView, ticketOfCard } from '@/features/agent/agent-model'
import { openLink } from '@/lib/open-link'
import type { AgentCopy } from '@/features/agent/copy'
import { metricLabel, metricOf, thresholdText } from '@/features/plans/evidence-model'
import type { PlansCopy } from '@/features/plans/copy'
import type { AgentCard, AgentFigure, AgentState, EvidenceMetricDefinition } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { cn } from '@/utils/cn'
import { DASH, formatAmount, formatMoment, formatPrice, formatUsd } from '@/utils/format'

import { MarkChip } from './marks'

export type CardContext = Readonly<{
  copy: AgentCopy
  plans: PlansCopy
  locale: Locale
  now: number
  metrics: readonly EvidenceMetricDefinition[] | null
  onOpen: (path: string) => void
  /** The company a token stands for, where the shelf names it — the words of a page's door. */
  nameOf: (mint: string) => string | null
}>

/* A figure nobody could read is a dash with its word, quiet — it is an absence, not an alarm; an old one is amber. */
const STATE_TONE: Readonly<Record<AgentState, 'neutral' | 'warning'>> = {
  current: 'neutral',
  stale: 'warning',
  unknown: 'neutral',
  unavailable: 'neutral',
}

/**
 * Figures two to a row: the label, the value as the tool read it, and its state when it is not current. When every
 * figure carries the same state — a whole read gone stale — it is said once, above them, not under each.
 */
function Figures({ figures, copy }: { figures: readonly AgentFigure[]; copy: AgentCopy }) {
  if (figures.length === 0) return null
  const views = figures.map(figureView)
  const first = views[0]!
  const shared = views.length > 1 && views.every((view) => view.flagged && view.state === first.state) ? first.state : null
  return (
    <View className="gap-2.5">
      {shared ? <Chip label={copy.state[shared]} tone={STATE_TONE[shared]} className="self-start" /> : null}
      <View className="flex-row flex-wrap" style={{ rowGap: 10 }}>
      {figures.map((figure, index) => {
        const view = views[index]!
        return (
          <View key={`${figure.label}-${index}`} className="gap-0.5 pr-3" style={{ width: '50%' }}>
            <Txt variant="labelSm" tone="faint" numberOfLines={1}>
              {view.label}
            </Txt>
            {/* A figure is set in the data face; a fact in words ("on Jupiter's verified list") stays in the interface face. */}
            <Txt variant={figure.number !== null ? 'data' : 'ui'} numberOfLines={2} selectable>
              {view.value}
            </Txt>
            {view.flagged && !shared ? (
              <Chip label={copy.state[view.state]} tone={STATE_TONE[view.state]} className="mt-0.5" />
            ) : null}
          </View>
        )
      })}
      </View>
    </View>
  )
}

/** A card's head: what kind of read it is, its subject, and the door to the phone's own screen for it. */
function Head({
  kind,
  title,
  meta,
  help,
  onPress,
}: {
  kind: string
  title: string
  meta?: string | null
  /** What the card is not — one tap deep behind «?», never a line on every card. */
  help?: string | null
  onPress?: (() => void) | null
}) {
  const body = (
    <View className="flex-row items-center gap-2">
      <View className="flex-1 gap-0.5">
        <Txt variant="labelSm" tone="faint" caps>
          {kind}
        </Txt>
        <Txt variant="ui" numberOfLines={2}>
          {title}
        </Txt>
        {meta ? (
          <Txt variant="labelSm" tone="faint" numberOfLines={2}>
            {meta}
          </Txt>
        ) : null}
      </View>
      {help ? <HelpDot title={kind} body={help} /> : null}
      {onPress ? <Icon name="chevron-forward" size={18} color="fgMuted" /> : null}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={title} onPress={onPress} className="active:opacity-80">
      {body}
    </Pressable>
  )
}

/** A short list one tap deep: what the draft assumed, what the builder will ask. */
function Disclosure({ label, title, lines }: { label: string; title: string; lines: readonly string[] }) {
  const [open, setOpen] = useState(false)
  if (lines.length === 0) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between py-1 active:opacity-80"
      >
        <Txt variant="ui" tone="muted">
          {label}
        </Txt>
        <Icon name="chevron-forward" size={16} color="fgMuted" />
      </Pressable>
      <Sheet visible={open} title={title} onClose={() => setOpen(false)} scroll>
        <View className="gap-3 pb-3">
          {lines.map((line, index) => (
            <View key={index} className="flex-row gap-2">
              <Txt variant="body" tone="faint">
                ·
              </Txt>
              <Txt variant="body" className="flex-1">
                {line}
              </Txt>
            </View>
          ))}
        </View>
      </Sheet>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5 pr-3" style={{ width: '50%' }}>
      <Txt variant="labelSm" tone="faint" numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="data">{value}</Txt>
    </View>
  )
}

/** «Що зрушило ціну?» — every row marked by how sure it is; the cause itself is always among the unknown (1.44.0). */
function MoveCard({ card, context }: { card: Extract<AgentCard, { kind: 'move' }>; context: CardContext }) {
  const { copy } = context
  const [legendOpen, setLegendOpen] = useState(false)
  const change = card.change
  const tone = change?.number === null || change?.number === undefined ? 'fg' : change.number > 0 ? 'success' : change.number < 0 ? 'danger' : 'fg'
  return (
    <Card className="gap-3">
      <View className="flex-row items-start gap-3">
        <View className="flex-1 gap-0.5">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.cardMove}
          </Txt>
          <Txt variant="ui">{`${card.symbol} · ${card.window === '1h' ? copy.move1h : copy.move24h}`}</Txt>
        </View>
        <Txt variant="data" tone={tone} selectable>
          {change?.value ?? DASH}
        </Txt>
      </View>
      <View className="gap-3">
        {card.rows.map((row, index) => (
          <View key={index} className="gap-1.5">
            <MarkChip mark={row.mark} copy={copy} />
            <Txt variant="body" selectable>
              {row.text}
            </Txt>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setLegendOpen(true)}
        hitSlop={6}
        className="flex-row items-center gap-1 self-start py-1 active:opacity-80"
      >
        <Txt variant="ui" tone="muted">
          {copy.marksTitle}
        </Txt>
        <Icon name="chevron-forward" size={14} color="fgMuted" />
      </Pressable>
      <Sheet visible={legendOpen} title={copy.marksTitle} onClose={() => setLegendOpen(false)}>
        <Txt variant="body" className="pb-3">
          {copy.marksLegend}
        </Txt>
      </Sheet>
    </Card>
  )
}

/** A token's or the market's stories of the last 48 h, newest first; a headline is a publication's report (1.44.0). */
function NewsCard({ card, context }: { card: Extract<AgentCard, { kind: 'news' }>; context: CardContext }) {
  const { copy, locale, now } = context
  return (
    <Card className="gap-3">
      <View className="gap-0.5">
        <View className="flex-row items-center gap-2">
          <Txt variant="labelSm" tone="faint" caps className="flex-1">
            {card.symbol ? copy.cardNews(card.symbol) : copy.cardNewsMarket}
          </Txt>
          {card.state !== 'current' ? <Chip label={copy.state[card.state]} tone={STATE_TONE[card.state]} /> : null}
          <HelpDot title={card.symbol ? copy.cardNews(card.symbol) : copy.cardNewsMarket} body={copy.newsReport} />
        </View>
        <Txt variant="labelSm" tone="faint">
          {copy.newsDay(card.day.stories, card.day.sources)}
        </Txt>
      </View>
      {card.items.length === 0 ? (
        <Txt variant="ui" tone="muted">
          {copy.newsNone}
        </Txt>
      ) : (
        <View className="gap-3">
          {card.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="link"
              accessibilityLabel={`${item.title}, ${item.source}`}
              onPress={() => openLink(item.url)}
              className="gap-1 active:opacity-80"
            >
              <Txt variant="ui" numberOfLines={3}>
                {item.title}
              </Txt>
              <Txt variant="labelSm" tone="faint">
                {[item.source, formatMoment(item.publishedAt, now, locale), item.also > 0 ? copy.newsAlso(item.also) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            </Pressable>
          ))}
        </View>
      )}
      <Txt variant="labelSm" tone="faint">
        {copy.newsCollected(formatMoment(card.collectedAt, now, locale))}
      </Txt>
    </Card>
  )
}

/**
 * One card of an assistant turn. Every figure on it is a figure a tool read,
 * with its state; a draft is a draft — its button opens the place where the
 * person acts (the builder, Trade's own Review), and says that nothing was
 * saved or signed. The button is orange only as the screen's one action
 * (`lead`); otherwise it is quiet.
 */
export function AgentCardView({ card, context, lead = false }: { card: AgentCard; context: CardContext; lead?: boolean }) {
  const { copy, plans, locale, now, metrics, onOpen, nameOf } = context
  const path = destinationOfCard(card)
  const open = path ? () => onOpen(path) : null
  const variant = lead ? 'primary' : 'secondary'
  switch (card.kind) {
    case 'market':
      return (
        <Card className="gap-3">
          <Head
            kind={copy.card.market}
            title={`${card.symbol} · ${card.name}`}
            meta={card.verified ? null : copy.unverified}
            onPress={open}
          />
          <Figures figures={card.figures} copy={copy} />
        </Card>
      )
    case 'stock':
      return (
        <Card className="gap-3">
          <Head kind={copy.card.stock} title={`${card.symbol} · ${card.name}`} meta={card.issuer.label} onPress={open} />
          <Figures figures={card.figures} copy={copy} />
        </Card>
      )
    case 'evidence':
      return (
        <Card className="gap-3">
          <Head kind={copy.card.evidence} title={`${card.window}`} meta={card.attribution?.text ?? null} onPress={open} />
          {card.figures.length > 0 ? (
            <Figures figures={card.figures} copy={copy} />
          ) : (
            <Txt variant="ui" tone="muted">
              {card.reason ?? copy.insufficient}
            </Txt>
          )}
        </Card>
      )
    case 'holdings': {
      const shown = card.rows.slice(0, 6)
      const more = card.rows.length - shown.length
      const read = copy.tokenRead[card.tokenRead]
      return (
        <Card className="gap-2">
          <Head
            kind={copy.card.holdings}
            title={copy.positions(card.rows.length)}
            meta={[read, card.unpriced > 0 ? copy.unpriced(card.unpriced) : ''].filter(Boolean).join(' · ') || null}
            onPress={open}
          />
          {shown.map((row, index) => (
            <View
              key={row.mint}
              className={cn('flex-row items-center gap-3 py-1.5', index === shown.length - 1 ? '' : 'border-b border-line')}
            >
              <Txt variant="ui" className="w-20" numberOfLines={1}>
                {row.symbol}
              </Txt>
              <Txt variant="data" className="flex-1" numberOfLines={1}>
                {row.amount}
              </Txt>
              <Txt variant="data" tone="muted" numberOfLines={1}>
                {row.priceUsd === null ? DASH : formatPrice(row.priceUsd, locale)}
              </Txt>
              {row.plans.length > 0 ? <Chip label={copy.hasPlan} tone="brand" /> : null}
            </View>
          ))}
          {more > 0 ? (
            <Txt variant="labelSm" tone="faint">
              {copy.moreRows(more)}
            </Txt>
          ) : null}
        </Card>
      )
    }
    case 'plan':
      return (
        <Card className="gap-3">
          <Head
            kind={copy.card.plan}
            title={`${card.symbol} · ${copy.version(card.version)}`}
            meta={plans.status[card.status]}
            onPress={open}
          />
          <Figures figures={card.figures} copy={copy} />
          {card.review && card.review.failed.length > 0 ? (
            <View className="gap-1.5">
              {card.review.failed.map((check) => (
                <View key={check.id} className="flex-row flex-wrap items-center gap-1.5">
                  <Chip label={copy.didNotPass} tone={check.outcome === 'fail' ? 'danger' : 'warning'} />
                  <Txt variant="labelSm" tone="muted" className="flex-1">
                    {`${plans.check[check.id] ?? check.id} · ${check.expected}${check.actual ? ` · ${check.actual}` : ''}`}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      )
    case 'note':
      return (
        <Card className="gap-2">
          <Head kind={copy.card.note} title={card.title} meta={formatMoment(card.createdAt, now, locale)} onPress={open} />
          {card.reason ? (
            <Txt variant="ui" tone="muted" numberOfLines={4}>
              {card.reason}
            </Txt>
          ) : null}
        </Card>
      )
    case 'comparison': {
      const width = `${100 / Math.max(1, card.columns.length)}%` as const
      return (
        <Card className="gap-3">
          <Head kind={copy.card.comparison} title={card.title} onPress={open} />
          {/* The columns named once; each row is a fact across them, a figure in the data face, words in the interface face. */}
          <View className="flex-row border-b border-line pb-2">
            {card.columns.map((column) => (
              <Txt key={column.id} variant="ui" numberOfLines={1} className="pr-3" style={{ width }}>
                {column.label}
              </Txt>
            ))}
          </View>
          {card.rows.map((row) => (
            <View key={row.label} className="gap-1">
              <Txt variant="labelSm" tone="faint" caps>
                {row.label}
              </Txt>
              <View className="flex-row">
                {row.cells.map((cell, index) => (
                  <Txt
                    key={index}
                    variant={/\d/.test(cell.text) ? 'data' : 'ui'}
                    tone={cell.established ? 'fg' : 'faint'}
                    numberOfLines={3}
                    className="pr-3"
                    style={{ width }}
                  >
                    {cell.text}
                  </Txt>
                ))}
              </View>
            </View>
          ))}
          {card.note ? (
            <Txt variant="labelSm" tone="faint">
              {card.note}
            </Txt>
          ) : null}
        </Card>
      )
    }
    case 'planDraft': {
      const rules = card.rules
      const entry = rules?.entry.pricePerShare ?? card.prefill.entryUsd
      const maxPrice = rules ? rules.entry.maxPricePerShare : card.prefill.maxPriceUsd
      const invalidation = rules?.risk.invalidationPerShare ?? card.prefill.invalidationUsd
      const risk = rules?.risk.plannedRiskUsd ?? card.prefill.riskUsd
      const budget = rules?.capital.budgetUsd ?? card.prefill.budgetUsd
      return (
        <Card level="elevated" className="gap-3 border-brand-line">
          <Head
            kind={copy.card.planDraft}
            title={`${card.asset.symbol}${card.asset.underlying.name ? ` · ${card.asset.underlying.name}` : ''}`}
            help={copy.boundary}
          />
          <View className="flex-row flex-wrap" style={{ rowGap: 10 }}>
            <Fact label={copy.entry} value={entry === null ? DASH : formatPrice(entry, locale)} />
            <Fact label={copy.maxPrice} value={maxPrice === null ? DASH : formatPrice(maxPrice, locale)} />
            <Fact label={copy.invalidation} value={invalidation === null ? DASH : formatPrice(invalidation, locale)} />
            <Fact label={copy.plannedRisk} value={risk === null ? DASH : formatUsd(risk, locale)} />
            <Fact label={copy.budget} value={budget === null ? DASH : formatUsd(budget, locale)} />
            <Fact
              label={copy.size}
              value={card.sizing ? copy.sizeValue(formatAmount(card.sizing.units, 6, locale), card.asset.symbol) : DASH}
            />
          </View>
          <View>
            <Disclosure
              label={copy.issues(card.issues.length)}
              title={copy.issues(card.issues.length)}
              lines={card.issues.map((issue) => issue.message)}
            />
            <Disclosure
              label={copy.assumptions(card.assumptions.length)}
              title={copy.assumptionsTitle}
              lines={card.assumptions}
            />
          </View>
          {open ? <Button title={copy.openDraft} variant={variant} onPress={open} /> : null}
        </Card>
      )
    }
    case 'monitoringDraft': {
      const metric = metricOf(metrics, card.condition.metric)
      const flags = { present: plans.flagPresent, renounced: plans.flagRenounced }
      const rule = `${metricLabel(metric, card.condition.metric, locale)} ${copy.operator[card.condition.operator]} ${thresholdText(metric, card.condition.threshold, flags, locale)} · ${card.condition.window}`
      return (
        <Card level="elevated" className="gap-3 border-brand-line">
          <Head kind={copy.card.monitoringDraft} title={card.subject.symbol} help={copy.boundary} />
          <View className="gap-1.5">
            <Txt variant="ui">{rule}</Txt>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Chip label={copy.mode[card.condition.mode]} tone={card.condition.mode === 'required' ? 'brand' : 'neutral'} />
              <Txt variant="labelSm" tone="faint">
                {card.observed && card.observed.state !== 'unavailable' && card.observed.state !== 'unknown'
                  ? copy.observedNow(figureView(card.observed).value)
                  : copy.noObservation}
              </Txt>
            </View>
          </View>
          <Disclosure label={copy.assumptions(card.assumptions.length)} title={copy.assumptionsTitle} lines={card.assumptions} />
          {open ? (
            <Button
              title={card.subject.kind === 'plan' ? copy.addRuleToPlan(card.subject.symbol) : copy.startPlanWithRule}
              variant={variant}
              onPress={open}
            />
          ) : null}
        </Card>
      )
    }
    case 'tradeDraft': {
      const buy = card.side === 'BUY'
      // A Buy opens the company's page first; the ticket with Ryntra's sum is a quiet door under it (one version.
      const ticket = buy ? ticketOfCard(card) : null
      return (
        <Card level="elevated" className="gap-3 border-brand-line">
          <Head
            kind={copy.card.tradeDraft}
            title={`${copy.side[card.side]} ${card.symbol}${card.amountUsd !== null ? ` · ${formatUsd(card.amountUsd, locale)}` : ''}`}
            meta={card.plan ? copy.underPlan(card.plan.version) : null}
            help={copy.boundary}
          />
          {open ? (
            <Button
              title={
                buy ? copy.openAsset(nameOf(card.mint) ?? card.symbol) : copy.openTicket(card.side, card.symbol)
              }
              variant={variant}
              onPress={open}
            />
          ) : null}
          {ticket ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.openTicket(card.side, card.symbol)}
              onPress={() => onOpen(ticket)}
              hitSlop={6}
              className="flex-row items-center justify-center gap-1.5 py-1 active:opacity-80"
            >
              <Icon name="swap-horizontal-outline" size={16} color="muted" />
              <Txt variant="ui" tone="muted">
                {copy.openTicket(card.side, card.symbol)}
              </Txt>
            </Pressable>
          ) : null}
        </Card>
      )
    }
    case 'move':
      return <MoveCard card={card} context={context} />
    case 'news':
      return <NewsCard card={card} context={context} />
    default:
      return null
  }
}
