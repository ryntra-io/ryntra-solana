import type { ReactNode } from 'react'

import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { useAccount } from '@/features/session/use-account'
import { useSharedCopy } from '@/lib/i18n'

export type WalletGateProps = {
  /** What the wallet unlocks here: "Your portfolio", "Trading". */
  what: string
  children: ReactNode
}

/**
 * Screens that read public figures by address follow the connected wallet.
 * Without one the surface is a composed state with the single action that
 * ends it — connecting the person's own wallet through Mobile Wallet Adapter.
 */
export function WalletGate({ what, children }: WalletGateProps) {
  const account = useAccount()
  const copy = useSharedCopy()
  if (account.address) return <>{children}</>
  return (
    <StateView
      icon="wallet-outline"
      title={copy.connectTitle}
      detail={copy.connectDetail(what)}
      action={{ title: copy.connectWallet, onPress: () => void account.connect(), loading: account.busy === 'connect' }}
    >
      {account.failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {account.failure.message}
        </Txt>
      ) : null}
    </StateView>
  )
}

/**
 * Private data — the wallet's own records on the server — opens only to a
 * verified session, never to an address alone. Until the wallet has signed
 * the server's message the surface says so, with the one action that ends it.
 */
export function SessionGate({ what, children }: WalletGateProps) {
  const account = useAccount()
  const copy = useSharedCopy()
  if (account.session) return <>{children}</>
  if (!account.address) return <WalletGate what={what}>{children}</WalletGate>
  return (
    <StateView
      icon="key-outline"
      title={copy.signInTitle}
      detail={copy.signInDetail(what)}
      action={{ title: copy.signIn, onPress: () => void account.signIn(), loading: account.signingIn }}
    >
      {account.signInFailure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {account.signInFailure.message}
        </Txt>
      ) : null}
    </StateView>
  )
}
