import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { PAY_UNCONFIRMED_HOLD_MS, type PayPhase } from '@/features/money/use-pay-links'
import { payLink, type PayApi, type PayFailure } from '@/features/money/send-flow'
import {
  ApiError,
  assistantApi,
  payLinkTransaction,
  submitPayLink,
  type AssistantCreditOrderResponse,
  type AssistantCreditOrdersResponse,
  type AssistantCreditPackage,
  type AssistantCreditsResponse,
  type Session,
} from '@/lib/api'
import { feel } from '@/lib/haptics'

import { creditedMore, ORDER_POLL_MS, orderPolls, payHeld, withOrder } from './credits-panel-model'
import { creditsChanged, creditsKey } from './use-credits'

/**
 * Buying credits from the phone (AI-12, 1.54.0): an order is opened for a package, and the order IS a `lib/pay`
 * request under the same id — so it is paid exactly as a Ryntra link is: the server builds the transfer with its
 * reference, the wallet signs those bytes through MWA and nothing else, the server sends what the wallet signed, once.
 * The order is then read every few seconds until the chain says it is paid, and the credits are the server's.
 */

export const creditOrdersKey = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-credit-orders', address] as const
export const creditOrderKey = (address: string, orderId: string) =>
  [PRIVATE_QUERY_KEY, 'assistant-credit-order', address, orderId] as const

/**
 * A payment of an order that left the phone without its final word, kept for the life of the app — so leaving the
 * tab and coming back never offers to pay the same order a second time inside the server's window.
 */
type Hold = Readonly<{ at: number; kind: 'sent' | 'unconfirmed' }>
const holds = new Map<string, Hold>()
/** The orders whose payment is in flight right now: one at a time per order, whatever screen asked. */
const paying = new Set<string>()
/** The credits each order was last seen to have added — the balance is read again only when they move. */
const seenCredited = new Map<string, number>()

function heldNow(orderId: string | null, now = Date.now()): Hold | null {
  if (!orderId) return null
  const hold = holds.get(orderId)
  return hold && payHeld(hold.at, now, PAY_UNCONFIRMED_HOLD_MS) ? hold : null
}

const codeOf = (error: unknown): string | null => (error instanceof ApiError ? error.code : null)

/** The wallet's orders with their receipts, newest first; the server reads the chain for the ones still open. */
export function useCreditOrders(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: creditOrdersKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.orders(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 15_000,
    retry: 1,
  })
}

/**
 * One order, read again every four seconds while a payment can still arrive (or one of ours is out); when it added
 * credits, the balance, the price line and the receipts follow.
 */
export function useCreditOrder(session: Session | null, orderId: string | null) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  const read = useQuery({
    queryKey: creditOrderKey(address, orderId ?? ''),
    queryFn: ({ signal }) => assistantApi.order(session!, orderId!, signal),
    enabled: session !== null && orderId !== null,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return orderPolls(data.order, Date.now(), heldNow(data.order.id) !== null) ? ORDER_POLL_MS : false
    },
    retry: 1,
  })
  const data = read.data
  useEffect(() => {
    if (!data || !session) return
    const { order } = data
    queryClient.setQueryData<AssistantCreditOrdersResponse>(creditOrdersKey(session.address), (current) =>
      current ? { ...current, orders: withOrder(current.orders, order) } : current,
    )
    const before = seenCredited.get(order.id)
    seenCredited.set(order.id, order.credited)
    if (creditedMore(before, order.credited)) {
      creditsChanged(queryClient, session.address, data.credits)
      if (before !== undefined) feel('done')
    }
  }, [data, queryClient, session])
  return read
}

/** «Купити»: an order for one package, in the app's language; the server names the amount, the treasury and the window. */
export function useOpenCreditOrder(session: Session | null, locale: 'en' | 'uk') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (pkg: AssistantCreditPackage['id']): Promise<AssistantCreditOrderResponse> => {
      if (!session) throw new Error('No session.')
      return assistantApi.openOrder(session, { package: pkg, locale })
    },
    onSuccess: (response) => {
      if (!session) return
      seenCredited.set(response.order.id, response.order.credited)
      queryClient.setQueryData(creditOrderKey(session.address, response.order.id), response)
      queryClient.setQueryData<AssistantCreditOrdersResponse>(creditOrdersKey(session.address), (current) =>
        current ? { ...current, orders: withOrder(current.orders, response.order) } : current,
      )
    },
    onError: () => feel('failed'),
  })
}

/** The refusal code of a failed order or welcome — the screen turns it into words. */
export function refusalCode(error: unknown): string | null {
  return codeOf(error)
}

/** «Отримати вітальні кредити»: once per wallet and account; what arrived is `granted`. */
export function useWelcomeCredits(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<AssistantCreditsResponse> => {
      if (!session) throw new Error('No session.')
      return assistantApi.welcome(session)
    },
    onSuccess: (response) => {
      if (!session) return
      queryClient.setQueryData<AssistantCreditsResponse>(creditsKey(session.address), (current) => ({
        ...response,
        purchase: response.purchase ?? current?.purchase,
      }))
      creditsChanged(queryClient, session.address, response.credits)
      feel('done')
    },
    onError: () => feel('failed'),
  })
}

/**
 * «Підписати в гаманці» for one order — the «pay a Ryntra link» flow as it is: the server's transfer with the order's
 * reference, the wallet's own signature, one send by the server. One payment at a time; a send with no answer is
 * «не підтверджено», never «оплачено»: the order is read on, and the button returns only after the server's own
 * window for that transaction has closed.
 */
export function useOrderPayment(session: Session | null, orderId: string | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<PayPhase>(() => heldNow(orderId)?.kind ?? 'idle')
  const [failure, setFailure] = useState<PayFailure | null>(null)
  const [heldAt, setHeldAt] = useState<number | null>(() => heldNow(orderId)?.at ?? null)
  const shown = useRef(orderId)

  // Another order on screen: its own hold, if one of its payments is still out.
  useEffect(() => {
    if (shown.current === orderId) return
    shown.current = orderId
    const hold = heldNow(orderId)
    setPhase(hold?.kind ?? 'idle')
    setHeldAt(hold?.at ?? null)
    setFailure(null)
  }, [orderId])

  const pay = useCallback(async () => {
    if (!session || !orderId || paying.has(orderId) || heldNow(orderId)) return
    paying.add(orderId)
    const api: PayApi = {
      transaction: (id, request) => payLinkTransaction(session, id, request),
      submit: (id, request) => submitPayLink(session, id, request),
    }
    const hold = (kind: Hold['kind']) => {
      const at = Date.now()
      holds.set(orderId, { at, kind })
      setHeldAt(at)
      setPhase(kind)
    }
    setFailure(null)
    setPhase('preparing')
    try {
      const result = await payLink({
        api,
        wallet: { signTransaction: wallet.signTransaction },
        id: orderId,
        payer: session.address,
        amount: null,
        onSigning: () => setPhase('signing'),
        onSending: () => setPhase('sending'),
      })
      if (result.ok) {
        hold('sent')
        feel('sent')
      } else if (result.sent === 'unknown' || result.failure.key === 'payPending') {
        // No answer, or the server says a payment is already on its way: never a second one — the order decides.
        setFailure(result.failure)
        hold('unconfirmed')
        feel('sent')
      } else {
        setFailure(result.failure)
        setPhase('idle')
        feel(result.failure.key === 'payRefused' ? 'declined' : 'failed')
      }
      void queryClient.invalidateQueries({ queryKey: creditOrderKey(session.address, orderId) })
    } finally {
      paying.delete(orderId)
    }
  }, [orderId, queryClient, session, wallet.signTransaction])

  const clearFailure = useCallback(() => setFailure(null), [])
  return { phase, failure, heldAt, pay, clearFailure }
}

/** How long a payment that left without its final word holds «Підписати в гаманці» back — the server's window. */
export const ORDER_PAY_HOLD_MS = PAY_UNCONFIRMED_HOLD_MS
