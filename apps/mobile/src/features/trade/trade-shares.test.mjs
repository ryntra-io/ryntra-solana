import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  floorSolUsd,
  PAY_SHARES_PCT,
  payingAssetFor,
  QUOTE_ASSETS,
  shareOfRaw,
  SOL_SWAP_RESERVE_LAMPORTS,
  ticketSpendableRaw,
  underOneDollar,
  unitsForField,
} from './trade-model.ts'

test('the quick shares are 25 · 50 · 75 · 100 % of what the wallet can spend, rounded down — never more', () => {
  assert.deepEqual([...PAY_SHARES_PCT], [25, 50, 75, 100])
  assert.equal(shareOfRaw('1000000', 25), '250000')
  assert.equal(shareOfRaw('1000000', 100), '1000000')
  // An odd amount rounds down: three quarters of 7 units is 5, not 6.
  assert.equal(shareOfRaw('7', 75), '5')
  assert.equal(shareOfRaw('0', 50), '0')
  // Not a whole raw amount: no share is offered.
  assert.equal(shareOfRaw('', 50), null)
  assert.equal(shareOfRaw('1.5', 50), null)
  // What the field shows: 12.5 USDC as typed, without grouping.
  assert.equal(unitsForField(shareOfRaw('50000000', 25), 6, 'en'), '12.5')
  assert.equal(unitsForField(shareOfRaw('5000000000', 50), 6, 'uk'), '2500')
})

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'

test('SOL’s 100 % is what a swap can sign: the server’s fee reserve and two accounts’ rent kept back; a token’s is all of it', () => {
  assert.equal(SOL_SWAP_RESERVE_LAMPORTS, 4_078_560n)
  assert.equal(ticketSpendableRaw('1000000000', SOL), String(1_000_000_000n - 4_078_560n))
  assert.equal(ticketSpendableRaw('4000000', SOL), '0', 'less than the reserve: nothing to offer')
  assert.equal(ticketSpendableRaw('5000000', USDC), '5000000')
  assert.equal(ticketSpendableRaw('abc', USDC), '0')
})

test('a purchase is paid with what the wallet can spend — USDC from a dollar, else SOL, else USDC; never the asset bought', () => {
  const jup = { mint: JUP, symbol: 'JUP', name: 'Jupiter', icon: null, decimals: 6 }
  const solAsset = QUOTE_ASSETS.find((asset) => asset.mint === SOL)
  const holds = (usdc, sol) => (mint) => (mint === USDC ? usdc : mint === SOL ? sol : null)
  assert.equal(payingAssetFor(QUOTE_ASSETS, jup, null).mint, USDC, 'before the read: USDC')
  assert.equal(payingAssetFor(QUOTE_ASSETS, jup, holds('2500000', '0')).mint, USDC)
  assert.equal(payingAssetFor(QUOTE_ASSETS, jup, holds('900000', '500000000')).mint, SOL, 'under a dollar of USDC: SOL')
  assert.equal(payingAssetFor(QUOTE_ASSETS, jup, holds(null, '500000000')).mint, SOL, 'a SOL-only wallet pays in SOL')
  assert.equal(
    payingAssetFor(QUOTE_ASSETS, jup, holds('0', '1000')).mint,
    USDC,
    'nothing spendable: USDC, said as such',
  )
  // Buying SOL is never paid in SOL, buying USDC never in USDC.
  assert.equal(payingAssetFor(QUOTE_ASSETS, solAsset, holds('0', '500000000')).mint, USDC)
  const usdcAsset = QUOTE_ASSETS.find((asset) => asset.mint === USDC)
  assert.equal(payingAssetFor(QUOTE_ASSETS, usdcAsset, holds('9000000', '500000000')).mint, SOL)
})

test('the $1 floor is the sum itself: exactly $1 of USDC passes, $0.99 does not; SOL at its own price, with a hair of tolerance', () => {
  const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
  const usd = (raw) => underOneDollar({ payMint: USDC, payDecimals: 6, amountRaw: raw, solUsd: null })
  assert.equal(usd('1000000'), false, 'exactly $1 — whatever a venue says a dollar is worth')
  assert.equal(usd('990000'), true)
  assert.equal(usd('0'), false, 'nothing typed is not under a dollar')
  assert.equal(usd(null), false)
  assert.equal(underOneDollar({ payMint: USDT, payDecimals: 6, amountRaw: '999999', solUsd: null }), true)
  const sol = (raw, price) => underOneDollar({ payMint: SOL, payDecimals: 9, amountRaw: raw, solUsd: price })
  assert.equal(sol('10000000', 104.9), false, '0.01 SOL ≈ $1.05')
  assert.equal(sol('9000000', 104.9), true, '0.009 SOL ≈ $0.94')
  assert.equal(sol('9500000', 104.9), false, '≈ $0.997 — within the tolerance of a price reading')
  assert.equal(sol('9000000', null), false, 'no price: nothing is claimed')
})

test('the SOL price of the floor is the market figure; without it, the one an order paying SOL implies — never a dollar order', () => {
  const order = (inputMint, inAmountRaw, inUsdValue) => ({ inputMint, inAmountRaw, inUsdValue })
  assert.equal(floorSolUsd(104.9, order(SOL, '10000000', '0.98')), 104.9, 'the market first')
  assert.ok(Math.abs(floorSolUsd(null, order(SOL, '10000000', '1.049')) - 104.9) < 1e-9, '$1.049 for 0.01 SOL')
  assert.equal(floorSolUsd(null, order(USDC, '5000000', '5.00')), null, 'a dollar order says nothing of SOL')
  assert.equal(floorSolUsd(null, order(SOL, '10000000', null)), null)
  assert.equal(floorSolUsd(null, null), null)
  assert.equal(floorSolUsd(Number.NaN, order(SOL, '0', '0')), null)
  // Held with the order's own price: 0.009 SOL at an implied $104.90 is ≈ $0.94.
  const implied = floorSolUsd(null, order(SOL, '9000000', '0.9441'))
  assert.equal(underOneDollar({ payMint: SOL, payDecimals: 9, amountRaw: '9000000', solUsd: implied }), true)
})
