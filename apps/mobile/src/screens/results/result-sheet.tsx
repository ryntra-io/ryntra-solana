import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { ruleWhenLine } from '@/features/autoinvest/words'
import { explorerUrl } from '@/features/history/history-model'
import { dollarsText } from '@/features/invest/buy-model'
import { mapDeepLink } from '@/features/monitoring/deep-link'
import { NO_TRADE_LABELS, RESULTS_COPY } from '@/features/results/copy'
import {
  bpsText,
  checkWord,
  citationLabel,
  costPartText,
  costReasonText,
  legWord,
  noTradeSentence,
  occurrenceTone,
  pctText,
  positionSentence,
  realisedLine,
  reminderSum,
  shownStateOf,
  symbolOf,
  verdictOf,
  type RuleTally,
} from '@/features/results/results-model'
import { PLANS_COPY } from '@/features/plans/copy'
import type { PlanCheck, PlanMemoryFact, PlanNoTradeOutcome, PlanPositionRow, PlanResult } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAmount, formatMoment, formatUsd, shortAddress } from '@/utils/format'

export type Opened =
  | Readonly<{ kind: 'rule'; tally: RuleTally }>
  | Readonly<{ kind: 'position'; row: PlanPositionRow }>
  | Readonly<{ kind: 'outcome'; outcome: PlanNoTradeOutcome }>
  | Readonly<{ kind: 'operation'; result: PlanResult }>
  | Readonly<{ kind: 'memory'; fact: PlanMemoryFact; text: string }>

type Handlers = Readonly<{
  now: number
  onOpenPlan: (planId: string) => void
  onOpenAsset: (mint: string) => void
  onOpenTransaction: (url: string) => void
  onOpenPath: (path: string) => void
}>

const DASH = '—'

function Heading({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps className="pb-1 pt-4" accessibilityRole="header">
      {children}
    </Txt>
  )
}

/** A check of the plan: its outcome as a mark, the plan's word, and the figures it was judged on. */
function CheckRow({ check, last }: { check: PlanCheck; last: boolean }) {
  const locale = useLocale()
  const icon = check.outcome === 'pass' ? 'checkmark-circle' : check.outcome === 'fail' ? 'close-circle' : 'help-circle'
  const color = check.outcome === 'pass' ? 'successInk' : check.outcome === 'fail' ? 'dangerInk' : 'fgMuted'
  return (
    <View className={`gap-0.5 py-2.5 ${last ? '' : 'border-b border-line'}`}>
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size={16} color={color} />
        <Txt variant="ui" className="flex-1">
          {checkWord(check.id, locale)}
        </Txt>
      </View>
      <Txt variant="data" tone="faint" className="pl-6">
        {check.actual ? `${check.expected} · ${check.actual}` : check.expected}
      </Txt>
    </View>
  )
}

function TransactionRow({ signature, onOpen, last }: { signature: string; onOpen: (url: string) => void; last?: boolean }) {
  const copy = useCopy(RESULTS_COPY)
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${copy.transaction} ${shortAddress(signature, 6)}`}
      onPress={() => onOpen(explorerUrl(signature))}
      className={`flex-row items-center justify-between py-2.5 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <Txt variant="ui" tone="muted">
        {copy.transaction}
      </Txt>
      <View className="flex-row items-center gap-1.5">
        <Txt variant="data">{shortAddress(signature, 6)}</Txt>
        <Icon name="open-outline" size={14} color="fgMuted" />
      </View>
    </Pressable>
  )
}

/* ---- «Автоінвест»: one rule's reminders ---- */

function RuleBody({ tally, now, onOpenAsset, onOpenTransaction }: { tally: RuleTally } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  return (
    <View>
      <Heading>{copy.remindersLine(tally.reminders.length)}</Heading>
      {tally.reminders.map((occurrence, index) => {
        const last = index === tally.reminders.length - 1
        // Read against this minute, not the moment the sheet opened: a window that closes while it is open says so.
        const shown = shownStateOf(tally.rule, occurrence, now)
        const spent = occurrence.state === 'bought' ? occurrence.spentUsd : null
        return (
          <View key={occurrence.dueAt} className={`gap-1 py-2.5 ${last ? '' : 'border-b border-line'}`}>
            <View className="flex-row items-center justify-between gap-3">
              <Txt variant="ui">{formatMoment(occurrence.dueAt, now, locale)}</Txt>
              <Chip label={copy.occurrence[shown]} tone={occurrenceTone(shown)} caps={false} />
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Txt variant="ui" tone="muted">
                {occurrence.state === 'bought'
                  ? `${copy.spendLabel} ${spent === null ? DASH : formatUsd(spent, locale)}`
                  : copy.reminderFor(dollarsText(reminderSum(tally.rule, occurrence), locale))}
              </Txt>
              {occurrence.signature ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${copy.transaction} ${shortAddress(occurrence.signature, 4)}`}
                  onPress={() => onOpenTransaction(explorerUrl(occurrence.signature!))}
                  hitSlop={8}
                  className="flex-row items-center gap-1"
                >
                  <Txt variant="data" tone="faint">
                    {shortAddress(occurrence.signature, 4)}
                  </Txt>
                  <Icon name="open-outline" size={13} color="fgMuted" />
                </Pressable>
              ) : null}
            </View>
          </View>
        )
      })}
      <View className="pt-4">
        <Button title={copy.openRule} variant="secondary" onPress={() => onOpenAsset(tally.rule.asset.mint)} />
      </View>
    </View>
  )
}

/* ---- a position under a plan ---- */

function PositionBody({ row, onOpenPlan }: { row: PlanPositionRow } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  const symbol = symbolOf(row)
  const position = row.position
  const realised = position.realisedUsd
  const why = realisedLine(position, locale)
  const units = (value: string) => `${formatAmount(Number(value), 6, locale)} ${symbol}`
  return (
    <View>
      <Txt variant="ui" tone="muted" className="pb-1">
        {positionSentence(position, symbol, locale)}
      </Txt>
      <FactRow label={copy.costBasis} value={formatUsd(position.costBasisUsd, locale)} />
      <FactRow label={copy.proceeds} value={formatUsd(position.proceedsUsd, locale)} />
      <FactRow label={copy.feesPaid} value={formatUsd(position.feesUsd, locale)} />
      <FactRow
        label={copy.realised}
        value={formatUsd(realised, locale)}
        tone={realised === null ? 'faint' : realised > 0 ? 'success' : realised < 0 ? 'danger' : 'fg'}
        detail={realised === null ? null : copy.realisedMethod}
        last={!why}
      />
      {why ? (
        <Txt variant="labelSm" tone="faint" className="pt-1.5">
          {why}
        </Txt>
      ) : null}
      <Heading>{copy.held}</Heading>
      <FactRow label={copy.bought} value={units(position.unitsIn)} />
      <FactRow label={copy.sold} value={units(position.unitsOut)} />
      <FactRow label={copy.held} value={units(position.unitsHeld)} />
      <FactRow label={copy.version} value={`${row.version}`} last />
      <View className="pt-4">
        <Button title={copy.openPlan} variant="secondary" onPress={() => onOpenPlan(row.planId)} />
      </View>
    </View>
  )
}

/* ---- a plan that made no trade ---- */

function OutcomeBody({ outcome, now, onOpenPlan }: { outcome: PlanNoTradeOutcome } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const plans = useCopy(PLANS_COPY)
  const locale = useLocale()
  return (
    <View>
      <Txt variant="ui" tone="muted" className="pb-1">
        {noTradeSentence(outcome, locale)}
      </Txt>
      {outcome.blockedBy ? (
        <>
          <FactRow label={copy.theRule} value={checkWord(outcome.blockedBy, locale)} mono={false} />
          <FactRow label={copy.yourBound} value={outcome.expected ?? DASH} />
          <FactRow label={copy.whatWasFound} value={outcome.found ?? DASH} />
        </>
      ) : null}
      {outcome.reviews > 0 ? <FactRow label={copy.reviewsCount} value={`${outcome.reviews}`} /> : null}
      <FactRow label={copy.status} value={plans.status[outcome.status]} mono={false} detail={formatMoment(outcome.observedAt, now, locale)} last />
      <View className="pt-4">
        <Button title={copy.openPlan} variant="secondary" onPress={() => onOpenPlan(outcome.planId)} />
      </View>
    </View>
  )
}

/* ---- one operation against its plan ---- */

function OperationBody({ result, now, onOpenPlan, onOpenTransaction }: { result: PlanResult } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  const costs = result.costs
  const actual = result.actual
  const exit = result.exit
  const verdict = verdictOf(result, locale)
  const part = (value: Parameters<typeof costPartText>[0]) => costPartText(value, locale) ?? DASH
  return (
    <View>
      <View className="flex-row flex-wrap items-center gap-1.5 pb-2">
        <Chip label={legWord(result, locale)} caps={false} />
        <Chip label={verdict.word} tone={verdict.tone} caps={false} />
      </View>
      {actual.matchedBy === 'asset' ? (
        <Txt variant="ui" tone="muted" className="pb-1">
          {copy.matchedByAsset}
        </Txt>
      ) : null}
      <FactRow label={copy.plannedPrice} value={formatUsd(costs.plannedPerUnitUsd, locale)} />
      <FactRow label={copy.quotedPrice} value={formatUsd(costs.quotedPerUnitUsd, locale)} />
      <FactRow label={copy.filledPrice} value={formatUsd(costs.filledPerUnitUsd, locale)} />
      <FactRow
        label={actual.leg === 'exit' ? copy.proceeds : copy.spendLabel}
        value={formatUsd(actual.leg === 'exit' ? actual.proceedsUsd : actual.usd, locale)}
        detail={formatMoment(actual.settledAt, now, locale)}
        last
      />

      {exit ? (
        <>
          <Heading>{copy.exitAdherence}</Heading>
          <Txt variant="labelSm" tone="faint" className="pb-1">
            {copy.ruledBy(exit.ruledByVersion === null ? DASH : `${exit.ruledByVersion}`)}
          </Txt>
          {exit.checks.map((check, index) => (
            <CheckRow key={check.id} check={check} last={index === exit.checks.length - 1} />
          ))}
          {exit.notBackdated ? (
            <Txt variant="labelSm" tone="faint" className="pt-1.5">
              {copy.laterRule}
            </Txt>
          ) : null}
        </>
      ) : null}

      <Heading>{copy.difference}</Heading>
      <FactRow label={copy.marketMove} value={part(costs.marketMove)} detail={costReasonText(costs.marketMove.reason, locale)} />
      <FactRow label={copy.executionPart} value={part(costs.execution)} detail={costReasonText(costs.execution.reason, locale)} />
      <FactRow label={copy.feePart} value={part(costs.fee)} detail={costReasonText(costs.fee.reason, locale)} last />

      <Heading>{copy.expectedAtReview}</Heading>
      <FactRow label={copy.spendLabel} value={formatUsd(costs.expected.quotedUsd, locale)} />
      <FactRow label={copy.slippageLabel} value={bpsText(costs.expected.slippageBps, locale) ?? DASH} />
      <FactRow label={copy.feeLabel} value={bpsText(costs.expected.feeBps, locale) ?? DASH} />
      <FactRow label={copy.priceImpactLabel} value={pctText(costs.expected.priceImpactPct, locale) ?? DASH} last />
      <Txt variant="labelSm" tone="faint" className="pt-1.5">
        {copy.estimateNote}
      </Txt>

      {result.checks.length > 0 ? (
        <>
          <Heading>{copy.theChecks}</Heading>
          {result.checks.map((check, index) => (
            <CheckRow key={check.id} check={check} last={index === result.checks.length - 1} />
          ))}
        </>
      ) : null}

      <View className="pt-3">
        <TransactionRow signature={actual.signature} onOpen={onOpenTransaction} last />
      </View>
      <View className="pt-3">
        <Button title={copy.openPlan} variant="secondary" onPress={() => onOpenPlan(result.planId)} />
      </View>
    </View>
  )
}

/* ---- a memory fact: what it stands on ---- */

function MemoryBody({ fact, text, now, onOpenPath }: { fact: PlanMemoryFact; text: string } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  return (
    <View>
      <Txt variant="body" className="pb-2">
        {text}
      </Txt>
      <Heading>{copy.sources}</Heading>
      {fact.cites.map((cite, index) => {
        const mapped = cite.href ? mapDeepLink(cite.href) : null
        const path = mapped?.kind === 'native' ? mapped.path : null
        const last = index === fact.cites.length - 1
        const label = citationLabel(cite, locale)
        const at = cite.at ? formatMoment(cite.at, now, locale) : null
        return (
          <Pressable
            key={`${cite.kind}:${cite.id}`}
            accessibilityRole={path ? 'button' : 'text'}
            accessibilityLabel={[label, at].filter(Boolean).join(', ')}
            disabled={!path}
            onPress={() => path && onOpenPath(path)}
            className={`flex-row items-center justify-between gap-3 py-2.5 active:bg-hover ${last ? '' : 'border-b border-line'}`}
          >
            <Txt variant="ui">{label}</Txt>
            <View className="flex-row items-center gap-1.5">
              {at ? (
                <Txt variant="labelSm" tone="faint">
                  {at}
                </Txt>
              ) : null}
              {path ? <Icon name="chevron-forward" size={16} color="fgMuted" /> : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The one sheet Results opens: the figures behind a row, one tap deep. */
export function ResultSheet({ opened, onClose, ...handlers }: { opened: Opened | null; onClose: () => void } & Handlers) {
  const copy = useCopy(RESULTS_COPY)
  const noTrade = useCopy(NO_TRADE_LABELS)
  const locale = useLocale()
  let title = ''
  let subtitle: string | undefined
  let body = null
  if (opened?.kind === 'rule') {
    title = opened.tally.rule.name
    subtitle = ruleWhenLine(opened.tally.rule, locale)
    body = <RuleBody tally={opened.tally} {...handlers} />
  } else if (opened?.kind === 'position') {
    title = symbolOf(opened.row)
    subtitle = copy.positionsTitle
    body = <PositionBody row={opened.row} {...handlers} />
  } else if (opened?.kind === 'outcome') {
    title = symbolOf(opened.outcome)
    subtitle = noTrade[opened.outcome.reason]
    body = <OutcomeBody outcome={opened.outcome} {...handlers} />
  } else if (opened?.kind === 'operation') {
    title = symbolOf(opened.result)
    subtitle = formatMoment(opened.result.actual.settledAt, handlers.now, locale)
    body = <OperationBody result={opened.result} {...handlers} />
  } else if (opened?.kind === 'memory') {
    title = copy.memoryTitle
    body = <MemoryBody fact={opened.fact} text={opened.text} {...handlers} />
  }
  return (
    <Sheet visible={opened !== null} title={title} subtitle={subtitle} onClose={onClose} scroll>
      {body}
    </Sheet>
  )
}
