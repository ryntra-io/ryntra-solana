import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { clearDeviceRecord } from '@/features/notifications/device-store'
import { revokeThisDevice } from '@/features/notifications/revoke'
import { useWallet } from '@/features/wallet/use-wallet'
import { clearWalletList } from '@/features/watchlist/watchlist'
import { useNow } from '@/hooks/use-now'
import { sessionApi } from './session-api'
import { signInWithWallet, signOut as endSession, type SignInFailure } from './session-client'
import { sessionFor } from './session-model'
import { clearSession, saveSession, useSession } from './session-store'

/** Every private query is keyed under this prefix so a sign-out can drop them all at once. */
export const PRIVATE_QUERY_KEY = 'private'

/**
 * The account as the screens see it: the connected wallet, the verified
 * session for exactly that wallet, and the actions between them. Connect
 * shares an address; sign-in proves it to the server; sign-out, switch and
 * disconnect end the session and drop every private cache before the
 * wallet changes hands.
 */
export function useAccount() {
  const wallet = useWallet()
  const { session: stored, ready } = useSession()
  const queryClient = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const [signInFailure, setSignInFailure] = useState<SignInFailure | null>(null)
  const api = sessionApi
  const now = useNow(30_000)
  const session = sessionFor(stored, wallet.address, now)

  const forget = useCallback(
    async (address: string | null) => {
      await clearSession()
      if (address) {
        clearWalletList(address)
        clearDeviceRecord(address)
      }
      queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_KEY] })
    },
    [queryClient],
  )

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!wallet.address) return false
    const address = wallet.address
    setSigningIn(true)
    setSignInFailure(null)
    try {
      const outcome = await signInWithWallet({
        wallet: {
          address,
          signIn: (payload) => wallet.signIn(payload),
          signMessage: (message) => wallet.signMessage(message),
        },
        api,
        save: saveSession,
      })
      if (!outcome.ok) setSignInFailure(outcome.failure)
      return outcome.ok
    } finally {
      setSigningIn(false)
    }
  }, [api, wallet])

  const signOut = useCallback(async () => {
    const address = stored?.address ?? wallet.address
    // This phone leaves the wallet's device registry while the bearer still stands; then the session ends.
    await revokeThisDevice(stored)
    await endSession({ session: stored, api, clear: () => forget(address) })
  }, [api, forget, stored, wallet.address])

  const disconnect = useCallback(async () => {
    await signOut()
    return wallet.disconnect()
  }, [signOut, wallet])

  const switchWallet = useCallback(async () => {
    await signOut()
    return wallet.switchWallet()
  }, [signOut, wallet])

  return {
    ready,
    address: wallet.address,
    label: wallet.label,
    session,
    busy: wallet.busy,
    signingIn,
    failure: wallet.failure,
    signInFailure,
    clearFailures: () => {
      wallet.clearFailure()
      setSignInFailure(null)
    },
    connect: wallet.connect,
    disconnect,
    switchWallet,
    signIn,
    signOut,
  }
}
