/**
 * The phone's calls to the limits routes — the same five the web's ticket and
 * «Мої ордери» call (`app/solana/workspace/spot/limit-api.ts` on line A). The
 * routes take the site's origin from a browser and the session's bearer from
 * the phone, and a bearer acts only for its own wallet
 * (`lib/solana/limits/http.server.ts`). They decide; this file only carries.
 */

import { apiRequest, type Session } from '../../lib/api.ts'

import type { LimitMarket, LimitOrders, LimitReview, LimitSide, LimitSubmitAnswer, LimitVenue } from './limit-model.ts'

/** Building and relaying wait on the chain: the review simulates, the submit waits for the network's answer. */
const REVIEW_TIMEOUT_MS = 30_000
const SUBMIT_TIMEOUT_MS = 60_000

export type LimitsApi = Readonly<{
  market: (session: Session, input: Readonly<{ baseMint: string; quoteMint: string }>, signal?: AbortSignal) => Promise<LimitMarket>
  review: (
    session: Session,
    input: Readonly<{ venue: LimitVenue; side: LimitSide; baseMint: string; quoteMint: string; amount: string; price: string; quoteUsd: number | null }>,
  ) => Promise<Readonly<{ review: LimitReview }>>
  orders: (session: Session, signal?: AbortSignal) => Promise<LimitOrders>
  cancel: (session: Session, input: Readonly<{ venue: LimitVenue; order: string }>) => Promise<Readonly<{ transactionBase64: string; requestId: string | null }>>
  submit: (session: Session, body: LimitSubmitBody) => Promise<LimitSubmitAnswer>
}>

export type LimitSubmitBody = Readonly<{
  kind: 'place' | 'cancel'
  venue: LimitVenue
  owner: string
  order: string
  requestId: string | null
  signedTransactionBase64: string
  terms: LimitTerms | null
}>

export type LimitTerms = Readonly<{
  side: LimitSide
  baseMint: string
  quoteMint: string
  inputMint: string
  outputMint: string
  makingRaw: string
  takingRaw: string
  price: string
  fillPrice: number
  pool: string | null
  fee: Readonly<{ ryntraBps: number; venueBps: number; account: string | null }>
}>

/** What the Review showed, which the signed bytes must hold — the server reads them again against these. */
export function termsOf(review: LimitReview): LimitTerms {
  return {
    side: review.side,
    baseMint: review.pair.baseMint,
    quoteMint: review.pair.quoteMint,
    inputMint: review.inputMint,
    outputMint: review.outputMint,
    makingRaw: review.makingRaw,
    takingRaw: review.takingRaw,
    price: review.price,
    fillPrice: review.fillPrice,
    pool: review.pool,
    fee: { ryntraBps: review.fee.ryntraBps, venueBps: review.fee.venueBps, account: review.fee.account },
  }
}

export const limitsApi: LimitsApi = {
  market: (session, input, signal) =>
    apiRequest<LimitMarket>('POST', '/api/solana/limits/market', { owner: session.address, ...input }, { session, signal }),
  review: (session, input) =>
    apiRequest('POST', '/api/solana/limits/review', { owner: session.address, ...input }, { session, timeoutMs: REVIEW_TIMEOUT_MS }),
  orders: (session, signal) =>
    apiRequest<LimitOrders>('POST', '/api/solana/limits/orders', { owner: session.address }, { session, signal, timeoutMs: REVIEW_TIMEOUT_MS }),
  cancel: (session, input) =>
    apiRequest('POST', '/api/solana/limits/cancel', { owner: session.address, ...input }, { session, timeoutMs: REVIEW_TIMEOUT_MS }),
  submit: (session, body) => apiRequest<LimitSubmitAnswer>('POST', '/api/solana/limits/submit', body, { session, timeoutMs: SUBMIT_TIMEOUT_MS }),
}
