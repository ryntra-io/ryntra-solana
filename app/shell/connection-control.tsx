"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, Copy, SignOut, Warning, Wallet as WalletIcon } from "@phosphor-icons/react";

import {
  can,
  connectionState,
  showsError,
  type ConnectionAdapter,
  type ConnectionErrorKind,
  type ConnectionState,
} from "./connection";
import { MenuRow, ShellMenu } from "./menu";

/**
 * The connection control — always the last item in the top bar, on every
 * workspace, in every state.
 *
 * One component, one position, one vocabulary. What it replaces is five
 * different answers to the same question: one hub's wallet menu, Stellar's connect
 * button, Home's Telegram avatar standing in for a financial connection,
 * Solana's *nothing at all* while its Send page owned the wallet, and Agent
 * Control's flat `NO WALLET` printed above a route that signs EIP-712.
 *
 * Three rules it enforces structurally rather than by convention.
 *
 * **The trigger is never an avatar.** A profile picture is an identity, and a
 * wallet is an authority; a control that shows one while meaning the other
 * teaches people that being signed in is the same as being able to spend. The
 * connected trigger is a shortened address in mono, because that is the only
 * thing on screen that identifies what would actually sign.
 *
 * **A capability that is not proven is not offered.** `Switch network`,
 * `Disconnect` and `Connect` each render only when the adapter supplied the
 * verb *and* `can()` agrees the current state can exercise it. There is no
 * disabled-button branch: a control that refuses without saying why is the
 * worst of both, and the panel always has room to say why.
 *
 * **Unknown stays unknown.** A balance the adapter could not read is absent,
 * not zero. `null` here means "could not look", and the panel says so.
 *
 * Profile, venue credentials and anything else workspace-specific arrive as
 * slots. They are secondary metadata *inside* the panel — never the trigger,
 * which is the mistake Home made in the other direction.
 */
export function ConnectionControl({
  adapter,
  copy = DEFAULT_COPY,
  identity,
  venue,
  manageHref,
  triggerId,
  unavailable,
  preferences,
  compact = false,
}: {
  adapter: ConnectionAdapter;
  copy?: ConnectionCopy;
  /** Ryntra session/profile, rendered above the connection. Optional. */
  identity?: ReactNode;
  /** Venue or credential state — Arcus and the like. Optional. */
  venue?: ReactNode;
  /**
   * The way on when this browser has no wallet at all — on a phone, the page
   * inside a wallet's own browser; on a computer, where to get one. Optional:
   * without it the panel only says why nothing can connect.
   */
  unavailable?: ReactNode;
  /** Where `Manage connections` goes. Omitted when the workspace has no such page. */
  manageHref?: string;
  /** Stable target for a task-local Connect action that opens this same panel. */
  triggerId?: string;
  /**
   * The person's own settings, in every state of the panel — connected or
   * not — above the way out (canon v5.4 В31: the wallet's menu carries
   * Налаштування, Мова, Тема, Від'єднати). Handed `close` so a row that
   * navigates can shut the panel it lives in.
   */
  preferences?: (close: () => void) => ReactNode;
  /**
   * The product's menu: the address and its balance, and none of the rows a
   * beginner cannot use — the network the product never changes, the list of
   * what this connection is able to sign, the explorer and the venue's list.
   */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { snapshot, network } = adapter;
  const state = connectionState(snapshot);
  const address = snapshot.address;
  /* Unclassified is `FAILED`, never `REFUSED`. An adapter that did not say
     what happened has not said the person said no. */
  const kind: ConnectionErrorKind = snapshot.errorKind ?? "FAILED";

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* Clipboard permission can be refused. The address is on screen either way. */
    }
  }

  const label =
    state === "CONNECTING"
      ? copy.connecting
      : state === "ACTION_PENDING"
        ? copy.waiting
        : address
          ? adapter.truncate(address)
          : copy.connect;

  /* The address is the one fact that decides whether the next tap can spend
     anything, so it is never abbreviated further. Only the invitation to
     connect has a short form. */
  const shortLabel = address || state === "CONNECTING" || state === "ACTION_PENDING"
    ? label
    : (copy.connectShort ?? copy.connect);

  return (
    <ShellMenu
      boxClass="rs-connbox"
      triggerClass="rs-conn"
      triggerId={triggerId}
      triggerState={state}
      panelTitle={copy.panelTitle}
      ariaLabel={`${copy.panelTitle} — ${triggerAria(state, copy)}`}
      caret={false}
      icon={<TriggerIcon state={state} />}
      label={
        <span className="rs-conn-label" data-mono={address ? "true" : undefined}>
          <span className="rs-conn-long">{label}</span>
          {/* Swapped by a media query, not by JavaScript: a label that depends on
              a measured width flashes the wrong word on first paint. */}
          <span className="rs-conn-short">{shortLabel}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <CloseOnConnect address={address} close={close} />
          {identity ? <section className="rs-menu-section">{identity}</section> : null}

          {state === "UNAVAILABLE" ? (
            <section className="rs-menu-section">
              <p className="rs-menu-body">{copy.unavailableTitle}</p>
              <p className="rs-menu-hint">{copy.unavailableBody}</p>
              {unavailable}
            </section>
          ) : null}

          {state === "DISCONNECTED" || state === "CONNECTING" ? (
            <section className="rs-menu-section">
              <p className="rs-menu-body">
                {hasChoice(adapter) ? copy.chooseTitle : copy.disconnectedTitle}
              </p>
              <p className="rs-menu-hint">{copy.disconnectedBody}</p>
              <ConnectAction adapter={adapter} copy={copy} state={state} />
            </section>
          ) : null}

          {address ? (
            <>
              <dl className="rs-menu-section">
                <MenuRow label={copy.address} value={adapter.truncate(address)} />
                {compact && state !== "WRONG_NETWORK" ? null : (
                  <MenuRow
                    label={copy.network}
                    value={
                      state === "WRONG_NETWORK"
                        ? copy.wrongNetwork
                        : (network?.label ?? copy.unknown)
                    }
                    prose
                  />
                )}
                {adapter.balance ? (
                  <MenuRow
                    label={adapter.balance.label}
                    value={
                      state === "WRONG_NETWORK"
                        ? copy.unavailable
                        : adapter.balance.loading
                          ? copy.reading
                          : /* Absent means the adapter could not read it. It does
                               not mean nothing is held, and the two must not
                               render the same. */
                            (adapter.balance.value ?? copy.unknown)
                    }
                  />
                ) : null}
                {compact ? null : <MenuRow label={copy.capability} value={capabilityLine(adapter, copy)} prose />}
              </dl>

              {state === "WRONG_NETWORK" ? (
                <section className="rs-menu-section">
                  <p className="rs-menu-hint">
                    {copy.wrongNetworkBody(network?.label ?? copy.unknown)}
                  </p>
                  {can(snapshot, "SWITCH_NETWORK") && adapter.switchNetwork ? (
                    <button
                      type="button"
                      className="rs-menu-action"
                      data-variant="primary"
                      onClick={() => void adapter.switchNetwork?.()}
                    >
                      {copy.switchNetwork(network?.shortLabel ?? network?.label ?? "")}
                    </button>
                  ) : null}
                </section>
              ) : null}

              {state === "ACTION_PENDING" ? (
                <section className="rs-menu-section">
                  <p className="rs-menu-body">{copy.pendingTitle}</p>
                  <p className="rs-menu-hint">{copy.pendingBody}</p>
                </section>
              ) : null}

              {venue && !compact ? <section className="rs-menu-section">{venue}</section> : null}

              <section className="rs-menu-section">
                <button type="button" className={compact ? "rs-menu-item" : "rs-menu-action"} onClick={() => void copyAddress()}>
                  <Copy size={compact ? 16 : 15} weight="bold" aria-hidden />
                  {compact ? <span className="rs-menu-item-label">{copied ? copy.copied : copy.copy}</span> : copied ? copy.copied : copy.copy}
                </button>
                {network?.explorerAddressUrl && !compact ? (
                  <a
                    className="rs-menu-action"
                    href={network.explorerAddressUrl(address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowSquareOut size={15} weight="bold" aria-hidden />
                    {copy.explorer}
                  </a>
                ) : null}
                {manageHref ? (
                  <a className="rs-menu-action" href={manageHref} onClick={close}>
                    {copy.manage}
                  </a>
                ) : null}
              </section>

              {preferences ? <section className="rs-menu-section" data-section="preferences">{preferences(close)}</section> : null}

              {adapter.disconnect ? (
                <section className="rs-menu-section">
                  <button
                    type="button"
                    className={compact ? "rs-menu-item" : "rs-menu-action"}
                    onClick={() => {
                      adapter.disconnect?.();
                      close();
                    }}
                  >
                    {compact ? <SignOut size={16} weight="bold" aria-hidden /> : null}
                    {compact ? <span className="rs-menu-item-label">{copy.disconnect}</span> : copy.disconnect}
                  </button>
                </section>
              ) : null}
            </>
          ) : null}

          {/* The refusal one hub's shell captured and never rendered, so a person
              who rejected a request saw a button that simply did nothing.

              Keyed on the snapshot rather than the state, because an error is
              additive: a connected wallet that refused a network switch keeps
              its address in the trigger and gains this section under it. */}
          {showsError(snapshot) ? (
            <section className="rs-menu-section">
              <p className="rs-menu-title">{errorTitle(kind, copy)}</p>
              <p className="rs-menu-hint">{snapshot.error}</p>
              {/* The one failure with an instruction attached, because it is the
                  one a person cannot answer from this panel: the request is
                  open inside the extension and nothing here can reach it. */}
              {kind === "PENDING" ? <p className="rs-menu-hint">{copy.pendingInWalletBody}</p> : null}
              {/* Retry re-enters the choice rather than repeating the pick.
                  A list that appears only before the first attempt strands
                  whoever the ranking sent to the wrong wallet. */}
              {address ? (
                adapter.connect ? (
                  <button type="button" className="rs-menu-action" onClick={() => void adapter.connect?.()}>
                    {copy.retry}
                  </button>
                ) : null
              ) : (
                <ConnectAction adapter={adapter} copy={copy} state={state} retry />
              )}
            </section>
          ) : null}

          {/* A guest's settings: the language and the theme are theirs before
              any wallet is (canon v5.4 В31), so the rows stand under the way
              in. With a wallet they stand above the way out, drawn above. */}
          {!address && preferences ? (
            <section className="rs-menu-section" data-section="preferences">{preferences(close)}</section>
          ) : null}
        </>
      )}
    </ShellMenu>
  );
}

/**
 * A connection made from the open panel closes it.
 *
 * The person opened the panel to connect, and connecting is done: what comes
 * next is on the page they came from — on «Простий»'s Home, «Поповнити» —
 * not in a panel that now covers it on a phone. A panel opened while already
 * connected never closes by itself. (RYN-INVEST-SIMPLE-001, session 5: the
 * beginner's walk stopped here under the panel.)
 */
function CloseOnConnect({ address, close }: { address: string | null; close: () => void }) {
  const atOpen = useRef(address);
  useEffect(() => {
    if (atOpen.current === null && address !== null) close();
  }, [address, close]);
  return null;
}

/** Whether this page found more than one connector, so the person picks. */
function hasChoice(adapter: ConnectionAdapter): boolean {
  return (adapter.choices?.length ?? 0) > 1;
}

/**
 * The title for a failure, per kind, falling back to the adapter's own.
 *
 * `errorTitles` is partial and `errorTitle` remains the floor so that a
 * workspace carrying its own translated catalog — one has three locales —
 * keeps rendering the string it already ships instead of failing to compile
 * on a vocabulary it has not translated yet.
 */
function errorTitle(kind: ConnectionErrorKind, copy: ConnectionCopy): string {
  return copy.errorTitles?.[kind] ?? copy.errorTitle;
}

/**
 * Attach — as one button, or as the list when there is a choice.
 *
 * The list is not a nicety. Solana's adapter registered Phantom, MetaMask, OKX
 * Wallet and SquadsX in one browser, scored them, and connected the winner;
 * with no wallet yet exposing a Solana account the score is a four-way tie and
 * the tiebreak is `localeCompare`, so `Connect` reached for MetaMask over the
 * Phantom in the same toolbar. MetaMask answered with a request it already had
 * open, and the panel called that a refusal. Three defects, one cause: the
 * product chose, silently, and gave nobody a way to choose differently.
 */
function ConnectAction({
  adapter,
  copy,
  state,
  retry = false,
}: {
  adapter: ConnectionAdapter;
  copy: ConnectionCopy;
  state: ConnectionState;
  /** Renders under a failure, where the label is `Try again` rather than `Connect`. */
  retry?: boolean;
}) {
  if (!adapter.connect) return null;
  const busy = state === "CONNECTING";

  if (hasChoice(adapter)) {
    return (
      <div className="rs-menu-choices">
        {adapter.choices?.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="rs-menu-action"
            onClick={() => void adapter.connect?.(choice.id)}
            disabled={busy}
          >
            {choice.icon ? (
              /* The wallet's own icon, handed over as a data URI. `next/image`
                 optimizes remote files it can fetch; there is no file here. */
              // eslint-disable-next-line @next/next/no-img-element
              <img className="rs-menu-choice-icon" src={choice.icon} alt="" width={18} height={18} />
            ) : (
              <WalletIcon size={16} weight="bold" aria-hidden />
            )}
            {choice.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="rs-menu-action"
      data-variant={retry ? undefined : "primary"}
      onClick={() => void adapter.connect?.()}
      disabled={busy}
    >
      {busy ? copy.connecting : retry ? copy.retry : copy.connect}
    </button>
  );
}

function TriggerIcon({ state }: { state: ConnectionState }) {
  if (state === "WRONG_NETWORK" || state === "ERROR") {
    return <Warning size={16} weight="bold" />;
  }
  if (state === "CONNECTED" || state === "ACTION_PENDING") {
    return <span className="rs-conn-dot" />;
  }
  return <WalletIcon size={16} weight="bold" />;
}

/**
 * What the connection is proven able to do, in one line.
 *
 * Stated positively and never inferred. A connection that can read and prove
 * ownership but cannot sign says exactly that, which is the honest form of the
 * `Read only` the standard asks for in place of a global `NO WALLET`.
 */
function capabilityLine(adapter: ConnectionAdapter, copy: ConnectionCopy): string {
  const { snapshot } = adapter;
  if (can(snapshot, "SIGN_TX")) return copy.capSignTx;
  if (can(snapshot, "SIGN_MESSAGE")) return copy.capSignMessage;
  if (snapshot.capabilities.includes("OWNERSHIP_PROVEN")) return copy.capOwnership;
  if (snapshot.capabilities.includes("READ")) return copy.capRead;
  return copy.unknown;
}

function triggerAria(state: ConnectionState, copy: ConnectionCopy): string {
  return copy.states[state];
}

/* --------------------------------------------------------------------- copy */

export type ConnectionCopy = Readonly<{
  panelTitle: string;
  connect: string;
  /**
   * The one-word form, for the phone bar.
   *
   * At 375px the full label used to be hidden outright, which left the primary
   * action of the whole workspace as an unnamed glyph among five other unnamed
   * glyphs on twenty-seven of twenty-eight tabs. A short word fits where the
   * sentence does not. Omitted, `connect` is used at both widths.
   */
  connectShort?: string;
  connecting: string;
  waiting: string;
  unavailableTitle: string;
  unavailableBody: string;
  disconnectedTitle: string;
  /** The heading when the page found more than one connector to choose between. */
  chooseTitle: string;
  disconnectedBody: string;
  address: string;
  network: string;
  capability: string;
  wrongNetwork: string;
  wrongNetworkBody: (network: string) => string;
  switchNetwork: (network: string) => string;
  pendingTitle: string;
  pendingBody: string;
  copy: string;
  copied: string;
  explorer: string;
  manage: string;
  disconnect: string;
  /** The floor title for a failure, used for any kind the catalog omits. */
  errorTitle: string;
  /** Titles per failure kind. Partial: an omitted kind falls back to `errorTitle`. */
  errorTitles?: Partial<Record<ConnectionErrorKind, string>>;
  /** Where to answer a request the wallet already has open. */
  pendingInWalletBody: string;
  retry: string;
  reading: string;
  unavailable: string;
  unknown: string;
  capRead: string;
  capOwnership: string;
  capSignMessage: string;
  capSignTx: string;
  states: Readonly<Record<ConnectionState, string>>;
}>;

/**
 * English defaults.
 *
 * A workspace with its own catalog — one has three locales — passes its own
 * strings. The shape is exhaustive on purpose: `states` is keyed by
 * `ConnectionState`, so adding an eighth state breaks every translation at
 * compile time rather than silently rendering a blank accessible name.
 */
export const DEFAULT_COPY: ConnectionCopy = {
  panelTitle: "Connection",
  connect: "Connect",
  connectShort: "Wallet",
  connecting: "Connecting…",
  waiting: "Waiting…",
  unavailableTitle: "No wallet detected",
  unavailableBody:
    "This page found no wallet to connect to. Open it in a browser with a wallet extension, or use one of the read-only surfaces.",
  disconnectedTitle: "Not connected",
  chooseTitle: "Choose a wallet",
  disconnectedBody: "Connecting reads your balances. Nothing is signed until you authorize it.",
  address: "Address",
  network: "Network",
  capability: "This connection can",
  wrongNetwork: "Wrong network",
  wrongNetworkBody: (network) => `This workspace works on ${network}. Switch to continue.`,
  switchNetwork: (network) => (network ? `Switch to ${network}` : "Switch network"),
  pendingTitle: "Waiting for you",
  pendingBody: "An authorization is open in your wallet. Nothing proceeds until you answer it.",
  copy: "Copy address",
  copied: "Copied",
  explorer: "View on explorer",
  manage: "Manage connections",
  disconnect: "Disconnect",
  /* Neutral, because it is the title for the case nobody classified. The
     refusal keeps its own words below, where a refusal was actually reported. */
  errorTitle: "The wallet did not connect",
  errorTitles: {
    REFUSED: "The wallet refused",
    PENDING: "Your wallet is already asking",
    FAILED: "The wallet did not connect",
  },
  pendingInWalletBody:
    "Open the wallet extension and answer the request waiting there. Nothing new can be sent until that one is closed.",
  retry: "Try again",
  reading: "Reading…",
  unavailable: "Unavailable",
  unknown: "Unknown",
  capRead: "Read balances",
  capOwnership: "Prove ownership",
  capSignMessage: "Sign authorizations",
  capSignTx: "Sign and send transactions",
  states: {
    UNAVAILABLE: "no wallet detected",
    DISCONNECTED: "not connected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    WRONG_NETWORK: "connected to the wrong network",
    ACTION_PENDING: "waiting for your authorization",
    ERROR: "the wallet did not connect",
  },
};
