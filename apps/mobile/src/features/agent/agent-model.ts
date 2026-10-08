/**
 * The assistant as values — pure. The conversation is the server's: one
 * session per wallet and context, the turns it keeps, answers composed over
 * the product's own reads, cards whose every figure a tool read, handoffs to
 * the pages where the person acts. This module only shapes those answers for
 * the phone — an assistant turn as the screen draws it (the lead, what sits
 * one tap deeper, the sources with their times, the one action drawn
 * orange), a figure honest about its state, each card and handoff onto the
 * phone's own screen, the budget as it stands, a refusal in the app's words.
 * Nothing here reads the network, and nothing here signs, submits or saves:
 * Ryntra prepares; the builder, the Review and the wallet decide.
 */

import { ApiError } from '../../lib/api.ts'
import type {
  AgentBudgetState,
  AgentCard,
  AgentCitation,
  AgentFigure,
  AgentHandoff,
  AgentHandoffKind,
  AgentMessageResponse,
  AgentSentence,
  AgentSession,
  AgentState,
  AgentTurn,
} from '../../lib/api/v1/types.ts'
import { DASH } from '../../utils/format.ts'
import { mapDeepLink } from '../monitoring/deep-link.ts'

/** The contract's own bounds: a question of 1–2000 characters; the server keeps the last forty turns. */
export const QUESTION_MAX = 2000
export const TURNS_KEPT = 40

/** The words to send, or null when there is nothing to send or too much of it. */
export function questionOf(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length === 0 || trimmed.length > QUESTION_MAX ? null : trimmed
}

/* ---- an assistant turn as the screen draws it ---- */

/** A sentence and the numbers of the sources it stands on; a sentence with none is the assistant's own reasoning. */
export type SentenceView = Readonly<{ text: string; marks: readonly number[] }>

/** One source as the turn's foot lists it: the number its sentences carry, the source, when it was read, its state. */
export type SourceView = Readonly<{
  n: number
  source: string
  observedAt: string | null
  state: AgentState
}>

export type RynTurnView = Readonly<{
  id: string
  at: string
  headline: string
  /** The assistant refused to execute or to share a secret; the reason is the app's own words. */
  refusal: 'execute' | 'secret' | null
  /** The reads did not give enough to judge — said instead of invented. */
  insufficient: boolean
  /** What is known now and what it means — the answer at rest. */
  lead: readonly SentenceView[]
  /** What could make it wrong, the risks and unknowns, what to check — one tap deeper. */
  deeper: Readonly<{ counter: readonly SentenceView[]; risks: readonly SentenceView[]; checks: readonly SentenceView[] }>
  deeperCount: number
  /** Neutral options, never a command to buy or sell. */
  actions: readonly SentenceView[]
  cards: readonly AgentCard[]
  /** The pages the person may open next, less those a draft card already carries; at most one primary, first. */
  handoffs: readonly AgentHandoff[]
  sources: readonly SourceView[]
  /** The weakest state among the sources the answer cites: `stale` or `unavailable` is said at the head of the turn. */
  weakest: AgentState | null
  composedBy: 'model' | 'deterministic' | null
}>

const STATE_RANK: Readonly<Record<AgentState, number>> = { current: 0, stale: 1, unknown: 2, unavailable: 3 }

function sentencesOf(sentences: readonly AgentSentence[], numbers: ReadonlyMap<string, number>): SentenceView[] {
  return sentences
    .filter((sentence) => sentence.text.trim().length > 0)
    .map((sentence) => ({
      text: sentence.text.trim(),
      marks: [...new Set(sentence.cites.map((id) => numbers.get(id)).filter((n): n is number => n !== undefined))],
    }))
}

export function isDraftCard(card: AgentCard): card is Extract<AgentCard, { handoff: AgentHandoff }> {
  return card.kind === 'planDraft' || card.kind === 'monitoringDraft' || card.kind === 'tradeDraft'
}

/** The turn's handoffs as the phone offers them: none twice, none a draft card already carries, one primary at most — first. */
export function turnHandoffs(turn: Pick<AgentTurn, 'cards' | 'handoffs'>): AgentHandoff[] {
  const carried = new Set(turn.cards.filter(isDraftCard).map((card) => card.handoff.href))
  const seen = new Set<string>()
  const kept: AgentHandoff[] = []
  for (const handoff of turn.handoffs) {
    if (carried.has(handoff.href) || seen.has(handoff.href)) continue
    seen.add(handoff.href)
    kept.push(handoff)
  }
  const primary = kept.findIndex((handoff) => handoff.primary)
  return kept
    .map((handoff, index) => ({ ...handoff, primary: index === primary }))
    .sort((a, b) => Number(b.primary) - Number(a.primary))
}

/** The assistant's turn, shaped for the screen. The words are the server's, in the language the session speaks. */
export function rynTurnView(turn: AgentTurn): RynTurnView {
  const numbers = new Map<string, number>()
  turn.citations.forEach((citation, index) => numbers.set(citation.id, index + 1))
  const answer = turn.answer
  const deeper = {
    counter: answer ? sentencesOf(answer.counter, numbers) : [],
    risks: answer ? sentencesOf(answer.risks, numbers) : [],
    checks: answer ? sentencesOf(answer.checks, numbers) : [],
  }
  const lead = answer ? [...sentencesOf(answer.observation, numbers), ...sentencesOf(answer.meaning, numbers)] : []
  const cited = new Set(
    answer
      ? [...answer.observation, ...answer.meaning, ...answer.counter, ...answer.risks, ...answer.checks, ...answer.actions]
          .flatMap((sentence) => sentence.cites)
      : [],
  )
  const citedStates = turn.citations.filter((citation) => cited.has(citation.id)).map((citation) => citation.state)
  const weakest = citedStates.reduce<AgentState | null>(
    (worst, state) => (worst === null || STATE_RANK[state] > STATE_RANK[worst] ? state : worst),
    null,
  )
  return {
    id: turn.id,
    at: turn.at,
    headline: turn.text,
    refusal: turn.refusal?.code ?? null,
    insufficient: answer?.insufficient ?? false,
    lead,
    deeper,
    deeperCount: deeper.counter.length + deeper.risks.length + deeper.checks.length,
    actions: answer ? sentencesOf(answer.actions, numbers) : [],
    cards: turn.cards,
    handoffs: turnHandoffs(turn),
    sources: turn.citations.map((citation: AgentCitation, index) => ({
      n: index + 1,
      source: citation.source,
      observedAt: citation.observedAt,
      state: citation.state,
    })),
    weakest,
    composedBy: turn.composedBy,
  }
}

/* ---- the one orange action ---- */

/** The action of a turn drawn orange: a draft card by its place among the cards, or a handoff by its link. */
export type TurnLead = Readonly<{ kind: 'card'; index: number }> | Readonly<{ kind: 'handoff'; href: string }>

/**
 * One orange action on the screen. In a turn it is the
 * first draft card — it opens the place where the person acts — else the
 * primary handoff the phone offers, else none. The screen gives it to the
 * latest answer only, and only while the composer holds nothing to send;
 * every other button is quiet.
 */
export function turnLead(turn: Pick<AgentTurn, 'cards' | 'handoffs'>): TurnLead | null {
  const card = turn.cards.findIndex((candidate) => isDraftCard(candidate) && destinationOfCard(candidate) !== null)
  if (card >= 0) return { kind: 'card', index: card }
  const primary = turnHandoffs(turn).find((handoff) => handoff.primary)
  // A primary handoff the phone has no place for is not offered, so it cannot be the action either.
  return primary && handoffView(primary, turn.cards) ? { kind: 'handoff', href: primary.href } : null
}

/* ---- a figure ---- */

export type FigureView = Readonly<{
  label: string
  /** The printed figure; an unavailable or unknown one is a dash, never a zero. */
  value: string
  state: AgentState
  /** Said beside the value: anything that is not current. */
  flagged: boolean
}>

export function figureView(figure: AgentFigure): FigureView {
  const missing = (figure.state === 'unavailable' || figure.state === 'unknown') && figure.number === null
  return {
    label: figure.label,
    value: missing || figure.value.trim().length === 0 ? DASH : figure.value,
    state: figure.state,
    flagged: figure.state !== 'current',
  }
}

/* ---- where a card or a handoff leads on the phone ---- */

function query(entries: readonly (readonly [string, string | null | undefined])[]): string {
  const params = new URLSearchParams()
  for (const [key, value] of entries) if (value) params.set(key, value)
  return params.toString()
}

/**
 * The ticket a trade draft names, on Trade: the side, and for a Buy the sum
 * the person told Ryntra and the plan it is bound to. A Sell's ticket is where
 * its draft opens; a Buy's is the card's quiet second door — the tool «Профі»
 * opened first, a tap deeper since one version.
 */
export function ticketOfCard(card: AgentCard): string | null {
  if (card.kind !== 'tradeDraft') return null
  const buy = card.side === 'BUY'
  // A sum rides a Buy only (paid in USDC); a Sell's amount is the asset's units, typed on the ticket.
  const amount = buy && card.amountUsd !== null && card.amountUsd > 0 ? String(card.amountUsd) : null
  const plan = buy ? card.plan : null
  return `/trade?${query([
    ['mint', card.mint],
    ['symbol', card.symbol],
    ['side', buy ? 'buy' : 'sell'],
    ['amount', amount],
    ['plan', plan?.planId],
    ['v', plan ? String(plan.version) : null],
  ])}`
}

/**
 * A path the router knows. A draft opens the place where the person acts —
 * never the act. Ryntra hands no ticket first for a purchase (no assistant on the way to a purchase): a Buy it
 * prepared opens the asset's own page, where the person presses «Купити» and
 * chooses the sum; the ticket with Ryntra's sum is the card's quiet second
 * door (`ticketOfCard`). A Sell opens its ticket.
 */
export function destinationOfCard(card: AgentCard): string | null {
  switch (card.kind) {
    case 'market':
      return `/asset/${card.mint}?${query([['symbol', card.symbol], ['category', card.category]])}`
    case 'stock':
      return `/asset/${card.mint}?${query([['symbol', card.symbol], ['category', 'stock']])}`
    case 'evidence':
      return `/asset/${card.mint}`
    case 'holdings':
      return '/(tabs)/portfolio'
    case 'plan':
      return `/plans/${card.planId}`
    case 'note':
      return card.subject?.kind === 'trading-plan' ? `/plans/${card.subject.id}?from=monitoring` : '/monitoring'
    case 'comparison': {
      if (!card.href) return null
      const mapped = mapDeepLink(card.href)
      return mapped.kind === 'native' ? mapped.path : null
    }
    case 'planDraft':
      return `/plans/new?${query([['mint', card.asset.mint], ['symbol', card.asset.symbol], ['draft', card.draftId]])}`
    case 'monitoringDraft':
      return card.subject.kind === 'plan'
        ? `/plans/new?${query([['plan', card.subject.planId], ['draft', card.draftId]])}`
        : `/plans/new?${query([['mint', card.subject.mint], ['symbol', card.subject.symbol], ['draft', card.draftId]])}`
    case 'tradeDraft':
      return card.side === 'BUY' ? `/asset/${card.mint}?${query([['symbol', card.symbol]])}` : ticketOfCard(card)
    default:
      return null
  }
}

/** How the phone names a handoff: the server's own words where the place is the same, the app's where the phone's place differs. */
export type HandoffWords =
  | Readonly<{ kind: 'server' }>
  | Readonly<{ kind: 'asset'; symbol: string | null }>
  | Readonly<{ kind: 'plans' | 'results' | 'stocks' | 'markets' | 'portfolio' | 'history' | 'inbox' }>

export type HandoffView = Readonly<{
  handoff: AgentHandoff
  kind: AgentHandoffKind
  path: string
  primary: boolean
  words: HandoffWords
}>

/** A Buy ticket on the phone (`/trade?mint=…`, not a Sell): the asset it would buy, or null. */
function buyTicketMint(path: string): string | null {
  const [bare, search = ''] = path.split('?')
  if (bare !== '/trade') return null
  const params = new URLSearchParams(search)
  return params.get('side') === 'sell' ? null : params.get('mint')
}

/**
 * A handoff onto the phone's own screen, or null when the phone has no place
 * for it (it is then not offered). A Buy ticket is the asset's page, as with a
 * draft card (see `destinationOfCard`).
 */
export function handoffView(handoff: AgentHandoff, cards: readonly AgentCard[]): HandoffView | null {
  const mapped = mapDeepLink(handoff.href, { carrySums: true })
  if (mapped.kind !== 'native') return null
  let path = mapped.path
  const ticketMint = buyTicketMint(path)
  if (ticketMint) path = `/asset/${ticketMint}`
  // A stock named by its symbol opens its own asset when the turn's cards carry its address.
  const stock = /^\/app\/stocks\/([^/?#]+)/.exec(handoff.href)
  if (stock) {
    const symbol = decodeURIComponent(stock[1] ?? '')
    const card = cards.find(
      (candidate): candidate is Extract<AgentCard, { kind: 'stock' | 'market' }> =>
        (candidate.kind === 'stock' || candidate.kind === 'market') && candidate.symbol === symbol,
    )
    if (card) path = `/asset/${card.mint}`
  }
  const words = wordsFor(path, cards)
  return { handoff, kind: handoff.kind, path, primary: handoff.primary, words }
}

function wordsFor(path: string, cards: readonly AgentCard[]): HandoffWords {
  const bare = path.split('?')[0] ?? path
  if (bare === '/bots') return { kind: 'plans' }
  if (bare === '/results') return { kind: 'results' }
  if (bare === '/(tabs)/portfolio') return { kind: 'portfolio' }
  if (bare === '/history') return { kind: 'history' }
  if (bare === '/monitoring') return { kind: 'inbox' }
  if (bare === '/(tabs)/markets') return { kind: /[?&]tab=(?:stocks|private)(?:&|$)/.test(path) ? 'stocks' : 'markets' }
  const asset = /^\/asset\/([^/?]+)/.exec(bare)
  if (asset) {
    const card = cards.find(
      (candidate): candidate is Extract<AgentCard, { mint: string; symbol: string }> =>
        'mint' in candidate && 'symbol' in candidate && candidate.mint === asset[1],
    )
    return { kind: 'asset', symbol: card?.symbol ?? null }
  }
  return { kind: 'server' }
}

/* ---- the budget ---- */

export type BudgetView =
  /** No model composes on this deployment: every answer is composed from the reads, and nothing is counted. */
  | Readonly<{ kind: 'reads' }>
  /** The model's allowance is spent: answers are composed from the reads until it resets. */
  | Readonly<{ kind: 'spent'; resetsAt: string }>
  | Readonly<{ kind: 'open'; left: number; allowance: number }>

export function budgetView(budget: AgentBudgetState | null | undefined): BudgetView | null {
  if (!budget) return null
  if (budget.model === 'absent') return { kind: 'reads' }
  if (budget.exhausted) {
    const monthSpent = budget.month.used >= budget.month.allowance && budget.day.used < budget.day.allowance
    return { kind: 'spent', resetsAt: monthSpent ? budget.month.resetsAt : budget.day.resetsAt }
  }
  const left = Math.max(0, Math.min(budget.day.allowance - budget.day.used, budget.month.allowance - budget.month.used))
  return { kind: 'open', left, allowance: budget.day.allowance }
}

/* ---- a failure, in the app's words ---- */

export type AgentFailure =
  /** A question of this wallet is still being answered (`AGENT_BUSY`). */
  | 'busy'
  /** The call was refused for the budget outright (`AGENT_BUDGET_EXHAUSTED`). */
  | 'budget'
  /** The bearer is gone: only a new signature brings the conversation back. */
  | 'signIn'
  /** The conversation is not this wallet's, or no longer exists: it is opened again. */
  | 'gone'
  /** The words were refused by the schema (too long, empty). */
  | 'invalid'
  | 'network'
  | 'unavailable'

export function agentFailureOf(error: unknown): AgentFailure {
  if (!(error instanceof ApiError)) return 'network'
  switch (error.code) {
    case 'AGENT_BUSY':
      return 'busy'
    case 'AGENT_BUDGET_EXHAUSTED':
      return 'budget'
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return 'signIn'
    case 'AGENT_SESSION_NOT_FOUND':
      return 'gone'
    case 'VALIDATION_ERROR':
      return 'invalid'
    default:
      return error.status === 401 ? 'signIn' : 'unavailable'
  }
}

/* ---- the conversation as the phone holds it between reads ---- */

/** The session with an answered exchange appended — the server's own turns, none twice, the last forty kept as the server keeps them. */
export function withExchange(session: AgentSession, exchange: AgentMessageResponse): AgentSession {
  const known = new Set(session.turns.map((turn) => turn.id))
  const added = [exchange.person, exchange.ryn].filter((turn) => !known.has(turn.id))
  const turns = [...session.turns, ...added].slice(-TURNS_KEPT)
  return { ...session, turns, updatedAt: exchange.ryn.at }
}

/**
 * After a send that failed on the network the server may still have answered.
 * True when the session read afterwards ends with this question — asked no
 * earlier than the send — and the assistant's answer to it; the phone then shows that
 * answer instead of asking again.
 */
export function exchangeLanded(session: AgentSession, question: string, sentAt: number): boolean {
  const turns = session.turns
  const last = turns[turns.length - 1]
  const asked = turns[turns.length - 2]
  if (!last || !asked || last.role !== 'ryn' || asked.role !== 'person') return false
  // A minute of slack for the difference between the phone's clock and the server's.
  return asked.text.trim() === question.trim() && Date.parse(asked.at) >= sentAt - 60_000
}
