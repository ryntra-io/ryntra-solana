import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { SearchInput } from '@/components/search-field'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { creditsText, paidBy } from '@/features/assistant/credits-model'
import { PLAN_COPY, type PlanCopy } from '@/features/assistant/plan-copy'
import { useAssistantPlans, useComposePlan } from '@/features/assistant/plans'
import {
  composeRequest,
  EMPTY_COMPOSE,
  MINT,
  planFailureOf,
  plansByToken,
  stateTone,
  type ComposeForm,
  type ComposeNeed,
  type PlanFailure,
} from '@/features/assistant/plans-model'
import { useCredits } from '@/features/assistant/use-credits'
import { useMarketSearch } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import type { AssistantCredits, AssistantPlan, AssistantPlanState, Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatCount, formatMoment, shortAddress } from '@/utils/format'

import type { AssistantToken } from './watch-panel'

export type PlansPanelProps = {
  session: Session
  /** Opened from a token («План» beside «Пояснити рух»): that token's plans first, a new one for it. */
  token: AssistantToken | null
  /** A question about a plan goes into the conversation's field. */
  onAsk: (question: string) => void
  /** «Поповнити» when the credits are short of composing: the assistant's «Кредити». */
  onTopUp?: () => void
}

/** A plan's state as a small chip — the same words in the list and on the plan's page. */
export function PlanStateChip({ state, copy }: { state: AssistantPlanState; copy: PlanCopy }) {
  return <Chip label={copy.state[state]} tone={stateTone(state)} caps={false} />
}

/** A refusal in one line, in the app's words. */
export function failureLine(failure: PlanFailure, copy: PlanCopy): string {
  if (failure.kind === 'invalid') return copy.invalid(failure.fields.map((field) => copy.field[field]).join(', '))
  return copy[failure.kind]
}

/** One plan as a row: the token and its state, the thesis in one line, the version and when it last changed. */
function PlanCard({ plan, copy, now, locale }: { plan: AssistantPlan; copy: PlanCopy; now: number; locale: Locale }) {
  const router = useRouter()
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${plan.symbol}, ${copy.state[plan.state]}`}
      onPress={() => router.push(`/ryn-plan/${plan.id}` as never)}
      className="active:opacity-80"
    >
      <Card className="gap-1.5">
        <View className="flex-row items-center gap-2">
          <Txt variant="title" className="flex-1" numberOfLines={1}>
            {plan.symbol}
          </Txt>
          <PlanStateChip state={plan.state} copy={copy} />
          <Icon name="chevron-forward" size={16} color="fgMuted" />
        </View>
        <Txt variant="ui" tone="muted" numberOfLines={1}>
          {plan.current.body.thesis.text}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {`${copy.version(plan.version)} · ${copy.updated(formatMoment(plan.updatedAt, now, locale))}`}
        </Txt>
      </Card>
    </Pressable>
  )
}

/** «Плани» — trade plans Ryntra composes with the person, with the critic (AI-11, 1.61.0). */
export function PlansPanel({ session, token, onTopUp }: PlansPanelProps) {
  const locale = useLocale()
  const copy = useCopy(PLAN_COPY)
  const shared = useSharedCopy()
  const now = useNow(60_000)
  const list = useAssistantPlans(session, locale)
  const credits = useCredits(session)
  const [composing, setComposing] = useState(false)

  const name = token ? token.symbol?.trim() || shortAddress(token.mint) : null
  const groups = plansByToken(list.data?.plans ?? [], token?.mint ?? null)

  let body: ReactNode
  if (list.isPending) {
    body = (
      <View className="gap-3" accessibilityRole="progressbar">
        <Skeleton className="h-20 rounded-sm" />
        <Skeleton className="h-20 rounded-sm" />
      </View>
    )
  } else if (list.isError && !list.data) {
    body = (
      <StateView
        icon="alert-circle-outline"
        tone="danger"
        title={copy.loadFailed}
        action={{ title: shared.tryAgain, onPress: () => void list.refetch(), loading: list.isFetching }}
      />
    )
  } else {
    const plans = list.data?.plans ?? []
    body = (
      <View className="gap-4">
        {token && name ? (
          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.onToken(name)}
            </Txt>
            {groups.here.length === 0 ? (
              <Txt variant="ui" tone="muted">
                {copy.noneOnToken(name)}
              </Txt>
            ) : (
              groups.here.map((plan) => <PlanCard key={plan.id} plan={plan} copy={copy} now={now} locale={locale} />)
            )}
          </View>
        ) : null}
        {groups.other.length > 0 ? (
          <View className="gap-2">
            {token ? (
              <Txt variant="labelSm" tone="faint" caps>
                {copy.otherPlans}
              </Txt>
            ) : null}
            {groups.other.map((plan) => (
              <PlanCard key={plan.id} plan={plan} copy={copy} now={now} locale={locale} />
            ))}
          </View>
        ) : null}
        {plans.length === 0 && !token ? (
          <Txt variant="ui" tone="muted">
            {copy.none}
          </Txt>
        ) : null}
      </View>
    )
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center gap-2">
        <Txt variant="title" className="flex-1">
          {copy.groupTitle}
        </Txt>
        <HelpDot title={copy.howTitle} body={[copy.howLead, copy.noBuy]} />
      </View>
      <Button title={copy.compose} onPress={() => setComposing(true)} />
      {body}
      <ComposeSheet
        key={token?.mint ?? 'any'}
        visible={composing}
        onClose={() => setComposing(false)}
        session={session}
        token={token}
        price={list.data?.prices.plan ?? null}
        credits={credits.data?.credits ?? list.data?.budget?.credits ?? null}
        onTopUp={onTopUp}
        copy={copy}
        locale={locale}
      />
    </ScrollView>
  )
}

/** What the composer still needs, as one line under its press. */
function needLine(need: ComposeNeed, copy: PlanCopy, labels: Readonly<Record<string, string>>): string {
  switch (need.kind) {
    case 'token':
      return copy.needToken
    case 'idea':
      return copy.needIdea
    case 'money':
      return copy.needMoney
    case 'figure':
      return copy.notFigure(labels[need.field] ?? '')
    case 'targets':
      return copy.tooManyTargets
    case 'days':
      return copy.badDays
    case 'price':
      return copy.priceWait
  }
}

/** Where the plan's price comes from: today's free credits, the balance, or neither. */
function paidLine(price: number, credits: AssistantCredits | null, copy: PlanCopy, locale: Locale) {
  if (price === 0 || !credits) return null
  const paid = paidBy(credits, price)
  switch (paid.kind) {
    case 'free':
      return { text: copy.paidFree, blocked: false, short: false }
    case 'balance':
      return {
        text: copy.paidBalance(creditsText(paid.rest, locale), formatCount(credits.balance, locale)),
        blocked: false,
        short: false,
      }
    case 'short':
      return { text: copy.paidShort, blocked: true, short: true }
    case 'dayCap':
      return { text: copy.paidDayCap, blocked: true, short: false }
  }
}

type ChosenToken = Readonly<{ mint: string; symbol: string }>

/** The token: the one the tab was opened about, or one found by name, ticker or a pasted mint. */
function TokenPick({
  chosen,
  onChoose,
  copy,
}: {
  chosen: ChosenToken | null
  onChoose: (token: ChosenToken | null) => void
  copy: PlanCopy
}) {
  const [query, setQuery] = useState('')
  const search = useMarketSearch(chosen ? '' : query)
  if (chosen) {
    return (
      <View className="gap-1.5">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.token}
        </Txt>
        <View className="h-11 flex-row items-center gap-2 rounded-btn border border-line bg-surface px-3">
          <Txt variant="ui" className="flex-1" numberOfLines={1}>
            {chosen.symbol}
          </Txt>
          <Pressable accessibilityRole="button" onPress={() => onChoose(null)} hitSlop={8} className="active:opacity-80">
            <Txt variant="ui" tone="brand">
              {copy.tokenChange}
            </Txt>
          </Pressable>
        </View>
      </View>
    )
  }
  const typed = query.trim()
  const rows = (search.data?.rows ?? []).slice(0, 6)
  const pastedMint = MINT.test(typed) && !rows.some((row) => row.mint === typed) ? typed : null
  return (
    <View className="gap-1.5">
      <Txt variant="labelSm" tone="faint" caps>
        {copy.token}
      </Txt>
      <View className="flex-row">
        <SearchInput
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={copy.tokenSearch}
          label={copy.token}
        />
      </View>
      {typed !== '' ? (
        <View className="gap-0.5">
          {pastedMint ? (
            <TokenRow label={shortAddress(pastedMint)} detail={null} onPress={() => onChoose({ mint: pastedMint, symbol: shortAddress(pastedMint) })} />
          ) : null}
          {rows.map((row) => (
            <TokenRow
              key={row.mint}
              label={row.symbol}
              detail={row.verified ? row.name : `${row.name} · ${copy.unverified}`}
              onPress={() => onChoose({ mint: row.mint, symbol: row.symbol })}
            />
          ))}
          {rows.length === 0 && !pastedMint ? (
            <Txt variant="ui" tone="faint" className="py-2">
              {search.isFetching ? copy.searching : copy.tokenNone}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function TokenRow({ label, detail, onPress }: { label: string; detail: string | null; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-3 rounded-btn px-2 py-2 active:bg-hover"
    >
      <Txt variant="ui" className="shrink-0">
        {label}
      </Txt>
      {detail ? (
        <Txt variant="ui" tone="faint" className="flex-1" numberOfLines={1}>
          {detail}
        </Txt>
      ) : (
        <View className="flex-1" />
      )}
      <Icon name="add" size={18} color="fgMuted" />
    </Pressable>
  )
}

/**
 * «Скласти з Ryntra»: the token, the idea, the loss limit or a budget — one is required, money is the person's — and
 * the levels the person knows, folded. The price `prices.plan` stands in the press before it is pressed, with what pays
 * it; the call carries exactly that price. Composing may take a minute and a half: a calm wait, then the plan's page.
 */
function ComposeSheet({
  visible,
  onClose,
  session,
  token,
  price,
  credits,
  onTopUp,
  copy,
  locale,
}: {
  visible: boolean
  onClose: () => void
  session: Session
  token: AssistantToken | null
  price: number | null
  credits: AssistantCredits | null
  onTopUp?: () => void
  copy: PlanCopy
  locale: Locale
}) {
  const router = useRouter()
  const { colors } = useTheme()
  const compose = useComposePlan(session, locale)
  const [form, setForm] = useState<ComposeForm>(EMPTY_COMPOSE)
  const [chosen, setChosen] = useState<ChosenToken | null>(
    token ? { mint: token.mint, symbol: token.symbol?.trim() || shortAddress(token.mint) } : null,
  )
  const [levelsOpen, setLevelsOpen] = useState(false)
  const [failure, setFailure] = useState<PlanFailure | null>(null)

  const set = (key: keyof ComposeForm) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (failure) setFailure(null)
  }
  const labels: Readonly<Record<string, string>> = {
    risk: copy.risk,
    budget: copy.budget,
    entry: copy.entry,
    maxPrice: copy.maxPrice,
    invalidation: copy.invalidation,
    targets: copy.targets,
  }
  const built = composeRequest({ ...form, mint: chosen?.mint ?? null }, locale, price)
  const paid = price === null ? null : paidLine(price, credits, copy, locale)
  const priceWords = price === null ? null : price === 0 ? copy.free : creditsText(price, locale)

  const submit = () => {
    if (!built.ok || compose.isPending || paid?.blocked) return
    setFailure(null)
    compose.mutate(built.request, {
      onSuccess: (answer) => {
        onClose()
        setForm(EMPTY_COMPOSE)
        const spent = answer.spent && answer.spent.credits > 0 ? answer.spent : null
        const part = spent && spent.critic === 'rules' && spent.architect === 'model' ? '&part=1' : ''
        router.push(`/ryn-plan/${answer.plan.id}${spent ? `?spent=${spent.credits}${part}` : ''}` as never)
      },
      onError: (error) => setFailure(planFailureOf(error)),
    })
  }

  return (
    <Sheet visible={visible} title={copy.composeTitle} onClose={onClose} scroll>
      {compose.isPending ? (
        <View className="items-center gap-3 py-10" accessibilityRole="progressbar" accessibilityLabel={copy.composing}>
          <ActivityIndicator color={colors.brand} />
          <Txt variant="body" className="text-center">
            {copy.composing}
          </Txt>
          <Txt variant="ui" tone="faint" className="text-center">
            {copy.composingWait}
          </Txt>
        </View>
      ) : (
        <View className="gap-4 pb-3">
          <TokenPick chosen={chosen} onChoose={setChosen} copy={copy} />
          <Field
            label={copy.idea}
            value={form.idea}
            onChangeText={(value) => set('idea')(value.slice(0, 600))}
            placeholder={copy.ideaHint}
            multiline
            mono={false}
            maxLength={600}
          />
          <View className="flex-row gap-3">
            <Field
              label={copy.risk}
              value={form.risk}
              onChangeText={set('risk')}
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Field
              label={copy.budget}
              value={form.budget}
              onChangeText={set('budget')}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Txt variant="labelSm" tone="faint" className="-mt-2">
            {copy.moneyHint}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: levelsOpen }}
            onPress={() => setLevelsOpen((open) => !open)}
            className="min-h-10 flex-row items-center gap-2 active:opacity-80"
          >
            <Txt variant="ui" className="flex-1">
              {copy.levels}
            </Txt>
            <Icon name={levelsOpen ? 'chevron-up' : 'chevron-down'} size={18} color="fgMuted" />
          </Pressable>
          {levelsOpen ? (
            <View className="gap-3">
              <Txt variant="labelSm" tone="faint">
                {copy.levelsHint}
              </Txt>
              <View className="flex-row gap-3">
                <Field label={copy.entry} value={form.entry} onChangeText={set('entry')} keyboardType="decimal-pad" className="flex-1" />
                <Field
                  label={copy.maxPrice}
                  value={form.maxPrice}
                  onChangeText={set('maxPrice')}
                  keyboardType="decimal-pad"
                  className="flex-1"
                />
              </View>
              <Field
                label={copy.invalidation}
                value={form.invalidation}
                onChangeText={set('invalidation')}
                keyboardType="decimal-pad"
              />
              <Field label={copy.targets} value={form.targets} onChangeText={set('targets')} keyboardType="numbers-and-punctuation" />
              <Field label={copy.days} value={form.days} onChangeText={set('days')} keyboardType="number-pad" maxLength={3} />
            </View>
          ) : null}
          <View className="gap-2">
            <Button
              title={priceWords === null ? copy.priceWait : copy.composeButton(priceWords)}
              onPress={submit}
              disabled={!built.ok || Boolean(paid?.blocked)}
            />
            {failure ? (
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
                  {failureLine(failure, copy)}
                </Txt>
                {failure.kind === 'short' && onTopUp ? (
                  <TopUpLink copy={copy} onPress={() => {
                    onClose()
                    onTopUp()
                  }} />
                ) : null}
              </View>
            ) : !built.ok && built.need.kind !== 'price' ? (
              <Txt variant="labelSm" tone="faint">
                {needLine(built.need, copy, labels)}
              </Txt>
            ) : paid ? (
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <Txt variant="labelSm" tone={paid.blocked ? 'warning' : 'faint'}>
                  {paid.blocked ? paid.text : `${paid.text} · ${copy.takenOnly}`}
                </Txt>
                {paid.short && onTopUp ? (
                  <TopUpLink copy={copy} onPress={() => {
                    onClose()
                    onTopUp()
                  }} />
                ) : null}
              </View>
            ) : price !== null && price > 0 ? (
              <Txt variant="labelSm" tone="faint">
                {copy.takenOnly}
              </Txt>
            ) : null}
          </View>
        </View>
      )}
    </Sheet>
  )
}

function TopUpLink({ copy, onPress }: { copy: PlanCopy; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} className="active:opacity-80">
      <Txt variant="ui" tone="brand">
        {copy.topUp}
      </Txt>
    </Pressable>
  )
}
