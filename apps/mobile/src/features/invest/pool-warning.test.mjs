import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BUY_COPY } from './buy-copy.ts'
import { INVEST_COPY } from './copy.ts'
import {
  deviationOf,
  fairFromOf,
  heardLive,
  LIVE_FRESH_MS,
  liveAt,
  perSharePaid,
  POOL_EMPTY_USD,
  poolWarningOf,
  poolWarningText,
  quoteFar,
  shareWorthUsd,
} from './pool-warning.ts'

test('a pool far from the share, nearly empty: one plain line, which way and how far (ST-5 r7, SGOVx)', () => {
  const warning = poolWarningOf({ deviationPct: 1978.27, referencePerShare: 100.59, liquidityUsd: 0.2 })
  assert.deepEqual(warning, { farPct: 1978.27, liveUsd: null, empty: true, fairFrom: null })
  assert.equal(
    poolWarningText(warning, 'en', INVEST_COPY.en),
    'The pool price is 1,978% above the share — the pool is nearly empty',
  )
  assert.match(poolWarningText(warning, 'uk', INVEST_COPY.uk), /^Ціна в пулі на 1\s978% вища за акцію — пул майже порожній$/)
})

test('below the share, a deep pool: the distance alone', () => {
  const warning = poolWarningOf({ deviationPct: -24.6, referencePerShare: 180, liquidityUsd: 250_000 })
  assert.equal(poolWarningText(warning, 'en', INVEST_COPY.en), 'The pool price is 25% below the share')
  assert.equal(poolWarningText(warning, 'uk', INVEST_COPY.uk), 'Ціна в пулі на 25% нижча за акцію')
})

test('with no reference no distance is claimed; a near price in a deep pool says nothing', () => {
  // NVDAon: 4.5% under, no reference, $2,66K in its pool — nothing to say.
  assert.equal(poolWarningOf({ deviationPct: -4.5, referencePerShare: null, liquidityUsd: 2_660 }), null)
  assert.equal(poolWarningOf({ deviationPct: 40, referencePerShare: null, liquidityUsd: 2_660 }), null)
  assert.equal(poolWarningOf({ deviationPct: 4.5, referencePerShare: 180, liquidityUsd: 2_660 }), null)
  assert.equal(poolWarningOf({ deviationPct: null, referencePerShare: 180, liquidityUsd: null }), null)
  // An empty pool with no reference: that it is empty, no distance.
  const empty = poolWarningOf({ deviationPct: 40, referencePerShare: null, liquidityUsd: POOL_EMPTY_USD - 1 })
  assert.deepEqual(empty, { farPct: null, liveUsd: null, empty: true, fairFrom: null })
  assert.equal(poolWarningText(empty, 'en', INVEST_COPY.en), INVEST_COPY.en.poolEmpty)
})

test('the freshest figure wins: a live quote near the share silences the stale pool price; the empty pool stays (ST-5 r8)', () => {
  // 13 minutes on, the route quotes SGOVx fairly — $100.81 a share — while the pool's listed price still says +1 978%.
  const fair = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: 100.59,
    liquidityUsd: 0.2,
    live: { perShare: 100.81, usd: 10 },
  })
  assert.deepEqual(fair, { farPct: null, liveUsd: null, empty: true, fairFrom: null })
  assert.equal(poolWarningText(fair, 'uk', INVEST_COPY.uk), INVEST_COPY.uk.poolEmpty)
  // In a deep pool a fair live quote leaves nothing to say.
  assert.equal(
    poolWarningOf({
      deviationPct: 1978.27,
      referencePerShare: 100.59,
      liquidityUsd: 50_000,
      live: { perShare: 100.81, usd: 10 },
    }),
    null,
  )
})

test('a live quote far from the share says the distance for its sum', () => {
  // $10 bought ≈ 0.0002 of a share: $50 000 a share against $100.59.
  const far = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: 100.59,
    liquidityUsd: 0.2,
    live: { perShare: 50_000, usd: 10 },
  })
  assert.equal(far.liveUsd, 10)
  assert.equal(
    poolWarningText(far, 'en', INVEST_COPY.en),
    'For $10 the price is 49,607% above the share — the pool is nearly empty',
  )
  assert.match(poolWarningText(far, 'uk', INVEST_COPY.uk), /^За \$10 ціна на 49\s607% вища за акцію — пул майже порожній$/)
  // With no reference the live figure claims nothing either.
  assert.equal(
    poolWarningOf({
      deviationPct: null,
      referencePerShare: null,
      liquidityUsd: 50_000,
      live: { perShare: 50_000, usd: 10 },
    }),
    null,
  )
})

test('what a purchase paid for a share, and what it brings is worth at the reference', () => {
  assert.equal(perSharePaid(10, 0.0002), 50_000)
  assert.equal(perSharePaid(10, 0), null)
  assert.equal(perSharePaid(null, 0.0002), null)
  assert.ok(Math.abs(shareWorthUsd(0.0002, 100.59) - 0.020118) < 1e-9)
  assert.equal(shareWorthUsd(0.0002, null), null)
  assert.equal(deviationOf(110.649, 100.59).toFixed(2), '10.00')
  assert.equal(deviationOf(null, 100.59), null)
  assert.equal(BUY_COPY.uk.shareWorth('≈ $0,02', '$10'), '≈ $0,02 у ціні акції за $10')
  assert.equal(BUY_COPY.en.shareWorth('≈ $0.02', '$10'), '≈ $0.02 of the share’s value for $10')
})

test('a quote far from the reference', () => {
  assert.equal(quoteFar(4_689_447.28, 100.59), true)
  assert.equal(quoteFar(0.4, 100.59), false)
  assert.equal(quoteFar(4_689_447.28, null), false)
})

test('the warning over «Купити» is judged at the sum about to be bought, never by another sum (ST-5 r9, SGOVx)', () => {
  const now = Date.parse('2026-10-19T11:56:00Z')
  const reference = 100.59
  // The purchase's own engine: $1 000 fair at $100.81 (a route with depth); its default $10 through the empty pool, $48 077 a share.
  let seen = heardLive([], { perShare: 100.81, usd: 1_000, at: now - 60_000, source: 'swap' })
  seen = heardLive(seen, { perShare: 48_077, usd: 10, at: now - 30_000, source: 'swap' })
  // At $10 the $10 quote judges, not the fair $1 000 one.
  assert.equal(liveAt(seen, 10, now).usd, 10)
  assert.equal(liveAt(seen, 25, now), null)
  const fairFrom = fairFromOf(seen, 10, reference, now)
  assert.equal(fairFrom.usd, 1_000)
  const warning = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: reference,
    liquidityUsd: 0.2,
    live: liveAt(seen, 10, now),
    fairFrom,
  })
  assert.equal(warning.liveUsd, 10)
  assert.ok(warning.farPct > 47_000)
  const clock = () => '11:55'
  assert.match(
    poolWarningText(warning, 'uk', INVEST_COPY.uk, clock),
    /^За \$10 ціна на 47\s695% вища за акцію — пул майже порожній\. Від \$1\s000 ціна близька до акції — котирування о 11:55$/,
  )
  assert.equal(
    poolWarningText(warning, 'en', INVEST_COPY.en, clock),
    'For $10 the price is 47,695% above the share — the pool is nearly empty. From $1,000 the price is close to the share — quote at 11:55',
  )
  // Before any quote for $10 the fair $1 000 never softens it: the pool's own price speaks, the seen fair sum beside it.
  const before = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: reference,
    liquidityUsd: 0.2,
    live: liveAt([seen[1]], 10, now),
    fairFrom: fairFromOf([seen[1]], 10, reference, now),
  })
  assert.equal(before.farPct, 1978.27)
  assert.equal(before.liveUsd, null)
  assert.equal(before.fairFrom.usd, 1_000)
  // At $1 000 itself the fair quote judges: only the empty pool is said.
  const atThousand = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: reference,
    liquidityUsd: 0.2,
    live: liveAt(seen, 1_000, now),
    fairFrom: fairFromOf(seen, 1_000, reference, now),
  })
  assert.deepEqual(atThousand, { farPct: null, liveUsd: null, empty: true, fairFrom: null })
})

test('a fair larger sum is said only as seen: none seen, none said; a larger sum seen far voids it; old quotes judge nothing', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  // No larger sum quoted: no threshold is claimed.
  assert.equal(fairFromOf([{ perShare: 48_077, usd: 10, at: now, source: 'swap' }], 10, 100.59, now), null)
  // $100 far, $1 000 fair, $10 000 fair: from $1 000.
  const ladder = [
    { perShare: 473_934, usd: 100, at: now, source: 'swap' },
    { perShare: 100.81, usd: 1_000, at: now, source: 'swap' },
    { perShare: 100.7, usd: 10_000, at: now, source: 'swap' },
  ]
  assert.equal(fairFromOf(ladder, 10, 100.59, now).usd, 1_000)
  // $1 000 fair but $10 000 far: no «from» can be said.
  assert.equal(
    fairFromOf([{ perShare: 100.81, usd: 1_000, at: now, source: 'swap' }, { perShare: 900, usd: 10_000, at: now, source: 'swap' }], 10, 100.59, now),
    null,
  )
  // Without a reference no claim.
  assert.equal(fairFromOf(ladder, 10, null, now), null)
  // A quote past its freshness judges nothing.
  const old = { perShare: 100.81, usd: 10, at: now - LIVE_FRESH_MS - 1, source: 'swap' }
  assert.equal(liveAt([old], 10, now), null)
  assert.equal(fairFromOf([{ ...old, usd: 1_000 }], 10, 100.59, now), null)
  // One figure per sum, the newest; a sum to the cent.
  const kept = heardLive([{ perShare: 1, usd: 25, at: now - 10, source: 'swap' }], { perShare: 2, usd: 25.001, at: now, source: 'swap' })
  assert.equal(kept.length, 1)
  assert.equal(kept[0].perShare, 2)
  // Without a clock the larger fair sum is not said.
  const warning = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: 100.59,
    liquidityUsd: 0.2,
    fairFrom: { perShare: 100.81, usd: 1_000, at: now, source: 'swap' },
  })
  assert.equal(poolWarningText(warning, 'en', INVEST_COPY.en), 'The pool price is 1,978% above the share — the pool is nearly empty')
})

test('only the engine the purchase buys through judges its warning (ST-5 r10, SGOVx: the quote card said «from $1 000 close» while the purchase at $1 000 was far)', () => {
  const now = Date.parse('2026-10-19T19:15:00Z')
  const reference = 100.59
  // The quote card's engine: $1 000 fair. The purchase's own engine: $10 far.
  let seen = heardLive([], { perShare: 100.77, usd: 1_000, at: now - 60_000, source: 'stock-quote' })
  seen = heardLive(seen, { perShare: 48_077, usd: 10, at: now - 30_000, source: 'swap' })
  assert.equal(fairFromOf(seen, 10, reference, now), null)
  assert.equal(liveAt(seen, 1_000, now), null)
  assert.equal(liveAt(seen, 10, now).source, 'swap')
  // A figure with no engine named judges nothing.
  assert.equal(liveAt([{ perShare: 100.77, usd: 10, at: now }], 10, now), null)
  // The purchase's engine at $1 000 far: no «from $1 000» is said, and at $1 000 the far figure judges.
  seen = heardLive(seen, { perShare: 4_712_000, usd: 1_000, at: now, source: 'swap' })
  assert.equal(seen.length, 3)
  assert.equal(fairFromOf(seen, 10, reference, now), null)
  const atThousand = poolWarningOf({
    deviationPct: 1978.27,
    referencePerShare: reference,
    liquidityUsd: 0.2,
    live: liveAt(seen, 1_000, now),
    fairFrom: fairFromOf(seen, 1_000, reference, now),
  })
  assert.equal(atThousand.liveUsd, 1_000)
  assert.equal(atThousand.fairFrom, null)
  // The same sum from both engines is kept apart: one per engine and sum.
  const both = heardLive(seen, { perShare: 101, usd: 1_000, at: now + 1, source: 'stock-quote' })
  assert.equal(both.filter((quote) => quote.usd === 1_000).length, 2)
})
