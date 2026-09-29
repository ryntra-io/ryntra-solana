import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips } from '@/components/choice-chips'
import { FactRow } from '@/components/fact-row'
import { Field, ToggleRow } from '@/components/field'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { useAgentDraft } from '@/features/agent/use-agent'
import { PLANS_COPY, type PlansCopy } from '@/features/plans/copy'
import {
  conditionFromParam,
  conditionKey,
  metricLabel,
  metricOf,
  onUnknownOf,
  thresholdText,
  withCondition,
} from '@/features/plans/evidence-model'
import {
  assetKindOf,
  draftFromRead,
  draftFromRules,
  draftFromStock,
  rulesOf,
  sizingPreview,
  startingPrice,
  startingPriceOfRead,
  stockUnitBasis,
  unitBasisOf,
  VALIDITY_PRESETS,
  withAgentDraft,
  type DraftField,
  type DraftIssue,
  type HorizonUnit,
  type PlanDraft,
} from '@/features/plans/plan-model'
import { useCapabilities, useCreatePlan, usePlan, usePlanAsset, useUpdatePlan } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useStockAsset } from '@/hooks/use-market'
import { useNow } from '@/hooks/use-now'
import {
  ApiError,
  isMint,
  isNetworkError,
  isNotFound,
  type AgentDraftCard,
  type EvidenceCondition,
  type EvidenceMetricDefinition,
  type PlanRules,
  type UnitBasis,
} from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { formatAmount, formatDay, formatPrice, formatUsd } from '@/utils/format'

const AGENT_DRAFT = /^agd_[0-9a-f]{24}$/
const SUM = /^\d{1,9}(\.\d{1,6})?$/

/** Ryntra's draft belongs here only when it names this asset or this plan; any other id is ignored, never applied. */
function draftFits(card: AgentDraftCard, mint: string | null, planId: string | null): boolean {
  if (card.kind === 'planDraft') return !planId && card.asset.mint === mint
  if (card.kind === 'monitoringDraft') {
    return card.subject.kind === 'plan' ? card.subject.planId === planId : !planId && card.subject.mint === mint
  }
  return false
}

/** A mint the server will not carry a plan on (422) or does not know (404) — said, never retried. */
function notPlannable(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 422 || error.status === 404 || error.code === 'ASSET_UNCONFIRMED')
  )
}

/**
 * One market rule of the version: the metric in the reader's words, the
 * comparison and the figure, the window; its mode (advisory names it,
 * required refuses without it — only where the metric allows it); whether
 * Ryntra or a link carried it here; and the way to take it off.
 */
function RuleRow({
  condition,
  metric,
  carried,
  copy,
  locale,
  onMode,
  onRemove,
  last,
}: {
  condition: EvidenceCondition
  metric: EvidenceMetricDefinition | null
  carried: boolean
  copy: PlansCopy
  locale: Locale
  onMode: (mode: EvidenceCondition['mode']) => void
  onRemove: () => void
  last: boolean
}) {
  const flags = { present: copy.flagPresent, renounced: copy.flagRenounced }
  const modes = metric?.conditionModes ?? ['advisory']
  const next = condition.mode === 'required' ? 'advisory' : 'required'
  const canToggle = modes.includes(next)
  return (
    <View className={`flex-row items-start gap-3 py-3 ${last ? '' : 'border-b border-line'}`}>
      <View className="flex-1 gap-1.5">
        <Txt variant="ui">
          {`${metricLabel(metric, condition.metric, locale)} ${copy.operator[condition.operator]} ${thresholdText(metric, condition.threshold, flags)} · ${condition.window}`}
        </Txt>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canToggle }}
            disabled={!canToggle}
            onPress={() => onMode(next)}
            hitSlop={6}
          >
            <Chip label={copy.mode[condition.mode]} tone={condition.mode === 'required' ? 'brand' : 'neutral'} />
          </Pressable>
          {carried ? <Chip label={copy.fromRynRule} tone="evidence" caps={false} /> : null}
          <Txt variant="labelSm" tone="faint">
            {copy.modeHint[condition.mode]}
          </Txt>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.removeRule}
        onPress={onRemove}
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-btn active:bg-hover"
      >
        <Icon name="close" size={18} color="muted" />
      </Pressable>
    </View>
  )
}

const STEPS = 4
const STEP_FIELDS: readonly (readonly DraftField[])[] = [
  ['thesis', 'whyNow', 'horizonValue'],
  ['budget', 'plannedRisk', 'reserve'],
  [
    'entryPrice',
    'invalidation',
    'maxPrice',
    'validUntil',
    'costBufferPct',
    'target',
    'timeExit',
    'maxSlippagePct',
    'maxQuoteAge',
    'maxDeviationPct',
    'minLiquidity',
  ],
  [],
]

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

function issueText(issues: readonly DraftIssue[], field: DraftField, copy: PlansCopy): string | null {
  const issue = issues.find((candidate) => candidate.field === field)
  return issue ? copy.need[issue.need] : null
}

/** How many days a validity leaves from now, or null for none; the preset chips read from it. */
function validityDays(validUntil: string, now: number): number | null {
  if (!validUntil) return null
  const until = Date.parse(validUntil)
  return Number.isFinite(until) ? Math.round((until - now) / 86_400_000) : null
}

function LoadingBody() {
  return (
    <View className="gap-3 px-4" accessibilityRole="progressbar">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-24 rounded-btn" />
      <Skeleton className="h-11 rounded-btn" />
      <Skeleton className="h-11 rounded-btn" />
    </View>
  )
}

/**
 * The plan's rules, written on the phone in four steps — why, money, prices,
 * the check — and refused by name before a request leaves. The entry starts
 * from the price the desk knows (a stock) or the server's planning price (a
 * crypto or meme token, 1.7.0) and says which price it is; money is never
 * prefilled unless the person named it to Ryntra. The size on the last step is
 * a preview from the rules; the saved plan carries the server's own figure.
 * A new version of an existing plan follows the same steps on the version's
 * own rules, its market rules kept whole. Ryntra's draft (`?draft=`) and a
 * carried market rule (`?evidence=`) open here with every figure editable —
 * nothing is saved until the person saves.
 */
export function PlanBuilderScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const locale = useLocale()
  const copy = useCopy(PLANS_COPY)
  const shared = useSharedCopy()
  const now = useNow(60_000)
  const params = useLocalSearchParams<{
    mint?: string | string[]
    symbol?: string | string[]
    plan?: string | string[]
    draft?: string | string[]
    evidence?: string | string[]
    budget?: string | string[]
  }>()
  const planId = first(params.plan) ?? null
  const mintParam = first(params.mint)
  const symbolParam = first(params.symbol)
  const draftParam = first(params.draft)
  const agentDraftId = draftParam && AGENT_DRAFT.test(draftParam) ? draftParam : null
  // A market rule a link carried (`?evidence=`) and a sum Ryntra's handoff carried (`?budget=`) — the person's own figures.
  const carried = conditionFromParam(first(params.evidence))
  const budgetParam = first(params.budget)
  const carriedBudget = budgetParam && SUM.test(budgetParam) && Number(budgetParam) > 0 ? budgetParam : null

  const account = useAccount()
  const editing = usePlan(account.session, planId)
  const agentDraft = useAgentDraft(account.session, agentDraftId)
  const mint = planId ? (editing.data?.plan.asset.mint ?? null) : isMint(mintParam) ? mintParam : null
  const editingKind = editing.data ? assetKindOf(editing.data.plan.asset) : null
  // A stock starts from the desk's own figures; a token (1.7.0) from the server's read of the mint.
  const stock = useStockAsset(planId ? (editingKind === 'stock' ? mint : null) : mint)
  const stockMissing = !planId && stock.isError && isNotFound(stock.error)
  const tokenRead = usePlanAsset(stockMissing || (editingKind !== null && editingKind !== 'stock') ? mint : null)
  const tokenAsset = !planId && tokenRead.data && assetKindOf(tokenRead.data.asset) !== 'stock' ? tokenRead.data : null
  const capabilities = useCapabilities()
  const metrics = capabilities.data?.research.metrics ?? null
  const create = useCreatePlan(account.session)
  const update = useUpdatePlan(account.session)

  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [fromRyn, setFromRyn] = useState<'applied' | 'gone' | null>(null)
  const [carriedKeys, setCarriedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [shownIssues, setShownIssues] = useState<readonly DraftIssue[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /* The draft starts once from what is known — the version's rules, the stock's own figures or the token's
     read — and then Ryntra's draft or a carried rule is laid over it (state adjusted during render, as React
     prescribes). Ryntra's draft is waited for; one that is gone or names another asset is said, never applied. */
  const draftSettled = agentDraftId === null || agentDraft.isSuccess || agentDraft.isError
  const source = planId ? (editing.data?.plan ?? null) : (stock.data ?? tokenAsset ?? null)
  const [draftFor, setDraftFor] = useState<unknown>(null)
  if (source && draftSettled && draft === null && draftFor !== source) {
    setDraftFor(source)
    const base =
      planId && editing.data
        ? draftFromRules(editing.data.plan.current.rules)
        : stock.data
          ? draftFromStock(stock.data, now)
          : tokenAsset
            ? draftFromRead(tokenAsset, now)
            : null
    if (base) {
      const card = agentDraft.data?.draft ?? null
      const fits = card !== null && draftFits(card, mint, planId)
      let next = fits ? withAgentDraft(base, card) : base
      if (carried) next = { ...next, conditions: withCondition(next.conditions, carried) }
      if (carriedBudget && next.budget === '') next = { ...next, budget: carriedBudget }
      const keys = new Set<string>()
      if (fits && card.kind === 'monitoringDraft') keys.add(conditionKey(card.condition))
      if (carried) keys.add(conditionKey(carried))
      setDraft(next)
      setCarriedKeys(keys)
      setFromRyn(agentDraftId ? (fits ? 'applied' : 'gone') : null)
    }
  }

  const unit: UnitBasis =
    planId && editing.data
      ? unitBasisOf(editing.data.plan.asset)
      : stock.data
        ? stockUnitBasis(stock.data)
        : tokenAsset
          ? unitBasisOf(tokenAsset.asset)
          : 'share'
  const symbol =
    editing.data?.plan.asset.symbol ??
    stock.data?.row.representation.symbol ??
    tokenAsset?.asset.symbol ??
    symbolParam ??
    ''
  const set = <K extends DraftField>(field: K, value: PlanDraft[K]) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
    setSaveError(null)
  }
  const back = () => {
    if (step > 0) setStep(step - 1)
    else if (router.canGoBack()) router.back()
    else router.replace('/plans')
  }

  const made = draft ? rulesOf(draft) : null
  const issues = made && !made.ok ? made.issues : []
  const stepIssues = issues.filter((issue) => STEP_FIELDS[step]!.includes(issue.field))
  const continueStep = () => {
    if (stepIssues.length > 0) {
      setShownIssues(issues)
      return
    }
    setShownIssues([])
    setStep(step + 1)
  }
  const error = (field: DraftField) => issueText(shownIssues, field, copy)

  const save = async (rules: PlanRules, activate: boolean) => {
    setSaveError(null)
    try {
      if (planId && editing.data) {
        const saved = await update.mutateAsync({
          planId,
          rules,
          ifVersion: editing.data.plan.version,
          reason: draft?.reason.trim() || null,
        })
        router.replace({ pathname: '/plans/[id]', params: { id: saved.plan.id } })
      } else if (mint) {
        const saved = await create.mutateAsync({ mint, rules, activate })
        router.replace({ pathname: '/plans/[id]', params: { id: saved.plan.id } })
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PLAN_VERSION_CONFLICT') setSaveError(copy.conflict)
      else if (caught instanceof ApiError) setSaveError(`${copy.saveFailed} ${caught.message}`)
      else if (isNetworkError(caught)) setSaveError(shared.needsNetwork)
      else setSaveError(copy.saveFailed)
    }
  }
  const saving = create.isPending || update.isPending

  const failedRead = !planId ? (stockMissing ? tokenRead : stock) : null
  let body
  if (!account.session) {
    body = null
  } else if (planId && editing.isPending) {
    body = <LoadingBody />
  } else if (planId && editing.isError) {
    body = (
      <StateView
        icon="alert-circle-outline"
        tone="danger"
        title={isNotFound(editing.error) ? copy.notFound : copy.couldNotLoad}
        action={{ title: shared.back, onPress: back }}
      />
    )
  } else if (
    !planId &&
    (mint === null ||
      (stockMissing && ((tokenRead.isError && notPlannable(tokenRead.error)) || (tokenRead.isSuccess && !tokenAsset))))
  ) {
    body = (
      <StateView
        icon="help-circle-outline"
        title={copy.notAStock}
        detail={copy.plansForStocks}
        action={{ title: copy.pickStock, onPress: () => router.replace('/plans/pick') }}
      />
    )
  } else if (!planId && (stock.isPending || (stockMissing && tokenRead.isPending))) {
    body = <LoadingBody />
  } else if (failedRead && failedRead.isError && !source) {
    body = (
      <StateView
        icon={isNetworkError(failedRead.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(failedRead.error) ? shared.noConnection : copy.couldNotLoad}
        action={{ title: shared.tryAgain, onPress: () => void failedRead.refetch(), loading: failedRead.isFetching }}
      />
    )
  } else if (!draftSettled) {
    body = <LoadingBody />
  } else if (draft) {
    const start = stock.data
      ? startingPrice(stock.data)
      : tokenAsset
        ? startingPriceOfRead(tokenAsset)
        : tokenRead.data
          ? startingPriceOfRead(tokenRead.data)
          : null
    const perUnit = copy.perUnit[unit]
    const days = validityDays(draft.validUntil, now)
    const validityChoice =
      draft.validUntil === '' ? 'none' : (VALIDITY_PRESETS.find((preset) => preset === days) ?? 'custom')
    const preview = made?.ok ? sizingPreview(made.rules) : null
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-6"
        contentContainerStyle={{ paddingBottom: 24 + BOTTOM_ACTION_INSET }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && fromRyn ? (
          <View className="flex-row items-start gap-2 rounded-sm border border-line bg-surface px-4 py-3">
            <Icon name="sparkles" size={16} color={fromRyn === 'applied' ? 'brand' : 'muted'} />
            <Txt variant="ui" tone="muted" className="flex-1">
              {fromRyn === 'applied' ? copy.fromRyn : copy.draftGone}
            </Txt>
          </View>
        ) : null}
        {step === 0 ? (
          <>
            <Field
              label={copy.thesis}
              value={draft.thesis}
              onChangeText={(text) => set('thesis', text)}
              placeholder={copy.thesisPlaceholder}
              multiline
              mono={false}
              maxLength={2000}
              error={error('thesis')}
            />
            <Field
              label={copy.whyNow}
              value={draft.whyNow}
              onChangeText={(text) => set('whyNow', text)}
              multiline
              mono={false}
              maxLength={500}
              error={error('whyNow')}
            />
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.horizon}
              </Txt>
              <ChoiceChips
                choices={[
                  { value: 'none', label: copy.horizonNone },
                  { value: 'days', label: copy.horizonUnits.days },
                  { value: 'weeks', label: copy.horizonUnits.weeks },
                  { value: 'months', label: copy.horizonUnits.months },
                ]}
                value={draft.horizonUnit}
                onChange={(value: HorizonUnit) => set('horizonUnit', value)}
                size="sm"
              />
              {draft.horizonUnit !== 'none' ? (
                <Field
                  label={copy.horizonCount}
                  value={draft.horizonValue}
                  onChangeText={(text) => set('horizonValue', text)}
                  keyboardType="number-pad"
                  suffix={copy.horizonUnits[draft.horizonUnit]}
                  error={error('horizonValue')}
                />
              ) : null}
            </View>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field
              label={copy.budget}
              value={draft.budget}
              onChangeText={(text) => set('budget', text)}
              keyboardType="decimal-pad"
              placeholder="0"
              suffix="$"
              hint={copy.budgetHint}
              error={error('budget')}
            />
            <Field
              label={copy.risk}
              value={draft.plannedRisk}
              onChangeText={(text) => set('plannedRisk', text)}
              keyboardType="decimal-pad"
              placeholder="0"
              suffix="$"
              hint={copy.riskHint}
              error={error('plannedRisk')}
            />
            <Field
              label={copy.reserve}
              value={draft.reserve}
              onChangeText={(text) => set('reserve', text)}
              keyboardType="decimal-pad"
              placeholder="0"
              suffix="$"
              error={error('reserve')}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Field
              label={`${copy.entry} · $ ${perUnit}`}
              value={draft.entryPrice}
              onChangeText={(text) => set('entryPrice', text)}
              keyboardType="decimal-pad"
              placeholder="0"
              suffix="$"
              hint={start ? copy.entryFrom[start.source] : copy.entryNone}
              error={error('entryPrice')}
            />
            <Field
              label={`${copy.invalidation} · $ ${perUnit}`}
              value={draft.invalidation}
              onChangeText={(text) => set('invalidation', text)}
              keyboardType="decimal-pad"
              placeholder="0"
              suffix="$"
              hint={copy.invalidationHint}
              error={error('invalidation')}
            />
            <Card padded={false} className="px-4">
              <ToggleRow
                label={copy.limitPrice}
                hint={copy.maxPriceHint}
                value={draft.maxPriceOn}
                onChange={(value) => set('maxPriceOn', value)}
                last={!draft.maxPriceOn}
              />
              {draft.maxPriceOn ? (
                <Field
                  label={`${copy.maxPrice} · $ ${perUnit}`}
                  value={draft.maxPrice}
                  onChangeText={(text) => set('maxPrice', text)}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  suffix="$"
                  error={error('maxPrice')}
                  className="py-3"
                />
              ) : null}
            </Card>
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.validity}
              </Txt>
              <ChoiceChips
                choices={[
                  ...VALIDITY_PRESETS.map((preset) => ({ value: String(preset), label: copy.validityDays(preset) })),
                  { value: 'none', label: copy.validityNone },
                  ...(validityChoice === 'custom'
                    ? [{ value: 'custom', label: copy.validityUntil(formatDay(draft.validUntil, now, locale)) }]
                    : []),
                ]}
                value={String(validityChoice)}
                onChange={(value) => {
                  if (value === 'custom') return
                  set('validUntil', value === 'none' ? '' : new Date(now + Number(value) * 86_400_000).toISOString())
                }}
                size="sm"
              />
              {draft.validUntil ? (
                <Txt variant="labelSm" tone="faint">
                  {copy.validityUntil(formatDay(draft.validUntil, now, locale))}
                </Txt>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen }}
              onPress={() => setMoreOpen((open) => !open)}
              className="flex-row items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
            >
              <View className="gap-0.5">
                <Txt variant="ui">{copy.moreRules}</Txt>
                <Txt variant="labelSm" tone="faint">
                  {copy.moreRulesSub}
                </Txt>
              </View>
              <Icon name={moreOpen ? 'chevron-up' : 'chevron-down'} size={18} />
            </Pressable>
            {moreOpen ? (
              <View className="gap-4">
                <Field
                  label={copy.costBuffer}
                  value={draft.costBufferPct}
                  onChangeText={(text) => set('costBufferPct', text)}
                  keyboardType="decimal-pad"
                  suffix="%"
                  error={error('costBufferPct')}
                />
                <Field
                  label={`${copy.target} · ${perUnit}`}
                  value={draft.target}
                  onChangeText={(text) => set('target', text)}
                  keyboardType="decimal-pad"
                  suffix="$"
                  error={error('target')}
                />
                <Field
                  label={copy.maxSlippage}
                  value={draft.maxSlippagePct}
                  onChangeText={(text) => set('maxSlippagePct', text)}
                  keyboardType="decimal-pad"
                  suffix="%"
                  error={error('maxSlippagePct')}
                />
                <Field
                  label={copy.maxQuoteAge}
                  value={draft.maxQuoteAge}
                  onChangeText={(text) => set('maxQuoteAge', text)}
                  keyboardType="number-pad"
                  suffix="s"
                  error={error('maxQuoteAge')}
                />
                {unit === 'share' ? (
                  <Card padded={false} className="px-4">
                    <ToggleRow
                      label={copy.checkDeviation}
                      value={draft.deviationOn}
                      onChange={(value) => set('deviationOn', value)}
                    />
                    {draft.deviationOn ? (
                      <Field
                        label={copy.maxDeviation}
                        value={draft.maxDeviationPct}
                        onChangeText={(text) => set('maxDeviationPct', text)}
                        keyboardType="decimal-pad"
                        suffix="%"
                        error={error('maxDeviationPct')}
                        className="py-3"
                      />
                    ) : null}
                    <ToggleRow
                      label={copy.referenceRequired}
                      value={draft.referenceRequired}
                      onChange={(value) => set('referenceRequired', value)}
                      last
                    />
                  </Card>
                ) : null}
                <Field
                  label={copy.minLiquidity}
                  value={draft.minLiquidity}
                  onChangeText={(text) => set('minLiquidity', text)}
                  keyboardType="decimal-pad"
                  suffix="$"
                  error={error('minLiquidity')}
                />
              </View>
            ) : null}
            {draft.conditions.length > 0 ? (
              <View className="gap-2">
                <Txt variant="labelSm" tone="faint" caps>
                  {copy.marketRules}
                </Txt>
                <Card padded={false} className="px-4">
                  {draft.conditions.map((condition, index) => (
                    <RuleRow
                      key={conditionKey(condition)}
                      condition={condition}
                      metric={metricOf(metrics, condition.metric)}
                      carried={carriedKeys.has(conditionKey(condition))}
                      copy={copy}
                      locale={locale}
                      last={index === draft.conditions.length - 1}
                      onMode={(mode) =>
                        set(
                          'conditions',
                          draft.conditions.map((entry) =>
                            conditionKey(entry) === conditionKey(condition)
                              ? { ...entry, mode, onUnknown: onUnknownOf(mode) }
                              : entry,
                          ),
                        )
                      }
                      onRemove={() =>
                        set(
                          'conditions',
                          draft.conditions.filter((entry) => conditionKey(entry) !== conditionKey(condition)),
                        )
                      }
                    />
                  ))}
                </Card>
                <Txt variant="labelSm" tone="faint">
                  {copy.marketRulesHint}
                </Txt>
              </View>
            ) : null}
          </>
        ) : null}

        {step === 3 && made ? (
          <>
            {made.ok ? (
              <Card className="gap-1">
                <Txt variant="ui" tone="success">
                  {copy.checkPasses}
                </Txt>
                <FactRow label={copy.entryRule} value={`${formatPrice(made.rules.entry.pricePerShare)} ${perUnit}`} />
                <FactRow
                  label={copy.maxPriceRule}
                  value={
                    made.rules.entry.maxPricePerShare === null
                      ? copy.noBound
                      : `${formatPrice(made.rules.entry.maxPricePerShare)} ${perUnit}`
                  }
                />
                <FactRow
                  label={copy.invalidationRule}
                  value={`${formatPrice(made.rules.risk.invalidationPerShare)} ${perUnit}`}
                  detail={copy.ruleNote}
                />
                <FactRow
                  label={copy.budgetRule}
                  value={formatUsd(made.rules.capital.budgetUsd)}
                  detail={
                    made.rules.capital.reserveForCostsUsd > 0
                      ? `${formatUsd(made.rules.capital.reserveForCostsUsd)} ${copy.reserveRule.toLowerCase()}`
                      : null
                  }
                />
                <FactRow
                  label={copy.plannedRisk}
                  value={formatUsd(made.rules.risk.plannedRiskUsd)}
                  last={made.rules.evidenceConditions.length === 0}
                />
                {made.rules.evidenceConditions.length > 0 ? (
                  <FactRow
                    label={copy.marketRules}
                    value={String(made.rules.evidenceConditions.length)}
                    detail={made.rules.evidenceConditions.map((condition) => copy.mode[condition.mode]).join(' · ')}
                    last
                  />
                ) : null}
              </Card>
            ) : (
              <Card className="gap-1">
                <Txt variant="ui" tone="danger">
                  {copy.checkFails}
                </Txt>
                {made.issues.map((issue) => (
                  <Txt key={`${issue.field}-${issue.need}`} variant="ui" tone="muted">
                    · {copy.need[issue.need]}
                  </Txt>
                ))}
              </Card>
            )}
            {preview ? (
              <Card className="gap-1">
                <View className="flex-row items-end justify-between pb-1">
                  <Txt variant="labelSm" tone="faint" caps>
                    {copy.plannedSize}
                  </Txt>
                  <Chip label={copy.limitedBy[preview.limitedBy]} caps={false} />
                </View>
                <Txt variant="dataLg">
                  {formatAmount(preview.units, 4)} {copy.units[unit]}
                </Txt>
                <FactRow label={copy.plannedSpend} value={formatUsd(preview.notionalUsd)} />
                <FactRow label={copy.lossPerUnit} value={formatPrice(preview.lossPerShareUsd)} />
                <FactRow
                  label={copy.limitedBy.risk}
                  value={`${formatAmount(preview.riskLimitedUnits, 4)} ${copy.units[unit]}`}
                  mono
                />
                <FactRow
                  label={copy.limitedBy.capital}
                  value={`${formatAmount(preview.capitalLimitedUnits, 4)} ${copy.units[unit]}`}
                  last
                />
                <Txt variant="labelSm" tone="faint" className="pt-2">
                  {copy.previewNote} {copy.sizeNote}
                </Txt>
              </Card>
            ) : null}
            {planId ? (
              <Field
                label={copy.reason}
                value={draft.reason}
                onChangeText={(text) => set('reason', text)}
                mono={false}
                maxLength={240}
              />
            ) : null}
            {saveError ? (
              <Txt variant="ui" tone="danger">
                {saveError}
              </Txt>
            ) : null}
            {!planId && made.ok ? (
              <Button
                title={copy.saveDraft}
                variant="secondary"
                onPress={() => void save(made.rules, false)}
                disabled={saving}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    )
  }

  const stepTitles = [copy.stepWhy, copy.stepMoney, copy.stepPrices, copy.stepCheck]
  const lastStep = step === STEPS - 1
  const canSave = made?.ok === true && draft !== null

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.back}
          onPress={back}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <View className="flex-1">
          <ScreenHeader
            title={planId ? copy.builderTitleEdit : copy.builderTitle}
            subtitle={`${symbol}${draft ? ` · ${copy.stepOf(step + 1, STEPS)} · ${stepTitles[step]}` : ''}`}
          />
        </View>
      </View>
      <SessionGate what={copy.title}>
        <View className="flex-1">{body}</View>
        {draft ? (
          <BottomAction
            title={lastStep ? (planId ? copy.saveVersion : copy.createActive) : copy.continue}
            onPress={
              lastStep
                ? () => {
                    if (made?.ok) void save(made.rules, true)
                  }
                : continueStep
            }
            disabled={lastStep ? !canSave || saving : false}
            loading={saving}
            hint={lastStep ? (planId ? undefined : copy.planContextNote) : undefined}
          />
        ) : null}
      </SessionGate>
    </View>
  )
}
