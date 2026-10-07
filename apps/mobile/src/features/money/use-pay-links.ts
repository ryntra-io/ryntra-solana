import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import {
  createPayLink,
  listPayLinks,
  payLinkTransaction,
  readPayLink,
  submitPayLink,
  type PayLink,
  type PayLinkExpiration,
  type Session,
} from '@/lib/api'
import { feel } from '@/lib/haptics'

import { linkIsLive, PAY_LINK_POLL_MS } from './money-model'
import { payLink, type PayApi, type PayFailure } from './send-flow'

/** The session's own links, newest first — private, so under the prefix a sign-out drops. */
export function useMyPayLinks(session: Session | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'money', 'links', session?.address ?? ''],
    queryFn: ({ signal }) => listPayLinks(session!, signal),
    enabled: session !== null,
    staleTime: 15_000,
    retry: 1,
  })
}

/**
 * One link, as its page reads it — read again while a payment can still
 * arrive, never once it is paid or expired; the server itself reads the chain
 * at most every eight seconds. `initial` is the link as it was made or listed.
 */
export function usePayLink(initial: PayLink | null) {
  const id = initial?.id ?? null
  return useQuery({
    queryKey: ['money', 'link', id ?? ''],
    queryFn: async ({ signal }) => (await readPayLink(id!, signal)).link,
    enabled: id !== null,
    initialData: initial ?? undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: (query) => (query.state.data && linkIsLive(query.state.data.status) ? PAY_LINK_POLL_MS : false),
    retry: 1,
  })
}

export type LinkDraft = Readonly<{
  mint: string | null
  amount: string | null
  description: string | null
  expiration: PayLinkExpiration
}>

/** «Створити посилання на оплату» — for the session's own wallet; the recipient is never a field. */
export function useCreatePayLink(session: Session | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: LinkDraft) => {
      if (!session) throw new Error('No session.')
      return (
        await createPayLink(session, {
          mint: draft.mint,
          amount: draft.amount,
          description: draft.description,
          expiration: draft.expiration,
        })
      ).link
    },
    onSuccess: (link) => {
      queryClient.setQueryData(['money', 'link', link.id], link)
      void queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'money', 'links'] })
      feel('done')
    },
    onError: () => feel('failed'),
  })
}

export type PayPhase = 'idle' | 'preparing' | 'signing' | 'sending' | 'sent' | 'unconfirmed'

/** How long a payment sent without an answer holds «Оплатити» back — the server pins a link's transaction for three minutes. */
export const PAY_UNCONFIRMED_HOLD_MS = 180_000

/**
 * Paying a Ryntra link from Send: its own transfer with its reference, signed
 * in the wallet, sent once by the server; then the link's own state says
 * whether it is paid. One payment at a time: a second tap while one is in
 * flight does nothing. A send with no answer is «не підтверджено», never
 * «надіслано»: the link is read again, and «Оплатити» returns only after the
 * server's own window for that transaction has closed.
 */
export function usePayLinkPayment(session: Session | null, link: PayLink | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<PayPhase>('idle')
  const [failure, setFailure] = useState<PayFailure | null>(null)
  /** When a payment left without a final word — sent, or no answer: «Оплатити» is held back for the server's window. */
  const [heldAt, setHeldAt] = useState<number | null>(null)
  const [createsAccount, setCreatesAccount] = useState(false)
  const inFlight = useRef(false)
  const pay = useCallback(
    async (amount: string | null) => {
      if (!session || !link || inFlight.current) return
      inFlight.current = true
      const api: PayApi = {
        transaction: (id, request) => payLinkTransaction(session, id, request),
        submit: (id, request) => submitPayLink(session, id, request),
      }
      setFailure(null)
      setCreatesAccount(false)
      setPhase('preparing')
      try {
        const result = await payLink({
          api,
          wallet: { signTransaction: wallet.signTransaction },
          id: link.id,
          payer: session.address,
          amount,
          onSigning: (opens) => {
            setCreatesAccount(opens)
            setPhase('signing')
          },
          onSending: () => setPhase('sending'),
        })
        void queryClient.invalidateQueries({ queryKey: ['money', 'link', link.id] })
        if (result.ok) {
          setCreatesAccount(result.createsAccount)
          setHeldAt(Date.now())
          setPhase('sent')
          feel('sent')
          void queryClient.invalidateQueries({ queryKey: ['trade', 'holdings', session.address] })
          return
        }
        setFailure(result.failure)
        if (result.sent === 'unknown') {
          setHeldAt(Date.now())
          setPhase('unconfirmed')
          feel('sent')
          return
        }
        setPhase('idle')
        feel(result.failure.key === 'payRefused' ? 'declined' : 'failed')
      } finally {
        inFlight.current = false
      }
    },
    [link, queryClient, session, wallet.signTransaction],
  )
  const clearFailure = useCallback(() => setFailure(null), [])
  return { phase, failure, pay, heldAt, createsAccount, clearFailure }
}
