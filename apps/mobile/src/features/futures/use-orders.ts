import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useWallet } from '@/features/wallet/use-wallet'
import { walletCancel, type WalletCancel } from '@/features/wallet/wallet-wait'
import type { Session } from '@/lib/api'

import { ordersApi } from './orders-api'
import {
  followOrder,
  readOrderStates,
  reviewOrder,
  signAndRelay,
  type OrderOutcome,
  type Reviewed,
} from './orders-flow'
import {
  ORDERS_CLOSED_STATES,
  unsettled,
  type OrderBody,
  type OrderResult,
  type OrderReview,
  type OrderStates,
} from './orders-model'

/** How long a receipt follows its signature on the chain, and how often it asks: the web's two minutes, every four seconds. */
export const ORDER_FOLLOW_MS = 120_000
const FOLLOW_EVERY_MS = 4_000

/**
 * Whether this wallet may place orders now, by the server's gate — closed until it says otherwise. Only a word for the
 * screen: every Review and every relay asks the gate again on the server, so nothing here opens anything.
 */
export function useOrderStates(owner: string | null): OrderStates {
  return useOrderGate(owner).states
}

/**
 * The gate before it is read: no order is open on a guess, and Ryntra's fee is «in Review», never 0 — production routes
 * orders through the builder (B6b).
 */
export const ORDERS_UNREAD_STATES: OrderStates = { ...ORDERS_CLOSED_STATES, builder: true, builderBps: null }

/** The gate with whether it was read: a page says «view only» only on the gate's own word, never while it loads or fails. */
export function useOrderGate(owner: string | null): Readonly<{ states: OrderStates; read: boolean }> {
  const states = useQuery({
    queryKey: ['futures', 'orders', 'states', owner],
    queryFn: ({ signal }) => readOrderStates(ordersApi, owner, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
  return { states: states.data ?? ORDERS_UNREAD_STATES, read: states.data !== undefined }
}

/**
 * The wallet's acts on a Phoenix order: ask for the Review, then sign it and relay it — one signature, one relay; the
 * account is read again after a relay, whatever the answer. A second press before the first re-renders opens no second
 * wallet prompt.
 */
export function useOrderActions(session: Session | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const waiting = useRef<WalletCancel | null>(null)

  const review = useCallback(
    async (body: OrderBody): Promise<Reviewed> => {
      if (!session) return { ok: false, reason: 'signIn' }
      return reviewOrder(ordersApi, session, body)
    },
    [session],
  )

  const sign = useCallback(
    async (reviewed: OrderReview, receivedAt: number, onSigned?: () => void): Promise<OrderOutcome | null> => {
      if (!session) return { kind: 'refused', reason: 'signIn', afterSignature: false }
      if (inFlight.current) return null
      inFlight.current = true
      const cancel = walletCancel()
      waiting.current = cancel
      try {
        return await signAndRelay({
          api: ordersApi,
          wallet: { signTransaction: wallet.signTransaction },
          session,
          review: reviewed,
          receivedAt,
          wait: { cancel, onSigned },
        })
      } finally {
        if (waiting.current === cancel) waiting.current = null
        inFlight.current = false
        void queryClient.invalidateQueries({ queryKey: ['futures', 'account'] })
      }
    },
    [session, wallet.signTransaction, queryClient],
  )

  /** «Скасувати» while the wallet is asked: back to the Review, nothing relayed. */
  const cancelSigning = useCallback(() => waiting.current?.cancel(), [])

  return { review, sign, cancelSigning }
}

/**
 * A relayed order as the chain and Phoenix see it: the relay's answer, then their word every few seconds for two
 * minutes. An order that trades now waits for its fills too; a resting limit, TP/SL and a cancel fill nothing to wait
 * for. The account is read again once the order settles, so the page shows the new position.
 */
export function useFollowedOrder(result: OrderResult, owner: string, expectsFills: boolean): OrderResult {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState(result)
  // A new relay starts its receipt from its own answer (state adjusted during render, as React prescribes).
  const [base, setBase] = useState(result)
  if (base !== result) {
    setBase(result)
    setCurrent(result)
  }
  useEffect(() => {
    if (!unsettled(result, expectsFills)) return
    let live = true
    const started = Date.now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let seen = result
    const tick = async () => {
      seen = await followOrder(ordersApi, owner, seen, controller.signal)
      if (!live) return
      setCurrent(seen)
      if (!unsettled(seen, expectsFills)) {
        void queryClient.invalidateQueries({ queryKey: ['futures', 'account'] })
        return
      }
      if (Date.now() - started < ORDER_FOLLOW_MS) timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS)
    }
    timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS)
    return () => {
      live = false
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [result, owner, expectsFills, queryClient])
  return current
}
