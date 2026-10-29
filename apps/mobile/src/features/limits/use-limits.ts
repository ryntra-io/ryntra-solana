import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { walletCancel, type WalletCancel } from '@/features/wallet/wallet-wait'
import type { Session } from '@/lib/api'

import { isOpen, type LimitOrders, type LimitReview, type LimitVenue } from './limit-model'
import { limitsApi } from './limits-api'
import { cancelLimit, placeLimit, type LimitOutcome } from './limits-flow'

export const LIMITS_KEY = [PRIVATE_QUERY_KEY, 'limits'] as const

/** While an order still waits, the list is read again on this beat — the venue's fills and the reconciler's settling show up on their own. */
const OPEN_REFRESH_MS = 30_000

/**
 * «Мої ордери»: the wallet's limit orders at Jupiter and on DLMM, the same one
 * read the web's Spot workspace makes — reading it also advances any record
 * the venues contradict. Private: behind the session, dropped on sign-out with
 * every private cache.
 */
export function useLimitOrders(session: Session | null) {
  return useQuery<LimitOrders>({
    queryKey: [...LIMITS_KEY, session?.address ?? null],
    queryFn: ({ signal }) => limitsApi.orders(session!, signal),
    enabled: session !== null,
    staleTime: 15_000,
    retry: 1,
    refetchInterval: (query) => (query.state.data?.orders.some(isOpen) ? OPEN_REFRESH_MS : false),
  })
}

/** The pair's price now in its quote, and whether a Meteora pool of it takes limits — read again on a new pair. */
export function useLimitMarket(session: Session | null, baseMint: string, quoteMint: string) {
  return useQuery({
    queryKey: [...LIMITS_KEY, 'market', baseMint, quoteMint, session?.address ?? null],
    queryFn: ({ signal }) => limitsApi.market(session!, { baseMint, quoteMint }, signal),
    enabled: session !== null && baseMint !== quoteMint,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  })
}

/**
 * The wallet's two acts on a limit — place what the Review showed, cancel (or
 * take back) one order — each one signature and one relay; the list is read
 * again after either, whatever the answer.
 */
export function useLimitActions(session: Session | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const [acting, setActing] = useState<string | null>(null)
  // A second tap before the first re-renders never opens a second wallet prompt: it answers null and is ignored.
  const inFlight = useRef(false)
  // «Скасувати» for the wallet's wait now open, if one is (M45).
  const waiting = useRef<WalletCancel | null>(null)

  const reread = useCallback(() => void queryClient.invalidateQueries({ queryKey: LIMITS_KEY }), [queryClient])

  const place = useCallback(
    async (
      review: LimitReview,
      freshUntil: number | null = null,
      onSigned?: () => void,
    ): Promise<LimitOutcome | null> => {
      if (!session) return { kind: 'refused', reason: 'signIn', afterSignature: false }
      if (inFlight.current) return null
      inFlight.current = true
      setActing(review.order)
      const cancel = walletCancel()
      waiting.current = cancel
      try {
        return await placeLimit({
          api: limitsApi,
          wallet: { signTransaction: wallet.signTransaction },
          session,
          review,
          wait: { cancel, freshUntil, onSigned },
        })
      } finally {
        if (waiting.current === cancel) waiting.current = null
        inFlight.current = false
        setActing(null)
        reread()
      }
    },
    [session, wallet.signTransaction, reread],
  )

  const cancel = useCallback(
    async (order: Readonly<{ key: string; venue: LimitVenue; order: string }>): Promise<LimitOutcome | null> => {
      if (!session) return { kind: 'refused', reason: 'signIn', afterSignature: false }
      if (inFlight.current) return null
      inFlight.current = true
      setActing(order.key)
      try {
        return await cancelLimit({ api: limitsApi, wallet: { signTransaction: wallet.signTransaction }, session, order })
      } finally {
        inFlight.current = false
        setActing(null)
        reread()
      }
    },
    [session, wallet.signTransaction, reread],
  )

  /** «Скасувати» while the wallet is asked to place: back to «Перевірка», nothing relayed. */
  const cancelSigning = useCallback(() => {
    waiting.current?.cancel()
  }, [])

  return { acting, place, cancel, cancelSigning, reread }
}
