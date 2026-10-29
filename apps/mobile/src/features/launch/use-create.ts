import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import { useCapabilities } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { signsV1Known, useSignsV1 } from '@/features/wallet/wallet-versions'
import { ApiError, isNotFound } from '@/lib/api'
import type { LaunchLockId, LaunchPresetId, LaunchPresetsResponse } from '@/lib/api/v1/types'
import { useNow } from '@/hooks/use-now'
import { feel } from '@/lib/haptics'

import { checkLaunchForm, EMPTY_FORM, type LaunchFormFields } from './form'
import { createApi } from './launch-api'
import { launchToken, lostAfterSend, walletFailure, type CreateOutcome, type FlowStep, type LaunchFailure } from './launch-flow'
import { toRaw } from './launch-format'
import { contractAtLeast, isPaused, LAUNCH_V1_CONTRACT } from './launch-model'
import type { Picture } from './picture'
import { useFirstBuyQuote, useLaunchToken } from './use-launch'

/** A sent transaction lands while its blockhash lives (about a minute and a half); past this a «not found» is final. */
const LANDING_WINDOW_MS = 180_000

export type CreatePhase = 'form' | FlowStep | 'done' | 'error'

/**
 * «Запустити токен» on the phone: the form's state, the first buy quoted as
 * it is typed, and the launch itself — the picture and words stored, the
 * creation (and the lock) built, signed in one wallet prompt, sent once. The
 * form is checked by the web's own rules; the server checks again.
 */
export function useLaunchCreate(presets: LaunchPresetsResponse | null) {
  const account = useAccount()
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const capabilities = useCapabilities()
  const [fields, setFields] = useState<LaunchFormFields>(EMPTY_FORM)
  const [picture, setPicture] = useState<Picture | null>(null)
  const [pictureBad, setPictureBad] = useState(false)
  const [chosenPreset, choosePreset] = useState<LaunchPresetId | null>(null)
  const [buyText, setBuyText] = useState('')
  const [chosenLock, setLockId] = useState<LaunchLockId | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [phase, setPhase] = useState<CreatePhase>('form')
  const [failure, setFailure] = useState<Readonly<{
    failure: LaunchFailure
    token: string | null
    /** When the answer was lost — a «not found» counts only once the transaction can no longer land. */
    lostAt?: number
  }> | null>(null)
  const [result, setResult] = useState<Extract<CreateOutcome, { ok: true }> | null>(null)
  /** The build's simulated cost, with the terms it was built for: shown as exact only while they still stand. */
  const [cost, setCost] = useState<Readonly<{ lamports: string; terms: string }> | null>(null)
  const [transactions, setTransactions] = useState(1)
  const running = useRef(false)

  // «Захищений» first where the network has it: the plan's default against snipers.
  const preset =
    presets?.presets.find((entry) => entry.id === chosenPreset) ??
    presets?.presets.find((entry) => entry.id === 'protected') ??
    presets?.presets[0] ??
    null
  const check = useMemo(() => checkLaunchForm(fields), [fields])
  const buyRaw = preset ? toRaw(buyText, preset.pair.decimals) : null
  const buying = buyRaw !== null && buyRaw > 0n
  const quote = useFirstBuyQuote(preset?.id ?? null, buyRaw)
  const quoteData = quote.data && buyRaw !== null && quote.data.amountInRaw === buyRaw.toString() ? quote.data : null
  const quoteCode = quote.error instanceof ApiError ? quote.error.code : null
  const aboveCap = Boolean(buying && quoteData && !quoteData.withinCap)
  // The stop is read from the quote, which reads again every half a minute while it lasts: the form opens by itself.
  const paused = isPaused(quoteCode)
  // A launch whose answer was lost may have landed: its token is read until the chain says, and the form waits.
  const lostToken = failure && lostAfterSend(failure.failure) ? failure.token : null
  const settling = useLaunchToken(lostToken, 10_000)
  const now = useNow(5_000)
  const landed = lostToken !== null && settling.data !== undefined
  // Before it lands the mint has no account, so «not found» settles nothing until the transaction can no longer land.
  const notLanded =
    lostToken !== null &&
    settling.isError &&
    isNotFound(settling.error) &&
    failure?.lostAt !== undefined &&
    now - failure.lostAt > LANDING_WINDOW_MS
  const busy = phase === 'prepare' || phase === 'sign' || phase === 'send'
  /* Micro and the demo market: a first buy always goes under a lock long enough — only those schedules, and the lock on. */
  const lockMinDays = preset?.creatorLockMinDays ?? null
  const locks = presets?.locks
  const lockChoices = useMemo(
    () => (lockMinDays === null ? (locks ?? []) : (locks ?? []).filter((entry) => entry.cliffDays >= lockMinDays)),
    [locks, lockMinDays],
  )
  const lockId =
    lockMinDays !== null && !lockChoices.some((entry) => entry.id === chosenLock)
      ? (lockChoices[0]?.id ?? null)
      : chosenLock
  /*
   * 1.71.0: there the buy and its lock are one v1 transaction — only a wallet that signs v1 makes it. A deployment
   * before 1.71.0 refuses the field and builds the two transactions as before; the phone follows what it names.
   */
  const lockedBuy = buying && lockMinDays !== null
  const serverV1 = contractAtLeast(capabilities.data?.api.contractVersion, LAUNCH_V1_CONTRACT)
  const needsV1 = lockedBuy && serverV1
  // A preset that locks every first buy, with no schedule long enough offered: the server would refuse it.
  const lockMissing = lockedBuy && lockChoices.length === 0
  const signsV1 = useSignsV1()
  const v1Blocked = needsV1 && signsV1 === false
  const lock = buying ? (lockChoices.find((entry) => entry.id === lockId) ?? null) : null
  const valid =
    Object.keys(check.problems).length === 0 && picture !== null && buyRaw !== null && !aboveCap && !v1Blocked && !lockMissing
  const terms = `${preset?.id ?? ''}:${buyRaw ?? ''}:${buying ? (lockId ?? '') : ''}`

  const setField = (key: keyof LaunchFormFields, value: string) =>
    setFields((current) => ({ ...current, [key]: key === 'symbol' ? value.toUpperCase().replace(/^\$/, '') : value }))

  const fail = (next: LaunchFailure, token: string | null) => {
    feel(next.code === 'WALLET_REFUSED' ? 'declined' : 'failed')
    setFailure({ failure: next, token, lostAt: lostAfterSend(next) ? Date.now() : undefined })
    setPhase('error')
  }

  const launch = async () => {
    setAttempted(true)
    if (!valid || !preset || paused || running.current || (lostToken !== null && !notLanded)) return
    if (!account.address) {
      void account.connect()
      return
    }
    running.current = true
    setFailure(null)
    setCost(null)
    try {
      /* The deployment's version read fresh (it may have moved since the form opened), then the wallet asked once,
         before anything is stored: a wallet that cannot sign v1 never reaches the build. */
      const v1Server = lockedBuy
        ? contractAtLeast((await capabilities.refetch()).data?.api.contractVersion, LAUNCH_V1_CONTRACT)
        : false
      let v1 = v1Server ? signsV1Known() : null
      if (v1Server && v1 === null) {
        setPhase('prepare')
        try {
          v1 = await wallet.readSignsV1()
        } catch (error) {
          // The person's cancel and no wallet are said as such; any other failure is the question unanswered, not a signature.
          const said = walletFailure(error)
          const code = said.code === 'WALLET_REFUSED' || said.code === 'WALLET_NOT_FOUND' ? said.code : 'LAUNCH_WALLET_UNREAD'
          fail({ step: 'before', code, detail: said.detail }, null)
          return
        }
      }
      // Said once, on the form under the first buy, with the way on: launch without it.
      if (v1Server && !v1) {
        feel('failed')
        setPhase('form')
        return
      }
      const outcome = await launchToken({
        api: createApi,
        wallet: { signTransactions: wallet.signTransactions },
        creator: account.address,
        preset: preset.id,
        fields: {
          name: fields.name,
          symbol: fields.symbol,
          description: fields.description,
          website: fields.website,
          x: fields.x,
          telegram: fields.telegram,
        },
        imageBase64: picture?.base64 ?? '',
        firstBuyRaw: buyRaw ?? 0n,
        lock: buying ? lockId : null,
        ...(v1Server ? { format: 'v1' as const } : {}),
        onStep: (step) => {
          if (step === 'sign') feel('review')
          if (step === 'send') feel('sent')
          setPhase(step)
        },
        onBuilt: (built) => {
          setCost({ lamports: built.creatorCostLamports, terms })
          setTransactions(built.transactions)
        },
      })
      if (outcome.ok) {
        feel('done')
        setResult(outcome)
        setPhase('done')
        void queryClient.invalidateQueries({ queryKey: ['launch', 'cabinet'] })
      } else if (outcome.failure.code === 'LAUNCH_WALLET_V1_REQUIRED') {
        /* The phone sends v1 whenever the wallet said it signs it, so this refusal never means the wallet: the
           deployment's version was not read, or moved after it. Nothing was sent; the next press reads it again. */
        fail({ ...outcome.failure, code: 'LAUNCH_V1_AGAIN' }, outcome.token)
      } else {
        fail(outcome.failure, outcome.token)
        // The stop closed between the quote and the build: the quote reads it too, and says it on the form.
        if (isPaused(outcome.failure.code)) void quote.refetch()
        // A lost answer may hide a landed launch: the cabinet reads again.
        if (outcome.token) void queryClient.invalidateQueries({ queryKey: ['launch', 'cabinet'] })
      }
    } finally {
      running.current = false
    }
  }

  const reset = () => {
    setFields(EMPTY_FORM)
    setPicture(null)
    setPictureBad(false)
    setBuyText('')
    setLockId(null)
    setAttempted(false)
    setResult(null)
    setFailure(null)
    setCost(null)
    setPhase('form')
  }

  return {
    account,
    fields,
    setField,
    check,
    picture,
    setPicture: (next: Picture | null) => {
      setPicture(next)
      setPictureBad(false)
    },
    pictureBad,
    setPictureBad,
    preset,
    /* A lock the preset required was never the creator's choice: leaving that preset leaves it behind. */
    setPresetId: (id: LaunchPresetId) => {
      if (lockMinDays !== null) setLockId(null)
      choosePreset(id)
    },
    buyText,
    setBuyText,
    buyRaw,
    buying,
    quoteData,
    quoteLoading: quote.isFetching,
    aboveCap,
    lockId,
    setLockId,
    lock,
    lockChoices,
    lockMinDays,
    v1Blocked,
    lockMissing,
    attempted,
    phase,
    busy,
    failure,
    result,
    cost: cost && cost.terms === terms ? cost.lamports : null,
    transactions,
    lostToken,
    landed,
    landedToken: landed ? (settling.data ?? null) : null,
    notLanded,
    paused,
    valid,
    launch,
    reset,
    dismissFailure: () => {
      setFailure(null)
      setPhase('form')
    },
  }
}

export type LaunchCreate = ReturnType<typeof useLaunchCreate>
