'use client';

import { create } from 'zustand';
import { walletActions } from 'viem';
import { mainnet } from 'viem/chains';
import { createConfig, createStorage, http, injected, noopStorage, type Config } from 'wagmi';
import { connect, disconnect, getConnection, getConnectorClient, getConnectors, reconnect, watchConnection, watchConnectors } from 'wagmi/actions';

/**
 * The EVM wallet of the Bridge page: «Підключатися кошельок ЄВМ». wagmi finds every wallet the browser
 * carries by itself (EIP-6963: MetaMask, Rabby, Phantom, Coinbase Wallet, OKX…), remembers the one the person chose and
 * takes it back without a prompt on the next visit. The page asks nothing of the wallet but its address until a
 * transfer is signed; switching the wallet to the sending network is the Relay SDK's step (`bridge-run.ts`), which adds
 * the network to a wallet that lacks it.
 *
 * Nothing here reads a network: the page may talk only to its own site, and everything the wallet is asked goes through
 * the wallet itself.
 */

/** `generic`: the wallet that owns `window.ethereum` without naming itself — named on screen in the page's language. */
export type EvmWallet = Readonly<{ id: string; name: string; icon: string | null; generic: boolean }>;

type EvmState = Readonly<{
  started: boolean;
  wallets: readonly EvmWallet[];
  address: string | null;
  walletName: string | null;
  connecting: string | null;
  error: string | null;
}>;

export const useEvm = create<EvmState>(() => ({ started: false, wallets: [], address: null, walletName: null, connecting: null, error: null }));

let config: Config | null = null;

/** A data-URI icon only: the site's policy loads no image from a wallet's host. */
const iconOf = (icon: unknown) => (typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null);

function walletsOf(cfg: Config): EvmWallet[] {
  const seen = new Set<string>();
  const list: EvmWallet[] = [];
  for (const connector of getConnectors(cfg)) {
    // The bare «injected» connector stands for whichever wallet owns `window.ethereum`; the announced ones name themselves.
    if (connector.id === 'injected' && getConnectors(cfg).some((other) => other.type === 'injected' && other.id !== 'injected')) continue;
    if (seen.has(connector.name)) continue;
    seen.add(connector.name);
    list.push({ id: connector.uid, name: connector.name, icon: iconOf(connector.icon), generic: connector.id === 'injected' });
  }
  return list;
}

/** Starts once, in the browser: finds the wallets, follows the connection, takes back the last one quietly. */
export function startEvm(): void {
  if (config || typeof window === 'undefined') return;
  // A browser that keeps nothing (blocked site data, a private window) still connects; it just asks again next visit.
  let storage: Storage | typeof noopStorage = noopStorage;
  try {
    window.localStorage.getItem('ryntra.bridge.evm.probe');
    storage = window.localStorage;
  } catch {
    storage = noopStorage;
  }
  config = createConfig({
    chains: [mainnet],
    connectors: [injected({ shimDisconnect: true })],
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage, key: 'ryntra.bridge.evm' }),
    transports: { [mainnet.id]: http() },
    // Made in the browser only, without wagmi's React provider: the wallets already announced are taken at once.
    ssr: false,
  });
  const cfg = config;
  const follow = () => {
    const connection = getConnection(cfg);
    useEvm.setState({ address: connection.address ?? null, walletName: connection.connector?.name ?? null });
  };
  watchConnectors(cfg, { onChange: () => useEvm.setState({ wallets: walletsOf(cfg) }) });
  watchConnection(cfg, { onChange: follow });
  useEvm.setState({ started: true, wallets: walletsOf(cfg) });
  void reconnect(cfg).then(follow, () => undefined);
}

export async function connectEvm(walletId: string): Promise<boolean> {
  startEvm();
  const cfg = config;
  if (!cfg) return false;
  const connector = getConnectors(cfg).find((entry) => entry.uid === walletId);
  if (!connector) return false;
  useEvm.setState({ connecting: walletId, error: null });
  try {
    // A wallet that never answers does not hold the list shut.
    const result = await Promise.race([connect(cfg, { connector }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 90_000))]);
    useEvm.setState({ address: result.accounts[0] ?? null, walletName: connector.name, connecting: null });
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    // An already-open connection is still a connection.
    if (/already connected/i.test(text)) {
      useEvm.setState({ connecting: null });
      return true;
    }
    useEvm.setState({ connecting: null, error: /reject|denied|cancel/i.test(text) ? 'rejected' : 'failed' });
    return false;
  }
}

export async function disconnectEvm(): Promise<void> {
  if (!config) return;
  await disconnect(config).catch(() => undefined);
  useEvm.setState({ address: null, walletName: null });
}

/**
 * The connected wallet as a viem wallet client — what the Relay SDK signs with. Whatever network the wallet stands on is
 * taken as it is: the SDK turns it to the sending network itself.
 */
export async function evmClient() {
  if (!config) throw new Error('No EVM wallet is connected.');
  const client = await getConnectorClient(config, { assertChainId: false });
  return client.extend(walletActions);
}
