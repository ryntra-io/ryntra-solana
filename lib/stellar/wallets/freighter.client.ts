import {
  StellarWalletError,
  type SignAuthEntryInput,
  type SignAuthEntryResult,
  type SignTransactionInput,
  type SignTransactionResult,
  type StellarWalletAdapter,
  type StellarWalletCapability,
  type StellarWalletConnection,
  type StellarWalletNetwork,
} from "./adapter.ts";

/**
 * Freighter, behind the Ryntra wallet contract.
 *
 * **Client only.** Every entry point loads `@stellar/freighter-api` with a
 * dynamic `import()` at call time, so the package is not in the bundle of a
 * page nobody connects on — the Asset Passport, the network pages and the whole
 * public read surface ship without it. It is never imported by a server
 * component; `wallets.test.mjs` asserts that rather than trusting it.
 *
 * ## The failure mode this file exists to contain
 *
 * With the extension absent, most of the Freighter API **never settles**. The
 * package applies an internal two-second timeout to exactly two message types —
 * `isConnected()` and `getAddress()` — and to nothing else. `requestAccess()`,
 * `getNetwork()` and every signing method return a promise that hangs forever:
 * not a rejection, not an error, an `await` that never returns and a spinner
 * that never stops. Its own source says so plainly: *"any messages to background
 * from freighter-api will hang forever and not respond in any way."*
 *
 * So every call here goes through `withTimeout`, and every unprotected call is
 * additionally gated behind `isConnected()`. Neither alone is enough: the gate
 * without the timeout still hangs if the extension disappears mid-session, and
 * the timeout without the gate makes the common no-wallet path wait for nothing.
 *
 * ## Errors are values, not throws
 *
 * v6 returns `{ error?: FreighterApiError }` on the result rather than
 * rejecting, so a caller that only writes `try/catch` sees success. Every result
 * is inspected here and turned into a typed `StellarWalletError`.
 *
 * Code `-4` is the user rejecting, and it is the only code that is
 * unambiguous. `-1` covers both "no wallet" and "the wallet broke", so it is
 * reported as unavailable rather than guessed at — and a rejection is never
 * recorded as a system failure.
 */

/** Long enough for a person to approve a prompt, short enough not to look hung. */
const APPROVAL_TIMEOUT_MS = 120_000;
/** A read the extension answers immediately, or not at all. */
const READ_TIMEOUT_MS = 5_000;

/** Freighter's own code for "the person said no". The only unambiguous one. */
const USER_REJECTED = -4;

type FreighterError = { code?: number; message?: string } | undefined;

async function api() {
  /* Not a static import: this is what keeps the package out of every bundle
     that never connects a wallet. */
  return import("@stellar/freighter-api");
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new StellarWalletError(
              "TIMEOUT",
              `Freighter did not answer ${what} within ${Math.round(ms / 1000)}s.`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

/** Turns a returned error into a thrown, typed one. */
function refuse(error: FreighterError, fallback: string): never {
  if (error?.code === USER_REJECTED) {
    throw new StellarWalletError("SIGNATURE_REJECTED", error.message ?? "The request was rejected.");
  }
  throw new StellarWalletError("UNAVAILABLE", error?.message ?? fallback);
}

async function available(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { isConnected } = await api();
    const result = await withTimeout(isConnected(), READ_TIMEOUT_MS, "a connection check");
    return result.isConnected === true;
  } catch {
    /* Availability is the one question that must never throw: it is asked to
       decide whether anything else may be asked. */
    return false;
  }
}

/** Refuses before touching a call the package will not time out on its own. */
async function requireExtension(): Promise<void> {
  if (!(await available())) {
    throw new StellarWalletError(
      "NOT_INSTALLED",
      "Freighter is not available in this browser.",
    );
  }
}

const CAPABILITIES: readonly StellarWalletCapability[] = [
  "CONNECT",
  "GET_ADDRESS",
  "GET_NETWORK",
  "SIGN_TRANSACTION",
  "SIGN_AUTH_ENTRY",
];

export const freighterAdapter: StellarWalletAdapter = {
  id: "freighter",
  name: "Freighter",
  capabilities: CAPABILITIES,

  isAvailable: available,

  async connect(): Promise<StellarWalletConnection> {
    await requireExtension();
    const { requestAccess, getNetwork } = await api();

    const access = await withTimeout(requestAccess(), APPROVAL_TIMEOUT_MS, "the access request");
    if (access.error) {
      if (access.error.code === USER_REJECTED) {
        throw new StellarWalletError("ACCESS_DENIED", "Wallet access was not approved.");
      }
      refuse(access.error, "Freighter refused the access request.");
    }
    if (!access.address) {
      throw new StellarWalletError("LOCKED", "Freighter returned no address. It may be locked.");
    }

    const network = await withTimeout(getNetwork(), READ_TIMEOUT_MS, "its network");
    if (network.error) refuse(network.error, "Freighter did not report its network.");

    return {
      address: access.address,
      network: network.network,
      networkPassphrase: network.networkPassphrase,
    };
  },

  async getAddress(): Promise<string> {
    await requireExtension();
    const { getAddress } = await api();
    const result = await withTimeout(getAddress(), READ_TIMEOUT_MS, "the address");
    if (result.error) refuse(result.error, "Freighter did not return an address.");
    if (!result.address) {
      throw new StellarWalletError("ACCESS_DENIED", "No address is shared with this site.");
    }
    return result.address;
  },

  async getNetwork(): Promise<StellarWalletNetwork> {
    await requireExtension();
    const { getNetwork } = await api();
    const result = await withTimeout(getNetwork(), READ_TIMEOUT_MS, "its network");
    if (result.error) refuse(result.error, "Freighter did not report its network.");
    return { network: result.network, networkPassphrase: result.networkPassphrase };
  },

  async signTransaction(input: SignTransactionInput): Promise<SignTransactionResult> {
    await requireExtension();
    const { signTransaction } = await api();
    const result = await withTimeout(
      signTransaction(input.unsignedXdr, {
        networkPassphrase: input.networkPassphrase,
        address: input.address,
      }),
      APPROVAL_TIMEOUT_MS,
      "the signature",
    );
    if (result.error) refuse(result.error, "Freighter did not return a signature.");
    /* Returned, not submitted. Whether these bytes are the bytes that were
       authorized is decided by the caller, against its own fingerprint. */
    return { signedXdr: result.signedTxXdr, signerAddress: result.signerAddress };
  },

  async signAuthEntry(input: SignAuthEntryInput): Promise<SignAuthEntryResult> {
    await requireExtension();
    const { signAuthEntry } = await api();
    const result = await withTimeout(
      signAuthEntry(input.authEntry, {
        networkPassphrase: input.networkPassphrase,
        address: input.address,
      }),
      APPROVAL_TIMEOUT_MS,
      "the authorization entry signature",
    );
    if (result.error) refuse(result.error, "Freighter did not return a signed entry.");
    if (result.signedAuthEntry === null) {
      throw new StellarWalletError("SIGNATURE_REJECTED", "The authorization entry was not signed.");
    }
    return { signedAuthEntry: result.signedAuthEntry, signerAddress: result.signerAddress };
  },

  async disconnect(): Promise<void> {
    /* Freighter has no revoke API — a site's permission is managed inside the
       extension. Saying so is more honest than a no-op that implies Ryntra
       revoked something it cannot reach; what disconnects here is this
       session's memory of the address. */
    return;
  },
};
