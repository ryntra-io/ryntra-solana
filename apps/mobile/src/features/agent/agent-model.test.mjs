import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  agentFailureOf,
  budgetView,
  destinationOfCard,
  exchangeLanded,
  figureView,
  handoffView,
  questionOf,
  rynTurnView,
  ticketOfCard,
  turnHandoffs,
  turnLead,
  withExchange,
} from './agent-model.ts'
import { contextKey, contextParam, parseContextParam } from './context.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const PLAN = 'plan_0123456789abcdef0123456789abcdef'
const DRAFT = 'agd_0123456789abcdef01234567'

const turn = (overrides = {}) => ({
  id: 'agt_000000000000000000000002',
  role: 'ryn',
  at: '2026-09-22T10:00:00.000Z',
  text: 'A plan draft on SOL',
  class: 'prepare_plan',
  answer: {
    observation: [{ text: 'SOL is a crypto token; price $118.34 — observed 19:07 UTC, current.', cites: ['c1'] }],
    meaning: [{ text: 'The draft: entry $118.34, refuse above $120.71.', cites: ['c2'] }],
    counter: [{ text: 'A token plan has no issuer reference.', cites: ['c2'] }],
    risks: [
      { text: 'Entry taken as the planning price.', cites: ['c2'] },
      { text: '  ', cites: [] },
    ],
    checks: [{ text: 'The same reads again before a decision.', cites: [] }],
    actions: [{ text: 'Open the draft in the builder.', cites: ['c2', 'c2', 'c9'] }],
    insufficient: false,
  },
  cards: [],
  citations: [
    { id: 'c1', tool: 'market_read', source: 'Spot catalogue (Jupiter)', observedAt: '2026-09-22T09:58:00.000Z', state: 'current', ref: SOL, href: null },
    { id: 'c2', tool: 'prepare_plan_draft', source: 'Plan engine (draft)', observedAt: null, state: 'stale', ref: null, href: null },
    { id: 'c3', tool: 'holdings_read', source: 'Wallet holdings (RPC)', observedAt: null, state: 'unavailable', ref: null, href: null },
  ],
  handoffs: [],
  tools: [],
  composedBy: 'model',
  refusal: null,
  ...overrides,
})

const planDraftCard = {
  kind: 'planDraft',
  draftId: DRAFT,
  asset: {
    network: 'solana:mainnet',
    mint: SOL,
    symbol: 'SOL',
    issuer: { id: 'jupiter-verified', label: 'Jupiter verified' },
    underlying: { symbol: 'SOL', name: 'Wrapped SOL' },
    decimals: 9,
    unitBasis: 'token',
    kind: 'crypto',
  },
  rules: null,
  sizing: null,
  planningPrice: null,
  prefill: { entryUsd: 118.34, maxPriceUsd: 120.71, invalidationUsd: null, targetUsd: null, budgetUsd: null, riskUsd: 50, validUntil: null },
  issues: [],
  assumptions: ['Entry taken as the planning price.'],
  handoff: { kind: 'builder', href: `/app/strategies/new?mint=${SOL}&draft=${DRAFT}`, label: 'Open the draft in the builder', primary: true },
}

test('the context parameter is the web app’s own: written and read back, anything else is no context', () => {
  const cases = [
    { kind: 'asset', mint: SOL, symbol: 'SOL' },
    { kind: 'asset', mint: NVDA },
    { kind: 'plan', planId: PLAN },
    { kind: 'portfolio' },
    { kind: 'note', inboxId: 'inb_0123456789abcdef01234567' },
    { kind: 'page', page: 'results' },
  ]
  for (const context of cases) assert.deepEqual(parseContextParam(contextParam(context)), context)
  assert.equal(contextParam({ kind: 'asset', mint: SOL, symbol: 'SOL' }), `asset:${SOL}:SOL`)
  for (const junk of [null, '', 'asset:nope', 'plan:plan_x', 'portfolio:x', 'note:a b', 'page:admin', 'wallet:x', 'x'.repeat(200)]) {
    assert.equal(parseContextParam(junk), null, String(junk))
  }
  assert.equal(contextKey(null), 'none')
  assert.equal(contextKey({ kind: 'portfolio' }), 'portfolio')
})

test('a question is one to two thousand characters of words; nothing else is sent', () => {
  assert.equal(questionOf('  Why is SOL moving?  '), 'Why is SOL moving?')
  assert.equal(questionOf('   '), null)
  assert.equal(questionOf('x'.repeat(2001)), null)
  assert.equal(questionOf('x'.repeat(2000))?.length, 2000)
})

test('an assistant turn: the lead at rest, the rest one tap deeper, sources numbered, the weakest cited state said', () => {
  const view = rynTurnView(turn())
  assert.deepEqual(
    view.lead.map((sentence) => [sentence.text, sentence.marks]),
    [
      ['SOL is a crypto token; price $118.34 — observed 19:07 UTC, current.', [1]],
      ['The draft: entry $118.34, refuse above $120.71.', [2]],
    ],
  )
  // A blank sentence is dropped; a cite to a source that does not exist marks nothing.
  assert.equal(view.deeperCount, 3)
  assert.deepEqual(view.actions, [{ text: 'Open the draft in the builder.', marks: [2] }])
  assert.deepEqual(
    view.sources.map((source) => [source.n, source.source, source.state]),
    [
      [1, 'Spot catalogue (Jupiter)', 'current'],
      [2, 'Plan engine (draft)', 'stale'],
      [3, 'Wallet holdings (RPC)', 'unavailable'],
    ],
  )
  // The uncited unavailable source does not colour the answer; the cited stale one does.
  assert.equal(view.weakest, 'stale')
  assert.equal(view.refusal, null)
  assert.equal(view.insufficient, false)
})

test('an execute request is refused in the app’s words and arrives as a trade draft for the Review', () => {
  const trade = {
    kind: 'tradeDraft',
    draftId: DRAFT,
    side: 'BUY',
    mint: SOL,
    symbol: 'SOL',
    amountUsd: 25,
    plan: null,
    boundary: 'Nothing is signed or submitted here.',
    handoff: { kind: 'review', href: `/app/spot?view=crypto&mint=${SOL}&side=buy&amount=25`, label: 'Open the buy ticket for SOL', primary: true },
  }
  const view = rynTurnView(
    turn({
      class: 'execute',
      refusal: { code: 'execute', reason: 'Ryntra does not execute.' },
      answer: null,
      cards: [trade],
      handoffs: [trade.handoff, { kind: 'builder', href: `/app/strategies/new?mint=${SOL}`, label: 'Prepare a plan on SOL', primary: false }],
    }),
  )
  assert.equal(view.refusal, 'execute')
  assert.deepEqual(view.lead, [])
  // The card carries the ticket; the turn offers only what the card does not.
  assert.deepEqual(
    view.handoffs.map((handoff) => handoff.href),
    [`/app/strategies/new?mint=${SOL}`],
  )
  // A Buy opens the page where the person chooses the sum; the ticket with Ryntra’s sum is the card’s second door.
  assert.equal(destinationOfCard(trade), `/asset/${SOL}?symbol=SOL`)
  assert.equal(ticketOfCard(trade), `/trade?mint=${SOL}&symbol=SOL&side=buy&amount=25`)
  // A Sell never carries a dollar figure into the asset's own units; a plan binds a Buy only.
  assert.equal(
    destinationOfCard({ ...trade, side: 'SELL', plan: { planId: PLAN, version: 2 } }),
    `/trade?mint=${SOL}&symbol=SOL&side=sell`,
  )
  assert.equal(
    ticketOfCard({ ...trade, plan: { planId: PLAN, version: 2 } }),
    `/trade?mint=${SOL}&symbol=SOL&side=buy&amount=25&plan=${PLAN}&v=2`,
  )
})

test('one version: a Buy Ryntra prepared opens the asset’s page first; the ticket with Ryntra’s sum is a tap deeper, on the card', () => {
  const trade = {
    kind: 'tradeDraft',
    draftId: DRAFT,
    side: 'BUY',
    mint: NVDA,
    symbol: 'NVDAx',
    amountUsd: 25,
    plan: { planId: PLAN, version: 2 },
    boundary: 'Nothing is signed or submitted here.',
    handoff: { kind: 'review', href: `/app/spot?view=stock&mint=${NVDA}&side=buy&amount=25`, label: 'Open the buy ticket for NVDAx', primary: true },
  }
  // No sum, no plan binding, no ticket first: the page where the person presses «Купити» and chooses the sum.
  assert.equal(destinationOfCard(trade), `/asset/${NVDA}?symbol=NVDAx`)
  // The ticket with Ryntra's sum and its plan stays — the card's quiet second door.
  assert.equal(ticketOfCard(trade), `/trade?mint=${NVDA}&symbol=NVDAx&side=buy&amount=25&plan=${PLAN}&v=2`)
  // A Sell is not a purchase: it opens its ticket, which is its only door.
  const sell = { ...trade, side: 'SELL', plan: null }
  assert.equal(destinationOfCard(sell), `/trade?mint=${NVDA}&symbol=NVDAx&side=sell`)
  assert.equal(ticketOfCard(sell), destinationOfCard(sell))
  // Only a trade draft has a ticket.
  assert.equal(ticketOfCard({ kind: 'plan', planId: PLAN }), null)
  // The same for a ticket handed off as a link: a Buy is the page, a Sell its ticket.
  const ticket = trade.handoff
  assert.equal(handoffView(ticket, []).path, `/asset/${NVDA}`)
  const sellTicket = { ...ticket, href: `/app/spot?view=stock&mint=${NVDA}&side=sell` }
  assert.equal(handoffView(sellTicket, []).path, `/trade?mint=${NVDA}&side=sell`)
  // The card still leads the turn: its action is the page.
  assert.deepEqual(turnLead({ cards: [trade], handoffs: [ticket] }), { kind: 'card', index: 0 })
})

test('handoffs: none twice, one primary first, and each onto the phone’s own place with its own words', () => {
  const kept = turnHandoffs({
    cards: [],
    handoffs: [
      { kind: 'market', href: `/app/spot?view=crypto&mint=${SOL}`, label: 'Open SOL on Spot', primary: false },
      { kind: 'builder', href: `/app/strategies/new?mint=${SOL}`, label: 'Prepare a plan on SOL', primary: true },
      { kind: 'results', href: '/app/results', label: 'Open Results', primary: true },
      { kind: 'market', href: `/app/spot?view=crypto&mint=${SOL}`, label: 'Open SOL on Spot', primary: false },
    ],
  })
  assert.deepEqual(
    kept.map((handoff) => [handoff.kind, handoff.primary]),
    [
      ['builder', true],
      ['market', false],
      ['results', false],
    ],
  )
  const market = { kind: 'market', mint: SOL, symbol: 'SOL', name: 'Wrapped SOL', category: 'crypto', verified: true, figures: [], cite: 'c1', href: '' }
  assert.deepEqual(handoffView(kept[1], [market]), {
    handoff: kept[1],
    kind: 'market',
    path: `/asset/${SOL}`,
    primary: false,
    words: { kind: 'asset', symbol: 'SOL' },
  })
  // Results open the phone's own Results screen.
  assert.equal(handoffView(kept[2], []).path, '/results')
  assert.deepEqual(handoffView(kept[2], []).words, { kind: 'results' })
  assert.deepEqual(handoffView(kept[0], []).words, { kind: 'server' })
  // A stock named by its symbol opens its own asset when the turn carries its address, else the Stocks list.
  const stocks = { kind: 'stocks', href: '/app/stocks/NVDAx', label: 'Open NVDAx on Stocks', primary: false }
  const stockCard = { kind: 'stock', mint: NVDA, symbol: 'NVDAx', name: 'NVIDIA xStock', figures: [], cite: 'c1', href: '/app/stocks/NVDAx' }
  assert.equal(handoffView(stocks, [stockCard]).path, `/asset/${NVDA}`)
  assert.deepEqual(handoffView(stocks, []).words, { kind: 'stocks' })
  // A page the phone has no place for is not offered.
  assert.equal(handoffView({ kind: 'plan', href: '/app/settings', label: 'Settings', primary: false }, []), null)
})

test('one orange action: a turn’s first draft card, else its primary handoff the phone offers, else none', () => {
  const builder = { kind: 'builder', href: `/app/strategies/new?mint=${SOL}`, label: 'Prepare a plan on SOL', primary: true }
  const spot = { kind: 'market', href: `/app/spot?view=crypto&mint=${SOL}`, label: 'Open SOL on Spot', primary: false }
  const market = { kind: 'market', mint: SOL, symbol: 'SOL', name: 'Wrapped SOL', category: 'crypto', verified: true, figures: [], cite: 'c1', href: '' }
  // The draft opens the place where the person acts: it leads, over the turn's own primary handoff.
  assert.deepEqual(turnLead({ cards: [market, planDraftCard], handoffs: [builder, spot] }), { kind: 'card', index: 1 })
  // Without a draft, the primary handoff leads — whatever order the server listed it in.
  assert.deepEqual(turnLead({ cards: [market], handoffs: [spot, builder] }), { kind: 'handoff', href: builder.href })
  // A primary the phone has no place for is not offered, so nothing is orange; nor when nothing is primary.
  assert.equal(turnLead({ cards: [], handoffs: [{ kind: 'plan', href: '/app/settings', label: 'Settings', primary: true }, spot] }), null)
  assert.equal(turnLead({ cards: [market], handoffs: [spot] }), null)
  assert.equal(turnLead({ cards: [], handoffs: [] }), null)
})

test('cards open the phone’s own screens; a draft opens the builder with the draft, never a saved plan', () => {
  assert.equal(destinationOfCard(planDraftCard), `/plans/new?mint=${SOL}&symbol=SOL&draft=${DRAFT}`)
  const onPlan = {
    kind: 'monitoringDraft',
    draftId: DRAFT,
    subject: { kind: 'plan', planId: PLAN, symbol: 'NVDAx' },
    condition: { metric: 'dex_volume_usd', window: '24h', operator: 'lt', threshold: 1_000_000, mode: 'advisory', onUnknown: 'warn' },
    observed: null,
    assumptions: [],
    handoff: { kind: 'builder', href: `/app/strategies/new?plan=${PLAN}&evidence=x`, label: 'Add the rule as a new version', primary: true },
  }
  assert.equal(destinationOfCard(onPlan), `/plans/new?plan=${PLAN}&draft=${DRAFT}`)
  assert.equal(
    destinationOfCard({ ...onPlan, subject: { kind: 'asset', mint: NVDA, symbol: 'NVDAx' } }),
    `/plans/new?mint=${NVDA}&symbol=NVDAx&draft=${DRAFT}`,
  )
  assert.equal(
    destinationOfCard({ kind: 'note', inboxId: 'inb_1', subject: { kind: 'trading-plan', id: PLAN }, title: 't', reason: 'r', createdAt: '', finding: null, cite: 'c1', href: '' }),
    `/plans/${PLAN}?from=monitoring`,
  )
  assert.equal(
    destinationOfCard({ kind: 'note', inboxId: 'inb_1', subject: null, title: 't', reason: 'r', createdAt: '', finding: null, cite: 'c1', href: '' }),
    '/monitoring',
  )
  assert.equal(destinationOfCard({ kind: 'holdings', tokenRead: 'PARTIAL', rows: [], unpriced: 0, cite: 'c1', href: '/app/portfolio' }), '/(tabs)/portfolio')
})

test('a figure is honest about its state: unavailable is a dash, stale is said, a word stays a word', () => {
  assert.deepEqual(figureView({ label: 'Price', value: '$118.34', number: 118.34, unit: 'USD', state: 'current', cite: 'c1' }), {
    label: 'Price',
    value: '$118.34',
    state: 'current',
    flagged: false,
  })
  assert.equal(figureView({ label: 'Holders', value: 'unavailable', number: null, unit: null, state: 'unavailable', cite: 'c1' }).value, '—')
  assert.deepEqual(
    figureView({ label: 'Price', value: '$118.34', number: 118.34, unit: 'USD', state: 'stale', cite: 'c1' }),
    { label: 'Price', value: '$118.34', state: 'stale', flagged: true },
  )
  assert.equal(figureView({ label: 'Verified', value: "on Jupiter's verified list", number: null, unit: null, state: 'current', cite: 'c1' }).value, "on Jupiter's verified list")
})

test('the budget as it stands: reads only, spent until a time, or what is left today', () => {
  const base = {
    unit: 'calls',
    day: { used: 3, allowance: 20, resetsAt: '2026-09-23T00:00:00.000Z' },
    month: { used: 40, allowance: 200, resetsAt: '2026-10-01T00:00:00.000Z' },
    inFlight: { used: 0, limit: 1 },
    exhausted: false,
    reason: null,
    model: 'configured',
  }
  assert.deepEqual(budgetView(base), { kind: 'open', left: 17, allowance: 20 })
  assert.deepEqual(budgetView({ ...base, model: 'absent' }), { kind: 'reads' })
  assert.deepEqual(budgetView({ ...base, exhausted: true, day: { ...base.day, used: 20 } }), { kind: 'spent', resetsAt: '2026-09-23T00:00:00.000Z' })
  assert.deepEqual(budgetView({ ...base, exhausted: true, month: { ...base.month, used: 200 } }), { kind: 'spent', resetsAt: '2026-10-01T00:00:00.000Z' })
  // The month's allowance bounds what is left today.
  assert.deepEqual(budgetView({ ...base, month: { ...base.month, used: 195 } }), { kind: 'open', left: 5, allowance: 20 })
  assert.equal(budgetView(null), null)
})

test('a refusal is said in the app’s words; a network failure is not a refusal', () => {
  assert.equal(agentFailureOf(new ApiError('AGENT_BUSY', 'busy', 409)), 'busy')
  assert.equal(agentFailureOf(new ApiError('AGENT_BUDGET_EXHAUSTED', 'spent', 429)), 'budget')
  assert.equal(agentFailureOf(new ApiError('SESSION_EXPIRED', 'expired', 401)), 'signIn')
  assert.equal(agentFailureOf(new ApiError('AGENT_SESSION_NOT_FOUND', 'gone', 404)), 'gone')
  assert.equal(agentFailureOf(new ApiError('VALIDATION_ERROR', 'too long', 400)), 'invalid')
  assert.equal(agentFailureOf(new ApiError('UNAVAILABLE', 'down', 503)), 'unavailable')
  assert.equal(agentFailureOf(new Error('Network request failed')), 'network')
})

test('an answered exchange joins the kept turns once; a send lost on the network is found on the server', () => {
  const person = { ...turn(), id: 'agt_p', role: 'person', text: 'Why is SOL moving?', answer: null, citations: [], composedBy: null, at: '2026-09-22T10:00:05.000Z' }
  const ryn = { ...turn(), id: 'agt_r', at: '2026-09-22T10:00:09.000Z' }
  const session = { id: 'ags_1', owner: 'x', network: 'solana:mainnet', locale: 'en', context: null, turns: [], createdAt: '', updatedAt: '' }
  const once = withExchange(session, { sessionId: 'ags_1', person, ryn, budget: null })
  assert.deepEqual(once.turns.map((entry) => entry.id), ['agt_p', 'agt_r'])
  assert.deepEqual(withExchange(once, { sessionId: 'ags_1', person, ryn, budget: null }).turns.length, 2)
  // The server keeps forty; so does the phone.
  const many = { ...session, turns: Array.from({ length: 40 }, (_, index) => ({ ...person, id: `agt_${index}` })) }
  assert.equal(withExchange(many, { sessionId: 'ags_1', person, ryn, budget: null }).turns.length, 40)

  const sentAt = Date.parse('2026-09-22T10:00:04.000Z')
  assert.equal(exchangeLanded(once, 'Why is SOL moving?', sentAt), true)
  assert.equal(exchangeLanded(once, 'Why is BONK moving?', sentAt), false)
  // The same words asked long before this send are a different question.
  assert.equal(exchangeLanded(once, 'Why is SOL moving?', sentAt + 3_600_000), false)
  assert.equal(exchangeLanded({ ...once, turns: [person] }, 'Why is SOL moving?', sentAt), false)
})
