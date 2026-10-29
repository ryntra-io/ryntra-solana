import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DoorRow } from '@/components/door-row'
import { FactRow } from '@/components/fact-row'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { contextParam } from '@/features/agent/context'
import { creditsText } from '@/features/assistant/credits-model'
import { PLAN_COPY, type PlanCopy } from '@/features/assistant/plan-copy'
import { useAssistantPlan, usePlanAction, type PlanAction } from '@/features/assistant/plans'
import {
  editFormOf,
  editRequest,
  endLineOf,
  findingGroups,
  planButtons,
  planFailureOf,
  type ComposeNeed,
  type EditForm,
  type PlanButton,
  type PlanFailure,
} from '@/features/assistant/plans-model'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import type {
  AgentContext,
  AssistantPlan,
  AssistantPlanFinding,
  AssistantPlanResponse,
  AssistantPlanTrade,
  Session,
} from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { DASH, formatAmount, formatMoment, formatPrice, formatUsd } from '@/utils/format'

import { failureLine, PlanStateChip } from './plans-panel'

/** What composing cost, carried from the composer: `part` — the critic did not answer, so the plan's part alone. */
export type PlanSpent = Readonly<{ credits: number; part: boolean }>

/**
 * `/ryn-plan/<id>` — one plan Ryntra composed with the person (AI-11, 1.61.0): its thesis and levels with who set each,
 * the fees and both outcomes one tap deep, the critic's findings grouped, Нагляд's line, «План проти реальності», and
 * the person's words the plan allows now. Nothing here buys: an approved plan opens as the person's own plan, where
 * the Review and the wallet's signature stay.
 */
export function AssistantPlanScreen({ planId, spent = null }: { planId: string; spent?: PlanSpent | null }) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const copy = useCopy(PLAN_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const account = useAccount()
  const read = useAssistantPlan(account.session, planId, locale)
  const plan = read.data?.plan ?? null
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ryn'))

  const askContext: AgentContext | null = plan
    ? plan.tradingPlan && /^plan_[0-9a-f]{32}$/.test(plan.tradingPlan.id)
      ? { kind: 'plan', planId: plan.tradingPlan.id }
      : { kind: 'asset', mint: plan.mint, symbol: plan.symbol }
    : null

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={plan ? copy.title(plan.symbol) : copy.groupTitle}
        subtitle={plan ? copy.version(plan.version) : undefined}
        onBack={back}
        backLabel={shared.back}
        right={
          askContext ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.ask}
              onPress={() => router.push({ pathname: '/ryn', params: { context: contextParam(askContext) } })}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
            >
              <Icon name="chatbubble-ellipses-outline" size={20} color="muted" />
            </Pressable>
          ) : undefined
        }
      />
      <SessionGate what={copy.groupTitle}>
        {account.session ? (
          <PlanBody session={account.session} planId={planId} spent={spent} read={read} copy={copy} locale={locale} />
        ) : null}
      </SessionGate>
      <View style={{ height: insets.bottom }} />
    </View>
  )
}

type PlanRead = ReturnType<typeof useAssistantPlan>

function PlanBody({
  session,
  planId,
  spent,
  read,
  copy,
  locale,
}: {
  session: Session
  planId: string
  spent: PlanSpent | null
  read: PlanRead
  copy: PlanCopy
  locale: Locale
}) {
  const shared = useSharedCopy()
  const now = useNow(60_000)
  const action = usePlanAction(session, planId, locale)
  const [note, setNote] = useState<string | null>(
    spent && spent.credits > 0
      ? spent.part
        ? copy.spentPart(creditsText(spent.credits, locale))
        : copy.spent(creditsText(spent.credits, locale))
      : null,
  )
  const [failure, setFailure] = useState<PlanFailure | null>(null)
  const [pressed, setPressed] = useState<PlanButton | null>(null)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  if (read.isPending) {
    return (
      <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar">
        <Skeleton className="h-24 rounded-sm" />
        <Skeleton className="h-48 rounded-sm" />
        <Skeleton className="h-32 rounded-sm" />
      </View>
    )
  }
  if (!read.data) {
    const gone = planFailureOf(read.error).kind === 'notFound'
    return (
      <StateView
        icon={gone ? 'document-outline' : 'alert-circle-outline'}
        tone={gone ? 'neutral' : 'danger'}
        title={gone ? copy.notFound : copy.loadFailed}
        action={gone ? undefined : { title: shared.tryAgain, onPress: () => void read.refetch(), loading: read.isFetching }}
      />
    )
  }

  const { plan, prices } = read.data

  const run = (button: PlanButton, payload: PlanAction, done?: () => void) => {
    if (action.isPending) return
    setPressed(button)
    setFailure(null)
    setNote(null)
    action.mutate(payload, {
      onSuccess: (answer: AssistantPlanResponse) => {
        done?.()
        const paid = answer.spent && answer.spent.credits > 0 ? answer.spent : null
        if (paid) {
          const words = creditsText(paid.credits, locale)
          setNote(paid.critic === 'model' ? copy.spent(words) : copy.spentPart(words))
        }
      },
      onError: (error) => {
        done?.()
        setFailure(planFailureOf(error))
      },
      onSettled: () => setPressed(null),
    })
  }

  const press = (button: PlanButton) => {
    switch (button) {
      case 'approveWatch':
      case 'watch':
        return run(button, { kind: 'state', to: 'watching', ifVersion: plan.version })
      case 'approve':
        return run(button, { kind: 'state', to: 'approved', ifVersion: plan.version })
      case 'recheck':
        return run(button, { kind: 'recheck', ifVersion: plan.version, acceptCredits: prices.recheck })
      case 'edit':
        return setEditing(true)
      case 'cancel':
        return setCancelling(true)
    }
  }

  const buttons = planButtons(plan, prices)
  const buttonTitle = (button: PlanButton): string =>
    button === 'recheck' ? copy.recheck(creditsText(prices.recheck, locale)) : copy[button]

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-2"
      keyboardShouldPersistTaps="handled"
    >
      <ThesisCard plan={plan} copy={copy} now={now} locale={locale} note={note} />
      <LevelsCard plan={plan} copy={copy} locale={locale} />
      <CriticCard plan={plan} copy={copy} now={now} locale={locale} />

      {buttons.length > 0 ? (
        <View className="gap-2">
          {buttons.map((button, index) => (
            <Button
              key={button}
              title={buttonTitle(button)}
              variant={index === 0 ? 'primary' : button === 'cancel' ? 'ghost' : 'secondary'}
              loading={action.isPending && pressed === button}
              disabled={action.isPending && pressed !== button}
              onPress={() => press(button)}
            />
          ))}
        </View>
      ) : null}
      {failure ? (
        <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
          {failureLine(failure, copy)}
        </Txt>
      ) : null}

      <OwnPlanCard plan={plan} copy={copy} now={now} locale={locale} />
      {plan.reality ? <RealityCard reality={plan.reality} copy={copy} now={now} locale={locale} /> : null}
      <MoreFold plan={plan} copy={copy} now={now} locale={locale} />

      <EditSheet
        key={`edit-${plan.version}`}
        visible={editing}
        plan={plan}
        copy={copy}
        locale={locale}
        busy={action.isPending}
        onClose={() => setEditing(false)}
        onSave={(request) => run('edit', { kind: 'update', request }, () => setEditing(false))}
        onSame={() => {
          setEditing(false)
          setNote(copy.nothingChanged)
        }}
      />
      <Sheet visible={cancelling} title={copy.cancelTitle} onClose={() => setCancelling(false)}>
        <View className="gap-3 pb-3">
          <Txt variant="body" tone="muted">
            {copy.cancelBody}
          </Txt>
          <Button
            title={copy.cancel}
            variant="danger"
            loading={action.isPending && pressed === 'cancel'}
            onPress={() =>
              run('cancel', { kind: 'state', to: 'cancelled', ifVersion: plan.version }, () => setCancelling(false))
            }
          />
          <Button title={copy.keep} variant="secondary" disabled={action.isPending} onPress={() => setCancelling(false)} />
        </View>
      </Sheet>
    </ScrollView>
  )
}

/** The state, the thesis with why now, why an ended plan ended, and what the last paid call cost. */
function ThesisCard({
  plan,
  copy,
  now,
  locale,
  note,
}: {
  plan: AssistantPlan
  copy: PlanCopy
  now: number
  locale: Locale
  note: string | null
}) {
  const body = plan.current.body
  const end = endLineOf(plan)
  return (
    <Card className="gap-2">
      <View className="flex-row items-center gap-2">
        <PlanStateChip state={plan.state} copy={copy} />
        <Txt variant="labelSm" tone="faint" className="flex-1">
          {copy.updated(formatMoment(plan.updatedAt, now, locale))}
        </Txt>
        <HelpDot title={copy.howTitle} body={[copy.howLead, copy.noBuy]} />
      </View>
      {end ? (
        <Txt variant="ui" tone={end === 'broken' ? 'danger' : 'muted'}>
          {end === 'broken' ? copy.brokenLine : end === 'done' ? copy.doneLine : copy.expiredLine}
        </Txt>
      ) : null}
      <Txt variant="body" numberOfLines={4} selectable>
        {body.thesis.text}
      </Txt>
      {body.thesis.whyNow ? (
        <Txt variant="ui" tone="muted">
          {`${copy.whyNow}: ${body.thesis.whyNow}`}
        </Txt>
      ) : null}
      {note ? (
        <Txt variant="labelSm" tone="faint">
          {note}
        </Txt>
      ) : null}
    </Card>
  )
}

/** The levels with who set each as a small mark under the figure, the money that is the person's, the size; the fees one tap deep. */
function LevelsCard({ plan, copy, locale }: { plan: AssistantPlan; copy: PlanCopy; locale: Locale }) {
  const [feesOpen, setFeesOpen] = useState(false)
  const body = plan.current.body
  const fees = body.fees
  const targetAuthors = [...new Set(body.targets.map((row) => copy.by[row.by]))].join(' · ')
  const ratio =
    fees.rewardToRisk === null ? null : copy.ratio(formatAmount(fees.rewardToRisk, 2, locale))
  return (
    <Card className="gap-0">
      <View className="flex-row items-center gap-2 pb-1">
        <Txt variant="labelSm" tone="faint" caps className="flex-1">
          {copy.levelsTitle}
        </Txt>
        <HelpDot title={copy.byTitle} body={copy.byBody} />
      </View>
      <FactRow
        label={copy.entryLine}
        value={formatPrice(body.entry.priceUsd, locale)}
        detail={`${copy.upTo(formatPrice(body.entry.maxPriceUsd, locale))} · ${copy.by[body.entry.by]}`}
      />
      <FactRow
        label={copy.invalidationLine}
        value={formatPrice(body.invalidation.priceUsd, locale)}
        detail={copy.by[body.invalidation.by]}
      />
      <FactRow
        label={copy.targetsLine}
        value={body.targets.length > 0 ? body.targets.map((row) => formatPrice(row.priceUsd, locale)).join(' · ') : DASH}
        detail={targetAuthors || null}
      />
      <FactRow label={copy.lossLimit} value={formatUsd(body.lossLimit.riskUsd, locale)} />
      <FactRow label={copy.budgetLine} value={formatUsd(body.lossLimit.budgetUsd, locale)} />
      <FactRow
        label={copy.size}
        value={`${formatAmount(body.sizing.units, 6, locale)} ${plan.symbol}`}
        detail={formatUsd(body.sizing.notionalUsd, locale)}
        last={body.thesis.horizonDays === null}
      />
      {body.thesis.horizonDays !== null ? (
        <FactRow label={copy.horizonLine} value={copy.horizon(body.thesis.horizonDays)} mono={false} last />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.outcomes}
        onPress={() => setFeesOpen(true)}
        className="min-h-12 flex-row items-center gap-3 border-t border-line pt-3 active:opacity-80"
      >
        <Txt variant="ui" className="flex-1">
          {copy.outcomes}
        </Txt>
        <Txt variant="data" tone="muted">
          {ratio ?? formatUsd(fees.totalUsd, locale)}
        </Txt>
        <Icon name="chevron-forward" size={16} color="fgMuted" />
      </Pressable>
      <Sheet visible={feesOpen} title={copy.outcomes} subtitle={copy.estimate} onClose={() => setFeesOpen(false)}>
        <View className="pb-3">
          <FactRow label={copy.notional} value={formatUsd(fees.notionalUsd, locale)} />
          <FactRow label={copy.fees} value={formatUsd(fees.totalUsd, locale)} />
          <FactRow label={copy.ryntraFee} value={formatUsd(fees.ryntraFeeUsd, locale)} />
          <FactRow label={copy.networkFee} value={formatUsd(fees.networkUsd, locale)} />
          <FactRow label={copy.lossAt} value={formatUsd(fees.lossAtInvalidationUsd, locale)} />
          <FactRow label={copy.rewardAt} value={formatUsd(fees.rewardAtTargetUsd, locale)} />
          <FactRow label={copy.rewardToRisk} value={ratio ?? DASH} last />
        </View>
      </Sheet>
    </Card>
  )
}

function FindingList({ title, rows, tone }: { title: string; rows: readonly AssistantPlanFinding[]; tone: 'danger' | 'warning' | 'neutral' }) {
  if (rows.length === 0) return null
  return (
    <View className="gap-2">
      <View className="flex-row">
        <Chip label={title} tone={tone} caps={false} />
      </View>
      {rows.map((row) => (
        <Txt key={row.id} variant="body" selectable>
          {row.text}
        </Txt>
      ))}
    </View>
  )
}

/** The critic on this version: who checked it and when, its summary, «Серйозне» and «Виправити»; «Знати» and what was not checked folded. */
function CriticCard({ plan, copy, now, locale }: { plan: AssistantPlan; copy: PlanCopy; now: number; locale: Locale }) {
  const [open, setOpen] = useState(false)
  const critic = plan.current.critic
  const groups = findingGroups(critic.findings)
  const folded = groups.note.length + critic.gaps.length
  return (
    <Card className="gap-3">
      <View className="gap-1">
        <Txt variant="labelSm" tone="faint" caps>
          {critic.by === 'model' ? copy.criticModel : copy.criticRules}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {`${copy.criticCount(groups.major.length, groups.minor.length, groups.note.length)} · ${copy.checked(formatMoment(critic.checkedAt, now, locale))}`}
        </Txt>
      </View>
      {critic.summary ? (
        <Txt variant="body" selectable>
          {critic.summary}
        </Txt>
      ) : null}
      {groups.major.length === 0 ? (
        <Txt variant="ui" tone="muted">
          {copy.criticNone}
        </Txt>
      ) : null}
      <FindingList title={copy.major} rows={groups.major} tone="danger" />
      <FindingList title={copy.minor} rows={groups.minor} tone="warning" />
      {folded > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          className="min-h-10 flex-row items-center gap-2 active:opacity-80"
        >
          <Txt variant="ui" tone="muted" className="flex-1">
            {open ? copy.hide : copy.moreFindings(folded)}
          </Txt>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
        </Pressable>
      ) : null}
      {open ? (
        <View className="gap-3">
          <FindingList title={copy.note} rows={groups.note} tone="neutral" />
          {critic.gaps.length > 0 ? (
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.gaps}
              </Txt>
              {critic.gaps.map((gap, index) => (
                <Txt key={`${index}:${gap}`} variant="ui" tone="muted">
                  {gap}
                </Txt>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}

/** The person's own plan once approved: Нагляд's line, and the door to it, its Review and the wallet's signature. */
function OwnPlanCard({ plan, copy, now, locale }: { plan: AssistantPlan; copy: PlanCopy; now: number; locale: Locale }) {
  const router = useRouter()
  const watchLine = plan.watch.line
    ? [copy.watchLine(plan.watch.line), plan.watch.lastCheckedAt ? formatMoment(plan.watch.lastCheckedAt, now, locale) : null]
        .filter(Boolean)
        .join(' · ')
    : null
  if (!plan.tradingPlan) {
    return watchLine ? (
      <Txt variant="ui" tone="muted">
        {watchLine}
      </Txt>
    ) : null
  }
  const own = plan.tradingPlan
  return (
    <Card padded={false}>
      <View className="gap-1.5 px-4 pb-3 pt-4">
        <Txt variant="ui" tone="muted">
          {plan.state === 'watching' ? copy.watchingNote : copy.approvedNote}
        </Txt>
        {watchLine ? (
          <Txt variant="labelSm" tone="faint">
            {watchLine}
          </Txt>
        ) : null}
      </View>
      <View className="border-t border-line">
        <DoorRow
          icon="document-text-outline"
          label={copy.openPlan}
          value={copy.version(own.version)}
          onPress={() => router.push({ pathname: '/plans/[id]', params: { id: own.id } })}
          last
        />
      </View>
    </Card>
  )
}

const VERDICT_TONE: Readonly<Record<AssistantPlanTrade['verdict'], 'success' | 'warning' | 'neutral'>> = {
  followed: 'success',
  deviated: 'warning',
  unknown: 'neutral',
}

/** «План проти реальності»: the summary, the position, and each trade under the plan against it — its receipt and risk in words. */
function RealityCard({
  reality,
  copy,
  now,
  locale,
}: {
  reality: NonNullable<AssistantPlan['reality']>
  copy: PlanCopy
  now: number
  locale: Locale
}) {
  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Txt variant="labelSm" tone="faint" caps className="flex-1">
          {copy.reality}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {copy.position[reality.position.state]}
        </Txt>
      </View>
      {reality.summary.map((line, index) => (
        <Txt key={`${index}:${line}`} variant="body" selectable>
          {line}
        </Txt>
      ))}
      {reality.trades.map((trade) => (
        <View key={trade.signature} className="gap-1.5 border-t border-line pt-3">
          <View className="flex-row items-center gap-2">
            <Chip label={copy.verdict[trade.verdict]} tone={VERDICT_TONE[trade.verdict]} caps={false} />
            <Txt variant="labelSm" tone="faint" className="flex-1 text-right">
              {formatMoment(trade.at, now, locale)}
            </Txt>
          </View>
          <Fold title={copy.receipt} lines={trade.receipt} />
          <Fold title={copy.riskNow} lines={trade.risk} />
        </View>
      ))}
    </Card>
  )
}

function Fold({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <View className="gap-1">
      <Txt variant="labelSm" tone="faint" caps>
        {title}
      </Txt>
      {lines.map((line, index) => (
        <Txt key={`${index}:${line}`} variant="ui">
          {line}
        </Txt>
      ))}
    </View>
  )
}

/** «Припущення, джерела, версії» — the whole thesis, the assumptions with who made each, the sources with their times, the versions and what happened. */
function MoreFold({ plan, copy, now, locale }: { plan: AssistantPlan; copy: PlanCopy; now: number; locale: Locale }) {
  const [open, setOpen] = useState(false)
  const body = plan.current.body
  const section = (title: string, children: ReactNode) => (
    <View className="gap-1.5">
      <Txt variant="labelSm" tone="faint" caps>
        {title}
      </Txt>
      {children}
    </View>
  )
  return (
    <Card className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        className="min-h-10 flex-row items-center gap-2 active:opacity-80"
      >
        <Txt variant="ui" className="flex-1">
          {copy.more}
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
      </Pressable>
      {open ? (
        <View className="gap-4">
          {section(
            copy.thesis,
            <Txt variant="ui" selectable>
              {body.thesis.text}
            </Txt>,
          )}
          {body.assumptions.length > 0
            ? section(
                copy.assumptions,
                body.assumptions.map((row, index) => (
                  <Txt key={`${index}:${row.text}`} variant="ui">
                    {`${row.text} — ${copy.who[row.by]}`}
                  </Txt>
                )),
              )
            : null}
          {body.sources.length > 0
            ? section(
                copy.sources,
                body.sources.map((source) => (
                  <Txt key={source.id} variant="ui" tone="muted">
                    {`${source.source} · ${formatMoment(source.observedAt, now, locale)}`}
                  </Txt>
                )),
              )
            : null}
          {section(
            copy.versions,
            plan.versions.map((row) => (
              <Txt key={row.n} variant="ui" tone="muted">
                {[copy.version(row.n), copy.who[row.by], formatMoment(row.createdAt, now, locale), row.reason]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            )),
          )}
          {plan.journal.length > 0
            ? section(
                copy.journal,
                plan.journal.map((row, index) => (
                  <Txt key={`${row.at}:${index}`} variant="ui" tone="muted">
                    {`${formatMoment(row.at, now, locale)} · ${copy.ev[row.event]} · ${copy.version(row.version)}`}
                  </Txt>
                )),
              )
            : null}
        </View>
      ) : null}
    </Card>
  )
}

/** What the change still needs, as one line. */
function editNeedLine(need: ComposeNeed, copy: PlanCopy, labels: Readonly<Record<string, string>>): string {
  if (need.kind === 'figure') return copy.notFigure(labels[need.field] ?? '')
  if (need.kind === 'targets') return copy.tooManyTargets
  return copy.failed
}

/** «Змінити»: the plan's figures and thesis as fields; only what differs goes, with the version read — a new version. */
function EditSheet({
  visible,
  plan,
  copy,
  locale,
  busy,
  onClose,
  onSave,
  onSame,
}: {
  visible: boolean
  plan: AssistantPlan
  copy: PlanCopy
  locale: Locale
  busy: boolean
  onClose: () => void
  onSave: (request: Extract<PlanAction, { kind: 'update' }>['request']) => void
  onSame: () => void
}) {
  const [form, setForm] = useState<EditForm>(() => editFormOf(plan.current.body, locale))
  const [need, setNeed] = useState<ComposeNeed | null>(null)
  const set = (key: keyof EditForm) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setNeed(null)
  }
  const labels: Readonly<Record<string, string>> = {
    entry: copy.entry,
    maxPrice: copy.maxPrice,
    invalidation: copy.invalidation,
    targets: copy.targets,
    risk: copy.riskField,
    budget: copy.budgetField,
  }
  const save = () => {
    const built = editRequest(plan.current.body, plan.version, form, locale)
    if (built.kind === 'same') return onSame()
    if (built.kind === 'need') return setNeed(built.need)
    onSave(built.request)
  }
  return (
    <Sheet visible={visible} title={copy.editTitle} subtitle={copy.editLead} onClose={onClose} scroll>
      <View className="gap-4 pb-3">
        <Field
          label={copy.thesisField}
          value={form.thesis}
          onChangeText={set('thesis')}
          multiline
          mono={false}
          maxLength={600}
        />
        <View className="flex-row gap-3">
          <Field label={copy.entry} value={form.entry} onChangeText={set('entry')} keyboardType="decimal-pad" className="flex-1" />
          <Field label={copy.maxPrice} value={form.maxPrice} onChangeText={set('maxPrice')} keyboardType="decimal-pad" className="flex-1" />
        </View>
        <Field label={copy.invalidation} value={form.invalidation} onChangeText={set('invalidation')} keyboardType="decimal-pad" />
        <Field label={copy.targets} value={form.targets} onChangeText={set('targets')} keyboardType="numbers-and-punctuation" />
        <View className="flex-row gap-3">
          <Field label={copy.riskField} value={form.risk} onChangeText={set('risk')} keyboardType="decimal-pad" className="flex-1" />
          <Field label={copy.budgetField} value={form.budget} onChangeText={set('budget')} keyboardType="decimal-pad" className="flex-1" />
        </View>
        <Field label={copy.reason} value={form.reason} onChangeText={set('reason')} mono={false} maxLength={240} />
        <Button title={copy.save} onPress={save} loading={busy} />
        {need ? (
          <Txt variant="ui" tone="danger">
            {editNeedLine(need, copy, labels)}
          </Txt>
        ) : null}
      </View>
    </Sheet>
  )
}
