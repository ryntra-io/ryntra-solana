import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountState,
  attentionItems,
  briefLines,
  changeSince,
  freshestAt,
  HIDDEN_AMOUNT,
  lastLookOf,
  money,
  movePeriod,
  parseLastLook,
  plansBlock,
  serializeLastLook,
  showTrending,
  trending,
  watchlistMoves,
} from './home-model.ts'

const NOW = Date.parse('2026-09-22T10:00:00.000Z')
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString()

const MINTS = {
  nvda: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  aapl: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  sol: 'So11111111111111111111111111111111111111112',
  bonk: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
}

function plan(overrides = {}) {
  return {
    id: overrides.id ?? 'plan_' + '0'.repeat(32),
    status: overrides.status ?? 'active',
    asset: {
      symbol: overrides.symbol ?? 'NVDAx',
      mint: overrides.mint ?? MINTS.nvda,
      issuer: { id: 'xstocks', label: 'xStocks' },
    },
    version: overrides.version ?? 1,
    current: {
      rules: { entry: { validUntil: overrides.validUntil ?? null } },
      sizing: { notionalUsd: 100, units: 0.5 },
    },
    updatedAt: overrides.updatedAt ?? iso(600),
    createdAt: iso(1000),
  }
}

function card(overrides = {}) {
  return {
    monitorId: overrides.monitorId ?? 'mon_' + '1'.repeat(24),
    label: overrides.label ?? 'NVDAx',
    status: overrides.status ?? 'needs_attention',
    title: overrides.title ?? 'NVDAx is above your price bound',
    reason: 'The market is $228.04, the bound $216.60.',
    href: overrides.href ?? '/app/alerts/open?n=inb_' + '2'.repeat(24),
    cta: 'Review plan',
    paper: overrides.paper ?? false,
    lastCheckedAt: iso(5),
    lastTriggeredAt: iso(30),
  }
}

function note(overrides = {}) {
  return {
    id: overrides.id ?? 'inb_' + '2'.repeat(24),
    monitorId: 'mon_' + '1'.repeat(24),
    title: 'NVDAx is above your price bound',
    reason: '',
    context: 'NVDAx',
    href: '/app/alerts/open?n=inb_' + '2'.repeat(24),
    cta: 'Review plan',
    paper: false,
    unread: overrides.unread ?? true,
    createdAt: overrides.createdAt ?? iso(20),
  }
}

function row(overrides = {}) {
  return {
    mint: overrides.mint ?? MINTS.nvda,
    symbol: overrides.symbol ?? 'NVDAx',
    name: overrides.name ?? 'NVIDIA',
    icon: null,
    decimals: 8,
    price: 'price' in overrides ? overrides.price : 100,
    change24hPct: 'change24hPct' in overrides ? overrides.change24hPct : 1.5,
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    verified: overrides.verified ?? true,
    suspicious: overrides.suspicious ?? false,
    category: overrides.category ?? 'stock',
    issuer: null,
  }
}

const attempt = (state = 'SUBMITTED_UNKNOWN') => ({
  schema: 'ryntra.mobile.trade-attempt',
  schemaVersion: '1.0.0',
  requestId: 'req',
  signature: 'sig',
  taker: 'taker',
  state,
  recordedAt: iso(3),
  context: null,
})

test('the account is a guest without an address, connected without a session, signed in with both', () => {
  assert.equal(accountState(null, null), 'guest')
  assert.equal(accountState('addr', null), 'connected')
  assert.equal(
    accountState('addr', { address: 'addr', token: 't'.repeat(16), issuedAt: iso(1), expiresAt: iso(-60) }),
    'signed-in',
  )
})

test('attention: the unfinished operation first, then the cards, then the expired entries no card speaks of', () => {
  const nvda = plan({ id: 'plan_' + 'a'.repeat(32) })
  const aapl = plan({ id: 'plan_' + 'b'.repeat(32), symbol: 'AAPLx', mint: MINTS.aapl, validUntil: iso(10) })
  const items = attentionItems({
    attempt: attempt(),
    surface: {
      attention: [card()],
      watching: [],
      recent: [],
      unread: 1,
      preferences: { telegram: false, push: false, quietHours: null },
    },
    plans: [nvda, aapl],
    now: NOW,
  })
  assert.deepEqual(
    items.map((item) => item.kind),
    ['recovery', 'card', 'entry-expired'],
  )
  assert.equal(items[1].shared, false)
  assert.equal(items[1].target.kind, 'plan')
  assert.equal(items[1].target.planId, nvda.id)
  assert.equal(items[2].plan.id, aapl.id)
})

test('attention: a settled attempt is not an item; a card on a symbol two active plans wear is shared and asks', () => {
  const one = plan({ id: 'plan_' + 'a'.repeat(32) })
  const two = plan({ id: 'plan_' + 'b'.repeat(32) })
  const items = attentionItems({
    attempt: attempt('SETTLED'),
    surface: {
      attention: [card()],
      watching: [],
      recent: [],
      unread: 0,
      preferences: { telegram: false, push: false, quietHours: null },
    },
    plans: [one, two],
    now: NOW,
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'card')
  assert.equal(items[0].shared, true)
  assert.equal(items[0].plans.length, 2)
  assert.equal(items[0].target.kind, 'choose')
})

test('attention: an expired entry on a symbol a card already names is not repeated; a card of no owned plan is dropped; paper cards follow', () => {
  const expired = plan({ validUntil: iso(1) })
  const items = attentionItems({
    attempt: null,
    surface: {
      attention: [
        card({ label: 'TSLAx', monitorId: 'mon_' + '3'.repeat(24) }),
        card({ paper: true, label: 'Fed cut in October', monitorId: 'mon_' + '4'.repeat(24) }),
        card(),
      ],
      watching: [],
      recent: [],
      unread: 0,
      preferences: { telegram: false, push: false, quietHours: null },
    },
    plans: [expired],
    now: NOW,
  })
  assert.deepEqual(
    items.map((item) => (item.kind === 'card' ? `card:${item.card.label}` : item.kind)),
    ['card:NVDAx', 'card:Fed cut in October'],
  )
  assert.equal(items[1].target.kind, 'web')
})

test('attention: nothing read yet is nothing to show, never a crash', () => {
  assert.deepEqual(attentionItems({ attempt: null, surface: null, plans: null, now: NOW }), [])
})

test('the last look keeps usable prices only, round-trips, and refuses junk', () => {
  const look = lastLookOf(iso(0), [
    { mint: MINTS.nvda, price: 100 },
    { mint: MINTS.aapl, price: null },
    { mint: MINTS.sol, price: 0 },
    { mint: 'not-a-mint', price: 5 },
    { mint: MINTS.bonk, price: Number.NaN },
  ])
  assert.deepEqual(look.prices, { [MINTS.nvda]: 100 })
  assert.deepEqual(parseLastLook(serializeLastLook(look)), look)
  assert.equal(parseLastLook(null), null)
  assert.equal(parseLastLook('{'), null)
  assert.equal(parseLastLook(JSON.stringify({ at: 'never', prices: {} })), null)
  assert.deepEqual(
    parseLastLook(JSON.stringify({ at: iso(0), prices: { [MINTS.nvda]: 'x', [MINTS.aapl]: 3 } })).prices,
    {
      [MINTS.aapl]: 3,
    },
  )
})

test('the last look caps at the watchlist limit', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    mint: 'So1111111111111111111111111111111111111' + String(index).padStart(3, '1').replace(/0/g, '1'),
    price: 1,
  }))
  const look = lastLookOf(iso(0), rows)
  assert.ok(Object.keys(look.prices).length <= 200)
})

test('a change since the last look needs both figures; the period names the look or the 24 hours', () => {
  const look = { at: iso(60), prices: { [MINTS.nvda]: 100 } }
  assert.equal(changeSince(look, MINTS.nvda, 103), 3)
  assert.equal(changeSince(look, MINTS.nvda, 97), -3)
  assert.equal(changeSince(look, MINTS.aapl, 50), null)
  assert.equal(changeSince(look, MINTS.nvda, null), null)
  assert.equal(changeSince(null, MINTS.nvda, 100), null)
  assert.deepEqual(movePeriod(look), { kind: 'since', at: look.at })
  assert.deepEqual(movePeriod(null), { kind: '24h' })
})

test('watchlist moves: the biggest first over the period, the unknown last, the 24h figure always beside', () => {
  const look = { at: iso(60), prices: { [MINTS.nvda]: 100, [MINTS.aapl]: 200 } }
  const rows = [
    row({ price: 101, change24hPct: 9 }),
    row({ mint: MINTS.aapl, symbol: 'AAPLx', price: 190, change24hPct: -1 }),
    row({ mint: MINTS.sol, symbol: 'SOL', price: 20, change24hPct: 4, category: 'crypto' }),
  ]
  const moves = watchlistMoves(rows, look, 5)
  assert.deepEqual(
    moves.map((move) => [move.row.symbol, move.pct === null ? null : Math.round(move.pct * 100) / 100, move.dayPct]),
    [
      ['AAPLx', -5, -1],
      ['NVDAx', 1, 9],
      ['SOL', null, 4],
    ],
  )
  // Without a look the period is the venue's 24 hours.
  assert.deepEqual(
    watchlistMoves(rows, null, 2).map((move) => move.row.symbol),
    ['NVDAx', 'SOL'],
  )
  assert.equal(watchlistMoves(rows, null, 0).length, 0)
})

test('the brief: notes since the look, plans changed since, the portfolio day, the moves that matter, the coverage', () => {
  const look = { at: iso(60), prices: { [MINTS.nvda]: 100 } }
  const changed = plan({ id: 'plan_' + 'c'.repeat(32), updatedAt: iso(10) })
  const old = plan({ id: 'plan_' + 'd'.repeat(32), updatedAt: iso(600) })
  const lines = briefLines({
    look,
    surface: {
      attention: [],
      watching: [],
      recent: [
        note({ createdAt: iso(20) }),
        note({ id: 'inb_' + '5'.repeat(24), createdAt: iso(600) }),
        note({ id: 'inb_' + '6'.repeat(24), unread: false }),
      ],
      unread: 2,
      preferences: { telegram: false, push: false, quietHours: null },
    },
    plans: [changed, old],
    portfolio: { coverage: 'PARTIAL', total: 1000, dayChange: { usd: -12.3, pct: -1.2, covered: 3, of: 4 } },
    moves: [
      { row: row({ price: 103 }), pct: 3, dayPct: 9 },
      { row: row({ mint: MINTS.aapl, symbol: 'AAPLx' }), pct: 0.1, dayPct: 1 },
      { row: row({ mint: MINTS.sol, symbol: 'SOL' }), pct: null, dayPct: 4 },
    ],
    now: NOW,
  })
  assert.deepEqual(
    lines.map((line) => line.kind),
    ['notes', 'plan', 'portfolio', 'watch', 'coverage'],
  )
  assert.equal(lines[0].count, 1)
  assert.equal(lines[0].since, look.at)
  assert.equal(lines[1].plan.id, changed.id)
  assert.equal(lines[3].move.row.symbol, 'NVDAx')
  assert.deepEqual(lines[3].period, { kind: 'since', at: look.at })
})

test('the brief without a look: every unread note counts, no plan line is inferred, moves are 24h', () => {
  const lines = briefLines({
    look: null,
    surface: {
      attention: [],
      watching: [],
      recent: [note(), note({ id: 'inb_' + '5'.repeat(24) })],
      unread: 2,
      preferences: { telegram: false, push: false, quietHours: null },
    },
    plans: [plan({ updatedAt: iso(1) })],
    portfolio: null,
    moves: [{ row: row(), pct: 2, dayPct: 2 }],
    now: NOW,
  })
  assert.deepEqual(
    lines.map((line) => line.kind),
    ['notes', 'watch'],
  )
  assert.equal(lines[0].count, 2)
  assert.equal(lines[0].since, null)
  assert.deepEqual(lines[1].period, { kind: '24h' })
})

test('the brief is empty when nothing is known', () => {
  assert.deepEqual(briefLines({ look: null, surface: null, plans: null, portfolio: null, moves: [], now: NOW }), [])
})

test('trending picks the biggest verified movers per class and leaves an empty class empty', () => {
  const rows = [
    row({ change24hPct: 2 }),
    row({ mint: MINTS.aapl, symbol: 'AAPLx', change24hPct: -7 }),
    row({ mint: MINTS.sol, symbol: 'SOL', category: 'crypto', change24hPct: 3 }),
    row({ mint: MINTS.bonk, symbol: 'BONK', category: 'meme', change24hPct: 40, suspicious: true }),
    row({
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB264',
      symbol: 'COPY',
      category: 'crypto',
      change24hPct: 90,
      verified: false,
    }),
    row({
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB265',
      symbol: 'NOPE',
      category: 'crypto',
      change24hPct: null,
    }),
  ]
  const picked = trending(rows, 2)
  assert.deepEqual(
    picked.stock.map((r) => r.symbol),
    ['AAPLx', 'NVDAx'],
  )
  assert.deepEqual(
    picked.crypto.map((r) => r.symbol),
    ['SOL'],
  )
  assert.deepEqual(picked.meme, [])
})

test('trending shows for a guest and for a wallet without an active plan', () => {
  assert.equal(showTrending('guest', 0), true)
  assert.equal(showTrending('connected', 0), true)
  assert.equal(showTrending('signed-in', 0), true)
  assert.equal(showTrending('signed-in', 1), false)
})

test('the plans block: three active newest first, with the counts of what it leaves out', () => {
  const plans = [
    plan({ id: 'plan_' + '1'.repeat(32), updatedAt: iso(50) }),
    plan({ id: 'plan_' + '2'.repeat(32), updatedAt: iso(5) }),
    plan({ id: 'plan_' + '3'.repeat(32), updatedAt: iso(500) }),
    plan({ id: 'plan_' + '4'.repeat(32), updatedAt: iso(1) }),
    plan({ id: 'plan_' + '5'.repeat(32), status: 'draft' }),
    plan({ id: 'plan_' + '6'.repeat(32), status: 'cancelled' }),
  ]
  const block = plansBlock(plans)
  assert.deepEqual(
    block.active.map((p) => p.id.slice(5, 6)),
    ['4', '2', '1'],
  )
  assert.equal(block.activeTotal, 4)
  assert.equal(block.drafts, 1)
  assert.equal(block.total, 6)
})

test('money hides on request and dashes the unknown', () => {
  assert.equal(money(1234.5, false), '$1,234.50')
  assert.equal(money(1234.5, true), HIDDEN_AMOUNT)
  assert.equal(money(null, false), '—')
  assert.equal(money(null, true), HIDDEN_AMOUNT)
})

test('the freshest time wins; junk is ignored', () => {
  assert.equal(freshestAt(iso(10), null, iso(2), 'junk', undefined), iso(2))
  assert.equal(freshestAt(null, undefined, 'junk'), null)
})
