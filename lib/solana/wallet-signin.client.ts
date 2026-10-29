/**
 * Ask a Solana wallet to sign the sign-in message the server built.
 *
 * The wallet signs, through `solana:signMessage`, exactly the sign-in text the
 * server issued (a Sign In With Solana message — Phantom and Backpack show it as
 * a sign-in); the server verifies those bytes. Only a wallet without
 * `signMessage` is asked through `solana:signIn`, which rebuilds the text from
 * the input fields. `signMessage` comes first since 21.10: the operator's Phantom,
 * with Backpack holding the same address, never opened a window for `signIn`
 * and the page waited in silence, while `signMessage` of the same text opened
 * at once. Either way nothing but a message is signed — no transaction, no
 * approval, nothing that can move value — and the wallet's own consent screen
 * says so.
 *
 * This file, like `wallet.client.ts`, exists only where `window` does.
 */
import { seekerFailureCode, signedMessageText } from "./seeker-connect.ts";
import { promptTimeoutFor, registeredWallet, withWalletPromptTimeout } from "./wallet.client.ts";

type StandardAccount = Readonly<{ address: string; chains: readonly string[]; features: readonly string[]; publicKey: Uint8Array }>;
type StandardWallet = Readonly<{ name: string; accounts: readonly StandardAccount[]; features: Record<string, unknown> }>;

const SIGN_IN_FEATURE = "solana:signIn";
const SIGN_MESSAGE_FEATURE = "solana:signMessage";

export type SignInInput = Readonly<{
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}>;

export type SignInResult =
  | Readonly<{ ok: true; address: string; signedMessage: Uint8Array; signature: Uint8Array; via: "signIn" | "signMessage" }>
  /* `CANCELLED`: the person closed the wallet's own overlay (Seeker Connect) — an ordinary answer, never an error. */
  | Readonly<{ ok: false; state: "NO_WALLET" | "UNSUPPORTED" | "REFUSED" | "PENDING" | "FAILED" | "CANCELLED"; reason: string }>;

function registry(): readonly StandardWallet[] {
  const api = (globalThis as { navigator?: { wallets?: { get?: () => readonly StandardWallet[] } } }).navigator?.wallets;
  const listed = typeof api?.get === "function" ? api.get() : [];
  return listed;
}

/* The registry is the event-based one `wallet.client.ts` keeps — the one that
   actually sees Phantom, Solflare and Backpack, and the one the connection in
   the top bar came from. `navigator.wallets` is the never-shipped draft some
   wallets still expose; it is consulted last, never first. Before 2026-09-07
   this looked only at the draft and at a global nothing wrote to, so proof of
   ownership answered "no longer registered" over a connected wallet. */
function findWallet(name: string): StandardWallet | null {
  const fromRegistry = registeredWallet(name) as StandardWallet | null;
  if (fromRegistry) return fromRegistry;
  const fromNavigator = registry().find((wallet) => wallet.name === name);
  if (fromNavigator) return fromNavigator;
  const discovered = (globalThis as { __ryntraWallets?: readonly StandardWallet[] }).__ryntraWallets ?? [];
  return discovered.find((wallet) => wallet.name === name) ?? null;
}

function classify(failure: unknown): SignInResult {
  const code = (failure as { code?: unknown } | null)?.code;
  const message = failure instanceof Error ? failure.message : String((failure as { message?: unknown } | null)?.message ?? "");
  const seeker = seekerFailureCode(failure);
  if (seeker === "cancelled") return { ok: false, state: "CANCELLED", reason: message };
  if (seeker === "association-failed") return { ok: false, state: "FAILED", reason: "The wallet did not answer. Nothing was signed; try again." };
  if (seeker === "authorization-declined" || seeker === "request-declined") return { ok: false, state: "REFUSED", reason: message || "The wallet refused." };
  if (seeker) return { ok: false, state: "FAILED", reason: message || "The wallet did not sign, and gave no reason." };
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return { ok: false, state: "REFUSED", reason: message || "The wallet refused." };
  if (code === -32002) return { ok: false, state: "PENDING", reason: message };
  return { ok: false, state: "FAILED", reason: message || "The wallet did not sign, and gave no reason." };
}

export async function signInWithWallet(name: string, input: SignInInput, messageText: string): Promise<SignInResult> {
  const wallet = findWallet(name);
  if (!wallet) return { ok: false, state: "NO_WALLET", reason: `${name} is no longer registered in this browser.` };
  const account = wallet.accounts.find((entry) => entry.address === input.address) ?? null;

  const signMessage = wallet.features[SIGN_MESSAGE_FEATURE] as
    | { signMessage?: (...inputs: { account: StandardAccount; message: Uint8Array }[]) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> }
    | undefined;
  if (typeof signMessage?.signMessage === "function" && account) {
    try {
      const message = new TextEncoder().encode(messageText);
      const [output] = await withWalletPromptTimeout(signMessage.signMessage({ account, message }), promptTimeoutFor(name));
      if (!output) return { ok: false, state: "FAILED", reason: `${name} returned no signature.` };
      /* A Mobile Wallet Adapter wallet (Seeker Connect) answers with the signature appended to the text. */
      const signedMessage = signedMessageText(message, output.signedMessage, output.signature);
      return { ok: true, address: input.address, signedMessage, signature: output.signature, via: "signMessage" };
    } catch (failure) {
      return classify(failure);
    }
  }

  const signIn = wallet.features[SIGN_IN_FEATURE] as
    | { signIn?: (...inputs: SignInInput[]) => Promise<readonly { account: StandardAccount; signedMessage: Uint8Array; signature: Uint8Array }[]> }
    | undefined;
  if (typeof signIn?.signIn === "function") {
    try {
      const [output] = await withWalletPromptTimeout(signIn.signIn(input), promptTimeoutFor(name));
      if (!output) return { ok: false, state: "FAILED", reason: `${name} returned no sign-in output.` };
      return { ok: true, address: output.account.address, signedMessage: output.signedMessage, signature: output.signature, via: "signIn" };
    } catch (failure) {
      return classify(failure);
    }
  }

  if (typeof signMessage?.signMessage !== "function") {
    return { ok: false, state: "UNSUPPORTED", reason: `${name} cannot sign a message, so it cannot prove this address.` };
  }
  return { ok: false, state: "FAILED", reason: `${name} no longer offers ${input.address}. Reconnect and check which account is selected.` };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Sign a text the server built, verbatim, through `solana:signMessage` —
 * for a sign-in a *provider* issues its own nonce for (the prediction
 * aggregator's SIWS): the message must be signed as given, so the wallet's own
 * `signIn` (which rebuilds the text from fields) is not used here. Nothing but
 * a message is signed.
 */
export async function signMessageWithWallet(name: string, address: string, messageText: string): Promise<SignInResult> {
  const wallet = findWallet(name);
  if (!wallet) return { ok: false, state: "NO_WALLET", reason: `${name} is no longer registered in this browser.` };
  const account = wallet.accounts.find((entry) => entry.address === address) ?? null;
  const signMessage = wallet.features[SIGN_MESSAGE_FEATURE] as
    | { signMessage?: (...inputs: { account: StandardAccount; message: Uint8Array }[]) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> }
    | undefined;
  if (typeof signMessage?.signMessage !== "function") {
    return { ok: false, state: "UNSUPPORTED", reason: `${name} cannot sign a message, so it cannot open a paper account.` };
  }
  if (!account) return { ok: false, state: "FAILED", reason: `${name} no longer offers ${address}. Reconnect and check which account is selected.` };
  try {
    const message = new TextEncoder().encode(messageText);
    const [output] = await withWalletPromptTimeout(signMessage.signMessage({ account, message }), promptTimeoutFor(name));
    if (!output) return { ok: false, state: "FAILED", reason: `${name} returned no signature.` };
    const signedMessage = signedMessageText(message, output.signedMessage, output.signature);
    return { ok: true, address, signedMessage, signature: output.signature, via: "signMessage" };
  } catch (failure) {
    return classify(failure);
  }
}
