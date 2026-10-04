"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";

import type { ConnectionAdapter, ConnectionCapability, ConnectionErrorKind } from "@/app/shell/connection";
import { ConnectionControl, DEFAULT_COPY, type ConnectionCopy } from "@/app/shell/connection-control";
import { MenuRow } from "@/app/shell/menu";
import { scaleRawAmount } from "@/lib/solana/amounts";
import { explorerAddressUrl } from "@/lib/solana/explorer";
import type { ProviderHealthState } from "@/lib/solana/health";
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from "@/lib/solana/open-in-wallet";
import { useSolanaI18n } from "./i18n/provider.tsx";
import {
  connectWallet,
  detectWallets,
  reconnectWallet,
  subscribeWallets,
  watchWalletAccounts,
  type DetectedWallet,
  type WalletConnection,
  type WalletState,
} from "@/lib/solana/wallet.client";

/**
 * Solana's connection, moved out of the page that used to own it.
 *
 * This workspace was the sharpest contradiction in the migration matrix: the
 * shell rendered no account control at all, while `/app/send`
 * discovered wallets, chose one, connected it, read holdings and asked for a
 * signature. The chrome said there was no wallet; a route away, there was one
 * signing a transfer. Two truths in one product, and the shell's was the false
 * one.
 *
 * The split this fixes is the standard's, and it is a real distinction rather
 * than a tidy-up: **connection is shell-level, signing stays inside the action
 * lifecycle.** A wallet is something you are attached to across the whole
 * workspace; a signature is something you give to one exact set of bytes. The
 * Send console keeps every line of the second and reads the first from here.
 *
 * Nothing about discovery or the connect handshake changed — `wallet.client.ts`
 * still owns both, and `signTransaction` is not imported into this file at all.
 * A provider that could sign would be the same mistake in a new place.
 *
 * ## What connecting now shows
 *
 * Real mainnet balances. Before them, connecting a wallet changed a label and
 * nothing else: the control could report an address and a capability set, and
 * the first thing a person actually wants — *what do I hold* — was on no
 * surface in this workspace at all. The read is the ordinary one every other
 * Solana read uses, so it inherits the endpoint pair, the failover and the
 * health that comes with them, and the panel states which endpoint answered
 * rather than implying the configured one did.
 */

export type SolanaConnectionValue = Readonly<{
  wallets: readonly DetectedWallet[];
  connection: WalletConnection | null;
  connecting: boolean;
  error: string | null;
  /** What the failure was, so no panel has to guess that it was a refusal. */
  errorKind: ConnectionErrorKind | null;
  connect: (name?: string) => Promise<void>;
  disconnect: () => void;
}>;

/**
 * The wallet client's states, mapped to the shell's three.
 *
 * `NO_WALLET` and `UNSUPPORTED` are faults of this page's own bookkeeping — a
 * name it held that the registry no longer has, a connector missing the
 * feature it was listed for — and neither is a refusal either.
 */
function kindOf(state: WalletState): ConnectionErrorKind {
  if (state === "REFUSED") return "REFUSED";
  if (state === "PENDING") return "PENDING";
  return "FAILED";
}

/**
 * The one thing remembered between page loads: which wallet, by name.
 *
 * Not an address, not a key, not a signature — a hint, so the silent restore
 * knows who to ask. Clearing it is what "Disconnect" means, so disconnecting
 * genuinely disconnects rather than reconnecting on the next navigation.
 */
const WALLET_HINT_KEY = "ryntra.solana.wallet-hint.v1";

function readWalletHint(): string | null {
  try {
    const value = window.localStorage.getItem(WALLET_HINT_KEY);
    return value && value.length > 0 && value.length <= 64 ? value : null;
  } catch {
    /* A browser with site data blocked simply has no hint. */
    return null;
  }
}

function writeWalletHint(name: string | null): void {
  try {
    if (name === null) window.localStorage.removeItem(WALLET_HINT_KEY);
    else window.localStorage.setItem(WALLET_HINT_KEY, name);
  } catch {
    /* Not remembering is a worse session, never a broken one. */
  }
}

const SolanaConnectionContext = createContext<SolanaConnectionValue | null>(null);

export function useSolanaConnection(): SolanaConnectionValue {
  const value = useContext(SolanaConnectionContext);
  if (!value) {
    throw new Error("useSolanaConnection must be used inside SolanaConnectionProvider.");
  }
  return value;
}

export function SolanaConnectionProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<readonly DetectedWallet[]>([]);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ConnectionErrorKind | null>(null);

  /* Detection only, and only after mount. Registering wallets is not connecting
     to them, and there is no auto-connect anywhere in this workspace: a wallet
     prompt that appears because a page loaded is a permission request nobody
     asked for.

     It also stays subscribed, which is a fix rather than a flourish: this read
     the registry exactly once, so a wallet that injected itself a moment after
     this component mounted registered correctly into a list nobody looked at
     again. The panel then said "No Solana wallet detected" over a wallet
     sitting in the toolbar, and a reload cured it — which reads to the person
     as their problem. */
  useEffect(() => {
    setWallets(detectWallets());
    return subscribeWallets(() => setWallets(detectWallets()));
  }, []);

  /**
   * Restore a connection the wallet already trusts — once, and without asking.
   *
   * The no-auto-connect rule above is kept, not traded away: `reconnectWallet`
   * uses Wallet Standard's `connect({ silent: true })`, which must not prompt.
   * An origin the wallet has not been granted answers with no account and this
   * does nothing at all.
   *
   * Why it exists: this provider holds the connection in React state, and
   * `/agents/workspace` is outside it, so one trip out of this tree and back
   * used to leave holdings, history, receipts, receive, send, swap and bridge
   * disconnected — and Activity empty, because receipts are keyed by the
   * connected address. One wallet context is a property of the product, so it
   * has to survive navigation.
   *
   * Guarded by a ref rather than a dependency list because `wallets` changes
   * whenever a wallet registers late, and a restore attempt per registration is
   * a restore attempt too many.
   */
  const restored = useRef(false);
  const connectedWalletName = connection?.wallet ?? null;
  useEffect(() => {
    if (!connectedWalletName) return;
    return watchWalletAccounts(connectedWalletName, (next) => {
      setConnection(next);
      if (!next) writeWalletHint(null);
    });
  }, [connectedWalletName]);
  useEffect(() => {
    if (restored.current || connection) return;
    const hint = readWalletHint();
    if (!hint) return;
    if (!wallets.some((wallet) => wallet.name === hint)) return;
    restored.current = true;
    let live = true;
    void (async () => {
      const result = await reconnectWallet(hint);
      /* A silent refusal is not an error and is never shown: it only means the
         grant is gone, and the person is simply not connected. */
      if (live && result.ok) setConnection(result.connection);
    })();
    return () => {
      live = false;
    };
  }, [connection, wallets]);

  const connect = useCallback(
    async (name?: string) => {
      /* The fallback is for the single-wallet browser, where there is nothing
         to choose. With several registered the control passes the name the
         person picked, because ranking them and taking the first is what once
         reached past a Phantom in the toolbar for a MetaMask holding an
         unanswered popup — the scores tie whenever no wallet has yet exposed a
         Solana account, and the tiebreak is alphabetical. */
      const target = name ?? wallets[0]?.name;
      if (!target) return;
      setError(null);
      setErrorKind(null);
      setConnecting(true);
      try {
        const result = await connectWallet(target);
        if (result.ok) {
          setConnection(result.connection);
          writeWalletHint(result.connection.wallet);
        }
        /* A refusal is an ordinary answer — the person pressed cancel — and the
           client returns it as a value rather than throwing. It belongs in the
           panel, not in an error banner. What it is not is the only kind of
           failure, so the kind travels with the text. */
        else {
          setError(result.reason);
          setErrorKind(kindOf(result.state));
        }
      } finally {
        setConnecting(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    setConnection(null);
    setError(null);
    setErrorKind(null);
    /* Disconnect has to mean it. Leaving the hint would silently reconnect on
       the very next navigation, which is the opposite of what was asked. */
    writeWalletHint(null);
  }, []);

  const value = useMemo<SolanaConnectionValue>(
    () => ({ wallets, connection, connecting, error, errorKind, connect, disconnect }),
    [connect, connecting, connection, disconnect, error, errorKind, wallets],
  );

  return (
    <SolanaConnectionContext.Provider value={value}>{children}</SolanaConnectionContext.Provider>
  );
}

/* ------------------------------------------------------------- mainnet read */

type HoldingRow = Readonly<{
  kind?: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  amountRaw: string;
  decimals: number;
  symbol: string | null;
  name: string | null;
}>;

type WalletRead =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "reading" }>
  | Readonly<{
      status: "read";
      lamports: string;
      holdings: readonly HoldingRow[];
      /** Every balance the address holds, not just the ones detailed above. */
      held: number;
      /** Whether both token programs answered. An empty list means "nothing"
          only when they did. */
      tokenRead: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
      host: string;
      hosts: readonly string[];
      health: ProviderHealthState;
    }>
  | Readonly<{ status: "failed"; reason: string }>;

/**
 * Trim a scaled amount for a menu row.
 *
 * `scaleRawAmount` is exact and prints every decimal place the mint declares,
 * which is right for a transfer preview and wrong for a nine-decimal SOL
 * balance in a dropdown. Trailing zeros go; the value itself is never rounded
 * up, only cut, and a value that would cut to nothing keeps enough digits to
 * stay non-zero — a balance rendered as `0` when it is not zero is the single
 * worst thing this panel could say.
 */
function forDisplay(raw: string, decimals: number): string {
  const exact = scaleRawAmount(raw, decimals);
  if (!exact.includes(".")) return exact;
  const [whole, fraction] = exact.split(".");
  const significant = whole === "0" ? Math.max(4, fraction.search(/[1-9]/) + 4) : 4;
  const cut = fraction.slice(0, Math.min(fraction.length, significant)).replace(/0+$/, "");
  return cut.length > 0 ? `${whole}.${cut}` : whole;
}

const LAMPORTS_DECIMALS = 9;

function labelFor(holding: HoldingRow): string {
  if (holding.symbol) return holding.symbol;
  if (holding.name) return holding.name;
  const mint = holding.mint ?? "";
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/**
 * The top-right control, in the same slot as every other workspace.
 *
 * `SWITCH_NETWORK` is absent, and so is any control offering it. A Solana
 * wallet's cluster is chosen in the wallet, not by a page — Phantom labels
 * every non-mainnet cluster "Testnet" and the person sets it there. Offering a
 * switch here would open nothing.
 */
export function SolanaConnectionControl({
  identity,
  preferences,
  compact = false,
}: {
  identity?: ReactNode;
  /** The person's own settings in the panel — the product's menu. */
  preferences?: (close: () => void) => ReactNode;
  /** The product's menu: the address and the SOL balance, no technical rows. */
  compact?: boolean;
} = {}) {
  const { text } = useSolanaI18n();
  const { wallets, connection, connecting, error, errorKind, connect, disconnect } = useSolanaConnection();
  const [read, setRead] = useState<WalletRead>({ status: "idle" });
  const address = connection?.address ?? null;
  /* A browser with no wallet at all: a phone's Safari or Chrome cannot carry
     one, so the panel offers this page inside Phantom's own browser; a
     computer is told where to get one. Read after mount — the server does not
     know the device. */
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    setPhone(isPhoneUserAgent(window.navigator.userAgent));
  }, []);

  /* One read per connected address, cancelled if the address changes under it.
     Mainnet is named rather than defaulted: this workspace reads one network
     and a silent default is how the other half of this file once ended up
     asserting a different one. */
  useEffect(() => {
    if (!address) {
      setRead({ status: "idle" });
      return;
    }
    let live = true;
    setRead({ status: "reading" });
    void (async () => {
      try {
        const response = await fetch("/api/solana/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: address, network: "mainnet" }),
        });
        const payload = (await response.json()) as {
          data?: {
            lamports: string;
            holdings: readonly HoldingRow[];
            held: number;
            tokenRead?: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
            source: { host: string; hosts: readonly string[]; health: ProviderHealthState };
          };
          error?: { message: string };
        };
        if (!live) return;
        if (!response.ok || !payload.data) {
          setRead({ status: "failed", reason: payload.error?.message ?? `HTTP ${response.status}` });
          return;
        }
        setRead({
          status: "read",
          lamports: payload.data.lamports,
          holdings: payload.data.holdings,
          held: payload.data.held,
          tokenRead: payload.data.tokenRead ?? "UNAVAILABLE",
          host: payload.data.source.host,
          hosts: payload.data.source.hosts,
          health: payload.data.source.health,
        });
      } catch (failure) {
        if (!live) return;
        setRead({ status: "failed", reason: failure instanceof Error ? failure.message : String(failure) });
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  const adapter = useMemo<ConnectionAdapter>(() => {
    const capabilities: ConnectionCapability[] = [];
    if (connection) capabilities.push("READ", "OWNERSHIP_PROVEN", "SIGN_TX");

    return {
      id: "solana",
      snapshot: {
        available: wallets.length > 0,
        connecting,
        address,
        /* Wallet Standard does not expose a mutable "active cluster", but an
           account does declare the chains it belongs to. Report only that
           fact; a multi-chain wallet's unrelated account never becomes a
           Solana connection. The exact mainnet context is restated again at
           signature time. */
        onExpectedNetwork: connection ? connection.chains.includes("solana:mainnet") : true,
        capabilities,
        error,
        errorKind: errorKind ?? undefined,
      },
      /* Every wallet this browser registered, in the order the detector ranks
         them, so the ranking becomes a suggestion instead of a decision. The
         list is what the panel renders when there is more than one; with one
         wallet there is nothing to choose and the ordinary button stands. */
      choices: wallets.map((wallet) => ({ id: wallet.name, label: wallet.name, icon: wallet.icon })),
      /* This said "Solana Devnet" and pinned the explorer to that cluster,
         which made the shell assert a network for the whole workspace on
         behalf of one surface. Every read here is mainnet; only Send is still
         wired to its internal fixture, and Send links its own transaction to
         its own cluster. The explorer form is the module's, so the mainnet
         link stays the bare canonical one people can paste. */
      network: {
        label: text("Solana Mainnet"),
        shortLabel: text("Mainnet"),
        explorerAddressUrl: (value) => explorerAddressUrl("mainnet", value),
      },
      /* Absent means the read did not answer, never that nothing is held —
         the contract's own distinction, and the reason this is `null` rather
         than `"0"` while a read is failing. */
      balance: {
        label: "SOL",
        value: read.status === "read" ? forDisplay(read.lamports, LAMPORTS_DECIMALS) : null,
        loading: read.status === "reading",
      },
      connect: (id) => connect(id),
      disconnect,
      /* base58, not hex: a `0x`-shaped shortener produced unreadable stubs the
         first time it met a Solana address. */
      truncate: (value) => `${value.slice(0, 4)}…${value.slice(-4)}`,
    };
  }, [address, connect, connecting, connection, disconnect, error, errorKind, read, text, wallets]);

  const copy = useMemo<ConnectionCopy>(() => ({
    ...DEFAULT_COPY,
    panelTitle: text(DEFAULT_COPY.panelTitle),
    connect: text(DEFAULT_COPY.connect),
    connectShort: text(DEFAULT_COPY.connectShort ?? DEFAULT_COPY.connect),
    connecting: text(DEFAULT_COPY.connecting),
    waiting: text(DEFAULT_COPY.waiting),
    unavailableTitle: text("No wallet in this browser"),
    unavailableBody: phone
      ? text("On a phone, Ryntra opens inside your wallet app.")
      : text("Install Phantom, Solflare or Backpack, then reload this page."),
    disconnectedTitle: text(DEFAULT_COPY.disconnectedTitle),
    chooseTitle: text(DEFAULT_COPY.chooseTitle),
    disconnectedBody: text("Connecting only reads your wallet's balances. Nothing is signed until you approve the exact transaction."),
    address: text(DEFAULT_COPY.address),
    network: text(DEFAULT_COPY.network),
    capability: text(DEFAULT_COPY.capability),
    wrongNetwork: text(DEFAULT_COPY.wrongNetwork),
    wrongNetworkBody: (network) => `${text("This workspace works on")} ${network}. ${text("Switch to continue.")}`,
    switchNetwork: (network) => network ? `${text("Switch to")} ${network}` : text("Switch network"),
    pendingTitle: text(DEFAULT_COPY.pendingTitle),
    pendingBody: text(DEFAULT_COPY.pendingBody),
    copy: text(DEFAULT_COPY.copy),
    copied: text(DEFAULT_COPY.copied),
    explorer: text(DEFAULT_COPY.explorer),
    manage: text(DEFAULT_COPY.manage),
    disconnect: text(DEFAULT_COPY.disconnect),
    errorTitle: text(DEFAULT_COPY.errorTitle),
    errorTitles: {
      REFUSED: text(DEFAULT_COPY.errorTitles?.REFUSED ?? DEFAULT_COPY.errorTitle),
      PENDING: text(DEFAULT_COPY.errorTitles?.PENDING ?? DEFAULT_COPY.errorTitle),
      FAILED: text(DEFAULT_COPY.errorTitles?.FAILED ?? DEFAULT_COPY.errorTitle),
    },
    pendingInWalletBody: text(DEFAULT_COPY.pendingInWalletBody),
    retry: text(DEFAULT_COPY.retry),
    reading: text(DEFAULT_COPY.reading),
    unavailable: text(DEFAULT_COPY.unavailable),
    unknown: text(DEFAULT_COPY.unknown),
    capRead: text(DEFAULT_COPY.capRead),
    capOwnership: text(DEFAULT_COPY.capOwnership),
    capSignMessage: text(DEFAULT_COPY.capSignMessage),
    capSignTx: text("Sign transactions"),
    states: {
      UNAVAILABLE: text(DEFAULT_COPY.states.UNAVAILABLE),
      DISCONNECTED: text(DEFAULT_COPY.states.DISCONNECTED),
      CONNECTING: text(DEFAULT_COPY.states.CONNECTING),
      CONNECTED: text(DEFAULT_COPY.states.CONNECTED),
      WRONG_NETWORK: text(DEFAULT_COPY.states.WRONG_NETWORK),
      ACTION_PENDING: text(DEFAULT_COPY.states.ACTION_PENDING),
      ERROR: text(DEFAULT_COPY.states.ERROR),
    },
  }), [phone, text]);

  // Each entry has a unique accessible trigger; the wallet context is shared.
  const controlId = useId();

  /* Three, measured rather than chosen. At five this panel ran 665px against
     its 560px ceiling on a 375-wide phone and pushed `Disconnect` below the
     fold — a balance list that buries the way out. Three names what the
     address mostly holds; the count below it carries the rest, and the
     Portfolio surface that lists them all is its own row. */
  const tokens =
    read.status === "read"
      ? read.holdings.filter((holding) => holding.kind !== "NATIVE_SOL").slice(0, 3)
      : [];
  /* Counted from what the address holds, not from what this panel was handed.
     The route details the twelve largest; a "more" line computed against that
     slice told a wallet with sixty-one balances it had twelve. */
  const more = read.status === "read" ? Math.max(0, read.held - tokens.length) : 0;

  return (
    <ConnectionControl
      triggerId={`solana-connection-${controlId}`}
      adapter={adapter}
      preferences={preferences}
      compact={compact}
      /* The account, inside the wallet's own panel: the wallet is the account,
         and the header carries one principal. */
      identity={identity}
      venue={
        <>
          {read.status === "failed" ? <p className="rs-menu-hint">{text("Balances could not be loaded just now. Try again in a moment.")}</p> : null}

          {tokens.length > 0 ? (
            <dl className="so-conn-holdings">
              {tokens.map((holding) => (
                <MenuRow
                  key={holding.mint ?? labelFor(holding)}
                  label={labelFor(holding)}
                  value={
                    holding.mint ? (
                    <a
                      className="so-conn-token"
                      href={explorerAddressUrl("mainnet", holding.mint)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {forDisplay(holding.amountRaw, holding.decimals)}
                    </a>
                    ) : (
                      forDisplay(holding.amountRaw, holding.decimals)
                    )
                  }
                />
              ))}
              {more > 0 ? <p className="rs-menu-hint">{text("and")} {more} {text("more with a balance")}</p> : null}
            </dl>
          ) : read.status === "read" ? (
            /* "Nothing" and "we could not read" are different answers, and only
               one of them is safe to be wrong about. An empty list is a real
               empty wallet only when both token programs actually answered. */
            <p className="rs-menu-hint">
              {read.tokenRead === "COMPLETE"
                ? text("This wallet holds no tokens yet.")
                : text("Balances could not be loaded just now. Try again in a moment.")}
            </p>
          ) : null}
        </>
      }
      copy={copy}
      unavailable={
        phone ? (
          <button
            type="button"
            className="rs-menu-action"
            data-variant="primary"
            onClick={() => window.location.assign(phantomBrowseUrl(window.location.href, window.location.origin))}
          >
            {text("Open in Phantom")}
          </button>
        ) : (
          <a className="rs-menu-action" href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">
            <ArrowSquareOut size={15} weight="bold" aria-hidden />
            {text("Install Phantom")}
          </a>
        )
      }
    />
  );
}
