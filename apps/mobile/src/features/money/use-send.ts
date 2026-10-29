import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SEEKER_COPY } from '@/features/seeker/copy'
import {
  NAME_READ_AFTER_SIGNING_MS,
  nameAnswerFor,
  nameStopOf,
  resolveOf,
  reviewNameOf,
  shownNameOf,
  skrNameOf,
  type SkrResolve,
} from '@/features/seeker/seeker-model'
import { useNames, useSkrName } from '@/features/seeker/use-seeker'
import { useAccount } from '@/features/session/use-account'
import { withMark } from '@/features/trade/keypad-model'
import { parseAmount } from '@/features/trade/trade-model'
import { useWallet } from '@/features/wallet/use-wallet'
import { walletCancel, type WalletCancel } from '@/features/wallet/wallet-wait'
import { useDebounced } from '@/hooks/use-debounced'
import {
  adoptTransfer,
  checkRecipient,
  planTransfer,
  readAddressEvidence,
  readReturned,
  readSkrNameOwner,
  recoverTransfer,
  settleTransfer,
  type TransferReview,
  type TransferSettleResult,
} from '@/lib/api'
import { feel } from '@/lib/haptics'
import { useLocale } from '@/lib/i18n'
import { useHoldings } from '@/features/portfolio/use-portfolio'

import {
  blocksNewSend,
  overBalance,
  recipientLocal,
  sendFailureKey,
  recipientView,
  sendAssets,
  transferInput,
  wrongLengthView,
  type PendingSend,
  type RecipientView,
  type ResumeShow,
  type SendAsset,
  type SendOutcome,
} from './money-model'
import { failureOf, resumePending, sendReviewed, withinMs, type SendApi, type SendFailure } from './send-flow'
import { pendingSendStore, readPendingSend, usePendingSend } from './send-store'

const api: SendApi = {
  plan: async (input) => (await planTransfer({ input })).data,
  returned: readReturned,
  adopt: async (request) => (await adoptTransfer(request)).data,
  settle: async (request) => (await settleTransfer(request)).data,
}

/** How long past the plan a pasted address's forward name read may hold the Review — a label never delays it. */
const FORWARD_WAIT_MS = 1_000

/** Typing settles this long before the recipient is checked. */
const RECIPIENT_DEBOUNCE_MS = 500

/** A `.skr` name to where it points now — asked of the server every call, never kept; a failed read is UNAVAILABLE. */
async function resolveName(name: string, signal?: AbortSignal): Promise<SkrResolve> {
  try {
    return resolveOf(name, await readSkrNameOwner(name, signal))
  } catch (error) {
    if (signal?.aborted) throw error
    return { state: 'UNAVAILABLE', name }
  }
}

export type SendPhase = 'idle' | 'reviewing' | 'review' | 'preparing' | 'signing' | 'sending' | 'done'

export type SendDone = Readonly<{
  outcome: SendOutcome
  result: TransferSettleResult | null
  signature: string | null
  amount: string
  symbol: string
  to: string
  /** The `.skr` name the transfer was sent to, read again right before the wallet and after it — else null. */
  toName: string | null
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

  const holdings = useHoldings(address)
  const assets = useMemo(() => sendAssets(holdings.data?.data.holdings ?? []), [holdings.data])

  const [recipientText, setRecipientTextState] = useState('')
  /** The person is done with the recipient: left the field, pressed the keyboard's «Далі», pasted, scanned or picked it. */
  const [recipientFinished, setRecipientFinished] = useState(false)
  const [typedAmount, setTypedAmount] = useState('')
  /* The typed sum is always in the language's shape (ST-5 r8): «0,5» typed in Ukrainian reads «0.5» once the language
     is English — the same amount, and the keypad's «.» is its mark again (state adjusted during render). */
  const fieldMark: ',' | '.' = locale === 'uk' ? ',' : '.'
  const [markSeen, setMarkSeen] = useState(fieldMark)
  if (markSeen !== fieldMark) {
    setMarkSeen(fieldMark)
    setTypedAmount((text) => withMark(text, fieldMark))
  }
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
  // What the phone knows without asking: a short text still being typed says nothing yet, and a base58 text that
  // cannot decode to an address's 32 bytes is the wrong length — never sent to the server to be named something else.
  const localNow = recipientLocal(typed, recipientFinished)
  const localSettled = recipientLocal(settled, recipientFinished)
  /*
   * A `.skr` name (M41.2): the server says where it points now — read every time, kept by nothing (no stale time, no
   * cache past the screen) — and that address is what the recipient check, «Перевірка» and the wallet are for.
   */
  const names = useNames()
  const namesServed = names.served === 'yes'
  // A name typed while the capabilities are unread is neither resolved nor sent as text to be called «not an address».
  const nameLike = skrNameOf(settled)
  const namesUnread = nameLike !== null && names.served === 'unread'
  const settledName = namesServed ? nameLike : null
  const named = useQuery({
    queryKey: ['money', 'skr-owner', settledName ?? ''],
    queryFn: ({ signal }) => resolveName(settledName!, signal),
    enabled: settledName !== null,
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  })
  const refetchName = named.refetch
  const nameRead = nameAnswerFor(settledName, named.data)
  const capabilitiesLoading = namesUnread && names.retryable === false
  const resolving = (settledName !== null && (nameRead === null || named.isFetching)) || capabilitiesLoading
  // What is checked: the text itself, or — for a name — the address it points to now.
  const checkTo = settledName ? (nameRead?.state === 'FOUND' ? nameRead.address : null) : namesUnread ? null : settled
  const recipient = useQuery({
    queryKey: ['money', 'recipient', checkTo ?? '', chosen?.mint ?? 'SOL', address ?? ''],
    queryFn: ({ signal }) =>
      checkRecipient(
        { to: checkTo!, ...(chosen?.mint ? { mint: chosen.mint } : {}), ...(address ? { from: address } : {}) },
        signal,
      ),
    enabled: checkTo !== null && checkTo.length > 0 && localSettled === null && !resolving,
    staleTime: 30_000,
    retry: 1,
  })
  const serverAsked = typed === settled && localSettled === null && checkTo !== null && !resolving
  const checkingRecipient =
    typed.length > 0 &&
    localNow !== 'typing' &&
    (typed !== settled || resolving || (serverAsked && recipient.isFetching))
  const seekerWords = SEEKER_COPY[locale]
  const view: RecipientView | null =
    typed.length === 0 || typed !== settled
      ? null
      : localSettled === 'wrong-length'
        ? wrongLengthView(locale)
        : settledName && !resolving && nameRead?.state === 'NOT_FOUND'
          ? { kind: 'problem', line: seekerWords.noSuchName }
          : serverAsked && recipient.data
            ? recipientView(recipient.data, locale, checkTo ?? typed)
            : null
  const recipientAddress = view?.kind === 'transfer' ? view.address : null
  /** The name the address on screen came from — only while it still is that name's answer. */
  const recipientName = shownNameOf({ name: settledName, answer: nameRead, address: recipientAddress })
  /** A name the chain did not answer for: never «no such name» — said as unchecked, with «Спробувати ще раз». */
  const nameUnread =
    typed === settled &&
    !resolving &&
    ((settledName !== null && nameRead?.state === 'UNAVAILABLE') || (namesUnread && names.retryable))
  /** A name that points nowhere — the button then says to check the name. */
  const nameMissing = typed === settled && settledName !== null && !resolving && nameRead?.state === 'NOT_FOUND'
  /** A plain address's own primary name, shown beside it; Review names it only once read forward to this address. */
  const addressName = useSkrName(settledName ? null : recipientAddress)
  const [reviewName, setReviewName] = useState<Readonly<{ address: string; name: string }> | null>(null)

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
    serverAsked && recipient.data?.input === 'solana-pay' && recipient.data.asked ? recipient.data.asked : null
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
    (text: string, finished = false) => {
      invalidate()
      setRecipientTextState(text)
      setRecipientFinished(finished)
    },
    [invalidate],
  )
  /** The field is left or «Далі» pressed: a short text is judged now rather than while it is typed. */
  const finishRecipient = useCallback(() => setRecipientFinished(true), [])
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
  // «Скасувати» for the wallet's wait now open, if one is (M45).
  const waiting = useRef<WalletCancel | null>(null)

  /** A result dropped because the ticket changed meanwhile: «Готую…» ends, nothing else changes. */
  const leaveReviewing = useCallback(() => setPhase((now) => (now === 'reviewing' ? 'idle' : now)), [])

  const requestReview = useCallback(async () => {
    if (!transfer || inFlight.current) return
    inFlight.current = true
    // An edit or a step back while this runs moves the revision: what it brings back is then dropped.
    const round = revision.current
    setFailure(null)
    setReviewName(null)
    setPhase('reviewing')
    try {
      // A name is read again before the Review is built, never taken from the line on screen (M41.2).
      if (recipientName) {
        const again = await resolveName(recipientName)
        if (revision.current !== round) return leaveReviewing()
        const stop = nameStopOf(again, transfer.recipient)
        if (stop) {
          const code = stop === 'SKR_UNREAD' ? 'SKR_UNCHECKED' : stop
          setFailure({ code, key: sendFailureKey(code) })
          setPhase('idle')
          feel('failed')
          // The screen learns the new answer: «Кому» shows where the name points now.
          if (again.state !== 'UNAVAILABLE') void refetchName()
          return
        }
      }
      // A pasted address's name is named in Review only if, read forward now, it is still this address's — beside
      // the plan, so a label never delays the Review.
      const forwardRead = !recipientName && addressName ? resolveName(addressName) : Promise.resolve(null)
      const plan = await planTransfer({ input: transfer })
      // The label waits at most a moment past the plan; unanswered by then, the Review shows the address alone.
      const forward = await withinMs(forwardRead, FORWARD_WAIT_MS, null)
      if (revision.current !== round) return leaveReviewing()
      if (forward?.state === 'FOUND' && forward.address === transfer.recipient)
        setReviewName({ address: forward.address, name: forward.name })
      setReview(plan.data)
      setPhase('review')
      feel('review')
    } catch (error) {
      if (revision.current !== round) return leaveReviewing()
      setFailure(failureOf(error))
      setPhase('idle')
      feel('failed')
    } finally {
      inFlight.current = false
    }
  }, [addressName, leaveReviewing, recipientName, refetchName, transfer, setReviewName])

  const confirm = useCallback(async () => {
    if (!transfer || !review || !asset || inFlight.current) return
    inFlight.current = true
    const round = revision.current
    setFailure(null)
    setPhase('preparing')
    const summary = { amount: review.check.send.amount, symbol: asset.symbol, to: review.check.to.address }
    // Read again before and after the wallet: only a typed name. Shown on «Готово»: the name the Review showed.
    const toName = recipientName
    const shownName =
      recipientName ?? (reviewName?.address === review.check.to.address ? reviewName.name : null)
    const cancel = walletCancel()
    waiting.current = cancel
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
        onSigned: () => setPhase('sending'),
        cancel,
        onSending: () => setPhase('sending'),
        // A name is read again before the wallet opens and after it signed — where it points now is where money goes.
        ...(toName
          ? {
              recipientStill: async (after: 'before' | 'signed') => {
                const stop = nameStopOf(await resolveName(toName), transfer.recipient)
                // After the signature an unread name is said as such: the signature was not used.
                const code = stop === 'SKR_UNREAD' && after === 'signed' ? 'SKR_UNREAD_SIGNED' : stop
                return code ? { code, key: sendFailureKey(code) } : null
              },
              recipientStillMs: NAME_READ_AFTER_SIGNING_MS,
            }
          : {}),
      })
      if (result.ok) {
        setDone({
          outcome: result.outcome,
          result: result.result,
          signature: result.result.signature,
          amount: summary.amount,
          symbol: summary.symbol,
          to: summary.to,
          toName: shownName,
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
          toName: shownName,
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
      // A name that moved or went: «Кому» learns where it points now.
      if (result.failure.key === 'nameMoved' || result.failure.key === 'nameGone') void refetchName()
    } finally {
      inFlight.current = false
      if (waiting.current === cancel) waiting.current = null
    }
  }, [asset, queryClient, recipientName, refetchName, review, reviewName, settled, transfer, wallet.signTransaction])

  /** «Скасувати» while the wallet is asked: back to «Перевірка», nothing sent; a signature after this is dropped. */
  const cancelSigning = useCallback(() => {
    waiting.current?.cancel()
  }, [])

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
    finishRecipient,
    /** A short address still being typed — nothing said of it yet; «Перевір адресу отримувача» judges it now. */
    recipientTyping: localNow === 'typing',
    recipientFailed: recipient.isError && serverAsked,
    retryRecipient: () => void recipient.refetch(),
    /** M41.2: the `.skr` name the address came from, a name the chain did not answer for, and its retry. */
    recipientName,
    nameUnread,
    retryName: () => (namesUnread ? names.retry() : void refetchName()),
    nameMissing,
    /** A stale line from an earlier step goes when the person chooses the recipient again. */
    clearFailure: () => setFailure(null),
    /** A plain address's primary name, and the name Review may show beside the whole address. */
    addressName,
    reviewName: reviewNameOf({
      reviewAddress: review?.check.to.address ?? null,
      name: recipientName,
      address: recipientAddress,
      forward: reviewName,
    }),
    namesServed,
    /** Whether names are served — `no` says nothing of names at all. */
    namesState: names.served,
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
    cancelSigning,
    closeReview,
    reset,
  }
}
