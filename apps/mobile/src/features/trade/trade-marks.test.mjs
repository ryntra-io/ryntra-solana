import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formatRate, legMarks, legWarning, rateIsPrecise, reviewView, SOL_ASSET, usdAtPrice } from './trade-model.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const CBBTC = {
  mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  symbol: 'cbBTC',
  name: 'Coinbase BTC',
  icon: null,
  decimals: 8,
}
const GLONK = {
  mint: 'GLonkGLonkGLonkGLonkGLonkGLonkGLonkGLonk1111',
  symbol: 'Glonk',
  name: 'Glonk',
  icon: null,
  decimals: 6,
}

const order = (inAmountRaw, outAmountRaw) => ({
  requestId: 'req-r7',
  inputMint: SOL_ASSET.mint,
  outputMint: CBBTC.mint,
  inAmountRaw,
  outAmountRaw,
  minReceivedRaw: outAmountRaw,
  slippageBps: 50,
  priceImpactPct: '0',
  router: 'jupiter',
  totalFeeBasisPoints: 0,
  ryntraFee: null,
  signatureFeeLamports: '5000',
  priorityFeeLamports: '0',
  rentFeeLamports: '0',
  inUsdValue: null,
  outUsdValue: null,
  swapUsdValue: null,
  route: [],
  taker: null,
  observedAt: '2026-10-19T12:00:00.000Z',
  reviewExpiresAt: '2026-10-19T12:01:30.000Z',
})

const rateOf = (inRaw, outRaw, locale = 'uk') =>
  reviewView(
    { order: order(inRaw, outRaw), mode: 'swap', pay: SOL_ASSET, receive: CBBTC, decimals: {}, exact: false },
    locale,
  ).rows.find((row) => row.key === 'price')?.value ?? null

test('ST-5 r7: no rate from a crumb whose rounding is the rate — 0,00001 SOL → 1 satoshi said nothing, not «≈ 0,001»', () => {
  // 0,00001 SOL (10 000 lamports) bought 1 satoshi: the ratio is the rounding, 21 % off the market.
  assert.equal(rateOf('10000', '1'), null)
  // 0,001 SOL → 127 satoshi: still three digits at most, still none.
  assert.equal(rateOf('1000000', '127'), null)
  // 0,1 SOL → 12 734 satoshi: the rate is said.
  assert.equal(rateOf('100000000', '12734'), '1 SOL ≈ 0,0012734 cbBTC')
  assert.equal(rateIsPrecise('1000', '1000'), true)
  assert.equal(rateIsPrecise('999', '100000'), false)
  assert.equal(rateIsPrecise('x', '100000'), false)
})

test('ST-5 r7: a rate keeps six significant digits in both languages — the same digits, each its own marks', () => {
  assert.equal(formatRate(105.249912, 'en'), '105.25')
  assert.equal(formatRate(105.249912, 'uk'), '105,25')
  assert.equal(formatRate(105.5, 'en'), '105.5')
  assert.equal(formatRate(105.5, 'uk'), '105,5')
  assert.equal(formatRate(0.00127345678, 'en'), '0.00127346')
  assert.equal(formatRate(0.00127345678, 'uk'), '0,00127346')
  assert.equal(formatRate(1234567.8, 'en'), '1,234,568')
  assert.equal(formatRate(1234567.8, 'uk'), '1 234 568')
  assert.equal(formatRate(9.9999999, 'en'), '10')
  assert.equal(formatRate(0, 'en'), '—')
  assert.equal(formatRate(Number.NaN, 'uk'), '—')
})

test('ST-5 r7: a dollar line the estimate does not give comes from a known market price, never a «—» beside it', () => {
  // 349 663 Glonk at $0,00000304 ≈ $1,06.
  const usd = usdAtPrice('349663000000', 6, 0.00000304)
  assert.ok(usd !== null && Math.abs(usd - 1.063) < 0.001)
  assert.equal(usdAtPrice('349663000000', 6, null), null, 'no price: unknown, never 0')
  assert.equal(usdAtPrice('0', 6, 2), null)
  assert.equal(usdAtPrice(null, 6, 2), null)
  assert.equal(usdAtPrice('100', null, 2), null)
  assert.equal(usdAtPrice('100', 6, 0), null)
})

test('ST-5 r7: a picked token keeps the list’s marks — Jupiter’s check, its flag, a stock look-alike — and one line says the strongest', () => {
  assert.equal(legMarks(null, null), null)
  // Said by the list it was picked from.
  assert.deepEqual(legMarks({ ...GLONK, verified: false }, null), {
    unverified: true,
    flagged: false,
    lookalikeOf: null,
  })
  // Said by its market row read since.
  assert.deepEqual(legMarks(GLONK, { verified: false, suspicious: true }), {
    unverified: true,
    flagged: true,
    lookalikeOf: null,
  })
  // Said by neither: no mark is invented.
  assert.deepEqual(legMarks(GLONK, null), { unverified: false, flagged: false, lookalikeOf: null })
  assert.deepEqual(legMarks(SOL_ASSET, { verified: true, suspicious: false }), {
    unverified: false,
    flagged: false,
    lookalikeOf: null,
  })
  const lookalike = legMarks({ ...GLONK, verified: false, lookalikeOf: 'NVIDIA' }, null)
  assert.equal(lookalike.lookalikeOf, 'NVIDIA')

  const sol = legMarks(SOL_ASSET, null)
  assert.equal(legWarning([sol, legMarks(GLONK, null)]), null)
  assert.deepEqual(legWarning([sol, legMarks({ ...GLONK, verified: false }, null)]), { kind: 'unverified' })
  assert.deepEqual(
    legWarning([legMarks({ ...GLONK, verified: false }, null), legMarks(GLONK, { verified: true, suspicious: true })]),
    {
      kind: 'flagged',
    },
  )
  assert.deepEqual(legWarning([lookalike, legMarks({ ...GLONK, verified: false }, null)]), {
    kind: 'lookalike',
    company: 'NVIDIA',
  })
})

test('ST-5 r7: the swap draws the marks and the warning, a bounded dollar figure keeps its own qualifier, a blank line is silent', () => {
  const screen = code('screens/trade/index.tsx')
  assert.doesNotMatch(screen, /`≈ \$\{usd\}`/, 'never «≈ <$0,01»')
  assert.match(screen, /approxFigure\(usd\)/)
  assert.match(screen, /marks=\{payMarks\}/)
  assert.match(screen, /marks=\{receiveMarks\}/)
  assert.match(screen, /assetWords\.unverified/)
  assert.match(screen, /importantForAccessibility=\{dollars \? 'auto' : 'no'\}/)
  assert.match(screen, /importantForAccessibility=\{sub \? 'auto' : 'no'\}/)
  // «Можна використати» in its row label's face, not monospace.
  assert.match(screen, /<Txt variant="ui" tone=\{cornerTone\}/)
})
