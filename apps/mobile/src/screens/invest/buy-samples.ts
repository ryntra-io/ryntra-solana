import { truthLine } from '@/features/invest/buy-model'
import { USDC_ASSET } from '@/features/trade/trade-model'
import type { RyntraFeeOrder } from '@/features/invest/buy-model'
import type { SwapCheck } from '@/lib/api/v1/types'

/*
 * «Перевірка» of a purchase as the server would count it (contract 1.20.0), for
 * the development gallery only — made-up figures in the server's own shape, so
 * the sheet's rows are seen without a wallet: Apple for $20 opening its token's
 * account, OpenAI through PreStocks for $10 with the issuer's 1 %, Apple for $1
 * with its reserve under «Усі витрати», and the same $1 on a route whose
 * one-time reserve is more than the purchase.
 */

const APPLE = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const OPENAI = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF'

const appleTruth = () => ({ en: truthLine('xstocks', 'Apple', 'en') ?? '', uk: truthLine('xstocks', 'Apple', 'uk') ?? '' })

const apple = (
  spendUsd: number,
  get: Readonly<{ amount: number; atLeast: number }>,
  costsUsd: number,
  reserve: SwapCheck['reserve'],
): SwapCheck => ({
  side: 'buy',
  basis: 'order',
  company: {
    mint: APPLE,
    symbol: 'AAPLx',
    name: 'Apple',
    issuer: 'xstocks',
    unit: 'share',
    privateCompany: false,
    decimals: 8,
    multiplier: 1,
  },
  spend: { mint: USDC_ASSET.mint, unit: 'usdc', amount: spendUsd, usd: spendUsd },
  get: { mint: APPLE, unit: 'share', amount: get.amount, atLeast: get.atLeast, usd: spendUsd - costsUsd },
  costs: { usd: costsUsd, issuerFee: null },
  reserve,
  what: { truth: appleTruth(), note: null, caution: false },
  sol: { usd: 200, observedAt: null },
})

export const SAMPLE_BUY_CHECKS: Readonly<Record<'apple' | 'openai' | 'dollar' | 'reserveFirst', SwapCheck>> = {
  apple: apple(20, { amount: 0.0787, atLeast: 0.0783 }, 0.059, { lamports: '2039280', usd: 0.41, first: false }),
  openai: {
    side: 'buy',
    basis: 'order',
    company: {
      mint: OPENAI,
      symbol: 'OPENAI',
      name: 'OpenAI',
      issuer: 'prestocks',
      unit: 'token',
      privateCompany: true,
      decimals: 9,
      multiplier: 1.4861347,
    },
    spend: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 10, usd: 9.998 },
    get: { mint: OPENAI, unit: 'token', amount: 0.007272, atLeast: 0.007272, usd: 9.755 },
    costs: { usd: 0.35, issuerFee: { basisPoints: 100, usd: 0.099 } },
    reserve: { lamports: '2039280', usd: 0.41, first: false },
    what: {
      truth: { en: truthLine('prestocks', 'OpenAI', 'en') ?? '', uk: truthLine('prestocks', 'OpenAI', 'uk') ?? '' },
      note: null,
      caution: true,
    },
    sol: { usd: 200, observedAt: null },
  },
  dollar: apple(1, { amount: 0.00393, atLeast: 0.00391 }, 0.019, { lamports: '1559560', usd: 0.31, first: false }),
  reserveFirst: apple(1, { amount: 0.00393, atLeast: 0.00391 }, 0.019, { lamports: '9000000', usd: 1.8, first: true }),
}

/* Ryntra's fee on each sample's order, as the order states it: 0.50 % of the USDC that leaves (the phone's lane today). */
const usdcFee = (inAmountRaw: string): RyntraFeeOrder => ({
  inputMint: USDC_ASSET.mint,
  outputMint: APPLE,
  inAmountRaw,
  outAmountRaw: '1',
  inUsdValue: null,
  outUsdValue: null,
  ryntraFee: {
    mechanism: 'JUPITER_REFERRAL',
    state: 'QUOTED',
    basisPoints: 50,
    requestedBasisPoints: 50,
    asset: USDC_ASSET.mint,
    symbol: null,
    decimals: null,
    amountRaw: null,
    usd: null,
  },
})

export const SAMPLE_BUY_FEES: Readonly<Record<keyof typeof SAMPLE_BUY_CHECKS, RyntraFeeOrder>> = {
  apple: usdcFee('20000000'),
  openai: usdcFee('10000000'),
  dollar: usdcFee('1000000'),
  reserveFirst: usdcFee('1000000'),
}
