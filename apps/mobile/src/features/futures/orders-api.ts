/**
 * The phone's calls to the order routes of «Ф'ючерси» — the same four the web's order panel calls (B6b,
 * `app/solana/workspace/futures/orders-api.ts` on line A): whether the wallet may place orders now, the Review, the
 * relay of the wallet's signed bytes, and the chain's word with Phoenix's record of the fills. The routes live outside
 * `/api/v1` as the futures reads (C4) and the limits (C3) do, so they are carried here rather than by the pinned v1
 * client; the server's contract is read as it is, never changed. The routes take the site's origin from a browser and
 * the session's bearer from the phone, and a bearer acts only for its own wallet (`lib/phoenix/http.server.ts`). They
 * decide; this file only carries.
 */

import { apiRequest, type Session } from '../../lib/api.ts'

import type { OrderBody } from './orders-model.ts'

/** The Review simulates on the chain; the relay waits for the network's answer and Phoenix's record. */
const REVIEW_TIMEOUT_MS = 30_000
const SUBMIT_TIMEOUT_MS = 60_000

export type OrdersApi = Readonly<{
  /** The gate's word for this wallet: closed, a canary with its ceiling, or open. Public, like the web's. */
  states: (owner: string | null, signal?: AbortSignal) => Promise<unknown>
  review: (session: Session, body: OrderBody) => Promise<unknown>
  submit: (session: Session, body: Readonly<{ ticket: string; signed: readonly string[] }>) => Promise<unknown>
  status: (owner: string, signature: string, signal?: AbortSignal) => Promise<unknown>
}>

export const ordersApi: OrdersApi = {
  states: (owner, signal) =>
    apiRequest<unknown>(
      'GET',
      `/api/solana/futures/orders${owner ? `?${new URLSearchParams({ owner }).toString()}` : ''}`,
      undefined,
      { signal },
    ),
  review: (session, body) =>
    apiRequest<unknown>('POST', '/api/solana/futures/orders/review', body, { session, timeoutMs: REVIEW_TIMEOUT_MS }),
  submit: (session, body) =>
    apiRequest<unknown>('POST', '/api/solana/futures/orders/submit', body, { session, timeoutMs: SUBMIT_TIMEOUT_MS }),
  status: (owner, signature, signal) =>
    apiRequest<unknown>(
      'GET',
      `/api/solana/futures/orders/status?${new URLSearchParams({ owner, signatures: signature }).toString()}`,
      undefined,
      { signal },
    ),
}
