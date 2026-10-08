import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { agentFailureOf, budgetView, QUESTION_MAX, questionOf, type AgentFailure } from '@/features/agent/agent-model'
import { AGENT_COPY, type AgentCopy } from '@/features/agent/copy'
import { useAgentBudget, useAsk, useConversation, usePendingQuestion } from '@/features/agent/use-agent'
import { useShelfNames } from '@/features/invest/use-shelf'
import { PLANS_COPY } from '@/features/plans/copy'
import { useCapabilities } from '@/features/plans/use-plans'
import { PRIVATE_QUERY_KEY, useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import type { AgentContext, MonitoringSurface, TradingPlan } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { type, useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatClock, formatCount } from '@/utils/format'

import type { CardContext } from './cards'
import { PersonTurn, ReadingTurn, RynTurn } from './turns'

export type RynScreenProps = {
  /** Where the conversation was opened from; null is the tab's own conversation. */
  context: AgentContext | null
  /** A stack screen's way back to where the person came from; the tab has none. */
  onBack?: () => void
  /** Words a link carried: they fill the composer, and the person sends them. */
  question?: string | null
}

/** The name of what the conversation is about, from what the phone already read — never a new request for a label. */
function useSubject(context: AgentContext | null, address: string | null): string | null {
  const queryClient = useQueryClient()
  const locale = useLocale()
  if (!context || !address) return null
  if (context.kind === 'asset') return context.symbol ?? null
  if (context.kind === 'plan') {
    const one = queryClient.getQueryData<{ plan: TradingPlan }>([PRIVATE_QUERY_KEY, 'plan', address, context.planId])
    const list = queryClient.getQueryData<{ plans: readonly TradingPlan[] }>([PRIVATE_QUERY_KEY, 'plans', address])
    return one?.plan.asset.symbol ?? list?.plans.find((plan) => plan.id === context.planId)?.asset.symbol ?? null
  }
  if (context.kind === 'note') {
    const surface = queryClient.getQueryData<MonitoringSurface>([PRIVATE_QUERY_KEY, 'monitoring', address, locale])
    return surface?.recent.find((note) => note.id === context.inboxId)?.context ?? null
  }
  return null
}

function contextLabel(context: AgentContext | null, subject: string | null, copy: AgentCopy): string | undefined {
  // Opened from the tab itself: the title and the line under it say everything.
  if (!context) return undefined
  switch (context.kind) {
    case 'asset':
      return copy.contextAsset(subject ?? context.mint.slice(0, 4))
    case 'plan':
      return copy.contextPlan(subject)
    case 'portfolio':
      return copy.contextPortfolio
    case 'note':
      return copy.contextNote(subject)
    default:
      return copy.contextPage
  }
}

function OpeningBody() {
  return (
    <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar">
      <Skeleton className="h-11 rounded-md" style={{ width: '60%', alignSelf: 'flex-end' }} />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-24 rounded-sm" />
    </View>
  )
}

/**
 * Ryntra, the product's one AI assistant, text-first: Ask → Understand →
 * Prepare → Review. Labelled as an AI in the header and in the first line
 * of the conversation. The conversation is the wallet's and the
 * server's; the phone asks, draws the answer with its sources and their
 * times, and opens the place each card or handoff names — the builder with a
 * draft, Trade's own fresh quote and Review, a plan, the inbox. There is no
 * Execute here, no model, no key and no microphone: Ryntra prepares, the
 * person and the wallet decide. One orange action at a time: the send while
 * there are words to send, else the latest answer's own action.
 */
export function RynScreen({ context, onBack, question }: RynScreenProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(AGENT_COPY)
  const plansCopy = useCopy(PLANS_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const session = account.session
  const subject = useSubject(context, account.address)
  const conversation = useConversation(session, context, locale)
  const ask = useAsk(session, context, locale)
  const pending = usePendingQuestion(session, context)
  const capabilities = useCapabilities()
  const walletBudget = useAgentBudget(session)
  const nameOf = useShelfNames()

  const [text, setText] = useState(question ?? '')
  const [failure, setFailure] = useState<AgentFailure | null>(null)
  // Words a new link carries fill the composer once, even when the screen was already open (state adjusted during render).
  const [seenQuestion, setSeenQuestion] = useState(question ?? null)
  if ((question ?? null) !== seenQuestion) {
    setSeenQuestion(question ?? null)
    if (question) setText(question)
  }
  const scrollRef = useRef<ScrollView>(null)
  const lastAskedY = useRef(0)

  const turns = conversation.data?.session.turns ?? []
  // The wallet's allowance is one figure across conversations: the latest any of them read.
  const budget = budgetView(walletBudget.data ?? conversation.data?.budget)

  // A new exchange starts at the question it answers; a question in flight shows at the end.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pending) scrollRef.current?.scrollToEnd({ animated: true })
      else scrollRef.current?.scrollTo({ y: Math.max(0, lastAskedY.current - 8), animated: true })
    }, 60)
    return () => clearTimeout(timer)
  }, [turns.length, pending])

  const open = (path: string) => {
    if (path.startsWith('/(tabs)')) router.navigate(path as never)
    else router.push(path as never)
  }
  const cardContext: CardContext = {
    copy,
    plans: plansCopy,
    locale,
    now,
    metrics: capabilities.data?.research.metrics ?? null,
    onOpen: open,
    nameOf,
  }

  const send = (words: string) => {
    const asked = questionOf(words)
    const sessionId = conversation.data?.session.id
    if (!asked || !sessionId || pending) return
    setFailure(null)
    setText('')
    ask.mutate(
      { sessionId, text: asked },
      {
        onError: (error) => {
          // The words come back to the composer: nothing the person wrote is lost to a failure.
          setText((current) => (current.trim().length === 0 ? asked : current))
          setFailure(agentFailureOf(error))
        },
      },
    )
  }

  let body
  if (!account.address) {
    body = (
      <StateView
        icon="sparkles-outline"
        title={copy.guestTitle}
        detail={copy.guestDetail}
        action={{ title: shared.connectWallet, onPress: () => void account.connect(), loading: account.busy === 'connect' }}
      >
        {account.failure ? (
          <Txt variant="ui" tone="danger" className="text-center">
            {account.failure.message}
          </Txt>
        ) : null}
      </StateView>
    )
  } else if (!session) {
    body = (
      <StateView
        icon="key-outline"
        title={copy.signInTitle}
        detail={copy.signInDetail}
        action={{ title: shared.signIn, onPress: () => void account.signIn(), loading: account.signingIn }}
      >
        {account.signInFailure ? (
          <Txt variant="ui" tone="danger" className="text-center">
            {account.signInFailure.message}
          </Txt>
        ) : null}
      </StateView>
    )
  } else if (conversation.isPending) {
    body = <OpeningBody />
  } else if (conversation.isError && !conversation.data) {
    const why = agentFailureOf(conversation.error)
    body =
      why === 'signIn' ? (
        <StateView
          icon="key-outline"
          title={copy.signInTitle}
          detail={copy.failure.signIn}
          action={{ title: shared.signIn, onPress: () => void account.signIn(), loading: account.signingIn }}
        />
      ) : (
        <StateView
          icon={why === 'network' ? 'cloud-offline-outline' : 'alert-circle-outline'}
          tone="danger"
          title={why === 'network' ? shared.noConnection : copy.openFailed}
          action={{ title: shared.tryAgain, onPress: () => void conversation.refetch(), loading: conversation.isFetching }}
        />
      )
  } else if (conversation.data) {
    const suggestions = conversation.data.suggestions
    const lastPersonIndex = turns.map((turn) => turn.role).lastIndexOf('person')
    const lastAnswerIndex = turns.map((turn) => turn.role).lastIndexOf('ryn')
    body = (
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-6 pt-2"
        keyboardShouldPersistTaps="handled"
        // While Ryntra reads, the question and the reading line stay in view as they are laid out.
        onContentSizeChange={() => {
          if (pending) scrollRef.current?.scrollToEnd({ animated: true })
        }}
      >
        <View className="gap-4 pt-2">
          <Txt variant="body" tone="muted">
            {copy.lead}
          </Txt>
          {turns.length === 0 && !pending && suggestions.length > 0 ? (
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.suggested}
              </Txt>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion.text}
                  accessibilityRole="button"
                  onPress={() => send(suggestion.text)}
                  className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
                >
                  <Txt variant="ui" className="flex-1">
                    {suggestion.text}
                  </Txt>
                  <Icon name="arrow-up-circle-outline" size={20} color="muted" />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        {turns.map((turn, index) =>
          turn.role === 'person' ? (
            <View
              key={turn.id}
              onLayout={index === lastPersonIndex ? (event) => (lastAskedY.current = event.nativeEvent.layout.y) : undefined}
            >
              <PersonTurn text={turn.text} />
            </View>
          ) : (
            <RynTurn
              key={turn.id}
              turn={turn}
              context={cardContext}
              emphasis={index === lastAnswerIndex && !pending && questionOf(text) === null}
            />
          ),
        )}
        {pending ? (
          <View className="gap-4">
            <PersonTurn text={pending} pending />
            <ReadingTurn copy={copy} />
          </View>
        ) : null}
      </ScrollView>
    )
  }

  const ready = Boolean(session && conversation.data)
  const canSend = ready && !pending && questionOf(text) !== null
  const budgetLine =
    budget === null
      ? null
      : budget.kind === 'reads'
        ? copy.budgetReads
        : budget.kind === 'spent'
          ? copy.budgetSpent(formatClock(budget.resetsAt))
          : copy.budgetOpen(budget.left, budget.allowance)

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={copy.title}
        subtitle={contextLabel(context, subject, copy)}
        onBack={onBack}
        backLabel={shared.back}
      />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1">{body}</View>
        {ready ? (
          <View className="gap-1.5 border-t border-line bg-ground px-4 pb-3 pt-3">
            {failure ? (
              <Txt variant="ui" tone={failure === 'network' ? 'muted' : 'danger'}>
                {copy.failure[failure]}
              </Txt>
            ) : null}
            <View className="flex-row items-end gap-2">
              <View className="flex-1 rounded-btn border border-line bg-surface px-3 py-2" style={{ minHeight: 44 }}>
                <TextInput
                  value={text}
                  onChangeText={(value) => {
                    setText(value)
                    if (failure && failure !== 'network') setFailure(null)
                  }}
                  placeholder={copy.placeholder}
                  placeholderTextColor={colors.fgMuted}
                  selectionColor={colors.brand}
                  cursorColor={colors.brand}
                  multiline
                  maxLength={QUESTION_MAX}
                  editable={!pending}
                  accessibilityLabel={copy.placeholder}
                  className="text-fg"
                  style={[type.body, { paddingVertical: 2, maxHeight: 120 }]}
                />
              </View>
              {/* Orange only while there are words to send: then the send is the screen's one action. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.ask}
                accessibilityState={{ disabled: !canSend, busy: Boolean(pending) }}
                disabled={!canSend}
                onPress={() => send(text)}
                className={cn(
                  'h-11 w-11 items-center justify-center rounded-btn',
                  canSend ? 'bg-brand active:bg-brand-pressed' : 'border border-line bg-surface',
                )}
              >
                <Icon name="arrow-up" size={22} color={canSend ? 'onBrand' : 'muted'} />
              </Pressable>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Txt variant="labelSm" tone="faint" className="flex-1" numberOfLines={1}>
                {budgetLine ?? ''}
              </Txt>
              {text.length > QUESTION_MAX - 200 ? (
                <Txt variant="labelSm" tone="faint">
                  {`${formatCount(text.length, locale)} / ${formatCount(QUESTION_MAX, locale)}`}
                </Txt>
              ) : null}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {/* The bottom inset under a stack screen's composer; the tab bar keeps its own. */}
      {onBack ? <View style={{ height: insets.bottom }} className="bg-ground" /> : null}
    </View>
  )
}
