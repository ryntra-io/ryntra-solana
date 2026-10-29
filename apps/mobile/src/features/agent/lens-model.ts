/**
 * The Lens as values — pure. «Спитати Ryntra» on an asset, a plan or the
 * portfolio opens the web's Brief → Critic → Plan/Review on the phone: the
 * brief composed from the reads (free, no model), the critic on an explicit
 * press at the price the server names (`credits.prices.deep`, sent as exactly
 * `acceptCredits`), the doors to the phone's own places, the sources. Nothing
 * here reads the network, and nothing here signs, submits or saves.
 */

import type {
  AgentBudgetState,
  AgentBriefResponse,
  AgentCitation,
  AgentContext,
  AgentCriticFinding,
  AgentCriticResponse,
  AgentLensRequest,
  AgentState,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { paidBy, type PaidBy } from '../assistant/credits-model.ts'
import { agentFailureOf, handoffView, turnHandoffs, type HandoffView } from './agent-model.ts'
import { contextParam } from './context.ts'

/** The subjects the Lens reads: an asset, one of the person's plans, the portfolio. */
export type LensSubject = Extract<AgentContext, { kind: 'asset' | 'plan' | 'portfolio' }>

/** The context as a Lens subject, or null where the Lens has nothing of its own to read (a note, a page). */
export function lensSubjectOf(context: AgentContext | null | undefined): LensSubject | null {
  if (!context) return null
  return context.kind === 'asset' || context.kind === 'plan' || context.kind === 'portfolio' ? context : null
}

/** `/lens?context=…` for an asset, a plan or the portfolio; null for any other context. */
export function lensPath(context: AgentContext): string | null {
  const subject = lensSubjectOf(context)
  return subject ? `/lens?context=${encodeURIComponent(contextParam(subject))}` : null
}

/** The brief as the screen asks for it on open: composed from the reads, never the model, never a credit. */
export function briefRequest(subject: LensSubject, locale: Locale): AgentLensRequest {
  return { subject, locale, compose: 'deterministic' }
}

/* ---- the critic's price ---- */

/**
 * What the critic costs before the press. `none` — credits are not served here, or no model composes on this
 * deployment: no price is shown and none is sent. `priced` — the server's `prices.deep`, and what pays it.
 */
export type CriticOffer =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'priced'; price: number; paid: PaidBy; balance: number }>

export function criticOffer(budget: AgentBudgetState | null | undefined): CriticOffer {
  const credits = budget?.credits
  if (!budget || !credits || budget.model === 'absent') return { kind: 'none' }
  const price = Math.max(0, Math.floor(credits.prices.deep))
  return { kind: 'priced', price, paid: paidBy(credits, price), balance: credits.balance }
}

/** Whether the offer can be paid now — the price then stands on the button and goes out as `acceptCredits`. */
export function offerPayable(offer: CriticOffer): offer is Extract<CriticOffer, { kind: 'priced' }> {
  return offer.kind === 'priced' && (offer.paid.kind === 'free' || offer.paid.kind === 'balance')
}

/**
 * The critic as the screen sends it: the model asked for, and `acceptCredits` exactly the price shown on the button.
 * Short of credits or past the day's limit no price is shown, so none is sent: the server then answers from the reads
 * and takes nothing. Where credits are not served there is no `acceptCredits` at all.
 */
export function criticRequest(subject: LensSubject, locale: Locale, offer: CriticOffer): AgentLensRequest {
  return offerPayable(offer)
    ? { subject, locale, compose: 'model', acceptCredits: offer.price }
    : { subject, locale, compose: 'model' }
}

/** The price on the button: shown only when it is paid now and is more than nothing. */
export function shownCriticPrice(offer: CriticOffer): number | null {
  return offerPayable(offer) && offer.price > 0 ? offer.price : null
}

/* ---- what the screen draws ---- */

/** The critic's findings with words in them, in the server's order; a figure-less, word-less finding is not drawn. */
export function lensFindings(critic: AgentCriticResponse['critic']): AgentCriticFinding[] {
  return critic.findings.filter((finding) => finding.text.trim().length > 0)
}

/** The sentences of a section with words in them. */
export function sentencesOf(rows: readonly { text: string }[]): string[] {
  return rows.map((row) => row.text.trim()).filter((text) => text.length > 0)
}

/** The response's handoffs as quiet doors to the phone's own places: one per place, none the phone has no place for. */
export function lensDoors(response: Pick<AgentBriefResponse, 'cards' | 'handoffs'>): HandoffView[] {
  return turnHandoffs(response)
    .map((handoff) => handoffView(handoff, response.cards))
    .filter((view): view is HandoffView => view !== null)
    .filter((view, index, all) => all.findIndex((other) => other.path === view.path) === index)
}

export type LensSource = Readonly<{ key: string; source: string; observedAt: string | null; state: AgentState }>

/** What the read stood on: each source by its name, when it was read and its state — never the engine's ids. */
export function lensSources(citations: readonly AgentCitation[]): LensSource[] {
  return citations
    .filter((citation) => citation.source.trim().length > 0)
    .map((citation, index) => ({ key: `${citation.id}-${index}`, source: citation.source.trim(), observedAt: citation.observedAt, state: citation.state }))
}

/** A failed read or press, in the app's words: another question of this wallet is being answered, the session is gone, the network, or the server. */
export type LensFailure = 'busy' | 'signIn' | 'network' | 'budget' | 'unavailable'

export function lensFailureOf(error: unknown): LensFailure {
  const failure = agentFailureOf(error)
  switch (failure) {
    case 'busy':
    case 'signIn':
    case 'network':
    case 'budget':
      return failure
    default:
      return 'unavailable'
  }
}
