import {
  StellarWalletError,
  type SignAuthEntryInput,
  type SignAuthEntryResult,
  type SignTransactionInput,
  type SignTransactionResult,
  type StellarWalletAdapter,
  type StellarWalletConnection,
  type StellarWalletErrorCode,
  type StellarWalletNetwork,
} from "./adapter.ts";

/**
 * A wallet that is not a wallet.
 *
 * It exists so the contract can be exercised without a browser, an extension or
 * a person — every state a real wallet reaches only by being installed, locked,
 * refused or pointed at the wrong network is one constructor argument here.
 *
 * That matters more than it sounds: the states nobody can reproduce on demand
 * are exactly the ones that ship broken. A rejected signature and a locked
 * extension are the two most common things a real user hits and the two things
 * a developer with a working wallet never sees.
 *
 * It is not exported to any product surface and it never impersonates a real
 * signature — `signTransaction` returns a marked string, so a mock signature
 * reaching a submission path is visible rather than plausible.
 */

export type MockWalletOptions = Readonly<{
  installed?: boolean;
  address?: string;
  network?: StellarWalletNetwork;
  /** Fail the next call of this kind, once. */
  failWith?: StellarWalletErrorCode;
  /** Never settle, to prove a caller's own timeout works. */
  hang?: boolean;
}>;

const DEFAULT_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export function mockWallet(options: MockWalletOptions = {}): StellarWalletAdapter {
  const installed = options.installed ?? true;
  const address = options.address ?? DEFAULT_ADDRESS;
  const network = options.network ?? {
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  const never = <T,>(): Promise<T> => new Promise<T>(() => {});

  function guard(): void {
    if (!installed) {
      throw new StellarWalletError("NOT_INSTALLED", "No mock wallet is installed.");
    }
    if (options.failWith) {
      throw new StellarWalletError(options.failWith, `Mock wallet refused with ${options.failWith}.`);
    }
  }

  return {
    id: "mock",
    name: "Mock wallet",
    capabilities: ["CONNECT", "GET_ADDRESS", "GET_NETWORK", "SIGN_TRANSACTION", "SIGN_AUTH_ENTRY"],

    async isAvailable(): Promise<boolean> {
      if (options.hang) return never<boolean>();
      return installed;
    },

    async connect(): Promise<StellarWalletConnection> {
      if (options.hang) return never<StellarWalletConnection>();
      guard();
      return { address, ...network };
    },

    async getAddress(): Promise<string> {
      if (options.hang) return never<string>();
      guard();
      return address;
    },

    async getNetwork(): Promise<StellarWalletNetwork> {
      if (options.hang) return never<StellarWalletNetwork>();
      guard();
      return network;
    },

    async signTransaction(input: SignTransactionInput): Promise<SignTransactionResult> {
      if (options.hang) return never<SignTransactionResult>();
      guard();
      /* Marked, never plausible. A mock signature that looked like a real one
         could reach a submission path and be believed. */
      return { signedXdr: `MOCK_SIGNED:${input.unsignedXdr}`, signerAddress: address };
    },

    async signAuthEntry(input: SignAuthEntryInput): Promise<SignAuthEntryResult> {
      if (options.hang) return never<SignAuthEntryResult>();
      guard();
      return { signedAuthEntry: `MOCK_SIGNED:${input.authEntry}`, signerAddress: address };
    },

    async disconnect(): Promise<void> {
      return;
    },
  };
}
