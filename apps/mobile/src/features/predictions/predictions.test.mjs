import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  base64Of,
  depositRequest,
  linkFailureOf,
  newRequestId,
  orderSettled,
  parseAccount,
  parseFunding,
  parsePreview,
  parseReview,
  parseWithdrawOutcome,
  previewForWallet,
  rawOfTyped,
  receiveFloorRaw,
  signatureOf,
  spendOf,
  usdOfRaw,
  routeCodeOf,
  withdrawalCheckable,
  withdrawalFigure,
  withdrawalHolds,
  withdrawHold,
  withdrawalMoving,
  withdrawalNote,
} from './account-model.ts'
import { PREDICTIONS_COPY } from './predictions-copy.ts'
import {
  chanceText,
  isPredictionId,
  joinPages,
  leadingOutcome,
  leftText,
  lineStale,
  outcomeWord,
  parseEvent,
  parseHub,
  parseLine,
  payoutOf,
  tradable,
} from './predictions-model.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const WALLET = '6BQGYUvTnGt5r3bU1EcJ5ZdnYQ3FWZPPQwy3a6TeQBG4'
const DEPOSIT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/* The hub's answer as production served it on 2026-10-22 (`GET /api/predictions/discover`), cut to two events. */
const HUB = {
  categories: [
    { id: 'c1', slug: 'politics', name: 'Politics', eventCount: 6120, volume24h: 1 },
    { id: 'c2', slug: 'crypto', name: 'Crypto', eventCount: 4188, volume24h: 1 },
    { id: 'c3', slug: 'politics', name: 'Politics again', eventCount: 1, volume24h: 1 },
  ],
  categoriesUnavailable: false,
  events: [
    {
      id: 'fyrrixriwtsijm2avdec2goq',
      title: 'Fed Decision in October?',
      image: 'https://polymarket-upload.s3.amazonaws.com/fed.png',
      status: 'open',
      venues: ['kalshi', 'limitless', 'myriad', 'polymarket', 'predict', 'opinion'],
      volume: 54286240.456857,
      endDate: '2026-10-29T03:59:00.000Z',
      marketCount: 3,
      leading: [
        { id: 'igrvfa8296iqmo9tmggefq1j', label: 'Yes', probability: 0.875, venueMarketId: 'tqna66rex2t737gefhz3e8l5' },
        { id: 'zmad2kboyqmtm305jp15un3j', label: 'No', probability: 0.125, venueMarketId: 'tqna66rex2t737gefhz3e8l5' },
      ],
      leadingQuestion: 'No change',
    },
    {
      id: 'bad/id',
      title: 'Not an id',
      status: 'open',
      leading: [],
    },
    {
      id: 'gfshaoincvaimvqzgukw5xck',
      title: 'Texas Senate Election Winner',
      image: 'http://insecure.example/x.png',
      status: 'open',
      venues: ['limitless', 'polymarket', 'polymarket'],
      volume: null,
      endDate: 'not a date',
      marketCount: 2,
      leading: [{ id: 'e139asj6svqyzmgihcnhlqqp', label: 'Yes', probability: 1.4, venueMarketId: 'krmg' }],
    },
  ],
  nextCursor: 'gfshaoincvaimvqzgukw5xck',
  readAt: '2026-10-22T08:03:12.933Z',
}

test('the hub: categories once each, events read again — a bad id dropped, no image but https, no price outside 0…1', () => {
  const hub = parseHub(HUB)
  assert.deepEqual(
    hub.categories.map((entry) => [entry.slug, entry.count]),
    [
      ['politics', 6120],
      ['crypto', 4188],
    ],
  )
  assert.equal(hub.events.length, 2)
  const [fed, texas] = hub.events
  assert.equal(fed.lead, 'No change')
  assert.equal(fed.venueCount, 6)
  assert.equal(fed.leading.label, 'Yes')
  assert.equal(fed.leading.probability, 0.875)
  assert.equal(texas.image, null)
  assert.equal(texas.venueCount, 2)
  assert.equal(texas.volumeUsd, null)
  assert.equal(texas.endsAt, null)
  assert.equal(texas.leading.probability, null)
  assert.equal(hub.nextCursor, 'gfshaoincvaimvqzgukw5xck')
  assert.equal(hub.readAt, Date.parse('2026-10-22T08:03:12.933Z'))
  // Pages joined keep an event once, where it first stood.
  assert.deepEqual(
    joinPages([hub, parseHub({ events: [HUB.events[2], HUB.events[0]] })]).map((row) => row.id),
    ['fyrrixriwtsijm2avdec2goq', 'gfshaoincvaimvqzgukw5xck'],
  )
  // Categories the provider could not read are none, never a stale list.
  assert.deepEqual(parseHub({ ...HUB, categoriesUnavailable: true }).categories, [])
  assert.deepEqual(parseHub(null).events, [])
})

test('an event: its markets read again, the rules joined, a market without an outcome dropped', () => {
  const event = parseEvent({
    event: {
      id: 'fyrrixriwtsijm2avdec2goq',
      title: 'Fed Decision in October?',
      status: 'open',
      venues: ['kalshi', 'polymarket'],
      volume: 74400000,
      endDate: '2026-10-29T03:59:00.000Z',
      categories: [{ id: 'f', slug: 'finance', name: 'Finance' }],
      description: 'The FED interest rates…',
      settlement: { sharedSummary: 'This market tracks the change in basis points…', differences: [] },
      markets: [
        {
          id: 'tqna66rex2t737gefhz3e8l5',
          question: 'No change',
          status: 'open',
          volume: 15405472.19,
          endDate: '2026-10-29T03:59:00.000Z',
          resolutionDate: null,
          minOrderSize: 5,
          rules: { primary: 'Resolves to Yes if…', secondary: 'More text' },
          outcomes: [
            { id: 'igrvfa8296iqmo9tmggefq1j', label: 'Yes', probability: 0.875, winner: null },
            { id: 'zmad2kboyqmtm305jp15un3j', label: 'No', probability: 0.125, winner: null },
          ],
        },
        { id: 'emptymarket', question: 'Empty', status: 'open', outcomes: [] },
      ],
    },
    readAt: '2026-10-22T08:03:19.451Z',
  })
  assert.equal(event.category, 'Finance')
  assert.equal(event.venueCount, 2)
  assert.equal(event.markets.length, 1)
  assert.equal(event.markets[0].rules, 'Resolves to Yes if…\n\nMore text')
  assert.equal(leadingOutcome(event.markets[0].outcomes).id, 'igrvfa8296iqmo9tmggefq1j')
  assert.equal(parseEvent({ event: { id: 'x', title: '' } }), null)
  assert.equal(parseEvent({}), null)
})

test('a chance line: milliseconds to seconds, oldest first, one point per bar, nothing outside 0…1', () => {
  const line = parseLine(
    {
      chart: {
        bars: [
          { t: 1792490400000, o: 0.855, h: 0.855, l: 0.855, c: 0.86, v: null },
          { t: 1792486800000, o: 0.855, h: 0.855, l: 0.855, c: 0.855, v: null },
          { t: 1792490400000, o: 0.87, h: 0.87, l: 0.87, c: 0.87, v: null },
          { t: 1792494000000, c: 1.2 },
        ],
        lastBarAt: 1792490400000,
      },
      readAt: '2026-10-22T08:00:00.000Z',
    },
    'igrvfa8296iqmo9tmggefq1j',
  )
  assert.deepEqual(line.points, [
    { time: 1792486800, close: 0.855 },
    { time: 1792490400, close: 0.87 },
  ])
  assert.equal(line.lastAt, 1792490400)
})

test('a chance is written as a person reads it, never 0 % or 100 % for a live price; a dash when unpriced', () => {
  assert.equal(chanceText(0.735, 'en'), '74%')
  assert.equal(chanceText(0.875, 'uk'), '88%')
  assert.equal(chanceText(0.042, 'en'), '4.2%')
  assert.equal(chanceText(0.042, 'uk'), '4,2%')
  assert.equal(chanceText(0.001, 'en'), '0.1%')
  assert.equal(chanceText(0.0002, 'en'), '<0.1%')
  assert.equal(chanceText(0.9995, 'en'), '>99.9%')
  assert.equal(chanceText(0.995, 'en'), '99.5%')
  assert.equal(chanceText(1, 'en'), '100%')
  assert.equal(chanceText(0, 'en'), '0%')
  assert.equal(chanceText(null, 'en'), '—')
  // $10 on «Yes» at 73.5 % returns ≈ $13.61 if it wins — the web's own figure; nothing for an unpriced or sure outcome.
  assert.equal(payoutOf(10, 0.735).toFixed(2), '13.61')
  assert.equal(payoutOf(10, null), null)
  assert.equal(payoutOf(10, 1), null)
  assert.equal(outcomeWord('Yes', 'uk'), 'Так')
  assert.equal(outcomeWord('no', 'uk'), 'Ні')
  assert.equal(outcomeWord('Democratic Party', 'uk'), 'Democratic Party')
})

test('what is left until an event closes, and which events can still be traded', () => {
  const now = Date.parse('2026-10-22T08:00:00Z')
  assert.equal(leftText(now + 31 * 3_600_000, now, 'en'), '1d 7h')
  assert.equal(leftText(now + 31 * 3_600_000, now, 'uk'), '1 д 7 год')
  assert.equal(leftText(now + (5 * 60 + 20) * 60_000, now, 'en'), '5h 20m')
  assert.equal(leftText(now + 30_000, now, 'uk'), '1 хв')
  assert.equal(leftText(now - 1, now, 'en'), null)
  assert.equal(tradable({ status: 'open', endsAt: '2026-10-23T00:00:00Z' }, now), true)
  assert.equal(tradable({ status: 'open', endsAt: '2026-10-21T00:00:00Z' }, now), false)
  assert.equal(tradable({ status: 'resolved', endsAt: null }, now), false)
  assert.equal(isPredictionId('fyrrixriwtsijm2avdec2goq'), true)
  assert.equal(isPredictionId('../money'), false)
})

test('the simulated account: link state, balance with the result so far, positions per outcome, placed orders only', () => {
  const account = parseAccount({
    wallet: WALLET,
    link: { state: 'active', available: true },
    balance: {
      startingBalance: 1000,
      cashBalance: 990,
      positionsValue: 11.43,
      realizedPnl: 0,
      unrealizedPnl: 1.43,
      earnings: 0,
    },
    positions: [
      {
        eventId: 'fyrrixriwtsijm2avdec2goq',
        question: 'No change',
        outcomes: [
          {
            label: 'Yes',
            totalSize: 11.43,
            avgEntryPrice: 0.875,
            currentPrice: 0.88,
            totalValue: 10.06,
            unrealizedPnl: 0.06,
            winner: null,
          },
          { label: 'No', totalSize: 0, totalValue: 0 },
        ],
      },
    ],
    orders: [
      {
        quoteId: 'q1',
        eventId: 'fyrrixriwtsijm2avdec2goq',
        eventTitle: 'Fed',
        question: 'No change',
        outcomeLabel: 'Yes',
        side: 'buy',
        requested: 10,
        state: 'filled',
        createdAt: '2026-10-22T08:00:00Z',
      },
      {
        quoteId: 'q2',
        eventId: 'fyrrixriwtsijm2avdec2goq',
        eventTitle: 'Fed',
        question: 'No change',
        outcomeLabel: 'Yes',
        side: 'buy',
        requested: 10,
        state: 'reviewed',
      },
    ],
    providerFailure: null,
    access: { locationBlocked: false },
    readAt: '2026-10-22T08:05:00Z',
  })
  assert.equal(account.link.state, 'active')
  assert.equal(account.balance.cashUsd, 990)
  assert.equal(account.balance.pnlUsd, 1.43)
  assert.equal(account.positions.length, 1)
  assert.equal(account.positions[0].price, 0.88)
  assert.deepEqual(
    account.orders.map((order) => [order.quoteId, order.state]),
    [['q1', 'filled']],
  )
  assert.equal(account.locationBlocked, false)
  // Not linked: no balance is invented.
  const fresh = parseAccount({ wallet: WALLET, link: { state: 'none', available: true }, balance: null })
  assert.equal(fresh.balance, null)
  assert.equal(fresh.link.state, 'none')
  assert.equal(parseAccount({ wallet: '0xabc' }), null)
  assert.equal(orderSettled('submitted'), false)
  assert.equal(orderSettled('partially_filled'), true)
})

test('live money off: «off» and no address, whatever else the answer carries; on: the Solana address and the states', () => {
  const off = parseFunding({
    wallet: WALLET,
    enabled: false,
    destination: WALLET,
    limits: { withdrawMinUsd: 1, crossChainMinUsd: 2.5, bridgeFeeUsd: 0.23 },
    deposit: { state: 'ready', address: DEPOSIT },
    balance: null,
    deposits: [],
    withdrawals: [],
    readAt: '2026-10-22T08:05:00Z',
  })
  assert.equal(off.enabled, false)
  assert.deepEqual(off.deposit, { state: 'off' })
  assert.equal(off.withdrawMinUsd, 1)
  assert.equal(off.crossChainMinUsd, 2.5)
  assert.equal(off.feeUsd, 0.23)
  const on = parseFunding({
    wallet: WALLET,
    enabled: true,
    destination: WALLET,
    limits: { withdrawMinUsd: 1, crossChainMinUsd: 2.5, bridgeFeeUsd: 0.23 },
    deposit: {
      state: 'ready',
      address: DEPOSIT,
      chainId: 792703809,
      chainName: 'Solana',
      token: { symbol: 'USDC', mint: USDC, decimals: 6 },
    },
    balance: { cashUsd: 25.5, availableUsd: 20, reservedUsd: 5.5, tokens: [], positionsUsd: 3 },
    deposits: [
      {
        id: 'd1',
        amount: 25.5,
        symbol: 'USDC',
        at: '2026-10-22T07:00:00Z',
        phase: 'credited',
        providerStatus: 'completed',
      },
      { id: 'd2', amount: 5, symbol: 'USDC', at: '2026-10-22T07:30:00Z', phase: 'strange', providerStatus: 'x' },
    ],
    withdrawals: [
      {
        requestId: 'r1',
        phase: 'unknown',
        amountUsd: 5,
        reviewedReceiveUsd: 4.77,
        reviewedFeeUsd: 0.23,
        completedUsd: null,
        txHashes: [],
        aged: false,
        createdAt: '2026-10-22T07:40:00Z',
        updatedAt: '2026-10-22T07:41:00Z',
      },
      { requestId: 'r2', phase: 'completed', amountUsd: 3, completedUsd: 2.77, txHashes: ['a', 'b'], aged: false },
      { requestId: 'r3', phase: 'unknown', amountUsd: 3, aged: true },
    ],
  })
  assert.deepEqual(on.deposit, { state: 'ready', address: DEPOSIT, symbol: 'USDC', mint: USDC })
  // «Надіслати з гаманця» asks exactly USDC of the address — never the wallet's first asset, never SOL.
  assert.equal(depositRequest(on.deposit), `solana:${DEPOSIT}?spl-token=${USDC}`)
  assert.equal(on.cashUsd, 25.5)
  assert.deepEqual(
    on.deposits.map((row) => row.state),
    ['credited', 'unknown'],
  )
  assert.deepEqual(
    on.withdrawals.map((row) => [withdrawalHolds(row), withdrawalMoving(row, true), withdrawalCheckable(row, true)]),
    [
      [true, true, true],
      [false, false, false],
      [false, false, false],
    ],
  )
  assert.equal(on.withdrawals[1].signature, 'b')
  // The address must be a Solana address, with its token's mint: anything else is a failed read, never shown.
  assert.deepEqual(
    parseFunding({ wallet: WALLET, enabled: true, deposit: { state: 'ready', address: '0xdead' } }).deposit,
    {
      state: 'failed',
    },
  )
  assert.deepEqual(
    parseFunding({
      wallet: WALLET,
      enabled: true,
      deposit: { state: 'ready', address: DEPOSIT, token: { symbol: 'USDC' } },
    }).deposit,
    { state: 'failed' },
  )
})

test('a withdrawal: typed USDC to raw digits, the preview read again, the floor of what may arrive, one id per Review', () => {
  assert.equal(rawOfTyped('5'), '5000000')
  assert.equal(rawOfTyped('2,5'), '2500000')
  assert.equal(rawOfTyped('0.000001'), '1')
  assert.equal(rawOfTyped('0'), null)
  assert.equal(rawOfTyped('1.1234567'), null)
  assert.equal(rawOfTyped('-1'), null)
  assert.equal(usdOfRaw('4770000'), 4.77)
  // 1 % under the Review's figure, rounded down to the cent — the server's own bound.
  assert.equal(receiveFloorRaw('4770000'), '4720000')
  assert.equal(receiveFloorRaw(null), null)
  const quoted = parsePreview({
    preview: {
      status: 'quoted',
      amountRaw: '5000000',
      receiveRaw: '4770000',
      feeRaw: '230000',
      expiresAt: '2026-10-22T08:10:00Z',
      maxDeliverableRaw: '25270000',
      reason: null,
    },
  })
  assert.equal(quoted.status, 'quoted')
  assert.equal(quoted.reason, null)
  const unviable = parsePreview({
    preview: { status: 'unviable', amountRaw: '100', receiveRaw: null, reason: 'below_minimum' },
  })
  assert.equal(unviable.status, 'unviable')
  assert.equal(unviable.reason, 'below_minimum')
  // A «quoted» preview that delivers nothing is not one to confirm.
  assert.equal(parsePreview({ preview: { status: 'quoted', amountRaw: '100', receiveRaw: '0' } }).status, 'unviable')
  assert.equal(
    parseWithdrawOutcome({
      outcome: 'repriced',
      preview: { status: 'quoted', amountRaw: '5000000', receiveRaw: '4700000' },
    }).outcome,
    'repriced',
  )
  assert.equal(
    parseWithdrawOutcome({ outcome: 'recorded', withdrawal: { requestId: 'r9', phase: 'sending' } }).withdrawal.phase,
    'sending',
  )
  const fixed = newRequestId((bytes) => bytes.fill(255))
  assert.match(fixed, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(newRequestId(), newRequestId())
})

test('the Review: only the checks that are not a pass are read; it cannot be placed once refused or expired', () => {
  const body = {
    review: {
      mode: 'paper',
      quoteId: 'pq_1',
      market: { question: 'No change' },
      outcome: { label: 'Yes' },
      side: 'buy',
      figures: {
        probability: 0.88,
        shares: 11.36,
        costUsd: 9.95,
        feesUsd: 0.05,
        totalUsd: 10,
        payoutIfRightUsd: 11.36,
        profitIfRightUsd: 1.36,
        maxLossUsd: 10,
      },
      quote: { quotedAt: '2026-10-22T08:00:00Z', expiresAt: '2026-10-22T08:01:30Z', ageSeconds: 3, expired: false },
      checks: [
        { id: 'funds', state: 'pass', detail: 'Enough simulated balance' },
        { id: 'depth', state: 'warn', detail: 'Thin book at this size' },
        { id: 'route_warning', state: 'warn', detail: 'limitless: low_liquidity' },
        { id: 'route_warning', state: 'warn', detail: 'limitless: low_liquidity' },
        { id: 'route_warning', state: 'warn', detail: 'myriad: low_liquidity' },
      ],
      // The server lists each warning here too (production, 2026-10-22): read once, from the checks.
      warnings: ['Thin book at this size', 'limitless: low_liquidity', 'limitless: low_liquidity'],
      canPlace: true,
    },
  }
  const review = parseReview(body)
  assert.deepEqual(
    review.checks.map((check) => [check.id, check.routeCode]),
    [
      ['depth', null],
      ['route_warning', 'low_liquidity'],
    ],
  )
  assert.equal(review.canPlace, true)
  assert.equal(review.payoutUsd, 11.36)
  assert.equal(parseReview({ review: { ...body.review, quote: { expired: true } } }).canPlace, false)
  assert.equal(
    parseReview({ review: { ...body.review, checks: [{ id: 'access', state: 'fail', detail: 'Blocked' }] } }).canPlace,
    false,
  )
  assert.equal(parseReview({ review: { ...body.review, canPlace: false } }).canPlace, false)
})

test('both languages carry every word, and the Ukrainian says «ти» about the custody', () => {
  assert.deepEqual(Object.keys(PREDICTIONS_COPY.uk).sort(), Object.keys(PREDICTIONS_COPY.en).sort())
  assert.match(PREDICTIONS_COPY.uk.custody.join(' '), /не твій гаманець/)
  assert.doesNotMatch(JSON.stringify(PREDICTIONS_COPY.uk.custody), /ваш/)
})

test('Прогнози are a section of Ryntra on Solana: no door to another product, no EVM, nothing signs a transaction', () => {
  const files = [
    'screens/predictions/index.tsx',
    'screens/predictions/event.tsx',
    'screens/predictions/ticket.tsx',
    'screens/predictions/money.tsx',
    'screens/predictions/account-card.tsx',
    'features/predictions/use-predictions.ts',
  ].map(code)
  for (const file of files) {
    assert.doesNotMatch(file, /predict\.ryntra\.io|openLink|openURL|0x[0-9a-fA-F]{40}|siwe|evm/i)
    assert.doesNotMatch(file, /signTransaction/)
  }
  // The only signature is the link's sign-in message.
  assert.match(code('screens/predictions/account-card.tsx'), /useLinkAccount\(account\.session, wallet\.signMessage\)/)
  // A withdrawal names no address: the server sends only to the proven wallet.
  assert.doesNotMatch(code('features/predictions/use-predictions.ts'), /funding\/withdraw`,\s*\{[^}]*address/)
})

test('the link: the signature taken from either shape of a signed payload, sent as base64', () => {
  const message = new TextEncoder().encode('ryntra.io wants you to sign in')
  const signature = new Uint8Array(64).fill(7)
  assert.deepEqual(signatureOf(message, signature), signature)
  const appended = new Uint8Array([...message, ...signature])
  assert.deepEqual(signatureOf(message, appended), signature)
  // Another message with a signature after it, or a payload of any other length, is no signature.
  const other = new Uint8Array([...new TextEncoder().encode('ryntra.io wants you to sign up'), ...signature])
  assert.equal(signatureOf(message, other), null)
  assert.equal(signatureOf(message, new Uint8Array(63)), null)
  assert.equal(base64Of(new Uint8Array([0, 1, 2, 250, 251])), Buffer.from([0, 1, 2, 250, 251]).toString('base64'))
  assert.equal(base64Of(signature), Buffer.from(signature).toString('base64'))
})

test('a withdrawal in the list: the figure that arrived or was asked, its one line, whether it holds the next one', () => {
  const base = {
    requestId: 'r',
    amountUsd: 5,
    receiveUsd: 4.77,
    feeUsd: 0.23,
    completedUsd: null,
    signature: null,
    aged: false,
    mismatch: false,
    at: null,
  }
  // Arrived: what arrived; while AGG has not said how much, «≈» the reviewed figure — never «arrives» for a failed one.
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'completed', completedUsd: 4.8 }), {
    usd: 4.8,
    approx: false,
    arrived: true,
  })
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'completed' }), { usd: 4.77, approx: true, arrived: true })
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'partial', completedUsd: 2 }), {
    usd: 2,
    approx: false,
    arrived: true,
  })
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'failed' }), { usd: 5, approx: false, arrived: false })
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'unknown' }), { usd: 5, approx: false, arrived: false })
  // Another destination is never «being checked»: support first, and nothing to check again.
  const mismatch = { ...base, phase: 'unknown', mismatch: true }
  assert.equal(withdrawalNote(mismatch, true), 'mismatch')
  assert.equal(withdrawalCheckable(mismatch, true), false)
  assert.equal(withdrawalNote({ ...base, phase: 'unknown' }, true), 'unknown')
  assert.equal(withdrawalNote({ ...base, phase: 'unknown' }, false), 'unknownOff')
  assert.equal(withdrawalCheckable({ ...base, phase: 'unknown' }, false), false)
  assert.equal(withdrawalNote({ ...base, phase: 'unknown', aged: true }, true), 'aged')
  assert.equal(withdrawalNote({ ...base, phase: 'refused' }, true), 'refused')
  assert.equal(withdrawalNote({ ...base, phase: 'in_flight' }, true), null)
  // On its way holds nothing back — the server holds back only sending and unknown — but is read again sooner.
  assert.equal(withdrawalHolds({ ...base, phase: 'in_flight' }), false)
  assert.equal(withdrawalMoving({ ...base, phase: 'in_flight' }, true), true)
  // Switched off, nothing is asked again; another destination waits for support, not for the list.
  assert.equal(withdrawalMoving({ ...base, phase: 'in_flight' }, false), false)
  assert.equal(withdrawalMoving(mismatch, true), false)
  // The form says why it is held: another destination is never «still being checked».
  assert.equal(withdrawHold([{ ...base, phase: 'unknown' }]), 'open')
  assert.equal(withdrawHold([{ ...base, phase: 'unknown' }, mismatch]), 'mismatch')
  assert.equal(withdrawHold([{ ...base, phase: 'in_flight' }]), null)
  // No figure is no «≈».
  assert.deepEqual(withdrawalFigure({ ...base, phase: 'completed', receiveUsd: null }), {
    usd: null,
    approx: false,
    arrived: true,
  })
  assert.equal(withdrawalHolds({ ...base, phase: 'unknown', aged: true }), false)
  // A preview is reviewed only when answered for this very wallet as the destination.
  assert.equal(previewForWallet({ destination: WALLET, wallet: WALLET }, WALLET), true)
  assert.equal(previewForWallet({ destination: WALLET, wallet: null }, WALLET), false)
  assert.equal(previewForWallet({ destination: DEPOSIT, wallet: WALLET }, WALLET), false)
})

test('a simulated order: the sum typed, from $1 as the server takes it; the link’s refusals said by their kind', () => {
  assert.equal(spendOf('10'), 10)
  assert.equal(spendOf('2,5'), 2.5)
  assert.equal(spendOf('1.234'), null)
  assert.equal(spendOf('0'), null)
  assert.equal(spendOf(''), null)
  // No venue's minimum in shares is read as dollars: the ticket's floor is the server's own $1.
  assert.doesNotMatch(code('screens/predictions/ticket.tsx'), /minOrder/)
  assert.match(code('screens/predictions/ticket.tsx'), /const min = SPEND_MIN_USD/)
  assert.equal(linkFailureOf('CHALLENGE_REQUIRED', false), 'busy')
  assert.equal(linkFailureOf('RATE_LIMITED', false), 'busy')
  assert.equal(linkFailureOf('LINK_UNAVAILABLE', false), 'unavailable')
  assert.equal(linkFailureOf(null, true), 'declined')
  assert.equal(linkFailureOf('SIGNATURE_INVALID', false), 'failed')
  // A chance line the venue has not priced for over 15 minutes is marked.
  // Counted from the newest bar's opening (production: 1006 s on a live hourly bar, 33 406 s on a live daily one):
  // only what lies past the bar's own length counts.
  assert.equal(lineStale({ staleSeconds: 1006 }, '1w'), false)
  assert.equal(lineStale({ staleSeconds: 33_406 }, '3m'), false)
  assert.equal(lineStale({ staleSeconds: 3_600 + 901 }, '1w'), true)
  assert.equal(lineStale({ staleSeconds: 86_400 + 901 }, '3m'), true)
  assert.equal(lineStale({ staleSeconds: null }, '1w'), false)
  assert.equal(routeCodeOf('limitless: low_liquidity'), 'low_liquidity')
  assert.equal(routeCodeOf("kalshi: Unavailable for this account's region"), 'region')
  assert.equal(routeCodeOf('myriad: Venue key required'), 'account')
  assert.equal(routeCodeOf('polymarket: geo_blocked'), 'region')
  assert.equal(routeCodeOf('kalshi: insufficient account balance'), 'other')
  assert.equal(routeCodeOf('predict: Something else happened'), 'other')
})
