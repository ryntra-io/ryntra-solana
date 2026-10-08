import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DoorRow } from '@/components/door-row'
import { FactRow } from '@/components/fact-row'
import { Field } from '@/components/field'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { AGENT_COPY } from '@/features/agent/copy'
import { explorerUrl } from '@/features/history/history-model'
import { recordJourney } from '@/features/journeys/journey-store'
import { MONITORING_COPY } from '@/features/monitoring/copy'
import { PLANS_COPY, type PlansCopy } from '@/features/plans/copy'
import { metricLabel, metricOf, thresholdText } from '@/features/plans/evidence-model'
import {
  assetKindOf,
  attentionCard,
  entryExpired,
  marketNow,
  planActions,
  planIssuerLabel,
  sharedSymbols,
  statusTone,
  unitBasisOf,
  type MarketNow,
} from '@/features/plans/plan-model'
import {
  useCapabilities,
  usePlan,
  usePlans,
  usePlanVersion,
  useSetPlanStatus,
  useSurface,
} from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useMarket, useStockAsset } from '@/hooks/use-market'
import { useNow } from '@/hooks/use-now'
import {
  ApiError,
  isNetworkError,
  isNotFound,
  type EvidenceMetricDefinition,
  type PlanRules,
  type PlanSizing,
  type TradingPlan,
  type UnitBasis,
} from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { openLink } from '@/lib/open-link'
import {
  formatAge,
  formatAmount,
  formatClock,
  formatDay,
  formatMoment,
  formatPercent,
  formatPrice,
  formatUsd,
  shortAddress,
} from '@/utils/format'

import { AttentionCard } from './plan-row'

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Txt variant="labelSm" tone="faint" caps className="px-1">
        {title}
      </Txt>
      {children}
    </View>
  )
}

/** Every rule of a version, one fact per line — the same words the web says. */
function RulesFacts({
  rules,
  unit,
  copy,
  locale,
  now,
}: {
  rules: PlanRules
  unit: UnitBasis
  copy: PlansCopy
  locale: Locale
  now: number
}) {
  const perUnit = copy.perUnit[unit]
  const rows: { label: string; value: string; detail?: string | null }[] = [
    { label: copy.entryRule, value: `${formatPrice(rules.entry.pricePerShare, locale)} ${perUnit}` },
    {
      label: copy.maxPriceRule,
      value:
        rules.entry.maxPricePerShare === null
          ? copy.noBound
          : `${formatPrice(rules.entry.maxPricePerShare, locale)} ${perUnit}`,
      detail: rules.entry.maxPricePerShare === null ? copy.reportedOnly : null,
    },
    {
      label: copy.validity,
      value: rules.entry.validUntil ? formatDay(rules.entry.validUntil, now, locale) : copy.validityNone,
    },
    { label: copy.budgetRule, value: formatUsd(rules.capital.budgetUsd, locale) },
    { label: copy.reserveRule, value: formatUsd(rules.capital.reserveForCostsUsd, locale) },
    {
      label: copy.invalidationRule,
      value: `${formatPrice(rules.risk.invalidationPerShare, locale)} ${perUnit}`,
      detail: copy.ruleNote,
    },
    { label: copy.plannedRisk, value: formatUsd(rules.risk.plannedRiskUsd, locale) },
    { label: copy.costsRule, value: `${formatAmount(rules.risk.costBufferBps / 100, 2, locale)}%` },
    {
      label: copy.targetRule,
      value:
        rules.exit.targetPerShare === null ? copy.none : `${formatPrice(rules.exit.targetPerShare, locale)} ${perUnit}`,
    },
    {
      label: copy.timeExitRule,
      value: rules.exit.timeExitAt ? formatDay(rules.exit.timeExitAt, now, locale) : copy.none,
    },
    { label: copy.slippageRule, value: `${formatAmount(rules.execution.maxSlippageBps / 100, 2, locale)}%` },
    { label: copy.quoteAgeRule, value: `${rules.execution.maxQuoteAgeSeconds} s` },
    {
      label: copy.deviationRule,
      value:
        rules.execution.maxReferenceDeviationPct === null
          ? copy.noBound
          : `${formatAmount(rules.execution.maxReferenceDeviationPct, 6, locale)}%`,
      detail: rules.execution.maxReferenceDeviationPct === null ? copy.reportedOnly : null,
    },
    {
      label: copy.referenceRule,
      value: rules.execution.referenceRequired ? copy.required : copy.advisory,
      detail: null,
    },
    {
      label: copy.liquidityRule,
      value: rules.execution.minLiquidityUsd === null ? copy.none : formatUsd(rules.execution.minLiquidityUsd, locale),
    },
  ]
  return (
    <Card padded={false} className="px-4">
      {rows.map((row, index) => (
        <FactRow
          key={row.label}
          label={row.label}
          value={row.value}
          detail={row.detail ?? null}
          mono={/\d/.test(row.value)}
          last={index === rows.length - 1}
        />
      ))}
    </Card>
  )
}

/** A version's market rules — the rules monitoring watches and the Review judges — one per line, visible on the plan. */
function MarketRules({
  rules,
  metrics,
  copy,
  locale,
}: {
  rules: PlanRules
  metrics: readonly EvidenceMetricDefinition[] | null
  copy: PlansCopy
  locale: Locale
}) {
  const flags = { present: copy.flagPresent, renounced: copy.flagRenounced }
  return (
    <Card padded={false} className="px-4">
      {rules.evidenceConditions.map((condition, index) => {
        const metric = metricOf(metrics, condition.metric)
        return (
          <FactRow
            key={`${condition.metric}:${condition.window}`}
            label={metricLabel(metric, condition.metric, locale)}
            value={`${copy.operator[condition.operator]} ${thresholdText(metric, condition.threshold, flags, locale)} · ${condition.window}`}
            detail={`${copy.mode[condition.mode]} · ${copy.modeHint[condition.mode]}`}
            mono={false}
            last={index === rules.evidenceConditions.length - 1}
          />
        )
      })}
    </Card>
  )
}

function SizingCard({
  sizing,
  unit,
  copy,
  locale,
}: {
  sizing: PlanSizing
  unit: UnitBasis
  copy: PlansCopy
  locale: Locale
}) {
  return (
    <Card className="gap-1">
      <View className="flex-row items-end justify-between pb-1">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.plannedSize}
        </Txt>
        <Chip label={copy.limitedBy[sizing.limitedBy]} caps={false} />
      </View>
      <Txt variant="dataLg">
        {formatAmount(sizing.units, 4, locale)} {copy.units[unit]}
      </Txt>
      <FactRow label={copy.plannedSpend} value={formatUsd(sizing.notionalUsd, locale)} />
      <FactRow label={copy.lossPerUnit} value={formatPrice(sizing.lossPerShareUsd, locale)} last />
      <Txt variant="labelSm" tone="faint" className="pt-2">
        {copy.sizeNote}
      </Txt>
    </Card>
  )
}

function NowCard({
  now,
  market,
  copy,
  locale,
  clock,
  loading,
}: {
  now: MarketNow
  market: boolean
  copy: PlansCopy
  locale: Locale
  clock: number
  loading: boolean
}) {
  const perUnit = copy.perUnit[now.unitBasis]
  const boundWord =
    now.vsMax === 'within'
      ? copy.withinBound
      : now.vsMax === 'above'
        ? copy.aboveBound
        : now.vsMax === 'noBound'
          ? copy.noBound
          : copy.unknown
  const invalidationWord =
    now.vsInvalidation === 'below'
      ? copy.belowInvalidation
      : now.vsInvalidation === 'above'
        ? copy.aboveInvalidation
        : copy.unknown
  return (
    <Card className="gap-1">
      <View className="flex-row items-center justify-between">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.marketNow}
        </Txt>
        {now.stale ? <Chip label={copy.stale} tone="warning" /> : null}
      </View>
      {loading && now.pricePerUnit === null ? (
        <Txt variant="ui" tone="faint">
          {copy.marketReading}
        </Txt>
      ) : now.pricePerUnit === null ? (
        <Txt variant="ui" tone="faint">
          {market ? copy.marketUnavailable : copy.marketReading}
        </Txt>
      ) : (
        <>
          <Txt
            variant="dataLg"
            tone={now.vsMax === 'above' ? 'warning' : now.vsInvalidation === 'below' ? 'danger' : 'fg'}
          >
            {formatPrice(now.pricePerUnit, locale)}{' '}
            <Txt variant="ui" tone="faint">
              {perUnit}
            </Txt>
          </Txt>
          <Txt variant="labelSm" tone="faint">
            {now.at ? `${formatClock(now.at)} · ${formatAge(now.at, clock, locale)}` : ''}
          </Txt>
          <FactRow
            label={copy.maxPriceRule}
            value={boundWord}
            mono={false}
            tone={now.vsMax === 'above' ? 'warning' : 'fg'}
          />
          <FactRow
            label={copy.invalidationRule}
            value={invalidationWord}
            mono={false}
            tone={now.vsInvalidation === 'below' ? 'danger' : 'fg'}
          />
          {now.unitBasis === 'share' ? (
            <FactRow
              label={copy.reference}
              value={
                now.reference === null ? copy.referenceUnavailable : `${formatPrice(now.reference, locale)} ${perUnit}`
              }
              detail={
                now.deviationPct === null
                  ? null
                  : `${copy.deviation} ${formatPercent(now.deviationPct, locale)} · ${now.vsDeviation === 'within' ? copy.withinBound : now.vsDeviation === 'above' ? copy.aboveBound : now.vsDeviation === 'noBound' ? copy.noBound : copy.unknown}`
              }
              last
            />
          ) : null}
        </>
      )}
      <Txt variant="labelSm" tone="faint" className="pt-2">
        {copy.reviewDecides}
      </Txt>
    </Card>
  )
}

function LoadingBody() {
  return (
    <View className="gap-3 px-4" accessibilityRole="progressbar">
      <Skeleton className="h-28 rounded-sm" />
      <Skeleton className="h-36 rounded-sm" />
      <Skeleton className="h-24 rounded-sm" />
    </View>
  )
}

/**
 * One plan, whole: its state and version, the size the server computed,
 * what the market is doing against its bounds, what the monitoring says,
 * the thesis, every rule one tap deep, the activity and the executions,
 * earlier versions as they stood. The doors are the state's own: Review
 * the purchase under the plan (the same Review, signature, receipt and
 * recovery as any trade — the plan is context, never permission), a new
 * version, activate, cancel.
 */
export function PlanDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(PLANS_COPY)
  const shared = useSharedCopy()
  const clock = useNow(15_000)
  const params = useLocalSearchParams<{ id?: string | string[]; from?: string | string[]; note?: string | string[] }>()
  const planId = first(params.id) ?? null
  // Arrived from a note: the plan is shown with the reminder that a note is information, never permission.
  const fromMonitoring = first(params.from) === 'monitoring'
  // The note it was opened from, when the resolver knows it — Ryntra can explain that note.
  const noteId = fromMonitoring ? (first(params.note) ?? null) : null
  const agentCopy = useCopy(AGENT_COPY)
  const monitoringCopy = useCopy(MONITORING_COPY)

  const account = useAccount()
  const read = usePlan(account.session, planId)
  const plan: TradingPlan | null = read.data?.plan ?? null
  const kind = plan ? assetKindOf(plan.asset) : null
  const stock = useStockAsset(plan && kind === 'stock' ? plan.asset.mint : null)
  const spot = useMarket(plan?.asset.mint ?? '', plan !== null && kind !== 'stock')
  const capabilities = useCapabilities()
  const metrics = capabilities.data?.research.metrics ?? null
  const surface = useSurface(account.session, locale)
  const all = usePlans(account.session)
  const setStatus = useSetPlanStatus(account.session)

  const [rulesOpen, setRulesOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [versionOpen, setVersionOpen] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const version = usePlanVersion(account.session, planId, versionOpen)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/bots'))
  // Leaving the sheet without cancelling forgets the reason, so no later action inherits it.
  const closeCancel = () => {
    setCancelOpen(false)
    setCancelReason('')
  }

  const changeStatus = async (status: 'active' | 'cancelled') => {
    if (!plan) return
    setActionError(null)
    try {
      await setStatus.mutateAsync({
        planId: plan.id,
        status,
        ifVersion: plan.version,
        // Only a cancellation carries the sheet's reason; an activation says nothing.
        reason: status === 'cancelled' ? cancelReason.trim() || null : null,
      })
      setCancelOpen(false)
      setCancelReason('')
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.code === 'PLAN_VERSION_CONFLICT'
            ? copy.conflict
            : caught.message
          : isNetworkError(caught)
            ? shared.needsNetwork
            : copy.saveFailed,
      )
    }
  }

  const reviewTrade = () => {
    if (!plan) return
    recordJourney('plan_review', { from: fromMonitoring ? 'monitoring' : 'plan' })
    router.push({
      pathname: '/trade',
      params: {
        mint: plan.asset.mint,
        symbol: plan.asset.symbol,
        side: 'buy',
        plan: plan.id,
        v: String(plan.version),
        amount: plan.current.sizing.notionalUsd.toFixed(2),
      },
    })
  }

  let body
  if (!account.session) {
    body = null
  } else if (read.isPending) {
    body = <LoadingBody />
  } else if (read.isError && !plan) {
    body = (
      <StateView
        icon={isNetworkError(read.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={
          isNotFound(read.error) ? copy.notFound : isNetworkError(read.error) ? shared.noConnection : copy.couldNotLoad
        }
        action={
          isNotFound(read.error)
            ? { title: shared.back, onPress: back }
            : { title: shared.tryAgain, onPress: () => void read.refetch(), loading: read.isFetching }
        }
      />
    )
  } else if (plan) {
    const unit = unitBasisOf(plan.asset)
    const sizing = plan.current.sizing
    const rules = plan.current.rules
    const actions = planActions(plan)
    const expired = entryExpired(plan, clock)
    const now = marketNow(plan, stock.data ?? null, spot.data?.market ?? null, clock, spot.data?.observedAt ?? null)
    const marketRead = kind === 'stock' ? stock : spot
    const card = attentionCard(plan, surface)
    // Two active plans on one symbol share one card on the surface; the detail says so instead of claiming it.
    const shared = sharedSymbols(all.data?.plans ?? []).has(plan.asset.symbol)
    const stateLine =
      plan.status === 'draft'
        ? copy.stateDraft
        : plan.status === 'cancelled'
          ? copy.stateCancelled
          : plan.executions.length > 0
            ? copy.stateExecuted(plan.executions.length)
            : plan.status === 'active'
              ? copy.stateWaiting
              : null
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4"
        contentContainerStyle={{ paddingBottom: 24 + (actions.review ? BOTTOM_ACTION_INSET : 0) }}
        refreshControl={
          <RefreshControl
            refreshing={read.isFetching && !read.isPending}
            onRefresh={() => void read.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {fromMonitoring && plan.status === 'active' ? (
          <View className="flex-row items-start gap-2 rounded-sm border border-line bg-surface px-4 py-3">
            <Icon name="notifications-outline" size={18} color="brand" />
            <View className="flex-1 gap-2">
              <Txt variant="ui" tone="muted">
                {monitoringCopy.attentionBanner}
              </Txt>
              {noteId ? (
                <AskRyn context={{ kind: 'note', inboxId: noteId }} variant="inline" label={agentCopy.askAboutNote} />
              ) : null}
            </View>
          </View>
        ) : null}
        <View className="gap-2 pt-1">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Chip label={copy.status[plan.status]} tone={statusTone(plan.status)} />
            <Chip label={`${copy.versionLong(plan.version)} · ${copy.current}`} caps={false} />
            {expired ? <Chip label={copy.status.expired} tone="warning" /> : null}
          </View>
          {stateLine ? (
            <Txt variant="ui" tone="muted">
              {stateLine}
            </Txt>
          ) : null}
          {expired ? (
            <Txt variant="ui" tone="warning">
              {copy.entryExpired}
            </Txt>
          ) : null}
        </View>

        {card && card.status === 'needs_attention' ? (
          <View className="gap-2">
            <AttentionCard
              card={card}
              lastChecked={copy.lastChecked}
              locale={locale}
              now={clock}
              onPress={actions.review ? reviewTrade : () => undefined}
            />
            <Txt variant="labelSm" tone="faint" className="px-1">
              {shared ? copy.cardShared(plan.asset.symbol) : copy.attentionCta}
            </Txt>
          </View>
        ) : null}

        <SizingCard sizing={sizing} unit={unit} copy={copy} locale={locale} />

        <Card padded={false} className="px-4">
          <FactRow
            label={copy.entryRule}
            value={`${formatPrice(rules.entry.pricePerShare, locale)} ${copy.perUnit[unit]}`}
          />
          <FactRow
            label={copy.maxPriceRule}
            value={
              rules.entry.maxPricePerShare === null
                ? copy.noBound
                : `${formatPrice(rules.entry.maxPricePerShare, locale)} ${copy.perUnit[unit]}`
            }
          />
          <FactRow
            label={copy.invalidationRule}
            value={`${formatPrice(rules.risk.invalidationPerShare, locale)} ${copy.perUnit[unit]}`}
            detail={copy.ruleNote}
          />
          <FactRow label={copy.budgetRule} value={formatUsd(rules.capital.budgetUsd, locale)} />
          <FactRow label={copy.plannedRisk} value={formatUsd(rules.risk.plannedRiskUsd, locale)} last />
        </Card>

        <NowCard
          now={now}
          market={marketRead.isFetched}
          copy={copy}
          locale={locale}
          clock={clock}
          loading={marketRead.isPending}
        />

        {rules.evidenceConditions.length > 0 ? (
          <Section title={copy.marketRules}>
            <MarketRules rules={rules} metrics={metrics} copy={copy} locale={locale} />
          </Section>
        ) : null}

        <Section title={copy.thesis}>
          <Card className="gap-2">
            <Txt variant="body">{rules.thesis.text}</Txt>
            {rules.thesis.whyNow ? (
              <Txt variant="ui" tone="muted">
                {rules.thesis.whyNow}
              </Txt>
            ) : null}
            {rules.thesis.horizon ? (
              <Chip
                label={`${copy.horizon} · ${rules.thesis.horizon.value} ${copy.horizonUnits[rules.thesis.horizon.unit]}`}
                caps={false}
              />
            ) : null}
          </Card>
        </Section>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: rulesOpen }}
          onPress={() => setRulesOpen((open) => !open)}
          className="flex-row items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
        >
          <Txt variant="ui">{rulesOpen ? copy.hideRules : copy.allRules}</Txt>
          <Icon name={rulesOpen ? 'chevron-up' : 'chevron-down'} size={18} />
        </Pressable>
        {rulesOpen ? <RulesFacts rules={rules} unit={unit} copy={copy} locale={locale} now={clock} /> : null}

        {plan.versions.length > 1 ? (
          <Section title={copy.versions}>
            <Card padded={false} className="px-4">
              {[...plan.versions].reverse().map((entry, index, all) => (
                <Pressable
                  key={entry.version}
                  accessibilityRole="button"
                  disabled={entry.version === plan.version}
                  onPress={() => setVersionOpen(entry.version)}
                  className={`flex-row items-center gap-3 py-2.5 ${index === all.length - 1 ? '' : 'border-b border-line'}`}
                >
                  <Txt variant="ui" className="flex-1">
                    {copy.versionLong(entry.version)}
                    {entry.version === plan.version ? ` · ${copy.current}` : ''}
                  </Txt>
                  <Txt variant="labelSm" tone="faint">
                    {entry.reason ?? formatMoment(entry.createdAt, clock, locale)}
                  </Txt>
                  {entry.version !== plan.version ? <Icon name="chevron-forward" size={16} color="fgMuted" /> : null}
                </Pressable>
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={copy.executions}>
          {plan.executions.length === 0 ? (
            <Txt variant="ui" tone="faint" className="px-1">
              {copy.noExecutions}
            </Txt>
          ) : (
            <Card padded={false} className="px-4">
              {plan.executions.map((execution, index) => (
                <Pressable
                  key={execution.signature}
                  accessibilityRole="link"
                  onPress={() => openLink(explorerUrl(execution.signature))}
                  className={`flex-row items-center gap-3 py-2.5 ${index === plan.executions.length - 1 ? '' : 'border-b border-line'}`}
                >
                  <View className="flex-1 gap-0.5">
                    <Txt variant="data">{shortAddress(execution.signature, 6)}</Txt>
                    <Txt variant="labelSm" tone="faint">
                      {copy.version(execution.version)} · {formatMoment(execution.recordedAt, clock, locale)}
                    </Txt>
                  </View>
                  <Chip
                    label={execution.outcome}
                    tone={
                      execution.outcome === 'DONE' ? 'success' : execution.outcome === 'FAILED' ? 'danger' : 'warning'
                    }
                  />
                  <Icon name="open-outline" size={16} color="fgMuted" />
                </Pressable>
              ))}
            </Card>
          )}
        </Section>

        {plan.status !== 'draft' ? (
          <Card padded={false} className="px-4">
            <DoorRow
              icon="analytics-outline"
              label={copy.results}
              line={copy.resultsLine}
              onPress={() => router.push({ pathname: '/results', params: { plan: plan.id, from: 'plan' } })}
              last
            />
          </Card>
        ) : null}

        {plan.journal.length > 0 ? (
          <Section title={copy.activity}>
            <Card padded={false} className="px-4">
              {[...plan.journal].reverse().map((entry, index, all) => (
                <View
                  key={`${entry.at}-${entry.event}-${index}`}
                  className={`flex-row items-center gap-3 py-2.5 ${index === all.length - 1 ? '' : 'border-b border-line'}`}
                >
                  <View className="flex-1 gap-0.5">
                    <Txt variant="ui">{copy.event[entry.event]}</Txt>
                    {entry.note ? (
                      <Txt variant="labelSm" tone="faint">
                        {entry.note}
                      </Txt>
                    ) : null}
                  </View>
                  <Txt variant="labelSm" tone="faint">
                    {copy.version(entry.version)} · {formatMoment(entry.at, clock, locale)}
                  </Txt>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {actionError ? (
          <Txt variant="ui" tone="danger">
            {actionError}
          </Txt>
        ) : null}
        <View className="gap-2">
          {actions.activate ? (
            <Button title={copy.activate} onPress={() => void changeStatus('active')} loading={setStatus.isPending} />
          ) : null}
          <View className="flex-row gap-2">
            {actions.edit ? (
              <Button
                title={copy.edit}
                variant="secondary"
                onPress={() => router.push({ pathname: '/plans/new', params: { plan: plan.id } })}
                className="flex-1"
              />
            ) : null}
            {actions.cancel ? (
              <Button title={copy.cancel} variant="ghost" onPress={() => setCancelOpen(true)} className="flex-1" />
            ) : null}
          </View>
        </View>
      </ScrollView>
    )
  }

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
            title={plan?.asset.symbol ?? copy.title}
            subtitle={
              plan
                ? `${kind === 'stock' ? planIssuerLabel(plan.asset, copy.retiredIssuer) : copy.kind[kind ?? 'crypto']} ·${plan.asset.underlying.name ?? plan.asset.underlying.symbol} · ${copy.perUnit[unitBasisOf(plan.asset)]}`
                : undefined
            }
            right={plan ? <AskRyn context={{ kind: 'plan', planId: plan.id }} /> : undefined}
          />
        </View>
      </View>
      <SessionGate what={copy.title}>
        <View className="flex-1">{body}</View>
        {plan && planActions(plan).review ? (
          <BottomAction title={copy.reviewTrade} onPress={reviewTrade} hint={copy.planContextNote} />
        ) : null}
      </SessionGate>

      <Sheet visible={cancelOpen} title={copy.confirmCancel} onClose={closeCancel}>
        <View className="gap-3 pb-2">
          <Field
            label={copy.cancelReason}
            value={cancelReason}
            onChangeText={setCancelReason}
            mono={false}
            maxLength={240}
          />
          <Button
            title={copy.cancel}
            variant="danger"
            onPress={() => void changeStatus('cancelled')}
            loading={setStatus.isPending}
          />
          <Button title={copy.keep} variant="ghost" onPress={closeCancel} />
        </View>
      </Sheet>

      <Sheet
        visible={versionOpen !== null}
        title={versionOpen === null ? '' : copy.viewingVersion(versionOpen)}
        onClose={() => setVersionOpen(null)}
        scroll
      >
        {version.data && plan ? (
          <View className="gap-3 pb-2">
            <SizingCard
              sizing={version.data.version.sizing}
              unit={unitBasisOf(plan.asset)}
              copy={copy}
              locale={locale}
            />
            <RulesFacts
              rules={version.data.version.rules}
              unit={unitBasisOf(plan.asset)}
              copy={copy}
              locale={locale}
              now={clock}
            />
            {version.data.version.rules.evidenceConditions.length > 0 ? (
              <MarketRules rules={version.data.version.rules} metrics={metrics} copy={copy} locale={locale} />
            ) : null}
          </View>
        ) : version.isError ? (
          <Txt variant="ui" tone="danger" className="py-3">
            {copy.couldNotLoad}
          </Txt>
        ) : (
          <Txt variant="ui" tone="faint" className="py-3">
            {shared.loading}
          </Txt>
        )}
      </Sheet>
    </View>
  )
}
