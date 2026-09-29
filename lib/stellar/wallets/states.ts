import type { StellarWalletErrorCode } from "./adapter.ts";

/**
 * Every state a wallet connection can be in, and what the person is told.
 *
 * Twelve, because collapsing them is how a wallet surface starts lying. "Not
 * installed", "installed but access denied" and "connected to the wrong
 * network" are three different situations with three different next steps, and
 * a single `connected: boolean` turns all of them into a dead button.
 *
 * The state machine is pure and lives here rather than in a component so it can
 * be tested without a browser, a wallet, or React — the three things that make
 * a wallet bug expensive to reproduce.
 */

export const STELLAR_WALLET_STATES = [
  "NOT_INSTALLED",
  "AVAILABLE",
  "CONNECTING",
  "ACCESS_DENIED",
  "CONNECTED",
  "WRONG_NETWORK",
  "LOCKED",
  "SIGNING",
  "SIGNATURE_REJECTED",
  "SIGNED",
  "DISCONNECTED",
  "UNAVAILABLE",
] as const;

export type StellarWalletState = (typeof STELLAR_WALLET_STATES)[number];

/**
 * States in which a signature must not be requested.
 *
 * `WRONG_NETWORK` is the one that matters and the one an implementation forgets:
 * a wallet pointed at mainnet will happily sign a transaction built for testnet,
 * and the resulting signature is valid — over the wrong network. The block
 * belongs here, before the request, not in a warning beside it.
 */
export const SIGNING_BLOCKED_STATES: readonly StellarWalletState[] = [
  "NOT_INSTALLED",
  "AVAILABLE",
  "ACCESS_DENIED",
  "WRONG_NETWORK",
  "LOCKED",
  "DISCONNECTED",
  "UNAVAILABLE",
];

export function canRequestSignature(state: StellarWalletState): boolean {
  return !SIGNING_BLOCKED_STATES.includes(state);
}

/** A user's own decision, which is never rendered as a system failure. */
export const USER_DECISION_STATES: readonly StellarWalletState[] = [
  "ACCESS_DENIED",
  "SIGNATURE_REJECTED",
];

export function isUserDecisionState(state: StellarWalletState): boolean {
  return USER_DECISION_STATES.includes(state);
}

/** The state an adapter error resolves to. */
export function stateForError(code: StellarWalletErrorCode): StellarWalletState {
  switch (code) {
    case "NOT_INSTALLED":
      return "NOT_INSTALLED";
    case "ACCESS_DENIED":
      return "ACCESS_DENIED";
    case "SIGNATURE_REJECTED":
      return "SIGNATURE_REJECTED";
    case "LOCKED":
      return "LOCKED";
    case "TIMEOUT":
    case "UNAVAILABLE":
      return "UNAVAILABLE";
  }
}

export type WalletCopy = Readonly<{
  title: string;
  body: string;
  /** The one thing to do next, or `null` when there is nothing to press. */
  action: string | null;
}>;

/**
 * What each state says on screen.
 *
 * Kept beside the machine rather than in a component because the copy *is* the
 * behaviour here: a wrong-network state whose text does not name the expected
 * network has told the reader nothing they can act on.
 */
export const WALLET_COPY: Readonly<Record<StellarWalletState, WalletCopy>> = {
  NOT_INSTALLED: {
    title: "Freighter is not installed",
    body: "Install the browser extension to connect a Stellar wallet. Everything on this workspace reads without one.",
    action: "Install Freighter",
  },
  AVAILABLE: {
    title: "Freighter detected",
    body: "Connect to read your own balances and trustlines. Ryntra never receives a key.",
    action: "Connect Stellar wallet",
  },
  CONNECTING: {
    title: "Waiting for the wallet",
    body: "Approve the connection in Freighter.",
    action: null,
  },
  ACCESS_DENIED: {
    title: "Wallet access was not approved",
    body: "Ryntra cannot read an address until the wallet owner grants access.",
    action: "Try again",
  },
  CONNECTED: {
    title: "Connected",
    body: "Reading balances and trustlines for this address.",
    action: null,
  },
  WRONG_NETWORK: {
    title: "Wrong Stellar network",
    body: "The wallet is on a different network than this action was prepared for. Switch the network in Freighter before continuing — Ryntra cannot switch it for you.",
    action: null,
  },
  LOCKED: {
    title: "Freighter is locked",
    body: "Unlock the extension, then connect.",
    action: "Try again",
  },
  SIGNING: {
    title: "Waiting for a signature",
    body: "Review the exact transaction in Freighter. Nothing is submitted by signing.",
    action: null,
  },
  SIGNATURE_REJECTED: {
    title: "Signature cancelled",
    body: "Nothing was submitted to Stellar. The intent remains available for review.",
    action: "Review the intent",
  },
  SIGNED: {
    title: "Signed",
    body: "A signature is not a submission. The signed transaction is checked against what was authorized before anything reaches the network.",
    action: null,
  },
  DISCONNECTED: {
    title: "Disconnected",
    body: "Public Stellar reads are still open. Connect again for balances and trustlines.",
    action: "Connect Stellar wallet",
  },
  UNAVAILABLE: {
    title: "The wallet did not answer",
    body: "Freighter did not respond in time. This is a wallet or browser condition, not a rejected request.",
    action: "Try again",
  },
};
