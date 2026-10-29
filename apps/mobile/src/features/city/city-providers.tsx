import { createSolanaMainnet, MobileWalletProvider, type AppIdentity } from '@wallet-ui/react-native-kit'
import type { ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

/**
 * What the wallet shows when Ryntra asks to connect — word for word the identity every earlier version used, so a
 * wallet that already trusts Ryntra keeps trusting it after the update.
 */
const identity: AppIdentity = { name: 'Ryntra', uri: 'https://ryntra.io', icon: 'favicon.ico' }

/** Mainnet, always: Mobile Wallet Adapter authorizes against the chain the product runs on. */
const cluster = createSolanaMainnet({ label: 'Mainnet', url: 'https://api.mainnet-beta.solana.com' })

/**
 * Everything the city needs under it (decision 75): the safe area and the wallet. The city signs in, trades and keeps
 * its own state on the page; the app holds only the wallet the page asks over the bridge.
 */
export function CityProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <MobileWalletProvider cluster={cluster} identity={identity}>
        {children}
      </MobileWalletProvider>
    </SafeAreaProvider>
  )
}
