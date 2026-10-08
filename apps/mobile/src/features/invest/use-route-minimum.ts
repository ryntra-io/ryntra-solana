import { useQuery } from '@tanstack/react-query'

import { useDebounced } from '@/hooks/use-debounced'
import { ApiError, fetchSwapQuote } from '@/lib/api'

import { dollarsRaw, isNoRoute, ladderMinimum, type QuoteAnswer, type RouteMinimum } from './buy-model'

/**
 * A company's own minimum, read from the live quote («де живе
 * котирування на $1 маршруту не дає — мінімум цього активу з котирування,
 * чесно»). A purchase is from a dollar; when the venue finds no route for the
 * sum asked, the same read-only quote the purchase uses
 * (`POST /api/solana/swap/quote`) is asked for the ladder's larger sums in
 * turn (`ladderMinimum`), and the first that routes is the minimum the sheet
 * says — «На $1 маршруту зараз немає. IREN — від $5.» Nothing is claimed when
 * none routes or the venue does not answer. The web's own rule
 * (`app/app/invest/use-route-minimum.ts`); nothing here can be signed.
 */

/** The least sum found to route into a company, by the paying dollar and the company's mint — kept for the app's life, so a second look does not ask again. */
const FOUND = new Map<string, number>()

/** The paying dollars have six places (USDC, USDT). */
const DOLLAR_DECIMALS = 6
const QUOTE_DEBOUNCE_MS = 450

async function quoteAnswer(payMint: string, mint: string, usd: number, signal: AbortSignal): Promise<QuoteAnswer> {
  try {
    await fetchSwapQuote({ inputMint: payMint, outputMint: mint, amountRaw: dollarsRaw(usd, DOLLAR_DECIMALS) }, signal)
    return { ok: true }
  } catch (error) {
    return { ok: false, code: error instanceof ApiError ? error.code : signal.aborted ? 'ABORTED' : 'NETWORK' }
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

async function findMinimum(payMint: string, mint: string, amountUsd: number, signal: AbortSignal) {
  const found = await ladderMinimum({
    amountUsd,
    quote: (usd) => quoteAnswer(payMint, mint, usd, signal),
    wait: (ms) => pause(ms, signal),
    aborted: () => signal.aborted,
  })
  if (found.state === 'found') FOUND.set(`${payMint}:${mint}`, found.minimumUsd)
  return found
}

const known = (payMint: string, mint: string): number | undefined => FOUND.get(`${payMint}:${mint}`)

/** The company's own minimum once the sum asked has no route; idle otherwise. */
export function useRouteMinimum(
  payMint: string,
  mint: string,
  amountUsd: number | null,
  noRoute: boolean,
): RouteMinimum {
  const asked = noRoute && amountUsd !== null && amountUsd > 0 ? amountUsd : null
  const least = asked === null ? undefined : known(payMint, mint)
  const cached = asked !== null && least !== undefined && least > asked ? least : null
  const query = useQuery({
    queryKey: ['trade', 'route-minimum', payMint, mint, asked ?? 0],
    queryFn: ({ signal }) => findMinimum(payMint, mint, asked ?? 0, signal),
    enabled: asked !== null && cached === null,
    staleTime: Infinity,
    retry: 0,
  })
  if (asked === null) return { state: 'idle' }
  if (cached !== null) return { state: 'found', minimumUsd: cached }
  if (query.data) return query.data
  if (query.isError) return { state: 'none' }
  return { state: 'finding' }
}

export type QuoteRoute = 'unknown' | 'route' | 'no-route'

/**
 * Whether a sum of dollars routes into the company right now — one read-only
 * quote, asked once the sum settles (a rule's sheet has no quote of its own:
 * a sum with no route would only ever remind of a purchase that cannot
 * happen). Unknown while it settles, is asked, or the venue does not answer.
 */
export function useQuoteRoute(payMint: string, mint: string, amountUsd: number | null, enabled: boolean): QuoteRoute {
  const typed = enabled && amountUsd !== null && amountUsd > 0 ? amountUsd : null
  const settled = useDebounced(typed, QUOTE_DEBOUNCE_MS)
  const least = settled === null ? undefined : known(payMint, mint)
  const routes = settled !== null && least !== undefined && settled >= least
  const query = useQuery({
    queryKey: ['trade', 'route', payMint, mint, settled ?? 0],
    queryFn: ({ signal }) => quoteAnswer(payMint, mint, settled ?? 0, signal),
    enabled: settled !== null && !routes,
    staleTime: 60_000,
    retry: 0,
  })
  // An answer is about the sum it was asked for: a sum still settling says nothing yet.
  if (typed === null || settled !== typed) return 'unknown'
  if (routes) return 'route'
  const answer = query.data
  if (!answer) return 'unknown'
  return answer.ok ? 'route' : isNoRoute(answer.code) ? 'no-route' : 'unknown'
}
