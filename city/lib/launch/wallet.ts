import { citySigner } from '../app-bridge/route.ts';
import { startWallets, useWallet } from '../trade/wallet.ts';
import type { Network } from './engine.ts';
import type { Signer } from './flow.ts';

/**
 * The creator's wallet in the city: the city's one wallet (`../trade/wallet.ts` — Wallet Standard: Phantom, Solflare,
 * Backpack, Seeker), so a wallet connected to buy is the wallet that launches, and the other way round. It is asked to
 * sign only, never to send. Ryntra holds no key: the wallet returns signed bytes and the engine checks them against what
 * it built. In the Ryntra app the app's wallet signs, through the bridge (`../app-bridge/route.ts`).
 */

export type WalletOption = Readonly<{ name: string; icon: string | null }>;
export type Connection = Readonly<{ wallet: string; address: string }>;
export type ConnectAnswer = Readonly<{ ok: true; connection: Connection }> | Readonly<{ ok: false; reason: string; quiet: boolean }>;

export interface CityWallet {
  /** The wallets this browser offers, best first. */
  options(): readonly WalletOption[];
  /** Be told when the list or the connection changes: a wallet extension may register after the page. */
  subscribe(listener: () => void): () => void;
  connect(name: string): Promise<ConnectAnswer>;
  /** The wallet this site was already granted, brought back without a prompt; null when there is none. */
  restore(): Promise<Connection | null>;
  signer(connection: Connection): Signer;
}

/** How long a silent restore may take before the sheet offers to connect. */
const RESTORE_WAIT_MS = 2_000;

const connected = (): Connection | null => {
  const connection = useWallet.getState().connection;
  return connection ? { wallet: connection.wallet, address: connection.address } : null;
};

export function browserWallet(): CityWallet {
  startWallets();
  return {
    options: () => useWallet.getState().wallets.map((wallet) => ({ name: wallet.name, icon: wallet.icon })),
    subscribe: (listener) => useWallet.subscribe(listener),
    connect: async (name) => {
      const ok = await useWallet.getState().connect(name);
      const connection = connected();
      if (ok && connection) return { ok: true, connection };
      const error = useWallet.getState().error;
      return { ok: false, reason: error ?? '', quiet: !error };
    },
    restore: () =>
      new Promise((resolve) => {
        const now = connected();
        if (now) return resolve(now);
        const timer = setTimeout(() => {
          off();
          resolve(connected());
        }, RESTORE_WAIT_MS);
        const off = useWallet.subscribe(() => {
          const restored = connected();
          if (!restored) return;
          clearTimeout(timer);
          off();
          resolve(restored);
        });
      }),
    signer: (connection) => ({
      wallet: connection.wallet,
      address: connection.address,
      sign: async (wires: readonly string[], chain: Network) => {
        const answer = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wires, chain });
        return answer.ok ? { ok: true, signed: answer.signedWireBase64 } : { ok: false, reason: answer.reason };
      },
    }),
  };
}
