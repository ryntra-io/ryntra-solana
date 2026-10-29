import { getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder } from '@solana/kit'
import {
  MobileWalletProviderContext,
  transact,
  useAuthorization,
  useMobileWallet,
  type KitMobileWallet,
} from '@wallet-ui/react-native-kit'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Linking } from 'react-native'

import { startKeepClock } from '@/features/session/keep-store'
import { walletDeclined, walletErrorKind } from '@/features/session/session-client'

import { createLiveToken } from './live-token'
import { inWallet } from './wallet-away'
import { forgetSignsV1, rememberSignsV1, signsV1Of } from './wallet-versions'

/** The association intent every Mobile Wallet Adapter wallet answers; the app's manifest may query it. */
const WALLET_INTENT = 'solana-wallet://v1/associate/local'

/**
 * Whether a wallet that speaks the protocol is installed. Asked before an
 * association is started, because the adapter reports a missing wallet as a
 * closed session on Android, which would read as the person cancelling.
 */
export async function walletInstalled(): Promise<boolean> {
  try {
    return await Linking.canOpenURL(WALLET_INTENT)
  } catch {
    return true
  }
}

class NoWalletError extends Error {
  readonly code = 'ERROR_WALLET_NOT_FOUND'
  constructor() {
    super('Found no installed wallet that supports the mobile wallet protocol.')
    this.name = 'NoWalletError'
  }
}

export type WalletFailure = { kind: 'cancelled' | 'no-wallet' | 'failed'; message: string }

/** A wallet error into the one line a screen says. */
export function describeWalletError(error: unknown): WalletFailure {
  const kind = walletErrorKind(error)
  if (kind === 'cancelled') {
    return {
      kind,
      message: walletDeclined(error) ? 'The wallet declined the request.' : 'The wallet closed before it finished.',
    }
  }
  if (kind === 'no-wallet') return { kind, message: 'No Solana wallet is installed on this device.' }
  return { kind: 'failed', message: 'The wallet did not complete the request.' }
}

export type WalletAction = 'connect' | 'disconnect' | 'switch'

/** Between the revoke's wallet session and the fresh authorization's — the wallet needs the gap. */
const SWITCH_PAUSE_MS = 900

/** One for the app: every screen's wallet requests share the token they hold. */
const liveToken = createLiveToken()

/** The token the phone holds this moment — never the one a callback closed over renders ago. */
type HeldToken = () => string | undefined

/**
 * A session's wallet whose `authorize` carries the token the phone holds now — whatever token the kit's callback
 * closed over — and keeps to a live one (`live-token.ts`); every other method as it is. Holding none (never
 * connected, forgotten, switched), the request goes without. The kit's own «ask without the token» would get the held
 * token back from here; it never runs only because every refusal leaves `live-token.ts` untyped.
 */
function withLiveToken(wallet: KitMobileWallet, heldToken: HeldToken): KitMobileWallet {
  return new Proxy(wallet, {
    get(target, property, receiver) {
      if (property !== 'authorize') return Reflect.get(target, property, receiver)
      const authorize = target.authorize.bind(target) as (params: { auth_token?: string }) => Promise<unknown>
      return (params: { auth_token?: string }) => {
        const { auth_token: _closed, ...rest } = params
        const held = heldToken()
        return liveToken.authorize(authorize, held ? { ...rest, auth_token: held } : rest)
      }
    },
  })
}

/** One wallet session — opened, authorized with the held token or afresh, used and closed — counted while it is out. */
function inSession<T>(heldToken: HeldToken, work: (wallet: KitMobileWallet) => Promise<T>): Promise<T> {
  // The kit types the callback's own promise as the session's result; the session resolves with what it resolves to.
  return inWallet(() => transact((wallet) => work(withLiveToken(wallet, heldToken))) as unknown as Promise<T>)
}

/** A fresh authorization may come back with another account; nothing is signed for it in place of the one asked. */
const OTHER_ACCOUNT = 'The wallet answered with another account — nothing was signed.'

/**
 * The wallet is the account. This hook is the app's one view of it: the
 * connected address, connect, disconnect and switch through Mobile Wallet
 * Adapter, and the last failure said in one plain line.
 *
 * Connecting shares an address and authorizes this app in the wallet — it
 * proves nothing to the server; the session (`features/session`) does that
 * with a signature. The wallet's own auth token stays in the adapter's cache
 * and never reaches the API. Disconnecting revokes that token in the wallet
 * when the wallet can be reached, and forgets it on the device either way.
 */
export function useWallet() {
  const wallet = useMobileWallet()
  // The kit's own requests skip the live token, so the app opens its sessions itself and authorizes through the kit.
  const provider = useContext(MobileWalletProviderContext)
  const { authorizeSession, authorizeSessionWithSignIn } = useAuthorization(provider)
  const { store } = provider
  const heldToken = useCallback(() => store.$authToken.get(), [store])
  const address = wallet.account ? String(wallet.account.address) : null
  /** Authorized in this session as the account the request was made for, or nothing is signed. */
  const authorizeAs = useCallback(
    async (session: KitMobileWallet, expected: string | null) => {
      const account = await authorizeSession(session)
      if (expected !== null && String(account.address) !== expected) throw new Error(OTHER_ACCOUNT)
      return account
    },
    [authorizeSession],
  )
  const [busy, setBusy] = useState<WalletAction | null>(null)
  const [failure, setFailure] = useState<WalletFailure | null>(null)

  const run = useCallback(async (action: WalletAction, work: () => Promise<void>): Promise<boolean> => {
    setBusy(action)
    setFailure(null)
    try {
      await work()
      return true
    } catch (error) {
      setFailure(describeWalletError(error))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  /**
   * The chosen time starts with the connection — set before the account
   * arrives, so the old end never meets it; a connect cancelled or failed in
   * the wallet puts the time before it back.
   */
  const connectWithClock = useCallback(async () => {
    const undo = startKeepClock()
    try {
      return await inSession(heldToken, (session) => authorizeSession(session))
    } catch (error) {
      undo()
      throw error
    }
  }, [authorizeSession, heldToken])

  const connect = useCallback(
    () =>
      run('connect', async () => {
        if (!(await walletInstalled())) throw new NoWalletError()
        await connectWithClock()
      }),
    [run, connectWithClock],
  )

  /**
   * Connect as `connect` does, for a caller that answers someone else — the city's page (CITY-6c): the account the
   * wallet chose comes back, and a cancel or a failure is thrown as the wallet said it, not kept as the hook's line.
   */
  const connectAccount = useCallback(async (): Promise<Readonly<{ address: string; label: string | null }>> => {
    if (!(await walletInstalled())) throw new NoWalletError()
    const account = await connectWithClock()
    return { address: String(account.address), label: account.label ?? null }
  }, [connectWithClock])

  /**
   * Revoke the authorization in the wallet itself, so its list of connected
   * apps is true and the token is dead, then forget it on the device. No
   * wallet reachable, the token already dead, or the person closing the
   * wallet: the device forgets the authorization regardless.
   */
  const revokeAndForget = useCallback(async () => {
    try {
      await inWallet(() =>
        wallet.connectAnd(async (api) => {
          // `transact` hands the whole wallet; the adapter types the callback's parameter narrowly.
          await wallet.deauthorizeSession(api as unknown as Parameters<typeof wallet.deauthorizeSession>[0])
        }),
      )
    } catch {
      // See above.
    } finally {
      liveToken.reset()
      forgetSignsV1()
      await wallet.disconnect()
    }
  }, [wallet])

  const disconnect = useCallback(() => run('disconnect', revokeAndForget), [run, revokeAndForget])

  /**
   * Forget the authorization on this phone without opening the wallet — the
   * end of the time the person chose (ST-2) happens on its own, so no wallet
   * sheet is raised for it; the wallet's own list of apps keeps Ryntra until
   * the person removes it there or connects again.
   */
  const forget = useCallback(() => {
    liveToken.reset()
    forgetSignsV1()
    return wallet.disconnect()
  }, [wallet])

  /**
   * Let the person pick another wallet or account in the wallet's own sheet:
   * the current token is revoked and forgotten first, and the fresh
   * authorization is asked for once the phone holds no token — every
   * session reads the token held at that moment — so the wallet has to ask,
   * never re-authorizing the same account silently.
   */
  const switching = useRef(false)
  const switchWallet = useCallback(
    () =>
      run('switch', async () => {
        // Raised before the revoke: the render that follows the forget is the one that must connect.
        switching.current = true
        await revokeAndForget()
      }),
    [run, revokeAndForget],
  )
  /**
   * The wallet signs exact transaction bytes and hands them back signed — it
   * never sends. Base64 wire in, base64 wire out; the kit carries the bytes
   * as its own transaction value between the two.
   */
  const signTransaction = useCallback(
    async (unsignedWireBase64: string): Promise<string> => {
      const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(unsignedWireBase64))
      const [signed] = await inSession(heldToken, async (session) => {
        await authorizeAs(session, address)
        return session.signTransactions({ transactions: [unsigned] })
      })
      if (!signed) throw new Error('The wallet did not complete the request.')
      return getBase64Decoder().decode(getTransactionEncoder().encode(signed))
    },
    [authorizeAs, address, heldToken],
  )
  /**
   * Several exact transactions signed in one wallet prompt — a launch with its
   * lock, a claim in two parts — handed back in the order given, never sent.
   */
  const signTransactions = useCallback(
    async (unsignedWireBase64: readonly string[]): Promise<string[]> => {
      const unsigned = unsignedWireBase64.map((wire) => getTransactionDecoder().decode(getBase64Encoder().encode(wire)))
      const signed = await inSession(heldToken, async (session) => {
        await authorizeAs(session, address)
        return session.signTransactions({ transactions: unsigned })
      })
      return signed.map((transaction) => getBase64Decoder().decode(getTransactionEncoder().encode(transaction)))
    },
    [authorizeAs, address, heldToken],
  )

  /**
   * Whether this wallet signs v1 transactions, asked of the wallet itself in a
   * short session of its own, authorized as the connected account first — so
   * the answer is that wallet's, not another one the phone routed to — and
   * kept. Nothing is signed.
   */
  const readSignsV1 = useCallback(async (): Promise<boolean> => {
    const capabilities = await inSession(heldToken, async (session) => {
      await authorizeAs(session, address)
      return session.getCapabilities()
    })
    const signsV1 = signsV1Of(capabilities)
    rememberSignsV1(signsV1)
    return signsV1
  }, [authorizeAs, address, heldToken])

  const signIn = useCallback(
    (payload: Parameters<typeof authorizeSessionWithSignIn>[1]) =>
      inSession(heldToken, (session) => authorizeSessionWithSignIn(session, payload)),
    [authorizeSessionWithSignIn, heldToken],
  )
  const signMessage = useCallback(
    (message: Uint8Array): Promise<Uint8Array> =>
      inSession(heldToken, async (session) => {
        const account = await authorizeAs(session, address)
        const [signed] = await session.signMessages({ addresses: [account.addressBase64], payloads: [message] })
        if (!signed) throw new Error('The wallet did not complete the request.')
        return signed
      }),
    [authorizeAs, address, heldToken],
  )

  useEffect(() => {
    if (!switching.current || wallet.account) return
    switching.current = false
    // The wallet is still closing the revoke's session; a new association right behind it is refused.
    const timer = setTimeout(() => {
      void run('switch', async () => {
        if (!(await walletInstalled())) throw new NoWalletError()
        await connectWithClock()
      })
    }, SWITCH_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [wallet, run, connectWithClock])

  return {
    address,
    label: wallet.account?.label ?? null,
    accounts: wallet.accounts?.map((account) => String(account.address)) ?? [],
    /** Which action is running, or null. */
    busy,
    failure,
    clearFailure: () => setFailure(null),
    connect,
    /** Connect and hand back the account, or throw — for the city's bridge. */
    connectAccount,
    disconnect,
    forget,
    switchWallet,
    /** `solana:signIn` and plain message signing, for the session flow only. */
    signIn,
    signMessage,
    /** Exact reviewed bytes signed in the wallet, for the trade flow only; the server submits. */
    signTransaction,
    /** Several exact transactions in one prompt, for Launch; the server sends them. */
    signTransactions,
    /** Whether the wallet signs v1 — asked of it once, for Launch's first purchase on Micro. */
    readSignsV1,
  }
}
