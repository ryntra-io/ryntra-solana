import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createSolanaMainnet, MobileWalletProvider, type AppIdentity } from '@wallet-ui/react-native-kit'
import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { KeepConnectedBinder } from '@/features/session/keep-connected-binder'
import { SessionBinder } from '@/features/session/session-binder'
import { WidgetBinder } from '@/features/widget/widget-binder'
import { keepQueries, restoreKeptQueries } from '@/lib/query-keep'

/** What the wallet shows the person when Ryntra asks to connect. */
const identity: AppIdentity = { name: 'Ryntra', uri: 'https://ryntra.io', icon: 'favicon.ico' }

/**
 * Mainnet, always. The app has no RPC traffic of its own — every figure comes
 * from the Ryntra API — but Mobile Wallet Adapter authorizes against a chain,
 * and that chain is the one the product runs on.
 */
const cluster = createSolanaMainnet({ label: 'Mainnet', url: 'https://api.mainnet-beta.solana.com' })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// The last answers kept on the device come back before the first screen, and what changes is kept again (M9).
restoreKeptQueries(queryClient)
keepQueries(queryClient)

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <MobileWalletProvider cluster={cluster} identity={identity}>
            <SessionBinder />
            <KeepConnectedBinder />
            <WidgetBinder />
            {children}
          </MobileWalletProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
