import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { apiRequest, isNetworkError, isNotFound, type Session } from '@/lib/api'

import {
  base64Of,
  orderOf,
  orderSettled,
  parseAccount,
  parseFunding,
  parsePreview,
  parseReview,
  parseWithdrawOutcome,
  signatureOf,
  withdrawalOf,
  type PaperOrder,
  type PaperReview,
  type PredictionAccount,
  type PredictionFunding,
  type Withdrawal,
  type WithdrawOutcome,
  type WithdrawPreview,
} from './account-model'
import {
  parseEvent,
  parseHub,
  parseLine,
  RANGE_READ,
  type PredictionEvent,
  type PredictionHub,
  type PredictionLine,
  type PredictionRange,
  type PredictionSort,
} from './predictions-model'

/**
 * The phone's reads and writes of «Прогнози» — the same routes the web's hub and pages use (`/api/predictions/*`). The
 * server keeps its own caches (lists 20 s, an event 10 s, a chart 20 s), so the phone asks no more often than that: a
 * list every 60 s and when the place opens, an open event every 20 s, the account and the money every 30 s. Private
 * reads carry the wallet's session and are dropped with it; the paper account lives on the server, never on the phone.
 */

const BASE = '/api/predictions'

const query = (params: Readonly<Record<string, string | number | undefined>>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** One page of the hub: 24 events, as the web's browsed tabs read. */
const PAGE = 24

export const fetchHub = async (
  sort: PredictionSort,
  category: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<PredictionHub> =>
  parseHub(
    await apiRequest<unknown>(
      'GET',
      `${BASE}/discover${query({ sort, category: category ?? undefined, limit: PAGE, cursor: cursor ?? undefined })}`,
      undefined,
      { signal },
    ),
  )

export const fetchEvent = async (id: string, signal?: AbortSignal): Promise<PredictionEvent | null> =>
  parseEvent(await apiRequest<unknown>('GET', `${BASE}/events/${encodeURIComponent(id)}`, undefined, { signal }))

export const fetchLine = async (
  outcomeId: string,
  range: PredictionRange,
  signal?: AbortSignal,
): Promise<PredictionLine> =>
  parseLine(
    await apiRequest<unknown>(
      'GET',
      `${BASE}/outcomes/${encodeURIComponent(outcomeId)}/chart${query(RANGE_READ[range])}`,
      undefined,
      { signal },
    ),
    outcomeId,
  )

/** Asked again once, unless the server said there is no such event. */
const once = (count: number, error: unknown) => !isNotFound(error) && count < 1

export function usePredictionHub(sort: PredictionSort, category: string | null) {
  return useInfiniteQuery({
    queryKey: ['predictions', 'hub', sort, category ?? 'all'],
    queryFn: ({ pageParam, signal }) => fetchHub(sort, category, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function usePredictionEvent(id: string) {
  return useQuery({
    queryKey: ['predictions', 'event', id],
    queryFn: ({ signal }) => fetchEvent(id, signal),
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: once,
  })
}

export function usePredictionLine(outcomeId: string | null, range: PredictionRange) {
  return useQuery({
    queryKey: ['predictions', 'line', outcomeId, range],
    queryFn: ({ signal }) => fetchLine(outcomeId ?? '', range, signal),
    staleTime: 20_000,
    refetchInterval: range === '1w' ? 60_000 : 300_000,
    retry: once,
    enabled: outcomeId !== null,
  })
}

/* ------------------------------------------------------------------------------------------- the person's side */

const accountKey = (address: string) => [PRIVATE_QUERY_KEY, 'predictions-account', address] as const
const fundingKey = (address: string) => [PRIVATE_QUERY_KEY, 'predictions-funding', address] as const

const privately = (session: Session, signal?: AbortSignal) => ({ session, signal })

export function usePredictionAccount(session: Session | null) {
  return useQuery({
    queryKey: accountKey(session?.address ?? ''),
    queryFn: async ({ signal }): Promise<PredictionAccount | null> =>
      parseAccount(await apiRequest<unknown>('GET', `${BASE}/account`, undefined, privately(session!, signal))),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
    enabled: session !== null,
  })
}

export function usePredictionFunding(session: Session | null, moving = false) {
  return useQuery({
    queryKey: fundingKey(session?.address ?? ''),
    queryFn: async ({ signal }): Promise<PredictionFunding | null> =>
      parseFunding(await apiRequest<unknown>('GET', `${BASE}/funding`, undefined, privately(session!, signal))),
    staleTime: 10_000,
    // A withdrawal on its way is read again sooner — its end is what the person waits for.
    refetchInterval: moving ? 5_000 : 30_000,
    retry: 1,
    enabled: session !== null,
  })
}

/** A route that asks AGG may run its 30 s on the server: the phone waits a little longer than it does. */
const ROUTE_TIMEOUT_MS = 32_000

/** The link's routes may wait on AGG for up to their 30 s on the server: the phone waits longer than they do. */
const LINK_TIMEOUT_MS = 40_000

/** The pause before the link's one more verify after the network failed on the way back from the wallet. */
const LINK_RETRY_MS = 1_500

/**
 * The link to AGG's simulation account: the server writes a sign-in message, the wallet signs it (a message, never a
 * transaction), the server checks it and keeps AGG's session to itself. `sign` is the wallet's message signing.
 */
export function useLinkAccount(session: Session | null, sign: (message: Uint8Array) => Promise<Uint8Array>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('No session')
      const challenge = await apiRequest<{ message?: unknown }>('POST', `${BASE}/link/start`, undefined, {
        session,
        timeoutMs: LINK_TIMEOUT_MS,
      })
      const message = typeof challenge.message === 'string' ? challenge.message : null
      if (!message) throw new Error('The link sent no message to sign.')
      const bytes = new TextEncoder().encode(message)
      const signature = signatureOf(bytes, await sign(bytes))
      if (!signature) throw new Error('The wallet returned no usable signature.')
      const body = { message, signature: base64Of(signature), encoding: 'base64' }
      // Back from the wallet, the phone may not have its network yet (the sign-in's `verifyOnceMore`): the same signed
      // body is sent once more after a short wait; a refusal of the server is never retried.
      try {
        await apiRequest('POST', `${BASE}/link/verify`, body, { session, timeoutMs: LINK_TIMEOUT_MS })
      } catch (error) {
        if (!isNetworkError(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, LINK_RETRY_MS))
        await apiRequest('POST', `${BASE}/link/verify`, body, { session, timeoutMs: LINK_TIMEOUT_MS })
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKey(session?.address ?? '') }),
  })
}

export type QuoteAsk = Readonly<{
  eventId: string
  marketId: string
  outcomeId: string
  spendUsd: number
  locale: 'en' | 'uk'
}>

/** One simulated buy priced and checked by the server: its Review, never an order yet. */
export async function askReview(session: Session, ask: QuoteAsk, signal?: AbortSignal): Promise<PaperReview | null> {
  return parseReview(
    await apiRequest<unknown>(
      'POST',
      `${BASE}/quote`,
      {
        eventId: ask.eventId,
        venueMarketId: ask.marketId,
        outcomeId: ask.outcomeId,
        side: 'buy',
        spendUsd: ask.spendUsd,
        locale: ask.locale,
      },
      { session, signal, timeoutMs: ROUTE_TIMEOUT_MS },
    ),
  )
}

/** Places the Review's simulated order; the answer's order may still be on its way (`submitted`). */
export async function placeOrder(session: Session, quoteId: string): Promise<PaperOrder | null> {
  const answer = await apiRequest<{ order?: unknown }>(
    'POST',
    `${BASE}/orders`,
    { quoteId },
    { session, timeoutMs: ROUTE_TIMEOUT_MS },
  )
  return orderOf(answer.order)
}

/** An order read again (the server asks AGG while it is on its way). */
export async function readOrder(session: Session, quoteId: string): Promise<PaperOrder | null> {
  const answer = await apiRequest<{ order?: unknown }>(
    'GET',
    `${BASE}/orders/${encodeURIComponent(quoteId)}`,
    undefined,
    {
      session,
    },
  )
  return orderOf(answer.order)
}

/** Reads an order again until it settles, at most `tries` times; the last read is the answer either way. */
export async function followOrder(
  session: Session,
  order: PaperOrder,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tries = 8,
): Promise<PaperOrder> {
  let current = order
  for (let attempt = 0; attempt < tries && !orderSettled(current.state); attempt += 1) {
    await wait(attempt < 3 ? 1_500 : 3_000)
    current = (await readOrder(session, current.quoteId)) ?? current
  }
  return current
}

export function useRefreshAccount(session: Session | null) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: accountKey(session?.address ?? '') })
}

/* ------------------------------------------------------------------------------------------- live money */

/** A withdrawal priced now for an amount (USDC's raw digits) or for all of it; creates nothing. */
export async function previewWithdrawal(
  session: Session,
  amount: Readonly<{ amountRaw: string }> | Readonly<{ max: true }>,
): Promise<Readonly<{ preview: WithdrawPreview; destination: string | null; wallet: string | null }> | null> {
  const answer = await apiRequest<{ destination?: unknown; wallet?: unknown }>(
    'POST',
    `${BASE}/funding/preview`,
    amount,
    { session, timeoutMs: ROUTE_TIMEOUT_MS },
  )
  const preview = parsePreview(answer)
  if (!preview) return null
  return {
    preview,
    destination: typeof answer.destination === 'string' ? answer.destination : null,
    wallet: typeof answer.wallet === 'string' ? answer.wallet : null,
  }
}

/** Sends the reviewed withdrawal under its request id — one id per Review, so confirming it twice is one withdrawal. */
export async function sendWithdrawal(
  session: Session,
  requestId: string,
  preview: WithdrawPreview,
): Promise<WithdrawOutcome | null> {
  return parseWithdrawOutcome(
    await apiRequest<unknown>(
      'POST',
      `${BASE}/funding/withdraw`,
      {
        requestId,
        amountRaw: preview.amountRaw,
        reviewedReceiveRaw: preview.receiveRaw,
        reviewedFeeRaw: preview.feeRaw,
      },
      { session, timeoutMs: 45_000 },
    ),
  )
}

/** Asks where one withdrawal stands (the server asks AGG again under the same request id). */
export async function checkWithdrawal(session: Session, requestId: string): Promise<Withdrawal | null> {
  const answer = await apiRequest<{ withdrawal?: unknown }>(
    'POST',
    `${BASE}/funding/withdrawals/${encodeURIComponent(requestId)}`,
    {},
    { session, timeoutMs: ROUTE_TIMEOUT_MS },
  )
  return withdrawalOf(answer.withdrawal)
}

export function useRefreshFunding(session: Session | null) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: fundingKey(session?.address ?? '') })
}
