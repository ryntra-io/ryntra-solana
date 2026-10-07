import { getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking } from 'react-native'

import { walletDeclined, walletErrorKind } from '@/features/session/session-client'

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

  const connect = useCallback(
    () =>
      run('connect', async () => {
        if (!(await walletInstalled())) throw new NoWalletError()
        await wallet.connect()
      }),
    [run, wallet],
  )

  /**
   * Revoke the authorization in the wallet itself, so its list of connected
   * apps is true and the token is dead, then forget it on the device. No
   * wallet reachable, the token already dead, or the person closing the
   * wallet: the device forgets the authorization regardless.
   */
  const revokeAndForget = useCallback(async () => {
    try {
      await wallet.connectAnd(async (api) => {
        // `transact` hands the whole wallet; the adapter types the callback's parameter narrowly.
        await wallet.deauthorizeSession(api as unknown as Parameters<typeof wallet.deauthorizeSession>[0])
      })
    } catch {
      // See above.
    } finally {
      await wallet.disconnect()
    }
  }, [wallet])

  const disconnect = useCallback(() => run('disconnect', revokeAndForget), [run, revokeAndForget])

  /**
   * Let the person pick another wallet or account in the wallet's own sheet:
   * the current token is revoked and forgotten first, and the fresh
   * authorization is asked for on the next render — when the adapter's
   * `connect` no longer holds the old token in its closure — so the wallet
   * has to ask, never re-authorizing the same account silently.
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
      const signed = await wallet.signTransactions(unsigned)
      return getBase64Decoder().decode(getTransactionEncoder().encode(signed))
    },
    [wallet],
  )
  /**
   * Several exact transactions signed in one wallet prompt — a launch with its
   * lock, a claim in two parts — handed back in the order given, never sent.
   */
  const signTransactions = useCallback(
    async (unsignedWireBase64: readonly string[]): Promise<string[]> => {
      const unsigned = unsignedWireBase64.map((wire) => getTransactionDecoder().decode(getBase64Encoder().encode(wire)))
      const signed = await wallet.signTransactions(unsigned)
      return signed.map((transaction) => getBase64Decoder().decode(getTransactionEncoder().encode(transaction)))
    },
    [wallet],
  )

  useEffect(() => {
    if (!switching.current || wallet.account) return
    switching.current = false
    // The wallet is still closing the revoke's session; a new association right behind it is refused.
    const timer = setTimeout(() => {
      void run('switch', async () => {
        if (!(await walletInstalled())) throw new NoWalletError()
        await wallet.connect()
      })
    }, SWITCH_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [wallet, run])

  return {
    address: wallet.account ? String(wallet.account.address) : null,
    label: wallet.account?.label ?? null,
    accounts: wallet.accounts?.map((account) => String(account.address)) ?? [],
    /** Which action is running, or null. */
    busy,
    failure,
    clearFailure: () => setFailure(null),
    connect,
    disconnect,
    switchWallet,
    /** `solana:signIn` and plain message signing, for the session flow only. */
    signIn: wallet.signIn,
    signMessage: wallet.signMessages,
    /** Exact reviewed bytes signed in the wallet, for the trade flow only; the server submits. */
    signTransaction,
    /** Several exact transactions in one prompt, for Launch; the server sends them. */
    signTransactions,
  }
}
