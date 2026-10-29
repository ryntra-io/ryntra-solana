import { useEffect, useState } from 'react'
import { Linking } from 'react-native'

import { useWallet } from '@/features/wallet/use-wallet'
import { CLIENT_IDENTITY } from '@/lib/client-identity'

import type { BridgeWallet } from './bridge'
import { createCityHost, type CityHost, type HostWallet } from './city-host'
import { shareCityFile } from './share-file'

/** The wallet's name when the account carries no label of its own. */
const WALLET_NAME = 'Solana wallet'

const bridgeWalletOf = (address: string | null, label: string | null): BridgeWallet | null =>
  address ? { address, name: label || WALLET_NAME } : null

/** The app's wallet as the host uses it: the hook's own requests, each opening the wallet's window. */
function hostWalletOf(wallet: ReturnType<typeof useWallet>): HostWallet {
  return {
    current: () => bridgeWalletOf(wallet.address, wallet.label),
    connect: async () => {
      const account = await wallet.connectAccount()
      return { address: account.address, name: account.label || WALLET_NAME }
    },
    disconnect: async () => {
      await wallet.disconnect()
    },
    signMessage: (message) => wallet.signMessage(message),
    signTransactions: (transactions) => wallet.signTransactions(transactions),
  }
}

/** Before the first render's wallet is handed in: none held, nothing asked. */
const NO_WALLET: HostWallet = {
  current: () => null,
  connect: () => Promise.reject(new Error('The wallet is not ready.')),
  disconnect: () => Promise.resolve(),
  signMessage: () => Promise.reject(new Error('The wallet is not ready.')),
  signTransactions: () => Promise.reject(new Error('The wallet is not ready.')),
}

/**
 * The city's bridge under the app (CITY-6c): `createCityHost` on the app's own wallet (`useWallet`, Mobile Wallet
 * Adapter), Android's share sheet and the system's browser. `post` is the WebView's `postMessage`, stable for the
 * screen's life. The host lives as long as the screen and is handed the wallet of each render, never one a render
 * closed over; the page hears `wallet.changed` whenever the app's wallet changes, wherever the change was made.
 */
export function useCityHost(post: (text: string) => void): CityHost {
  const wallet = useWallet()
  const [host] = useState(() =>
    createCityHost({
      version: CLIENT_IDENTITY.appVersion,
      wallet: NO_WALLET,
      share: shareCityFile,
      openExternal: (url) => Linking.openURL(url),
      post,
    }),
  )
  useEffect(() => {
    host.setWallet(hostWalletOf(wallet))
  })
  const { address, label } = wallet
  useEffect(() => {
    host.walletChanged(bridgeWalletOf(address, label))
  }, [host, address, label])
  useEffect(() => () => host.detach(), [host])
  return host
}
