import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  limitBase,
  otherLegUsd,
  quoteLiveShare,
  referencePerToken,
  shareDistance,
  shareFar,
  sharesPerTokenOf,
  stockLegUsd,
  ticketLiveShare,
  ticketPoolWarning,
} from './stock-pool.ts'
import { SHEET_COPY } from './sheet-copy.ts'
import { LIMIT_COPY } from '../limits/copy.ts'
import { INVEST_COPY } from '../invest/copy.ts'
import { poolWarningText } from '../invest/pool-warning.ts'
import { SOL_MINT, USDC_MINT } from '../../lib/api.ts'
import { offsetPrice } from '../limits/limit-model.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

// SGOVx as the critics read it (ST-5 r9): the pool at $2 090,70 a token, the share's reference $100,59, $0,2 in the pool.
const SGOVX = { referencePerShare: 100.59, deviationPct: 1978, liquidityUsd: 0.2, sharesPerToken: 1 }

test('ST-5 r9: the ticket says the pool that cannot stand for the share — the Limit on the pool, the Market on its own estimate', () => {
  // The Limit waits on the pool: its own far price is said, and the empty pool with it.
  const limit = ticketPoolWarning(SGOVX)
  assert.equal(limit?.farPct, 1978)
  assert.equal(limit?.empty, true)
  // The Market ticket's estimate for $23 pays $102,29 a share: near the share — only the empty pool is said.
  const live = ticketLiveShare({ usd: 23, tokenRaw: '224845', decimals: 6, sharesPerToken: 1, at: 1_000 })
  assert.ok(live && Math.abs(live.perShare - 102.29) < 0.01)
  const market = ticketPoolWarning(SGOVX, live)
  assert.equal(market?.farPct, null)
  assert.equal(market?.empty, true)
  // $10 through the empty pool at $48 077 a share: far, said with its sum.
  const small = ticketLiveShare({ usd: 10, tokenRaw: '208', decimals: 6, sharesPerToken: 1, at: 1_000 })
  assert.ok((ticketPoolWarning(SGOVX, small)?.farPct ?? 0) > 1000)
  // No shares a token stands for, no time, no dollars: no live figure — the pool's own price speaks.
  assert.equal(ticketLiveShare({ usd: 23, tokenRaw: '224845', decimals: 6, sharesPerToken: null, at: 1 }), null)
  assert.equal(ticketLiveShare({ usd: 23, tokenRaw: '224845', decimals: 6, sharesPerToken: 1, at: null }), null)
  assert.equal(ticketLiveShare({ usd: null, tokenRaw: '224845', decimals: 6, sharesPerToken: 1, at: 1 }), null)
  // A token that is no stock, or a pool near the share and full: nothing said.
  assert.equal(ticketPoolWarning(null), null)
  assert.equal(
    ticketPoolWarning({ referencePerShare: 100, deviationPct: 0.4, liquidityUsd: 2_000_000, sharesPerToken: 1 }),
    null,
  )
})

test('ST-5 r9: the limit’s presets never stand on a far pool — on the share’s reference for a token, or on nothing', () => {
  // The reference for one token in USDC: per share × shares a token stands for, over the quote's dollar.
  const ref = referencePerToken({ referencePerShare: 100.59, sharesPerToken: 1, quoteUsd: 1, dollarQuote: true })
  assert.equal(ref, 100.59)
  assert.equal(
    referencePerToken({ referencePerShare: 100, sharesPerToken: 1.05, quoteUsd: null, dollarQuote: true }),
    105,
  )
  // In SOL, only at SOL's stated price; never a guess.
  assert.equal(referencePerToken({ referencePerShare: 100, sharesPerToken: 1, quoteUsd: 200, dollarQuote: false }), 0.5)
  assert.equal(referencePerToken({ referencePerShare: 100, sharesPerToken: 1, quoteUsd: null, dollarQuote: false }), null)
  // No multiplier, no reference: nothing.
  assert.equal(referencePerToken({ referencePerShare: 100, sharesPerToken: null, quoteUsd: 1, dollarQuote: true }), null)
  assert.equal(referencePerToken({ referencePerShare: null, sharesPerToken: 1, quoteUsd: 1, dollarQuote: true }), null)

  // The pool warned: −1 % stands on the share — $99,58, never the pool's $2 069,79.
  const warned = limitBase({ marketPrice: 2090.7, warned: true, pending: false, referencePerToken: ref })
  assert.deepEqual(warned, { price: 100.59, basis: 'reference' })
  assert.equal(offsetPrice('buy', 1, warned.price), '99.5841')
  // Warned with no reference for a token: the price is left empty beside the warning.
  assert.equal(limitBase({ marketPrice: 2090.7, warned: true, pending: false, referencePerToken: null }), null)
  // While the stock's read is coming: nothing pre-filled.
  assert.equal(limitBase({ marketPrice: 2090.7, warned: false, pending: true, referencePerToken: null }), null)
  // A pool that stands for the share, or a coin: the market's price, as before.
  assert.deepEqual(limitBase({ marketPrice: 150, warned: false, pending: false, referencePerToken: null }), {
    price: 150,
    basis: 'market',
  })

  // A typed price far from the share is said beside it: 2 069,79 is ≈ 1 958 % above a $100,59 share.
  const typed = shareDistance(2069.79, ref)
  assert.ok(typed !== null && Math.round(typed) === 1958)
  assert.equal(shareFar(typed), true)
  assert.equal(shareFar(shareDistance(99.58, ref)), false)
  assert.equal(shareFar(shareDistance(99.58, null)), false)
})

test('ST-5 r9: the ticket and the limit say the pool over their action, in both languages', () => {
  const trade = code('screens/trade/index.tsx')
  assert.match(trade, /\{marketPoolLine \? <PoolLine text=\{marketPoolLine\} \/> : null\}/)
  const panel = code('screens/trade/limit-panel.tsx')
  assert.match(panel, /\{stock\?\.warning \? <PoolLine text=\{stock\.warning\} \/> : null\}/)
  // The presets stand on what `limitBase` says, never on the market's price by itself.
  assert.doesNotMatch(panel, /offsetPrice\(side, \d, marketPrice\)/)
  assert.doesNotMatch(panel, /offsetPrice\(side, Number\(step\), marketPrice\)/)
  // A typed price far from the share, and the presets' distance from it, in both languages.
  assert.equal(LIMIT_COPY.uk.shareFar('1 958 %', true), '≈ 1 958 % вище за акцію')
  assert.equal(LIMIT_COPY.en.shareFar('1,958%', true), '≈ 1,958% above the share')
  assert.equal(LIMIT_COPY.uk.shareFar('40 %', false), '≈ 40 % нижче за акцію')
  assert.equal(LIMIT_COPY.uk.fromShare('−1 %'), '−1 % від акції')
  assert.equal(LIMIT_COPY.en.fromShare('−1%'), '−1% from the share')
})

// SGOVx as the critics read it in round 10: 1 SGOVx = 1,014694 SGOV, the share's reference $100,59, the pool listed at
// +1 978 % with $0,2 in it.
const SGOVX_R10 = { referencePerShare: 100.59, deviationPct: 1978, liquidityUsd: 0.2, sharesPerToken: 1.014694 }

test('ST-5 r10: $10 of SGOVx — the ticket warns on the very estimate its line shows, not on the pool’s listed figure', () => {
  // «≈ 0,00020509 SGOVx» for $10 in USDC, the estimate stating no dollar figure of its own: the USDC is its own dollars.
  const live = quoteLiveShare({
    other: { mint: USDC_MINT, raw: '10000000', decimals: 6, quotedUsd: null, price: null },
    stock: { raw: '20509', decimals: 8 },
    sharesPerToken: SGOVX_R10.sharesPerToken,
    at: Date.parse('2026-10-19T12:04:00Z'),
  })
  assert.ok(live !== null)
  assert.equal(live.usd, 10)
  // ≈ $48 054 a share — ≈ +47 670 % against the $100,59 share, the figure the buy sheet and the quote card say.
  assert.ok(Math.abs(live.perShare - 48_054) < 5, String(live.perShare))
  const warning = ticketPoolWarning(SGOVX_R10, live)
  assert.ok(warning !== null && warning.farPct !== null)
  assert.ok(Math.abs(warning.farPct - 47_673) < 10, String(warning.farPct))
  assert.equal(warning.liveUsd, 10)
  assert.equal(warning.empty, true)
  // Said with its sum, never the pool's listed «1 978 %».
  const uk = poolWarningText(warning, 'uk', INVEST_COPY.uk)
  assert.match(uk, /47\s67\d%/)
  assert.doesNotMatch(uk, /1\s978/)
  assert.match(poolWarningText(warning, 'en', INVEST_COPY.en), /47,67\d%/)
  // The estimate's own dollars win when it states them; without the multiplier there is no live figure — the listed one.
  assert.equal(
    quoteLiveShare({
      other: { mint: USDC_MINT, raw: '10000000', decimals: 6, quotedUsd: '9.998', price: null },
      stock: { raw: '20509', decimals: 8 },
      sharesPerToken: 1.014694,
      at: 1,
    })?.usd,
    9.998,
  )
  const noMultiplier = quoteLiveShare({
    other: { mint: USDC_MINT, raw: '10000000', decimals: 6, quotedUsd: null, price: null },
    stock: { raw: '20509', decimals: 8 },
    sharesPerToken: null,
    at: 1,
  })
  assert.equal(noMultiplier, null)
  assert.equal(ticketPoolWarning(SGOVX_R10, noMultiplier)?.farPct, 1978)
})

test('ST-5 r10: the other leg’s dollars — the estimate’s, a dollar token’s own, or at a stated price; never a guess', () => {
  assert.equal(otherLegUsd({ mint: USDC_MINT, raw: '2500000', decimals: 6, quotedUsd: null, price: null }), 2.5)
  assert.equal(otherLegUsd({ mint: SOL_MINT, raw: '1500000000', decimals: 9, quotedUsd: null, price: 186 }), 279)
  assert.equal(otherLegUsd({ mint: SOL_MINT, raw: '1500000000', decimals: 9, quotedUsd: '280.1', price: 186 }), 280.1)
  assert.equal(otherLegUsd({ mint: SOL_MINT, raw: '1500000000', decimals: 9, quotedUsd: null, price: null }), null)
  assert.equal(otherLegUsd({ mint: SOL_MINT, raw: null, decimals: 9, quotedUsd: null, price: 186 }), null)
})

test('ST-5 r10: the shares a token stands for — the page’s own figure, from the first read that states it', () => {
  const read = (over) => ({
    row: { multiplier: null },
    onchain: { error: 'x' },
    chainMultiplier: null,
    issuerMultiplier: null,
    ...over,
  })
  assert.equal(sharesPerTokenOf(read({ chainMultiplier: { current: 1.014694 } })), 1.014694)
  assert.equal(sharesPerTokenOf(read({ row: { multiplier: { current: 1.02 } } })), 1.02)
  assert.equal(sharesPerTokenOf(read({ issuerMultiplier: { current: 1.03 } })), 1.03)
  assert.equal(sharesPerTokenOf(read({ onchain: { scaledUi: { multiplier: 1.04 } } })), 1.04)
  // Before the stock's read answers, the wallet's read of the mint's multiplier; none stated is null, never 1.
  assert.equal(sharesPerTokenOf(undefined, 1.05), 1.05)
  assert.equal(sharesPerTokenOf(undefined), null)
  assert.equal(sharesPerTokenOf(read({})), null)
})

test('ST-5 r10: «Обмін» values a stock leg of a far pool at the share — ≈ $0,02, not the pool’s ≈ $0,44', () => {
  // 1,5 SOL → 0,00020892 SGOVx: at the pool's $2 090 a token it read «≈ $0,44»; at the share it is ≈ $0,0213.
  const worth = stockLegUsd('20892', 8, SGOVX_R10)
  assert.ok(worth !== null && Math.abs(worth - 0.02132) < 0.0001, String(worth))
  // Without the multiplier or the reference: a dash, never the pool's figure.
  assert.equal(stockLegUsd('20892', 8, { ...SGOVX_R10, sharesPerToken: null }), null)
  assert.equal(stockLegUsd('20892', 8, { ...SGOVX_R10, referencePerShare: null }), null)
  assert.equal(stockLegUsd('20892', 8, null), null)
  // The swap's estimate for 1,5 SOL at $186 judges the pool on its own price: far, said with the sum.
  const live = quoteLiveShare({
    other: { mint: SOL_MINT, raw: '1500000000', decimals: 9, quotedUsd: null, price: 186 },
    stock: { raw: '20892', decimals: 8 },
    sharesPerToken: SGOVX_R10.sharesPerToken,
    at: 1,
  })
  assert.ok((ticketPoolWarning(SGOVX_R10, live)?.farPct ?? 0) > 10_000)
})

test('ST-5 r10: one quote for the line and the warning; the estimate carries its time; «Обмін» says the pool', () => {
  const trade = code('screens/trade/index.tsx')
  // The figure under the sum and the warning read the same quote, the one for the amount on screen.
  assert.match(trade, /const shownQuote = trade\.quote && trade\.quote\.order\.inAmountRaw === trade\.typedRaw/)
  assert.match(trade, /shortUnits\(shownQuote\.order\.outAmountRaw/)
  assert.doesNotMatch(trade, /quotedHere/)
  assert.match(trade, /judgePool\(stockFacts, mode === 'sell' \? 'pay' : 'receive', false\)/)
  assert.match(trade, /sheetWords\.quotedAt\(formatClock\(trade\.quotedAt\)\)/)
  assert.match(trade, /<PoolLine text=\{poolLine\} \/>/)
  assert.equal(SHEET_COPY.uk.quotedAt('12:04'), 'о 12:04')
  assert.equal(SHEET_COPY.en.quotedAt('12:04'), 'at 12:04')
  // The pickers carry the far-pool chip Markets and Search carry.
  assert.match(code('screens/trade/asset-picker.tsx'), /poolFar: item\.poolFar/)
  assert.match(code('screens/plans/pick-stock.tsx'), /poolFar: stockPoolFar\(item\)/)
})
