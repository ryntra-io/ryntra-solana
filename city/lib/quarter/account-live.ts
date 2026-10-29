import { useSyncExternalStore } from 'react';
import { announceAccountChange, clearWalletAccount } from '../../../lib/account/wallet-auth.client.ts';
import { revalidateWalletFact, subscribeWalletFact, unknownWalletFact, walletFact } from '../../../lib/account/wallet-proof-store.client.ts';
import { proveWallet } from '../trade/proof.ts';
import { startWallets, useWallet } from '../trade/wallet.ts';
import { createAccountStore, readiness, useAccountOf, type AccountState, type Readiness } from './account.ts';
import { quarterStore } from './store.ts';

/**
 * The city's account, wired to what the rest of Ryntra already uses: the city's one wallet (`../trade/wallet.ts`), the
 * shared session fact every page reads, Ryntra's Sign In With Solana (`proveWallet`) and its Disconnect, which signs
 * the wallet's session out. Nothing here holds a key or a credential; the cookies stay HttpOnly.
 */
export const cityAccount = createAccountStore({
  quarter: quarterStore,
  wallet: {
    connection: () => {
      const c = useWallet.getState().connection;
      return c ? { wallet: c.wallet, address: c.address } : null;
    },
    wallets: () => useWallet.getState().wallets,
    connect: (name) => useWallet.getState().connect(name),
    error: () => useWallet.getState().error,
    disconnect: () => useWallet.getState().disconnect(),
    // Only a change of wallet or address matters here, not every balance read.
    subscribe: (listener) =>
      useWallet.subscribe((now, before) => {
        if (now.connection?.address !== before.connection?.address || now.connection?.wallet !== before.connection?.wallet) listener();
      }),
  },
  session: {
    fact: () => walletFact(),
    revalidate: () => revalidateWalletFact(),
    subscribe: subscribeWalletFact,
  },
  signIn: (connection) => proveWallet(connection, { signIn: true }),
  signOut: async () => {
    await clearWalletAccount().catch(() => undefined);
    await revalidateWalletFact({ fresh: true });
    announceAccountChange();
  },
});

/** Start following the wallet and the session, once per page; the session is read again when the tab comes back. */
export function startCityAccount(): () => void {
  startWallets();
  const stop = cityAccount.getState().start();
  const again = () => {
    if (document.visibilityState === 'visible') void revalidateWalletFact();
  };
  window.addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
  return () => {
    stop();
    window.removeEventListener('focus', again);
    document.removeEventListener('visibilitychange', again);
  };
}

export function useCityAccount<T>(pick: (state: AccountState) => T): T {
  return useAccountOf(cityAccount, pick);
}

/** Where the connected wallet stands for building: none, checking, needs a sign-in, or ready. */
export function useReadiness(): Readiness {
  const fact = useSyncExternalStore(subscribeWalletFact, walletFact, unknownWalletFact);
  const connection = useWallet((st) => st.connection);
  return readiness(fact, connection);
}
