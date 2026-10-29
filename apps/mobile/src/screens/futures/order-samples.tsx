import { useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import type { FuturesAccount, FuturesBook, FuturesMarket, FuturesPosition } from '@/features/futures/futures-model'
import {
  SAMPLE_CANCEL,
  SAMPLE_CLOSE,
  SAMPLE_OPEN_LIMIT,
  SAMPLE_OPEN_MARKET,
  SAMPLE_PROTECT,
  SAMPLE_RELAY_FAILED,
  SAMPLE_RELAY_FILLED,
  SAMPLE_RELAY_PENDING,
  SAMPLE_RELAY_RESTING,
} from '@/features/futures/order-samples'
import { parseOrderResult, parseOrderReview, type OrderResult, type OrderReview } from '@/features/futures/orders-model'

import { useAccount } from '@/features/session/use-account'

import { CollateralSheet } from './collateral-sheet'
import { OrderSheet, type OrderIntent } from './order-sheet'

/** Phoenix's SOL market as its list states it — the sheet's units, fees and mark for the samples. */
const SOL_MARKET: FuturesMarket = {
  symbol: 'SOL',
  status: 'active',
  calendar: false,
  session: null,
  maxLeverage: 25,
  leverageTiers: [{ maxLeverage: 25, maxSizeUnits: 321_646.84 }],
  maintenanceRatio: 0.5,
  openInterestUnits: 79_724.58,
  isolatedOnly: false,
  tickSize: 100,
  baseLotsDecimals: 2,
  takerRate: 0.00035,
  makerRate: 0.00005,
  markPrice: 103.94,
  oraclePrice: 103.87,
  prevDayMarkPrice: 106.9,
  dayVolumeUsd: 24_425_241,
}

type Sample = Readonly<{
  label: string
  intent?: OrderIntent
  review?: OrderReview
  result?: OrderResult
  /** The ticket's samples stand on an account and a book of their own. */
  ticket?: boolean
}>

/** A long the samples' acts stand on: 0.48 SOL at $103.96 with TP/SL, on the cross-margin account. */
const POSITION: FuturesPosition = {
  symbol: 'SOL',
  subaccount: 0,
  side: 'long',
  size: 0.48,
  entryPrice: 103.96,
  tpPrice: 115,
  slPrice: 98,
}

/** A cross-margin account the ticket's samples count from: $250 of value, the long above held, $5 of margin in use. */
const ACCOUNT: FuturesAccount = {
  wallet: '',
  state: 'active',
  collateralUsd: 250,
  collateralSol: null,
  positions: [POSITION],
  orders: [],
  margin: {
    portfolioUsd: 250,
    initialMarginUsd: 5,
    maintenanceMarginUsd: 2.5,
    riskTier: null,
    withdrawableMicro: '245000000',
    canDeposit: true,
    canWithdraw: true,
  },
  observedAt: 0,
}

/** SOL's book around the mark, thin enough that a large market order walks it. */
const BOOK: FuturesBook = {
  symbol: 'SOL',
  bids: [
    { price: 103.93, size: 12 },
    { price: 103.9, size: 40 },
    { price: 103.8, size: 120 },
  ],
  asks: [
    { price: 103.95, size: 10 },
    { price: 103.98, size: 45 },
    { price: 104.1, size: 150 },
  ],
  observedAt: 0,
}

const review = (raw: unknown) => parseOrderReview(raw)!
const result = (raw: unknown) => parseOrderResult(raw)!

const SAMPLES: readonly Sample[] = [
  { label: 'Ticket · long', intent: { kind: 'open', side: 'long' }, ticket: true },
  { label: 'Ticket · limit from the book', intent: { kind: 'open', side: 'short', price: '103.98' }, ticket: true },
  { label: 'Position · acts', intent: { kind: 'position', position: POSITION } },
  { label: 'Position · cut', intent: { kind: 'reduce', position: POSITION } },
  { label: 'Position · TP/SL', intent: { kind: 'protect', position: POSITION } },
  { label: 'Review · market long with TP/SL', review: review(SAMPLE_OPEN_MARKET) },
  { label: 'Review · limit short', review: review(SAMPLE_OPEN_LIMIT) },
  { label: 'Review · close', review: review(SAMPLE_CLOSE) },
  { label: 'Review · TP/SL', review: review(SAMPLE_PROTECT) },
  { label: 'Review · cancel', review: review(SAMPLE_CANCEL) },
  { label: 'Receipt · filled', review: review(SAMPLE_OPEN_MARKET), result: result(SAMPLE_RELAY_FILLED) },
  { label: 'Receipt · limit resting', review: review(SAMPLE_OPEN_LIMIT), result: result(SAMPLE_RELAY_RESTING) },
  { label: 'Receipt · closed', review: review(SAMPLE_CLOSE), result: result(SAMPLE_RELAY_FILLED) },
  { label: 'Receipt · waiting', review: review(SAMPLE_OPEN_MARKET), result: result(SAMPLE_RELAY_PENDING) },
  { label: 'Receipt · failed', review: review(SAMPLE_OPEN_MARKET), result: result(SAMPLE_RELAY_FAILED) },
]

/**
 * Phoenix orders' open path on samples (C4b): the gate keeps it closed on production until the operator's canary, so the
 * Reviews and receipts the server would answer are drawn here, in the sheet itself, from its sample answers.
 */
export function PerpOrderSamples() {
  const [open, setOpen] = useState<Sample | null>(null)
  const [move, setMove] = useState<'deposit' | 'withdraw' | null>(null)
  // The connected wallet's own reads: the sheet asks its Review with that wallet's session, as on the market's page.
  const wallet = useAccount()
  return (
    <View className="gap-2">
      {SAMPLES.map((sample) => (
        <Button key={sample.label} title={sample.label} variant="secondary" onPress={() => setOpen(sample)} />
      ))}
      {/* «Поповнити» and «Вивести» (C4c) for the connected wallet on production's routes; its own signature past the Review. */}
      <Button title="Collateral · deposit" variant="secondary" onPress={() => setMove('deposit')} />
      <Button title="Collateral · withdraw" variant="secondary" onPress={() => setMove('withdraw')} />
      <CollateralSheet owner={wallet.address ?? ''} action={move} account={null} onClose={() => setMove(null)} />
      {open ? (
        <OrderSheet
          key={open.label}
          market={SOL_MARKET}
          account={open.ticket ? ACCOUNT : null}
          book={open.ticket ? BOOK : null}
          markAt={null}
          intent={open.intent ?? { kind: 'open', side: open.review?.side ?? 'long' }}
          onIntent={() => undefined}
          onClose={() => setOpen(null)}
          sample={{ ...(open.review ? { review: open.review } : {}), ...(open.result ? { result: open.result } : {}) }}
        />
      ) : null}
    </View>
  )
}
