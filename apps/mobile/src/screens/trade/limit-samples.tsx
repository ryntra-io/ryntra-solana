import { useState } from 'react'
import { View } from 'react-native'

import { Txt } from '@/components/txt'
import type { LimitOrder, LimitReview } from '@/features/limits/limit-model'
import { SOL_MINT, USDC_MINT } from '@/lib/api'
import { LIMIT_COPY } from '@/features/limits/copy'
import { useCopy, useLocale } from '@/lib/i18n'
import { OrderRow } from '@/screens/orders'

import { LimitOutcomeCard, LimitReviewBody } from './limit-panel'

/* Visibly synthetic identities — never a real order account, wallet or signature (M28). */
const SAMPLE_ORDER = 'samp1eOrderAccount1111111111111111111111111'
const SAMPLE_POOL = 'samp1ePoo11111111111111111111111111111111111'
const SAMPLE_BUILT = '2026-10-16T12:00:00.000Z'

const REVIEW: LimitReview = {
  venue: 'trigger',
  side: 'buy',
  order: SAMPLE_ORDER,
  requestId: 'sample-request',
  pool: null,
  transactionBase64: 'sample',
  pair: { baseMint: SOL_MINT, baseDecimals: 9, quoteMint: USDC_MINT, quoteDecimals: 6 },
  inputMint: USDC_MINT,
  outputMint: SOL_MINT,
  makingRaw: '25000000',
  takingRaw: '241779497',
  price: '103.4',
  fillPrice: 103.29,
  fee: { ryntraBps: 10, venueBps: 0, ryntraFeeRaw: '241779', venueFeeRaw: '0', reason: 'FEE_ACCOUNT_READY', account: 'samp1eFeeAccount11111111111111111111111111111' },
  networkFeeLamports: 5_000,
  depositLamports: 2_039_280,
  makerFeeShare: false,
  builtAt: SAMPLE_BUILT,
}

const DLMM_REVIEW: LimitReview = {
  ...REVIEW,
  venue: 'dlmm',
  side: 'sell',
  requestId: null,
  pool: SAMPLE_POOL,
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  makingRaw: '500000000',
  takingRaw: '53250000',
  price: '106.5',
  fillPrice: 106.48,
  fee: { ryntraBps: 0, venueBps: 0, ryntraFeeRaw: '0', venueFeeRaw: '0', reason: 'VENUE_HAS_NO_FEE', account: null },
  depositLamports: 57_406_080,
  makerFeeShare: true,
}

const order = (over: Partial<LimitOrder>): LimitOrder => ({
  key: `sample:${over.order ?? SAMPLE_ORDER}`,
  venue: 'trigger',
  order: SAMPLE_ORDER,
  side: 'buy',
  baseMint: SOL_MINT,
  quoteMint: USDC_MINT,
  inputMint: USDC_MINT,
  outputMint: SOL_MINT,
  makingRaw: '25000000',
  takingRaw: '241779497',
  filledInputRaw: '0',
  filledOutputRaw: '0',
  ryntraFeeRaw: '0',
  ryntraBps: 10,
  fillPrice: 103.29,
  state: 'OPEN',
  placeSignature: 'sample-place',
  cancelSignature: null,
  fills: [],
  createdAt: SAMPLE_BUILT,
  updatedAt: SAMPLE_BUILT,
  throughRyntra: true,
  canCancel: true,
  canClaim: false,
  pool: null,
  ...over,
})

const ORDERS: readonly LimitOrder[] = [
  order({}),
  order({ key: 'sample:2', venue: 'dlmm', side: 'sell', inputMint: SOL_MINT, outputMint: USDC_MINT, makingRaw: '500000000', takingRaw: '53250000', fillPrice: 106.48, state: 'FILLED', filledInputRaw: '500000000', filledOutputRaw: '53250000', canCancel: false, canClaim: true, pool: SAMPLE_POOL }),
  order({ key: 'sample:3', state: 'FILLED', canCancel: false, filledInputRaw: '25000000', filledOutputRaw: '241537718', fills: [{ signature: 'sample-fill-signature-000000', inputRaw: '25000000', outputRaw: '241537718', feeRaw: '241779', at: SAMPLE_BUILT }] }),
  order({ key: 'sample:4', state: 'CANCELLED', canCancel: false, cancelSignature: 'sample-cancel-signature-0000' }),
]

/** «Ліміт» and «Мої ордери» on samples: the two Reviews, what a signature came to, and every kind of row. */
export function LimitSamples() {
  const locale = useLocale()
  const words = useCopy(LIMIT_COPY)
  const noop = () => undefined
  // The moment the samples were drawn stands for when a Review arrived.
  const [receivedAt] = useState(() => Date.now())
  return (
    <View className="gap-4">
      <LimitReviewBody review={REVIEW} receivedAt={receivedAt} signing={false} inputSymbol="USDC" outputSymbol="SOL" quoteSymbol="USDC" marketPrice={104.44} failure={null} onSign={noop} onBack={noop} />
      <LimitReviewBody review={DLMM_REVIEW} receivedAt={receivedAt} signing={false} inputSymbol="SOL" outputSymbol="USDC" quoteSymbol="USDC" marketPrice={104.44} failure="simulation" onSign={noop} onBack={noop} />
      <LimitOutcomeCard review={REVIEW} outcome={{ kind: 'done', signature: 'sample-place-signature-00000', settled: true }} inputSymbol="USDC" quoteSymbol="USDC" />
      <LimitOutcomeCard review={REVIEW} outcome={{ kind: 'unknown', signature: null }} inputSymbol="USDC" quoteSymbol="USDC" />
      <Txt variant="labelSm" tone="faint" caps>
        {words.myOrders}
      </Txt>
      {ORDERS.map((row, index) => (
        <OrderRow key={row.key} order={row} tokens={{}} locale={locale} focused={index === 1} acting={false} disabled={false} onAct={noop} />
      ))}
    </View>
  )
}
