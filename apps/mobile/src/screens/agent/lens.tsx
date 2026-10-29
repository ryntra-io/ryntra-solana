import { useRouter } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DoorRow } from '@/components/door-row'
import { Icon, type IconName } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { figureView, type HandoffView } from '@/features/agent/agent-model'
import { contextParam } from '@/features/agent/context'
import { AGENT_COPY, type AgentCopy } from '@/features/agent/copy'
import { criticKindLabel, criticWords, LENS_COPY, type LensCopy } from '@/features/agent/lens-copy'
import {
  criticOffer,
  lensDoors,
  lensFailureOf,
  lensFindings,
  lensSources,
  sentencesOf,
  type LensFailure,
  type LensSubject,
} from '@/features/agent/lens-model'
import { useAgentBudget } from '@/features/agent/use-agent'
import { lensSubjectOf, useLensBrief, useLensCritic } from '@/features/agent/use-lens'
import { useAccount } from '@/features/session/use-account'
import { useOpenPlace } from '@/features/shell/open-place'
import { failureLine, signInFailureLine } from '@/features/wallet/signing-copy'
import { useNow } from '@/hooks/use-now'
import type {
  AgentBriefResponse,
  AgentContext,
  AgentCriticResponse,
  AgentFigure,
  AgentState,
  Session,
} from '@/lib/api'
import type { AgentHandoffKind, AgentSentence } from '@/lib/api/v1/types'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { formatMoment } from '@/utils/format'

/**
 * «Спитати Ryntra» on an asset, a plan or the portfolio — the web's Brief → Critic → Plan/Review (`lens-panel.tsx`).
 * The brief is read as the screen opens, composed from the reads: free, no model. The critic is an explicit press at
 * the price the server names, shown on the button and sent as exactly that. The doors lead where the person acts; the
 * boundary is said at the foot. Nothing here buys, sells or signs.
 */
export function LensScreen({ context, onBack }: { context: AgentContext | null; onBack: () => void }) {
  const router = useRouter()
  const subject = lensSubjectOf(context)

  useEffect(() => {
    // A context the Lens has nothing of its own to read in (a note, a page, none): the conversation in its place.
    if (subject) return
    router.replace((context ? { pathname: '/ryn', params: { context: contextParam(context) } } : '/ryn') as never)
  }, [subject, context, router])

  if (!subject) return <View className="flex-1 bg-ground" />
  return <LensSubjectScreen key={contextParam(subject)} subject={subject} onBack={onBack} />
}

type LensView = 'brief' | 'critic'

function LensSubjectScreen({ subject, onBack }: { subject: LensSubject; onBack: () => void }) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const copy = useCopy(LENS_COPY)
  const shared = useSharedCopy()
  const account = useAccount()
  const session = account.session
  const locale = useLocale()
  const brief = useLensBrief(session, subject, locale)
  const critic = useLensCritic(session, subject, locale)
  const [view, setView] = useState<LensView>('brief')

  const shown: AgentBriefResponse | AgentCriticResponse | null =
    view === 'critic' && critic.data ? critic.data : (brief.data ?? null)
  const chat = () => router.push({ pathname: '/ryn', params: { context: contextParam(subject) } } as never)

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader title={session && shown ? shown.title : copy.brief} onBack={onBack} backLabel={shared.back} />
      {session ? (
        <LensBody
          session={session}
          brief={brief}
          critic={critic}
          view={view}
          setView={setView}
          copy={copy}
          locale={locale}
          onChat={chat}
        />
      ) : (
        <Guest copy={copy} onChat={chat} />
      )}
      <View style={{ height: insets.bottom }} />
    </View>
  )
}

/** Without a signed-in wallet: one quiet line, the way in, and the conversation, which a guest may have. */
function Guest({ copy, onChat }: { copy: LensCopy; onChat: () => void }) {
  const account = useAccount()
  const shared = useSharedCopy()
  const locale = useLocale()
  const accountFailure = account.failure
    ? failureLine(account.failure.message, locale)
    : account.signInFailure
      ? signInFailureLine(account.signInFailure, locale)
      : null
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2">
      <Card className="gap-3">
        <Txt variant="ui" tone="muted">
          {copy.guestLine}
        </Txt>
        <Button
          title={account.address ? shared.signIn : shared.connectWallet}
          variant="primary"
          loading={account.busy === 'connect' || account.signingIn}
          onPress={() => void (account.address ? account.signIn() : account.connect())}
        />
        {accountFailure ? (
          <Txt variant="ui" tone="danger">
            {accountFailure}
          </Txt>
        ) : null}
      </Card>
      <Card padded={false}>
        <DoorRow icon="chatbubble-ellipses-outline" label={copy.chat} onPress={onChat} last />
      </Card>
      <Txt variant="labelSm" tone="faint">
        {copy.boundary}
      </Txt>
    </ScrollView>
  )
}

function LensBody({
  session,
  brief,
  critic,
  view,
  setView,
  copy,
  locale,
  onChat,
}: {
  session: Session
  brief: ReturnType<typeof useLensBrief>
  critic: ReturnType<typeof useLensCritic>
  view: LensView
  setView: (view: LensView) => void
  copy: LensCopy
  locale: Locale
  onChat: () => void
}) {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const shared = useSharedCopy()
  const account = useAccount()
  const agentCopy = useCopy(AGENT_COPY)
  const now = useNow(60_000)
  const budget = useAgentBudget(session)
  const [failure, setFailure] = useState<LensFailure | null>(null)

  if (brief.isPending) {
    return (
      <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar" accessibilityLabel={copy.reading}>
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-44 rounded-sm" />
        <Skeleton className="h-11 rounded-sm" />
        <Skeleton className="h-28 rounded-sm" />
      </View>
    )
  }
  if (!brief.data) {
    const why = lensFailureOf(brief.error)
    if (why === 'signIn') {
      return (
        <StateView
          icon="key-outline"
          title={copy.signIn}
          action={{ title: shared.signIn, onPress: () => void account.signIn(), loading: account.signingIn }}
        />
      )
    }
    return (
      <StateView
        icon={why === 'network' ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone={why === 'busy' ? 'neutral' : 'danger'}
        title={why === 'network' ? shared.noConnection : why === 'busy' ? copy.busy : copy.failed}
        action={{ title: shared.tryAgain, onPress: () => void brief.refetch(), loading: brief.isFetching }}
      />
    )
  }

  const read = brief.data
  const answered = view === 'critic' && critic.data ? critic.data : null
  const shown = answered ?? read
  const offer = criticOffer(budget.data ?? read.budget)
  const words = criticWords(offer, copy, locale)
  const doors = lensDoors(shown)
  const sources = lensSources(shown.citations)

  const challenge = () => {
    if (critic.isPending) return
    setFailure(null)
    critic.mutate(offer, {
      onSuccess: () => setView('critic'),
      onError: (error) => setFailure(lensFailureOf(error)),
    })
  }
  const back = () => {
    setFailure(null)
    setView('brief')
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-1">
      <Txt variant="labelSm" tone="faint">
        {[
          shown.composedBy === 'model' ? copy.composedModel : copy.composedDeterministic,
          copy.observed(formatMoment(shown.observedAt, now, locale)),
        ].join(' · ')}
      </Txt>

      <BriefCard brief={read.brief} copy={copy} />
      {answered ? <CriticCard critic={answered.critic} copy={copy} /> : null}

      <View className="gap-2">
        {answered ? (
          <Button title={copy.againBrief} variant="secondary" onPress={back} />
        ) : (
          <>
            <Button
              title={critic.isPending ? copy.challenging : words.button}
              variant="primary"
              loading={critic.isPending}
              onPress={challenge}
            />
            {words.paid ? (
              <View className="flex-row items-center gap-3">
                <Txt variant="labelSm" tone={words.topUp ? 'warning' : 'faint'} className="flex-1">
                  {words.paid}
                </Txt>
                {words.topUp ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/ryn?tab=credits' as never)}
                    hitSlop={8}
                    className="flex-row items-center gap-1 py-1 active:opacity-80"
                  >
                    <Txt variant="ui" tone="brand">
                      {copy.topUp}
                    </Txt>
                    <Icon name="chevron-forward" size={14} color="brand" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {words.note ? (
              <Txt variant="labelSm" tone="faint">
                {words.note}
              </Txt>
            ) : null}
          </>
        )}
        {failure ? (
          <FailureLine
            failure={failure}
            copy={copy}
            onRetry={challenge}
            onSignIn={() => void account.signIn()}
            signingIn={account.signingIn}
          />
        ) : null}
      </View>

      <Card padded={false}>
        {doors.map((door) => (
          <DoorRow
            key={door.path}
            icon={DOOR_ICON[door.kind]}
            label={doorTitle(door, agentCopy)}
            onPress={() => (door.path.startsWith('/(tabs)') ? openPlace(door.path) : router.push(door.path as never))}
          />
        ))}
        <DoorRow icon="chatbubble-ellipses-outline" label={copy.chat} onPress={onChat} last />
      </Card>

      {sources.length > 0 ? (
        <Fold title={copy.sources(sources.length)}>
          <View className="gap-3">
            {sources.map((source) => (
              <View key={source.key} className="gap-1">
                <Txt variant="ui">{source.source}</Txt>
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Txt variant="labelSm" tone="faint">
                    {source.observedAt ? formatMoment(source.observedAt, now, locale) : copy.noTime}
                  </Txt>
                  <Chip label={copy.state[source.state]} tone={STATE_TONE[source.state]} />
                </View>
              </View>
            ))}
          </View>
        </Fold>
      ) : null}

      <Txt variant="labelSm" tone="faint">
        {copy.boundary}
      </Txt>
    </ScrollView>
  )
}

/** A critic that did not answer, in one line beside the brief that stays; the network's with its retry. */
function FailureLine({
  failure,
  copy,
  onRetry,
  onSignIn,
  signingIn,
}: {
  failure: LensFailure
  copy: LensCopy
  onRetry: () => void
  onSignIn: () => void
  signingIn: boolean
}) {
  const shared = useSharedCopy()
  const line =
    failure === 'busy'
      ? copy.busy
      : failure === 'network'
        ? copy.network
        : failure === 'signIn'
          ? copy.signIn
          : failure === 'budget'
            ? copy.budget
            : copy.criticFailed
  const action =
    failure === 'network'
      ? { title: shared.tryAgain, onPress: onRetry, loading: false }
      : failure === 'signIn'
        ? { title: shared.signIn, onPress: onSignIn, loading: signingIn }
        : null
  return (
    <View className="flex-row items-center gap-3" accessibilityLiveRegion="polite">
      <Txt variant="ui" tone={failure === 'busy' ? 'muted' : 'danger'} className="flex-1">
        {line}
      </Txt>
      {action ? <Button title={action.title} variant="ghost" size="sm" loading={action.loading} onPress={action.onPress} /> : null}
    </View>
  )
}

/** «Стисло» at rest: what changed and what matters; the data, the gaps and the checks one tap deeper. */
function BriefCard({ brief, copy }: { brief: AgentBriefResponse['brief']; copy: LensCopy }) {
  if (brief.insufficient) {
    return (
      <Card>
        <Txt variant="ui" tone="muted">
          {copy.insufficient}
        </Txt>
      </Card>
    )
  }
  const deeper = sentencesOf(brief.supports).length + sentencesOf(brief.unknown).length + sentencesOf(brief.checks).length
  return (
    <Card className="gap-4">
      <Section title={copy.changed} rows={brief.changed} />
      <Section title={copy.matters} rows={brief.matters} />
      {deeper > 0 ? (
        <Fold title={copy.more}>
          <View className="gap-4">
            <Section title={copy.supports} rows={brief.supports} muted />
            <Section title={copy.unknown} rows={brief.unknown} muted />
            <Section title={copy.checks} rows={brief.checks} muted />
          </View>
        </Fold>
      ) : null}
    </Card>
  )
}

/** The critic: each finding by its kind, its words and the figures it stands on; what could not be challenged folded. */
function CriticCard({ critic, copy }: { critic: AgentCriticResponse['critic']; copy: LensCopy }) {
  const findings = lensFindings(critic)
  const gaps = sentencesOf(critic.gaps)
  return (
    <Card className="gap-4">
      <Txt variant="labelSm" tone="faint" caps>
        {copy.critic}
      </Txt>
      {critic.insufficient || findings.length === 0 ? (
        <Txt variant="ui" tone="muted">
          {copy.criticInsufficient}
        </Txt>
      ) : (
        <View className="gap-5">
          {findings.map((finding) => (
            <View key={finding.id} className="gap-2">
              <Chip label={criticKindLabel(finding.kind, copy)} tone="neutral" caps={false} />
              <Txt variant="body" selectable>
                {finding.text}
              </Txt>
              <Figures figures={finding.figures} copy={copy} />
            </View>
          ))}
        </View>
      )}
      <Fold title={copy.gaps}>
        <View className="gap-2">
          {gaps.map((gap, index) => (
            <Txt key={index} variant="ui" tone="muted" selectable>
              {gap}
            </Txt>
          ))}
          <Txt variant="labelSm" tone="faint">
            {copy.notChallenged}
          </Txt>
        </View>
      </Fold>
    </Card>
  )
}

/** Figures two to a row: the label, the value as it was read (a dash when it was not), its state when not current. */
function Figures({ figures, copy }: { figures: readonly AgentFigure[]; copy: LensCopy }) {
  if (figures.length === 0) return null
  return (
    <View className="flex-row flex-wrap" style={{ rowGap: 10 }}>
      {figures.map((figure, index) => {
        const view = figureView(figure)
        return (
          <View key={`${figure.label}-${index}`} className="gap-0.5 pr-3" style={{ width: '50%' }}>
            <Txt variant="labelSm" tone="faint" numberOfLines={1}>
              {view.label}
            </Txt>
            <Txt variant={figure.number !== null ? 'data' : 'ui'} numberOfLines={2} selectable>
              {view.value}
            </Txt>
            {view.flagged ? <Chip label={copy.state[view.state]} tone={STATE_TONE[view.state]} className="mt-0.5" /> : null}
          </View>
        )
      })}
    </View>
  )
}

function Section({ title, rows, muted = false }: { title: string; rows: readonly AgentSentence[]; muted?: boolean }) {
  const lines = sentencesOf(rows)
  if (lines.length === 0) return null
  return (
    <View className="gap-1.5">
      <Txt variant="labelSm" tone="faint" caps>
        {title}
      </Txt>
      {lines.map((line, index) => (
        <Txt key={index} variant="body" tone={muted ? 'muted' : 'fg'} selectable>
          {line}
        </Txt>
      ))}
    </View>
  )
}

/** One tap deeper, in place: the title as a quiet row, the rest under it once opened. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        className="min-h-10 flex-row items-center gap-2 active:opacity-80"
      >
        <Txt variant="ui" tone="muted" className="flex-1">
          {title}
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
      </Pressable>
      {open ? children : null}
    </View>
  )
}

const STATE_TONE: Readonly<Record<AgentState, 'neutral' | 'warning'>> = {
  current: 'neutral',
  stale: 'warning',
  unknown: 'neutral',
  unavailable: 'neutral',
}

const DOOR_ICON: Readonly<Record<AgentHandoffKind, IconName>> = {
  builder: 'construct-outline',
  review: 'shield-checkmark-outline',
  plan: 'document-text-outline',
  monitoring: 'notifications-outline',
  market: 'stats-chart-outline',
  stocks: 'business-outline',
  portfolio: 'wallet-outline',
  results: 'ribbon-outline',
  compare: 'git-compare-outline',
}

/** A door's words: the server's own where the phone's place is the same, the app's where it differs. */
function doorTitle(view: HandoffView, copy: AgentCopy): string {
  switch (view.words.kind) {
    case 'server':
      return view.handoff.label
    case 'asset':
      return copy.openAsset(view.words.symbol)
    default:
      return copy.open[view.words.kind]
  }
}
