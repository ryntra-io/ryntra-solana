import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAccount } from '@/features/session/use-account'
import { parseAmount } from '@/features/trade/trade-model'
import { useWallet } from '@/features/wallet/use-wallet'
import { useDebounced } from '@/hooks/use-debounced'
import {
  adoptTransfer,
  checkRecipient,
  fetchHoldings,
  planTransfer,
  readAddressEvidence,
  readReturned,
  recoverTransfer,
  settleTransfer,
  type TransferReview,
  type TransferSettleResult,
} from '@/lib/api'
import { feel } from '@/lib/haptics'
import { useLocale } from '@/lib/i18n'

import {
  blocksNewSend,
  overBalance,
  recipientView,
  sendAssets,
  transferInput,
  type PendingSend,
  type ResumeShow,
  type SendAsset,
  type SendOutcome,
} from './money-model'
import { failureOf, resumePending, sendReviewed, type SendApi, type SendFailure } from './send-flow'
import { pendingSendStore, readPendingSend, usePendingSend } from './send-store'

const api: SendApi = {
  plan: async (input) => (await planTransfer({ input })).data,
  returned: readReturned,
  adopt: async (request) => (await adoptTransfer(request)).data,
  settle: async (request) => (await settleTransfer(request)).data,
}

/** Typing settles this long before the recipient is checked. */
const RECIPIENT_DEBOUNCE_MS = 500

export type SendPhase = 'idle' | 'reviewing' | 'review' | 'preparing' | 'signing' | 'sending' | 'done'

export type SendDone = Readonly<{
  outcome: SendOutcome
  result: TransferSettleResult | null
  signature: string | null
  amount: string
  symbol: string
  to: string
  at: string
}>

/**
 * One transfer on the phone: the recipient as typed, pasted or scanned and the
 * server's check of it, the amount in the asset's units, «Перевірка» from the
 * server, the wallet's signature, the one settle, and the record of a signed
 * transfer read again until the network answers. The rules live in
 * `send-flow`; this hook binds them to the wallet, the session and the screen.
 */
export function useSend() {
  const account = useAccount()
  const locale = useLocale()
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const address = account.address

  const holdings = useQuery({
    queryKey: ['trade', 'holdings', address ?? ''],
    queryFn: ({ signal }) => fetchHoldings(address!, signal),
    enabled: address !== null,
    staleTime: 20_000,
    retry: 1,
  })
  const assets = useMemo(() => sendAssets(holdings.data?.data.holdings ?? []), [holdings.data])

  const [recipientText, setRecipientTextState] = useState('')
  const [typedAmount, setTypedAmount] = useState('')
  /** The recipient a typed amount was typed for — a request scanned after it states its own. */
  const [amountFor, setAmountFor] = useState<string | null>(null)
  const [assetKey, setAssetKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<SendPhase>('idle')
  const [review, setReview] = useState<TransferReview | null>(null)
  const [failure, setFailure] = useState<SendFailure | null>(null)
  const [done, setDone] = useState<SendDone | null>(null)

  // The asset chosen, else the first the wallet can move (USDC when held).
  const chosen: SendAsset | null = assets.find((entry) => entry.key === assetKey) ?? assets[0] ?? null

  const typed = recipientText.trim()
  const settled = useDebounced(typed, RECIPIENT_DEBOUNCE_MS)
  const recipient = useQuery({
    queryKey: ['money', 'recipient', settled, chosen?.mint ?? 'SOL', address ?? ''],
    queryFn: ({ signal }) =>
      checkRecipient(
        { to: settled, ...(chosen?.mint ? { mint: chosen.mint } : {}), ...(address ? { from: address } : {}) },
        signal,
      ),
    enabled: settled.length > 0,
    staleTime: 30_000,
    retry: 1,
  })
  const checkingRecipient = typed.length > 0 && (typed !== settled || recipient.isFetching)
  const view = typed.length > 0 && typed === settled && recipient.data ? recipientView(recipient.data, locale) : null
  const recipientAddress = view?.kind === 'transfer' ? view.address : null

  const evidence = useQuery({
    queryKey: ['money', 'evidence', recipientAddress ?? ''],
    queryFn: ({ signal }) => readAddressEvidence(recipientAddress!, signal),
    enabled: recipientAddress !== null,
    staleTime: 60 * 60_000,
    retry: 0,
  })

  /*
   * A scanned or pasted Solana Pay request names its own token (none: SOL) and
   * may name an amount: the transfer is that token, never the one chosen
   * before — the server checked the recipient for it — and the amount stands in
   * the field until the person types their own.
   */
  const askedFor =
    typed === settled && recipient.data?.input === 'solana-pay' && recipient.data.asked ? recipient.data.asked : null
  const asset: SendAsset | null = askedFor ? (assets.find((entry) => entry.mint === askedFor.mint) ?? null) : chosen
  const askedMissing = askedFor !== null && asset === null && holdings.data !== undefined
  const askedAmount = askedFor?.amount ?? null
  const showAsked = askedAmount !== null && amountFor !== settled
  // The field holds it in the person's own mark («1,5» in Ukrainian); a request asking finer than the token can carry is refused, never rounded down.
  const amountText = showAsked ? (locale === 'uk' ? askedAmount.replace('.', ',') : askedAmount) : typedAmount
  const askedTooFine =
    showAsked && asset !== null && (askedAmount.split('.')[1] ?? '').replace(/0+$/, '').length > asset.decimals
  const amountRaw = asset && !askedTooFine ? parseAmount(amountText, asset.decimals) : null
  const over = overBalance(amountRaw, asset)

  /* ---- the signed transfer the app may have closed on ---- */
  const pending = usePendingSend(address)
  const pendingSignature = pending?.signature ?? null
  /** The last answer about a signed transfer — kept after its record is forgotten, so «Надіслано» stays on screen. */
  const [resume, setResume] = useState<Readonly<{ record: PendingSend; show: ResumeShow }> | null>(null)
  /** «Перевірити ще раз» asks the network again after the reading's own deadline passed. */
  const [checkRound, setCheckRound] = useState(0)
  const [roundEnded, setRoundEnded] = useState<string | null>(null)
  const session = account.session
  useEffect(() => {
    if (!address || !pendingSignature || !session) return undefined
    const record = readPendingSend(address)
    if (!record) return undefined
    let live = true
    void resumePending({
      recover: async (value) => (await recoverTransfer(session, value)).data,
      pending: pendingSendStore,
      record,
      show: (show) => {
        if (live) setResume({ record, show })
      },
      live: () => live,
    }).then(() => {
      if (live) setRoundEnded(`${record.signature}:${checkRound}`)
    })
    return () => {
      live = false
    }
  }, [address, pendingSignature, session, checkRound])
  // Without a session the recovery route cannot be asked: the record is open until someone can read it.
  const resumed: Readonly<{ record: PendingSend; show: ResumeShow }> | null = pending
    ? resume?.record.signature === pending.signature
      ? resume
      : { record: pending, show: session ? 'CHECKING' : 'UNKNOWN' }
    : resume && resume.record.wallet === address && resume.show !== null
      ? resume
      : null
  const blocked = pending !== null && blocksNewSend(resumed?.show ?? null)
  const canRecheck =
    pending !== null &&
    session !== null &&
    resumed?.show === 'UNKNOWN' &&
    roundEnded === `${pending.signature}:${checkRound}`
  const recheck = useCallback(() => setCheckRound((round) => round + 1), [])

  /* ---- editing voids a Review; every edit and every close moves the revision, so a press in flight never reaches the wallet ---- */
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current += 1
    setReview(null)
    setFailure(null)
  }, [])
  const setRecipientText = useCallback(
    (text: string) => {
      invalidate()
      setRecipientTextState(text)
    },
    [invalidate],
  )
  const setAmountText = useCallback(
    (text: string) => {
      invalidate()
      setAmountFor(settled)
      setTypedAmount(text.replace(/[^\d.,]/g, ''))
    },
    [invalidate, settled],
  )
  const chooseAsset = useCallback(
    (key: string) => {
      invalidate()
      setAssetKey(key)
      setAmountFor(settled)
      setTypedAmount('')
    },
    [invalidate, settled],
  )

  const transfer =
    address && asset && recipientAddress && amountRaw
      ? transferInput(asset, address, recipientAddress, amountRaw)
      : null
  const inFlight = useRef(false)

  const requestReview = useCallback(async () => {
    if (!transfer || inFlight.current) return
    inFlight.current = true
    setFailure(null)
    setPhase('reviewing')
    try {
      const plan = await planTransfer({ input: transfer })
      setReview(plan.data)
      setPhase('review')
      feel('review')
    } catch (error) {
      setFailure(failureOf(error))
      setPhase('idle')
      feel('failed')
    } finally {
      inFlight.current = false
    }
  }, [transfer])

  const confirm = useCallback(async () => {
    if (!transfer || !review || !asset || inFlight.current) return
    inFlight.current = true
    const round = revision.current
    setFailure(null)
    setPhase('preparing')
    const summary = { amount: review.check.send.amount, symbol: asset.symbol, to: review.check.to.address }
    try {
      const result = await sendReviewed({
        api,
        wallet: { signTransaction: wallet.signTransaction },
        pending: pendingSendStore,
        read: review,
        transfer,
        summary,
        cancelled: () => revision.current !== round,
        trace: (step, detail) => {
          if (__DEV__) console.log(`[send] ${step}: ${detail}`)
        },
        onSigning: () => setPhase('signing'),
        onSending: () => setPhase('sending'),
      })
      if (result.ok) {
        setDone({
          outcome: result.outcome,
          result: result.result,
          signature: result.result.signature,
          amount: summary.amount,
          symbol: summary.symbol,
          to: summary.to,
          at: new Date().toISOString(),
        })
        setReview(null)
        setAmountFor(settled)
        setTypedAmount('')
        setPhase('done')
        feel(result.outcome === 'sent' ? 'done' : result.outcome === 'open' ? 'sent' : 'failed')
        // The money left: the balance on screen is stale, and so is every other surface's.
        void queryClient.invalidateQueries({ queryKey: ['trade', 'holdings', transfer.sender] })
        return
      }
      if (result.phase === 'open') {
        setDone({
          outcome: 'open',
          result: null,
          signature: result.signature ?? null,
          amount: summary.amount,
          symbol: summary.symbol,
          to: summary.to,
          at: new Date().toISOString(),
        })
        setReview(null)
        setPhase('done')
        feel('sent')
        return
      }
      if (revision.current !== round) {
        // Closed or changed while the Review was rebuilt: nothing was signed, nothing reopens.
        setPhase('idle')
        return
      }
      setFailure(result.failure)
      if (result.review) {
        setReview(result.review)
        setPhase('review')
      } else {
        setReview(null)
        setPhase('idle')
      }
      feel(result.failure.key === 'walletCancelled' ? 'declined' : 'failed')
    } finally {
      inFlight.current = false
    }
  }, [asset, queryClient, review, settled, transfer, wallet.signTransaction])

  const closeReview = useCallback(() => {
    if (phase === 'preparing' || phase === 'signing' || phase === 'sending') return
    revision.current += 1
    setReview(null)
    setPhase('idle')
  }, [phase])

  const reset = () => {
    setResume(null)
    setDone(null)
    setFailure(null)
    setReview(null)
    setPhase('idle')
  }

  /* A transfer sent here whose outcome was open: the recovery's answer for the same signature closes it. */
  const doneView: SendDone | null =
    done && done.outcome === 'open' && resumed && resumed.record.signature === done.signature
      ? resumed.show === 'LANDED'
        ? { ...done, outcome: 'sent' }
        : resumed.show === 'FAILED'
          ? { ...done, outcome: 'not-sent' }
          : done
      : done
  const doneShown = doneView !== null && resumed !== null && resumed.record.signature === doneView.signature

  return {
    account,
    holdings,
    assets,
    asset,
    chooseAsset,
    recipientText,
    setRecipientText,
    checkingRecipient,
    recipientFailed: recipient.isError && typed === settled,
    retryRecipient: () => void recipient.refetch(),
    view,
    asked: askedFor,
    askedMissing,
    askedTooFine,
    opensAccount: view?.kind === 'transfer' ? view.opensAccount : false,
    evidence: evidence.data ?? null,
    evidenceLoading: evidence.isFetching,
    amountText,
    setAmountText,
    amountRaw,
    over,
    phase,
    review,
    failure,
    done: doneView,
    pending,
    resumed: doneShown ? null : resumed,
    blocked,
    canRecheck,
    recheck,
    ready: transfer !== null && !over && !blocked,
    requestReview,
    confirm,
    closeReview,
    reset,
  }
}
