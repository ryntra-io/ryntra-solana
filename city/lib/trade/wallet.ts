import { create } from 'zustand';
import { readWalletHoldingsUntilComplete } from '../../../lib/solana/holdings.client.ts';
import { restoreUntilAnswered } from '../../../lib/solana/wallet-restore.client.ts';
import {
  connectWallet,
  detectWallets,
  forgetWallet,
  subscribeWallets,
  watchWalletAccounts,
  type DetectedWallet,
  type WalletConnection,
} from '../../../lib/solana/wallet.client.ts';
import type { AppBridge } from '../app-bridge/client.ts';
import { APP_READY_WAIT_MS, catchExternalLinks, pageBridge } from '../app-bridge/page.ts';
import type { AppWallet } from '../app-bridge/protocol.ts';
import { appSigner } from '../app-bridge/route.ts';
import { spotIcon } from '../search/rank.ts';
import { SOL, type Balance } from './tiles.ts';

/**
 * The person's wallet in the city, through Ryntra's own wallet modules (Wallet Standard: Phantom, Solflare, Backpack,
 * Seeker). The city never asks a wallet anything because a page loaded: a wallet this site was already granted comes
 * back silently, any other connects only from a tap. Only the wallet's name is remembered — the same hint the rest of
 * Ryntra keeps, so connecting in one place connects everywhere.
 *
 * In the Ryntra app (CITY-6b, `docs/city/APP-BRIDGE.md`) the one wallet is the app's: the list holds it alone, a tap
 * connects it through the bridge, and the app says when it changes. The browser's wallets are not looked for there.
 */

/** The app's wallet in the list before the app has named it. */
export const APP_WALLET = 'Ryntra app wallet';

const HINT_KEY = 'ryntra.solana.wallet-hint.v1';

/** A held coin's name as the engine's holdings read gives it: Jupiter's catalogue first, the mint's own words after. */
export type CoinName = Readonly<{ symbol: string | null; name: string | null; verified: boolean | null; icon: string | null }>;

export type Holdings = Readonly<{
  owner: string;
  /** Native SOL the wallet can spend, the reserve for fees already kept back by the engine. */
  sol: Balance | null;
  /** Every token the wallet holds, by mint. */
  tokens: ReadonlyMap<string, Balance>;
  /** What the engine called each held token; a token it did not name is not here. */
  names?: ReadonlyMap<string, CoinName>;
  /** False when the chain answered by halves: what is missing is unknown, never zero. */
  complete: boolean;
  /** When the engine answered, ms since the epoch: a balance on screen always says how old it is. */
  at: number;
}>;

type HoldingRow = Readonly<{
  kind?: string;
  mint?: string | null;
  spendableRaw?: string;
  decimals?: number;
  symbol?: string | null;
  name?: string | null;
  catalog?: Readonly<{ symbol?: string | null; name?: string | null; isVerified?: boolean | null; isSuspicious?: boolean | null; icon?: string | null }> | null;
}>;

const word = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

/** The catalogue's name of a row when it has one — Jupiter's, which a mint cannot rewrite — else the mint's own. */
function nameOf(row: HoldingRow): CoinName | null {
  const catalog = row.catalog ?? null;
  const symbol = word(catalog?.symbol, 32) ?? word(row.symbol, 32);
  if (!symbol) return null;
  const verified = typeof catalog?.isVerified === 'boolean' ? catalog.isVerified && catalog.isSuspicious !== true : null;
  const icon = typeof row.mint === 'string' ? spotIcon(row.mint, word(catalog?.icon, 512)) : null;
  return { symbol: symbol.replace(/^\$+/, ''), name: word(catalog?.name, 128) ?? word(row.name, 128), verified, icon };
}

type WalletStore = {
  wallets: readonly DetectedWallet[];
  connection: WalletConnection | null;
  /** The wallet a tap is connecting right now. */
  connecting: string | null;
  error: string | null;
  holdings: Holdings | null;
  /** The last read of the balances: `failed` only while there is nothing older to show. */
  holdingsRead: 'none' | 'reading' | 'ready' | 'failed';
  /** Take a connection the wallet already granted, without asking it anything. */
  adopt: (connection: WalletConnection) => void;
  connect: (name: string) => Promise<boolean>;
  disconnect: () => void;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
};

function readHint(): string | null {
  try {
    const value = window.localStorage.getItem(HINT_KEY);
    return value && value.length <= 64 ? value : null;
  } catch {
    return null;
  }
}

function writeHint(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(HINT_KEY, name);
    else window.localStorage.removeItem(HINT_KEY);
  } catch {
    // Not remembering costs a tap next time, nothing more.
  }
}

/** The engine's holdings rows as balances by mint. */
export function holdingsOf(owner: string, rows: readonly HoldingRow[], complete: boolean, at = Date.now()): Holdings {
  let sol: Balance | null = null;
  const tokens = new Map<string, Balance>();
  const names = new Map<string, CoinName>();
  for (const row of rows) {
    if (typeof row.spendableRaw !== 'string' || !/^\d+$/.test(row.spendableRaw) || typeof row.decimals !== 'number') continue;
    const balance = { spendableRaw: row.spendableRaw, decimals: row.decimals };
    if (row.kind === 'NATIVE_SOL') sol = balance;
    else if (typeof row.mint === 'string' && BigInt(row.spendableRaw) > 0n) {
      tokens.set(row.mint, balance);
      const name = nameOf(row);
      if (name) names.set(row.mint, name);
    }
  }
  return { owner, sol, tokens, names, complete, at };
}

/** The towers of a wallet: every coin it holds except SOL itself, which every wallet keeps for fees. */
export function ownedMints(holdings: Holdings | null): ReadonlySet<string> {
  if (!holdings) return new Set();
  return new Set([...holdings.tokens.keys()].filter((mint) => mint !== SOL.mint));
}

let stopWatch: (() => void) | null = null;
let restoring: { stop: () => void } | null = null;
let readTicket = 0;

/** Ask again, silently, for a wallet this site was granted: after a page load, or after the wallet locked. */
function restoreSilently(): void {
  restoring?.stop();
  restoring = null;
  if (useWallet.getState().connection || !readHint()) return;
  restoring = restoreUntilAnswered(
    (connection) => {
      if (!useWallet.getState().connection) useWallet.getState().adopt(connection);
    },
    { hint: () => (useWallet.getState().connecting ? null : readHint()) },
  );
}

export const useWallet = create<WalletStore>((set, get) => ({
  wallets: [],
  connection: null,
  connecting: null,
  error: null,
  holdings: null,
  holdingsRead: 'none',
  adopt: (connection) => {
    stopWatch?.();
    restoring?.stop();
    restoring = null;
    set({ connection, error: null, holdings: null, holdingsRead: 'none' });
    get().refreshHoldings();
    // In the app, the app itself says when its wallet changes (`wallet.changed`).
    if (appSigner()) return;
    writeHint(connection.wallet);
    // A wallet that switches account brings its new address; one that locks lets go until it comes back.
    stopWatch = watchWalletAccounts(connection.wallet, (next) => {
      if (next && next.address === get().connection?.address) return;
      set({ connection: next, holdings: null, holdingsRead: 'none' });
      if (next) get().refreshHoldings();
      else restoreSilently();
    });
  },
  connect: async (name) => {
    set({ connecting: name, error: null });
    const app = appSigner();
    const result = app ? await app.connect() : await connectWallet(name);
    set({ connecting: null });
    if (result.ok) {
      get().adopt(result.connection);
      return true;
    }
    // Closing the wallet's own window is an answer, not an error.
    if (result.state !== 'CANCELLED') set({ error: result.state === 'REFUSED' ? 'The wallet said no. Nothing was shared.' : result.reason });
    return false;
  },
  disconnect: () => {
    const name = get().connection?.wallet;
    stopWatch?.();
    stopWatch = null;
    restoring?.stop();
    restoring = null;
    set({ connection: null, holdings: null, holdingsRead: 'none', error: null });
    const app = appSigner();
    if (app) return void app.disconnect();
    writeHint(null);
    if (name) void forgetWallet(name);
  },
  refreshHoldings: (delaysMs) => {
    const owner = get().connection?.address;
    if (!owner) return;
    const ticket = ++readTicket;
    const read = () => {
      if (!get().holdings) set({ holdingsRead: 'reading' });
      void readWalletHoldingsUntilComplete<HoldingRow>({
        owner,
        onRead: (answer) => {
          if (ticket !== readTicket || get().connection?.address !== owner) return;
          // A refused read keeps the older balances, with their own time; with none, the wallet is unavailable, not empty.
          if (!answer.ok) {
            if (!get().holdings) set({ holdingsRead: 'failed' });
            return;
          }
          set({ holdings: holdingsOf(owner, answer.rows, answer.tokenRead === 'COMPLETE'), holdingsRead: 'ready' });
        },
      });
    };
    read();
    // After a trade the chain is read again a little later, for an RPC that lags.
    for (const delay of delaysMs ?? []) setTimeout(() => ticket === readTicket && read(), delay);
  },
}));

let started = false;
let stopBrowser: (() => void) | null = null;
let onAppWallet = false;

function startBrowserWallets(): void {
  const list = () => useWallet.setState({ wallets: detectWallets() });
  list();
  const off = subscribeWallets(list);
  restoreSilently();
  stopBrowser = () => {
    off();
    stopWatch?.();
    stopWatch = null;
    restoring?.stop();
    restoring = null;
  };
}

/** The app's wallet is the city's: what the app says about it is what the city shows. */
function startAppWallet(app: AppBridge): void {
  if (onAppWallet) return;
  onAppWallet = true;
  // A browser wallet taken before a late `app.ready` lets go; it is not forgotten, the browser may want it again.
  stopBrowser?.();
  stopBrowser = null;
  if (useWallet.getState().connection) useWallet.setState({ connection: null, holdings: null, holdingsRead: 'none' });
  const follow = (wallet: AppWallet | null) => {
    useWallet.setState({ wallets: [{ name: wallet?.name ?? APP_WALLET, icon: null, supportsDevnet: false, hasSolanaAccount: true }] });
    const now = useWallet.getState().connection;
    if (!wallet) {
      if (now) useWallet.setState({ connection: null, holdings: null, holdingsRead: 'none' });
    } else if (now?.address !== wallet.address || now.wallet !== wallet.name) {
      useWallet.getState().adopt({ wallet: wallet.name, address: wallet.address, chains: ['solana:mainnet'] });
    }
  };
  follow(app.wallet());
  app.subscribe((event) => follow(event.wallet));
  catchExternalLinks(document, app);
}

/**
 * Find the wallets once per page. In a browser: this browser's, and one this site was already granted comes back. In
 * the app's WebView: the app's, once it said `app.ready`; a page that looks like the app but hears nothing from it in
 * time takes the browser's, and still switches if the app speaks late.
 */
export function startWallets(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const app = pageBridge();
  if (!app) return startBrowserWallets();
  if (app.ready()) return startAppWallet(app);
  const off = app.subscribe((event) => {
    if (event.type !== 'app.ready') return;
    off();
    startAppWallet(app);
  });
  void app.whenReady(APP_READY_WAIT_MS).then((ready) => {
    if (!ready && !onAppWallet) startBrowserWallets();
  });
}
