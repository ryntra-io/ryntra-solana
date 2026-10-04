import { View } from 'react-native'

import { Card } from '@/components/card'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { dollarsText, truthLine, type BuyOutcome } from '@/features/invest/buy-model'
import { CONVERT_COPY } from '@/features/invest/convert-copy'
import { SALE_COPY } from '@/features/invest/sale-copy'
import {
  heldUnitsText,
  positionUsd,
  saleAction,
  saleCheckRows,
  saleShares,
  type SaleCompany,
} from '@/features/invest/sale-model'
import type { SaleController } from '@/features/invest/use-sale'
import { USDC_ASSET, type TradeContext } from '@/features/trade/trade-model'
import type { SwapCheck } from '@/lib/api/v1/types'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'

import { BuyReceiptFace } from './buy-sheet'
import { PositionCard, saleReceiptFace, SaleCompose, SaleReview } from './sell-sheet'

/*
 * Samples of a sale from a position, for the development gallery only: the
 * sheet's own parts over made-up figures — a position of 0,05 Apple worth
 * $12,50, a private company's position, «Перевірка» as the server would count
 * it, and every receipt. Nothing here reads a wallet or signs.
 */

const APPLE = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const OPENAI = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF'

const sampleApple = (locale: Locale): SaleCompany => ({
  mint: APPLE,
  ticker: 'AAPLx',
  name: 'Apple',
  icon: null,
  decimals: 8,
  multiplier: 1,
  unit: 'share',
  preIpo: false,
  truth: truthLine('xstocks', 'Apple', locale),
  issuerFee: null,
  priceUsd: 250,
  sellable: true,
})

const sampleOpenAi = (locale: Locale): SaleCompany => ({
  mint: OPENAI,
  ticker: 'OPENAI',
  name: 'OpenAI',
  icon: null,
  decimals: 9,
  multiplier: 1,
  unit: 'token',
  preIpo: true,
  truth: truthLine('prestocks', 'OpenAI', locale, 100),
  issuerFee: { basisPoints: 100, maximumFeeRaw: null },
  priceUsd: 1100,
  sellable: true,
})

const noop = () => undefined

/** A sale's controller as the sheet sees it, standing still on made-up figures. */
function sampleController(
  company: SaleCompany,
  input: Readonly<{
    heldRaw: bigint
    amountText: string
    amountUsd: number | null
    pickedPct: 25 | 50 | 75 | 100 | null
    estimate: Readonly<{ gotUsd: number | null; costsUsd: number | null }> | null
    reviewLeft?: number
    locale: Locale
  }>,
): SaleController {
  const valueUsd = positionUsd(input.heldRaw, company.decimals, company.multiplier, company.priceUsd)
  const action = saleAction({
    lockedReview: false,
    connected: true,
    signedIn: true,
    heldRaw: input.heldRaw,
    companyRead: true,
    sellable: true,
    valueUsd,
    amountUsd: input.amountUsd,
    pickedPct: input.pickedPct,
    preparing: false,
    needsSol: false,
    unavailable: false,
    priced: true,
  })
  const trade = {
    busy: false,
    phase: input.reviewLeft === undefined ? 'idle' : 'review',
    quoteFailure: null,
    quoteBlocked: false,
    failure: null,
    reviewLeft: input.reviewLeft ?? null,
    invalidated: false,
    sending: false,
    account: { address: 'sample', session: {}, busy: null, signingIn: false, signInFailure: null, failure: null },
    refreshQuote: noop,
    review: noop,
    release: noop,
    sign: noop,
    closeReview: noop,
  }
  return {
    trade,
    locale: input.locale,
    amountText: input.amountText,
    setAmountText: noop,
    amountUsd: input.amountUsd,
    shares: saleShares(input.heldRaw, company.decimals, company.multiplier, company.priceUsd),
    pickedPct: input.pickedPct,
    pickShare: noop,
    heldRaw: input.heldRaw,
    decimals: company.decimals,
    multiplier: company.multiplier,
    valueUsd,
    needsSol: false,
    estimate: input.estimate,
    rows: null,
    action,
  } as unknown as SaleController
}

const appleCheck = (locale: Locale): SwapCheck => ({
  side: 'sell',
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
  spend: { mint: APPLE, unit: 'share', amount: 0.04, usd: 10 },
  get: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 9.96, atLeast: 9.91, usd: 9.96 },
  costs: { usd: 0.04, issuerFee: null },
  reserve: null,
  what: {
    truth: { en: truthLine('xstocks', 'Apple', 'en') ?? '', uk: truthLine('xstocks', 'Apple', 'uk') ?? '' },
    note: null,
    caution: false,
  },
  sol: { usd: 200, observedAt: null },
})

const openAiCheck = (): SwapCheck => ({
  side: 'sell',
  basis: 'order',
  company: {
    mint: OPENAI,
    symbol: 'OPENAI',
    name: 'OpenAI',
    issuer: 'prestocks',
    unit: 'token',
    privateCompany: true,
    decimals: 9,
    multiplier: 1,
  },
  spend: { mint: OPENAI, unit: 'token', amount: 0.0091, usd: 10.01 },
  get: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 9.76, atLeast: 9.66, usd: 9.76 },
  costs: { usd: 0.25, issuerFee: { basisPoints: 100, usd: 0.1 } },
  reserve: null,
  what: {
    truth: {
      en: truthLine('prestocks', 'OpenAI', 'en', 100) ?? '',
      uk: truthLine('prestocks', 'OpenAI', 'uk', 100) ?? '',
    },
    note: {
      kind: 'sale-may-fail',
      en: 'Selling may not be possible: the issuer promises no liquidity.',
      uk: 'Продати може не вийти: емітент ліквідності не обіцяє.',
    },
    caution: true,
  },
  sol: { usd: 200, observedAt: null },
})

const SALE_CONTEXT: TradeContext = {
  mode: 'sell',
  pay: { mint: APPLE, symbol: 'AAPLx', name: 'Apple', icon: null, decimals: 8 },
  receive: USDC_ASSET,
  payDecimals: 8,
  receiveDecimals: 6,
  inAmountRaw: '4000000',
  outAmountRaw: '9960000',
  minReceivedRaw: '9910000',
}

const SALE_OUTCOMES: readonly BuyOutcome[] = [
  { kind: 'filled', spentRaw: '4000000', gotRaw: '9960000', fromReview: false, belowMinimum: false },
  { kind: 'filled', spentRaw: '4000000', gotRaw: '9800000', fromReview: false, belowMinimum: true },
  { kind: 'nothing' },
  { kind: 'not-filled' },
  { kind: 'pending' },
]

export function SaleSamples() {
  const locale = useLocale()
  const words = useCopy(SALE_COPY)
  const buyWords = useCopy(BUY_COPY)
  const fails = useCopy(CONVERT_COPY).failures
  const apple = sampleApple(locale)
  const openAi = sampleOpenAi(locale)
  const held = 5_000_000n
  const heldUnits = heldUnitsText(held, apple, locale) ?? ''
  const rowWords = {
    atLeast: buyWords.atLeast,
    reserve: buyWords.reserve,
    issuerFee: buyWords.issuerFee,
    truthUnknown: buyWords.truthUnknown,
    mayFail: words.saleMayFail,
  }
  const review = (company: SaleCompany, check: SwapCheck) => {
    const controller = sampleController(company, {
      heldRaw: held,
      amountText: '10',
      amountUsd: 10,
      pickedPct: null,
      estimate: null,
      reviewLeft: 24,
      locale,
    })
    return {
      ...controller,
      rows: saleCheckRows(check, { unit: company.unit, company: company.name, locale, words: rowWords }),
    } as SaleController
  }
  return (
    <View className="gap-3">
      <PositionCard
        label={words.yourPosition}
        value={dollarsText(12.5, locale)}
        detail={heldUnits}
        sellLabel={words.sell}
        onSell={noop}
      />
      <Card>
        <SaleCompose
          sale={sampleController(apple, {
            heldRaw: held,
            amountText: '10',
            amountUsd: 10,
            pickedPct: null,
            estimate: { gotUsd: 9.96, costsUsd: 0.04 },
            locale,
          })}
          company={apple}
          words={words}
          buyWords={buyWords}
          fails={fails}
          onDone={noop}
          onTopUp={noop}
        />
      </Card>
      <Card>
        <SaleCompose
          sale={sampleController(apple, {
            heldRaw: held,
            amountText: '20',
            amountUsd: 20,
            pickedPct: null,
            estimate: { gotUsd: 12.45, costsUsd: 0.05 },
            locale,
          })}
          company={apple}
          words={words}
          buyWords={buyWords}
          fails={fails}
          onDone={noop}
          onTopUp={noop}
        />
      </Card>
      <Card>
        <SaleCompose
          sale={sampleController(openAi, {
            heldRaw: 18_200_000n,
            amountText: '10',
            amountUsd: 10,
            pickedPct: null,
            estimate: { gotUsd: 9.76, costsUsd: 0.25 },
            locale,
          })}
          company={openAi}
          words={words}
          buyWords={buyWords}
          fails={fails}
          onDone={noop}
          onTopUp={noop}
        />
      </Card>
      <Card>
        <SaleReview sale={review(apple, appleCheck(locale))} words={words} buyWords={buyWords} fails={fails} />
      </Card>
      <Card>
        <SaleReview sale={review(openAi, openAiCheck())} words={words} buyWords={buyWords} fails={fails} />
      </Card>
      {SALE_OUTCOMES.map((outcome) => (
        <Card key={outcome.kind === 'filled' ? `filled-${outcome.belowMinimum}` : outcome.kind}>
          <BuyReceiptFace
            face={saleReceiptFace({
              outcome,
              context: SALE_CONTEXT,
              company: apple,
              multiplier: 1,
              words,
              buyWords,
              locale,
            })}
          />
        </Card>
      ))}
    </View>
  )
}
