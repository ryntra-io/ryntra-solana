/**
 * The Ryntra Stellar wallet contract.
 *
 * One interface, and every wallet is an implementation of it. Freighter is the
 * first; Stellar Wallets Kit, a smart-account adapter and anything else are
 * later implementations of this same contract rather than replacements for it.
 *
 * **The rule this file exists to enforce:** a wallet library never reaches the
 * StrategySpec, the policy engine, the Asset Passport, a receipt, reconciliation
 * or any product logic. Those layers know this interface and nothing below it.
 * A provider swap must therefore be a one-file change, and if it ever is not,
 * the boundary has already leaked.
 *
 * It deliberately does **not** build, simulate, submit or interpret a
 * transaction. A wallet's whole job here is to say who the user is, which
 * network they are on, and to return a signature over bytes it was handed. The
 * bytes are produced and checked elsewhere — which is what makes
 * "the wallet signed it" and "Ryntra authorized it" two different facts.
 */

/** What a given wallet can actually do. Declared, never assumed. */
export type StellarWalletCapability =
  | "CONNECT"
  | "GET_ADDRESS"
  | "GET_NETWORK"
  | "SIGN_TRANSACTION"
  | "SIGN_AUTH_ENTRY"
  | "SIGN_MESSAGE";

export type StellarWalletNetwork = Readonly<{
  /** The wallet's own word for it, e.g. `PUBLIC` or `TESTNET`. */
  network: string;
  /**
   * The passphrase, which is the only identity that matters.
   *
   * A wallet's network *name* is a label; the passphrase is what a transaction
   * is signed against. Comparing names would pass a wallet pointed at a
   * differently-named copy of the same network, and fail one that names it
   * differently — so every guard in this product compares passphrases.
   */
  networkPassphrase: string;
}>;

export type StellarWalletConnection = StellarWalletNetwork & Readonly<{ address: string }>;

export type SignTransactionInput = Readonly<{
  unsignedXdr: string;
  address: string;
  networkPassphrase: string;
}>;

export type SignTransactionResult = Readonly<{
  signedXdr: string;
  signerAddress?: string;
}>;

export type SignAuthEntryInput = Readonly<{
  authEntry: string;
  address: string;
  networkPassphrase: string;
}>;

export type SignAuthEntryResult = Readonly<{
  signedAuthEntry: string;
  signerAddress?: string;
}>;

export interface StellarWalletAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly StellarWalletCapability[];

  /** Whether this wallet can be reached at all right now. Never throws. */
  isAvailable(): Promise<boolean>;

  connect(): Promise<StellarWalletConnection>;

  getAddress(): Promise<string>;

  getNetwork(): Promise<StellarWalletNetwork>;

  signTransaction(input: SignTransactionInput): Promise<SignTransactionResult>;

  signAuthEntry?(input: SignAuthEntryInput): Promise<SignAuthEntryResult>;

  disconnect(): Promise<void>;
}

/**
 * Why a wallet call did not succeed.
 *
 * A rejected signature is a person deciding, and a missing extension is a setup
 * step. Neither is a system failure, and collapsing them into one error is how a
 * product ends up telling someone something is broken when they simply said no.
 */
export type StellarWalletErrorCode =
  | "NOT_INSTALLED"
  | "ACCESS_DENIED"
  | "SIGNATURE_REJECTED"
  | "LOCKED"
  | "TIMEOUT"
  | "UNAVAILABLE";

export class StellarWalletError extends Error {
  readonly code: StellarWalletErrorCode;

  constructor(code: StellarWalletErrorCode, message: string) {
    super(message);
    this.name = "StellarWalletError";
    this.code = code;
  }
}

/** A user's own decision, not a fault. Never counted as a system failure. */
export function isUserDecision(error: unknown): boolean {
  return (
    error instanceof StellarWalletError &&
    (error.code === "ACCESS_DENIED" || error.code === "SIGNATURE_REJECTED")
  );
}
