import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ChoiceChips } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import {
  agentFailureOf,
  budgetView,
  guestMeterView,
  questionOf,
  shownPrice,
  type AgentFailure,
  type BudgetView,
  type GuestMeterView,
} from '@/features/agent/agent-model'
import { contextKey } from '@/features/agent/context'
import { AGENT_COPY, type AgentCopy } from '@/features/agent/copy'
import {
  useAgentBudget,
  useAsk,
  useConversation,
  useConversations,
  useFreshConversation,
  usePendingQuestion,
} from '@/features/agent/use-agent'
import {
  useClearGuest,
  useGuestAsk,
  useGuestMeter,
  useGuestThread,
  usePendingGuestQuestion,
} from '@/features/agent/use-guest'
import { useServerVoice, useVoiceLanguage } from '@/features/agent/use-voice'
import { withSpokenWords } from '@/features/agent/voice'
import { creditsChanged } from '@/features/assistant/use-credits'
import { profileKey, useMemory, useNewNotes, useProfile } from '@/features/assistant/use-memory'
import { coinName, companyDisplayName } from '@/features/invest/shelf'
import { useShelfNames } from '@/features/invest/use-shelf'
import { PLANS_COPY } from '@/features/plans/copy'
import { useCapabilities } from '@/features/plans/use-plans'
import { PRIVATE_QUERY_KEY, useAccount } from '@/features/session/use-account'
import { useOpenPlace } from '@/features/shell/open-place'
import { failureLine, signInFailureLine } from '@/features/wallet/signing-copy'
import { useNow } from '@/hooks/use-now'
import {
  assistantApi,
  type AgentContext,
  type AgentSessionSummary,
  type AgentTurn,
  type AssistantMemoryNote,
  type AssistantProfileResponse,
  type MarketDetailResponse,
  type MonitoringSurface,
  type StockAsset,
  type TradingPlan,
} from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { formatClock, formatMoment } from '@/utils/format'

import { BriefPanel } from './brief'
import type { CardContext } from './cards'
import { Composer } from './composer'
import { CreditsPanel } from './credits-panel'
import { Meet } from './meet'
import { KnowsSheet, RememberedLine } from './memory'
import { PlansPanel } from './plans-panel'
import { PersonTurn, ReadingTurn, RynTurn } from './turns'
import { WatchPanel, type AssistantToken } from './watch-panel'

export type RynScreenProps = {
  /** Where the conversation was opened from; null is the general conversation. */
  context: AgentContext | null
  /** A stack screen's way back to where the person came from. */
  onBack?: () => void
  /** Words a link carried: they fill the composer, and the person sends them. */
  question?: string | null
  /**
   * The question a door asks itself («Пояснити рух»): sent once when the conversation is ready, and only while it is
   * free (`acceptCredits` 0); past the day's free ones its words wait in the field at the price the line shows.
   */
  ask?: boolean
  /** A brief's day (`?brief=2026-10-18`, a note's link) or `latest`: the morning brief is opened first, that day's. */
  brief?: string | null
  /** The tab a door opened the assistant on — «Стежити» opens «Стежу», «План» opens «Плани». */
  tab?: AssistantTab | null
  /** A watch's note (`?watch=wch_…` or `all`): «Стежу» with that watch in view. */
  watch?: string | null
  /** A task's note (`?task=t_…`): the task's conversation — every run's answer. */
  task?: string | null
  /** A credits order the person came back to (its payment link or note): «Кредити» with its state. */
  order?: string | null
}

/** The assistant's tabs, as on the web: Розмова · Стежу · Плани · Огляди · Кредити. */
export type AssistantTab = 'chat' | 'watch' | 'plans' | 'brief' | 'credits'

type Mode = AssistantTab

/** The tab the screen opens on: the one a door asked for, else a note's own — a watch, a brief, an order — else the conversation. */
function openingTab(
  tab: AssistantTab | null,
  watch: string | null,
  brief: string | null,
  order: string | null,
): AssistantTab {
  if (tab) return tab
  if (watch) return 'watch'
  if (brief) return 'brief'
  if (order) return 'credits'
  return 'chat'
}

/**
 * The name of what the conversation is about, from what the phone already read — never a new request for a label, and
 * never an address. An asset is named as its page names it (the shelf's company, the issuer's company, the coin's own
 * name), else by its ticker; with none of them read, nothing is said (ST-5 r4: «About XsDo» was a mint's first letters).
 */
function useSubject(
  context: AgentContext | null,
  address: string | null,
  nameOf: (mint: string) => string | null,
): string | null {
  const queryClient = useQueryClient()
  const locale = useLocale()
  if (!context) return null
  if (context.kind === 'asset') {
    const shelf = nameOf(context.mint)
    if (shelf) return shelf
    const rep = queryClient.getQueryData<StockAsset>(['stocks', 'asset', context.mint])?.row.representation
    if (rep) return companyDisplayName(rep.underlying.name ?? rep.name, rep.underlying.symbol)
    const market = queryClient.getQueryData<MarketDetailResponse>(['market', context.mint])?.market
    if (market) return coinName(market)
    return context.symbol ?? null
  }
  if (!address) return null
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
  // The general conversation: the title says everything.
  if (!context) return undefined
  switch (context.kind) {
    case 'asset':
      // An asset with no name read says nothing rather than an address.
      return subject ? copy.contextAsset(subject) : undefined
    case 'plan':
      return copy.contextPlan(subject)
    case 'portfolio':
      return copy.contextPortfolio
    case 'note':
      return copy.contextNote(subject)
    default:
      // A list's own door («Зі сторінки») names no place: the header says nothing more than the title (ST-5 r4).
      return undefined
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

function walletLine(budget: BudgetView | null, copy: AgentCopy): string | null {
  // Only a count or a time is said under the composer; answers from Ryntra's own data need no line.
  if (budget === null || budget.kind === 'reads') return null
  switch (budget.kind) {
    case 'spent':
      return copy.budgetSpent(formatClock(budget.resetsAt))
    case 'open':
      return copy.budgetOpen(budget.left, budget.allowance)
    case 'free':
      return copy.freeLeft(budget.left)
    case 'balance':
      return budget.free > 0
        ? copy.creditsPartly(budget.price, budget.free, budget.rest, budget.balance)
        : copy.creditsFromBalance(budget.price, budget.balance)
    case 'dayCap':
      return copy.creditsDayCap(formatClock(budget.resetsAt))
    default:
      return copy.freeSpent(formatClock(budget.resetsAt))
  }
}

function guestLine(meter: GuestMeterView, copy: AgentCopy): string | null {
  switch (meter.kind) {
    case 'note':
      return copy.guestNote
    case 'reads':
      return null
    case 'spent':
      return copy.guestSpent
    default:
      return copy.guestOpen(Math.max(0, meter.allowance - meter.used), meter.allowance)
  }
}

/** A quiet icon in the header: the conversations, a new conversation. Never orange — the send is the screen's action. */
function HeaderIcon({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: 'time-outline' | 'create-outline' | 'person-circle-outline'
  label: string
  onPress: () => void
  busy?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(busy) }}
      disabled={busy}
      onPress={onPress}
      hitSlop={6}
      className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
      style={{ opacity: busy ? 0.5 : 1 }}
    >
      <Icon name={icon} size={20} color="muted" />
    </Pressable>
  )
}

/** The questions to start with: what to ask, each sent as it is with one tap. */
function Starters({
  title,
  line,
  starters,
  onAsk,
}: {
  title: string
  line: string
  starters: readonly string[]
  onAsk: (text: string) => void
}) {
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Txt variant="title">{title}</Txt>
        <Txt variant="ui" tone="muted">
          {line}
        </Txt>
      </View>
      {starters.length > 0 ? (
        <View className="gap-2">
          {starters.map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              onPress={() => onAsk(text)}
              className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
            >
              <Txt variant="ui" className="flex-1">
                {text}
              </Txt>
              <Icon name="arrow-up-circle-outline" size={20} color="muted" />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** The turns of a conversation, the question in flight at its end; a new exchange starts at the question it answers. */
function Turns({
  turns,
  pending,
  cardContext,
  copy,
  composing,
  lead,
}: {
  turns: readonly AgentTurn[]
  pending: string | null
  cardContext: CardContext
  copy: AgentCopy
  /** Words in the composer: the send is then the screen's one orange action, not an answer's. */
  composing: boolean
  lead: ReactNode
}) {
  const scrollRef = useRef<ScrollView>(null)
  const lastAskedY = useRef(0)
  const lastPersonIndex = turns.map((turn) => turn.role).lastIndexOf('person')
  const lastAnswerIndex = turns.map((turn) => turn.role).lastIndexOf('ryn')

  useEffect(() => {
    const timer = setTimeout(() => {
      if (pending) scrollRef.current?.scrollToEnd({ animated: true })
      else scrollRef.current?.scrollTo({ y: Math.max(0, lastAskedY.current - 8), animated: true })
    }, 60)
    return () => clearTimeout(timer)
  }, [turns.length, pending])

  return (
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
      {lead}
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
            emphasis={index === lastAnswerIndex && !pending && !composing}
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

/** The conversations of the wallet, the most recent first; the one open now is marked, every other opens. */
function ConversationsSheet({
  visible,
  onClose,
  sessions,
  state,
  currentId,
  onPick,
  onRetry,
  copy,
  now,
  locale,
}: {
  visible: boolean
  onClose: () => void
  sessions: readonly AgentSessionSummary[]
  state: 'loading' | 'failed' | 'ready'
  currentId: string | null
  onPick: (summary: AgentSessionSummary) => void
  onRetry: () => void
  copy: AgentCopy
  now: number
  locale: CardContext['locale']
}) {
  const shared = useSharedCopy()
  return (
    <Sheet visible={visible} title={copy.conversations} subtitle={copy.retention} onClose={onClose} scroll>
      <View className="pb-3">
        {state === 'loading' ? (
          <View className="gap-3" accessibilityRole="progressbar">
            <Skeleton className="h-12 rounded-sm" />
            <Skeleton className="h-12 rounded-sm" />
            <Skeleton className="h-12 rounded-sm" />
          </View>
        ) : state === 'failed' ? (
          <View className="gap-2">
            <Txt variant="ui" tone="danger">
              {copy.conversationsFailed}
            </Txt>
            <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={6} className="self-start py-1 active:opacity-80">
              <Txt variant="ui" tone="brand">
                {shared.tryAgain}
              </Txt>
            </Pressable>
          </View>
        ) : sessions.length === 0 ? (
          <Txt variant="ui" tone="muted">
            {copy.noConversations}
          </Txt>
        ) : (
          sessions.map((summary, index) => {
            const current = summary.id === currentId
            const when = formatMoment(summary.updatedAt, now, locale)
            return (
              <Pressable
                key={summary.id}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                disabled={current}
                onPress={() => onPick(summary)}
                className={`gap-1 py-3 active:opacity-80 ${index < sessions.length - 1 ? 'border-b border-line' : ''}`}
              >
                <Txt variant="ui" numberOfLines={2} tone={current ? 'muted' : 'fg'}>
                  {summary.title ?? copy.untitled}
                </Txt>
                <Txt variant="labelSm" tone="faint">
                  {current ? `${when} · ${copy.openNow}` : when}
                </Txt>
              </Pressable>
            )
          })
        )}
      </View>
    </Sheet>
  )
}

/**
 * Ryntra, the product's one AI assistant, as on the web: a market question without a wallet (the guest's
 * conversation lives on this phone only); with a signed-in wallet, five tabs — Розмова · Стежу · Плани · Огляди ·
 * Кредити: the wallet's conversations (the list, «Нова розмова»), «Знайомство» once and what Ryntra knows, the token
 * watches and «Доручення», the trade plans with the critic, the morning brief, the credits and their purchase. Labelled
 * as an AI. Every question with the model says its price before it is asked — free, then from the balance — and
 * carries exactly that price. No tool here signs, trades or saves on its own: Ryntra prepares; the person and the
 * wallet decide. The microphone is the phone's own speech to text, or a recording Ryntra's server hears at the price
 * shown — the words land in the field to be read and edited; voice is input only.
 */
export function RynScreen({
  context: openedWith,
  onBack,
  question,
  ask = false,
  brief = null,
  tab = null,
  watch = null,
  task = null,
  order = null,
}: RynScreenProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const queryClient = useQueryClient()
  const openPlace = useOpenPlace()
  const locale = useLocale()
  const copy = useCopy(AGENT_COPY)
  const plansCopy = useCopy(PLANS_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const session = account.session
  const nameOf = useShelfNames()
  const capabilities = useCapabilities()

  // The conversation shown: the one the screen was opened for, or one the person chose from the list or opened anew.
  const [active, setActive] = useState<{ context: AgentContext | null; pick: string | null }>({
    context: openedWith,
    pick: null,
  })
  const [mode, setMode] = useState<Mode>(openingTab(tab, watch, brief, order))
  const [seen, setSeen] = useState({ key: contextKey(openedWith), brief, tab, watch, task, order })
  // A new link while the screen is open: its context, its tab and the note it names (state adjusted during render).
  if (
    seen.key !== contextKey(openedWith) ||
    seen.brief !== brief ||
    seen.tab !== tab ||
    seen.watch !== watch ||
    seen.task !== task ||
    seen.order !== order
  ) {
    setSeen({ key: contextKey(openedWith), brief, tab, watch, task, order })
    setActive({ context: openedWith, pick: null })
    setMode(openingTab(tab, watch, brief, order))
  }
  const context = active.context

  const subject = useSubject(context, account.address, nameOf)
  const conversation = useConversation(session, context, locale, active.pick)
  const askWallet = useAsk(session, context, locale, active.pick)
  const pendingAsked = usePendingQuestion(session, context)
  const walletBudget = useAgentBudget(session)
  const fresh = useFreshConversation(session, locale)
  const [listOpen, setListOpen] = useState(false)
  const conversations = useConversations(session, listOpen)

  const guestThread = useGuestThread(context)
  const guestMeter = useGuestMeter()
  const askGuest = useGuestAsk(context, locale)
  const pendingGuest = usePendingGuestQuestion(context)
  const clearGuest = useClearGuest(context)

  const [text, setText] = useState(question ?? '')
  const [failure, setFailure] = useState<AgentFailure | null>(null)
  // Words a new link carries fill the composer once, even when the screen was already open (state adjusted during render).
  const [seenQuestion, setSeenQuestion] = useState(question ?? null)
  if ((question ?? null) !== seenQuestion) {
    setSeenQuestion(question ?? null)
    if (question && !ask) setText(question)
  }

  const guest = session === null
  // A wallet's question in flight is shown over the conversation it was asked in, not over another of the same context.
  const pendingWallet =
    pendingAsked && pendingAsked.sessionId === conversation.data?.session.id ? pendingAsked.text : null
  // Anything in flight for this context keeps the composer and the conversation controls still.
  const busy = guest ? pendingGuest !== null : pendingAsked !== null || fresh.isPending
  const pending = guest ? pendingGuest : pendingWallet
  const turns: readonly AgentTurn[] = guest ? (guestThread.data?.turns ?? []) : (conversation.data?.session.turns ?? [])
  const ready = guest ? true : Boolean(conversation.data)
  const budget = walletBudget.data ?? conversation.data?.budget ?? null
  const credits = budget?.credits ?? null

  // «Знайомство» once, after the conversation is open; a door that asked a question or opened a tab is answered first.
  const openedFor = question !== null && question !== undefined ? 'question' : tab && tab !== 'chat' ? 'tab' : null
  const profile = useProfile(session, ready && !guest)
  const [meetShown, setMeetShown] = useState<'auto' | 'edit' | 'closed'>('auto')
  const meetMode: 'first' | 'edit' | null =
    guest || !profile.data
      ? null
      : meetShown === 'edit'
        ? 'edit'
        : meetShown === 'auto' && profile.data.profile === null && openedFor === null && !ask && turns.length === 0
          ? 'first'
          : null
  // What Ryntra keeps about the person: read when «Що Ryntra знає» opens, and after each message for what it left.
  const [knowsOpen, setKnowsOpen] = useState(false)
  const memory = useMemory(session, knowsOpen)
  const newNotes = useNewNotes(session)
  const [remembered, setRemembered] = useState<readonly AssistantMemoryNote[]>([])
  // A note forgotten meanwhile in «Що Ryntra знає» is no longer said under the conversation.
  const kept = memory.data ? remembered.filter((note) => memory.data.notes.some((one) => one.id === note.id)) : remembered

  // The voice: the language the person speaks, and the recording the server hears where the phone cannot.
  const [voiceLanguage, toggleVoiceLanguage] = useVoiceLanguage(locale)
  const serverVoice = useServerVoice({
    session,
    locale: voiceLanguage,
    perBlock: credits ? credits.prices.voice : null,
    onWords: (words) => setText((current) => withSpokenWords(current, words, 2000)),
    onCredits: (after) => {
      if (session) creditsChanged(queryClient, session.address, after)
    },
    disabled: busy,
  })

  const open = (path: string) => {
    if (path.startsWith('/(tabs)')) openPlace(path)
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

  /** `typed` — the person's own words from the field: only those may be kept in Ryntra's memory. */
  const send = (words: string, typed = false) => {
    const asked = questionOf(words)
    if (!asked || busy) return
    const onError = (error: unknown) => {
      // The words come back to the composer: nothing the person wrote is lost to a failure.
      setText((current) => (current.trim().length === 0 ? asked : current))
      setFailure(agentFailureOf(error))
    }
    if (guest) {
      setFailure(null)
      setText('')
      askGuest.mutate(asked, { onError })
      return
    }
    const sessionId = conversation.data?.session.id
    if (!sessionId) return
    setFailure(null)
    setText('')
    setRemembered([])
    const before = typed ? newNotes.snapshot() : null
    askWallet.mutate(
      { sessionId, text: asked, acceptCredits: shownPrice(budget), typed },
      {
        onError,
        // A note this message left is said under the conversation, with «Забути» — nothing is kept unseen. Only the
        // person's typed words may be kept, so only those are looked after.
        onSuccess: () => {
          if (typed) void newNotes.since(before).then((notes) => setRemembered(notes))
        },
      },
    )
  }

  // Past the free ones a door's question waits in the field, at the price the line under it says.
  const holdForPress = (words: string) => setText(words)

  // A door's own question («Пояснити рух») is asked once per link — its context and words — when the conversation is
  // ready, and only while it is free: past the free ones it waits in the field at its price (a ref: no render reads it).
  const doorQuestion = ask ? (question ?? null) : null
  const doorKey = doorQuestion ? `${contextKey(openedWith)}|${doorQuestion}` : null
  const askedDoor = useRef<string | null>(null)
  useEffect(() => {
    if (!doorQuestion || !doorKey || askedDoor.current === doorKey || !ready || busy || mode !== 'chat') return
    askedDoor.current = doorKey
    // Once per link, when the conversation is ready: the field takes the door's words (a read of the server's budget).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!guest && shownPrice(budget)) holdForPress(doorQuestion)
    else send(doorQuestion)
    // Once per opening, when the conversation is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorKey, ready, busy, mode])

  // A task's note opens the task's conversation — every run's answer — once the tasks are read.
  const openedTask = useRef<string | null>(null)
  useEffect(() => {
    if (!task || !session || openedTask.current === task) return
    openedTask.current = task
    void assistantApi
      .tasks(session)
      .then((read) => {
        const sessionId = read.tasks.find((one) => one.id === task)?.sessionId ?? null
        if (sessionId) {
          setActive({ context: null, pick: sessionId })
          setMode('chat')
        }
      })
      .catch(() => undefined)
  }, [task, session])

  const newConversation = () => {
    // While Ryntra reads, the conversation stays: its answer lands where it was asked.
    if (busy) return
    setFailure(null)
    setRemembered([])
    if (guest) {
      clearGuest()
      return
    }
    fresh.mutate(context, {
      // Opened anew unless the person chose another conversation meanwhile.
      onSuccess: (opened) =>
        setActive((current) =>
          current.context === context && current.pick === active.pick ? { context, pick: opened.session.id } : current,
        ),
    })
  }
  const pickConversation = (summary: AgentSessionSummary) => {
    setListOpen(false)
    setFailure(null)
    setRemembered([])
    setActive({ context: summary.context, pick: summary.id })
  }
  // «Чому?» on a watch, a question about a plan: into the conversation's field, asked on the person's press at its price.
  const intoChat = useCallback((words: string) => {
    setMode('chat')
    setText(words.slice(0, 2000))
  }, [])
  const openConversation = useCallback((sessionId: string) => {
    setActive({ context: null, pick: sessionId })
    setMode('chat')
  }, [])

  const ownDoor = guest ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => void (account.address ? account.signIn() : account.connect())}
      disabled={account.busy === 'connect' || account.signingIn}
      className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
    >
      <Icon name={account.address ? 'key-outline' : 'wallet-outline'} size={18} color="muted" />
      <View className="flex-1 gap-0.5">
        <Txt variant="ui">{account.address ? shared.signIn : shared.connectWallet}</Txt>
        <Txt variant="labelSm" tone="faint">
          {copy.guestOwn}
        </Txt>
      </View>
      <Icon name="chevron-forward" size={16} color="fgMuted" />
    </Pressable>
  ) : null
  const accountFailure = account.failure
    ? failureLine(account.failure.message, locale)
    : account.signInFailure
      ? signInFailureLine(account.signInFailure, locale)
      : null

  const meet =
    meetMode && session && profile.data ? (
      <Meet
        key={meetMode}
        session={session}
        read={profile.data}
        mode={meetMode}
        onDone={(next: AssistantProfileResponse) => {
          queryClient.setQueryData(profileKey(session.address), next)
          setMeetShown('closed')
        }}
        onCancel={() => setMeetShown('closed')}
        onFirstWatch={() => {
          setMeetShown('closed')
          setMode('watch')
        }}
      />
    ) : null

  let chatBody: ReactNode
  if (!guest && conversation.isPending) {
    chatBody = <OpeningBody />
  } else if (!guest && conversation.isError && !conversation.data) {
    const why = agentFailureOf(conversation.error)
    chatBody =
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
  } else {
    const starters = guest
      ? [copy.guestAsk1, copy.guestAsk2, copy.guestAsk3, copy.guestAsk4]
      : (conversation.data?.suggestions ?? []).map((suggestion) => suggestion.text)
    const empty = turns.length === 0 && !pending
    chatBody = (
      <Turns
        turns={turns}
        pending={pending}
        cardContext={cardContext}
        copy={copy}
        composing={questionOf(text) !== null}
        lead={
          <View className="gap-4 pt-2">
            {meet}
            {empty && !meet ? (
              <Starters
                title={copy.emptyTitle}
                line={guest ? copy.emptyLineGuest : copy.emptyLine}
                starters={starters}
                onAsk={(words) => send(words)}
              />
            ) : null}
            <Txt variant="labelSm" tone="faint">
              {copy.lead}
            </Txt>
            {ownDoor}
            {accountFailure && guest ? (
              <Txt variant="ui" tone="danger">
                {accountFailure}
              </Txt>
            ) : null}
          </View>
        }
      />
    )
  }

  const footLine = guest
    ? guestLine(guestMeterView(guestMeter.data ?? { day: null, model: null }, now), copy)
    : walletLine(budgetView(budget), copy)

  // The tabs the wallet has: «Кредити» only where credits are served.
  const tabs: readonly { value: Mode; label: string }[] = [
    { value: 'chat', label: copy.tabChat },
    { value: 'watch', label: copy.tabWatch },
    { value: 'plans', label: copy.tabPlans },
    { value: 'brief', label: copy.tabBriefs },
    // Unknown until the budget is read: a link to «Кредити» keeps its tab; switched off, there is none.
    ...(credits || !budget ? [{ value: 'credits' as const, label: copy.tabCredits }] : []),
  ]
  const shown: Mode = guest ? 'chat' : tabs.some((one) => one.value === mode) ? mode : 'chat'
  const assetToken: AssistantToken | null =
    context?.kind === 'asset' ? { mint: context.mint, symbol: subject ?? context.symbol ?? null } : null

  // A guest's one control sits in the header; a wallet's «Що Ryntra знає» there, the conversation's two beside the tabs.
  const headerRight = guest ? (
    turns.length > 0 ? (
      <HeaderIcon icon="create-outline" label={copy.newConversation} onPress={newConversation} busy={busy} />
    ) : undefined
  ) : (
    // The balance is on the way in («Ще → Ryntra») and in «Кредити»; here the title keeps its one line at 390.
    <HeaderIcon icon="person-circle-outline" label={copy.knowsTitle} onPress={() => setKnowsOpen(true)} />
  )

  let body: ReactNode
  if (shown === 'brief' && session) {
    body = <BriefPanel session={session} copy={copy} day={brief} />
  } else if (shown === 'watch' && session) {
    body = (
      <WatchPanel
        session={session}
        focusId={watch}
        token={assetToken}
        onAsk={intoChat}
        taskId={task}
        onOpenConversation={openConversation}
      />
    )
  } else if (shown === 'plans' && session) {
    body = <PlansPanel session={session} token={assetToken} onAsk={intoChat} onTopUp={() => setMode('credits')} />
  } else if (shown === 'credits' && session) {
    body = <CreditsPanel session={session} orderId={order} />
  } else {
    body = (
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1">{chatBody}</View>
        {ready && session && kept.length > 0 ? (
          <RememberedLine session={session} notes={kept} onDismiss={() => setRemembered([])} />
        ) : null}
        {ready ? (
          <Composer
            value={text}
            onChange={(value) => {
              setText(value)
              if (failure && failure !== 'network') setFailure(null)
            }}
            onSend={() => send(text, true)}
            pending={busy}
            placeholder={guest ? copy.guestPlaceholder : copy.placeholder}
            failure={failure ? copy.failure[failure] : null}
            failureQuiet={failure === 'network'}
            footLine={footLine}
            copy={copy}
            voice={{
              language: voiceLanguage,
              onToggleLanguage: toggleVoiceLanguage,
              server: guest || !credits ? null : serverVoice,
              perBlock: credits ? credits.prices.voice : null,
            }}
          />
        ) : null}
      </KeyboardAvoidingView>
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={copy.title}
        subtitle={shown === 'chat' ? contextLabel(context, subject, copy) : undefined}
        onBack={onBack}
        backLabel={shared.back}
        right={headerRight}
      />
      {guest ? null : (
        <View className="h-12 flex-row items-center gap-1 pb-2 pl-4 pr-2">
          <View className="flex-1">
            <ChoiceChips role="tablist" size="sm" scroll value={shown} onChange={setMode} choices={tabs} />
          </View>
          {shown === 'chat' ? (
            <>
              <HeaderIcon
                icon="time-outline"
                label={copy.conversations}
                onPress={() => setListOpen(true)}
                busy={busy}
              />
              <HeaderIcon
                icon="create-outline"
                label={copy.newConversation}
                onPress={newConversation}
                busy={busy}
              />
            </>
          ) : null}
        </View>
      )}
      {body}
      {/* The bottom inset under a stack screen's composer. */}
      {onBack ? <View style={{ height: insets.bottom }} className="bg-ground" /> : null}
      {guest ? null : (
        <ConversationsSheet
          visible={listOpen}
          onClose={() => setListOpen(false)}
          sessions={conversations.data?.sessions ?? []}
          state={conversations.isPending ? 'loading' : conversations.isError && !conversations.data ? 'failed' : 'ready'}
          currentId={conversation.data?.session.id ?? null}
          onPick={pickConversation}
          onRetry={() => void conversations.refetch()}
          copy={copy}
          now={now}
          locale={locale}
        />
      )}
      {session ? (
        <KnowsSheet
          visible={knowsOpen}
          onClose={() => setKnowsOpen(false)}
          session={session}
          onChangeProfile={() => {
            setKnowsOpen(false)
            setMode('chat')
            setMeetShown('edit')
          }}
        />
      ) : null}
    </View>
  )
}
