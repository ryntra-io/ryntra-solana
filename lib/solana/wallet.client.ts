/**
 * Talking to a Solana wallet, in the browser and nowhere else.
 *
 * The Wallet Standard is read off `window.navigator.wallets` — Phantom,
 * Solflare and Backpack all register there — so this module names no wallet
 * and hard-codes no extension. What it does hard-code is the boundary: it asks
 * for `solana:signTransaction`, never `solana:signAndSendTransaction`.
 *
 * That choice is the whole design. A wallet that signs *and sends* leaves no
 * moment between the signature and the network for anyone to compare what was
 * signed against what was built — the comparison would happen after the money
 * moved, which is diagnosis rather than control. Signing alone gives that
 * moment back, and `signature.ts` uses it.
 *
 * The file is `.client.ts` because it only exists where `window` does. No key,
 * no seed, no secret of any kind passes through here; a wallet returns signed
 * bytes and that is the entire surface.
 */

export const WALLET_STATES = [
  "UNSUPPORTED",
  "NO_WALLET",
  "READY",
  "CONNECTING",
  "CONNECTED",
  "REFUSED",
  "PENDING",
  "FAILED",
] as const;
export type WalletState = (typeof WALLET_STATES)[number];

export type DetectedWallet = Readonly<{
  name: string;
  icon: string | null;
  /** True when the wallet advertises the devnet chain this lifecycle needs. */
  supportsDevnet: boolean;
  /** True when it already holds an account on a Solana chain, not just the feature. */
  hasSolanaAccount: boolean;
}>;

export type WalletConnection = Readonly<{
  wallet: string;
  address: string;
  chains: readonly string[];
}>;

type StandardAccount = Readonly<{ address: string; chains: readonly string[]; features: readonly string[] }>;

type StandardWallet = Readonly<{
  name: string;
  icon?: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
}>;

const SIGN_FEATURE = "solana:signTransaction";
const CONNECT_FEATURE = "standard:connect";
const DEVNET_CHAIN = "solana:devnet";
const WALLET_PROMPT_TIMEOUT_MS = 20_000;

export async function withWalletPromptTimeout<T>(
  pending: Promise<T>,
  timeoutMs = WALLET_PROMPT_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const failure = new Error(
        "The wallet is still waiting for an answer in its extension window.",
      ) as Error & { code: number };
      failure.code = -32002;
      reject(failure);
    }, timeoutMs);
  });
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * The Wallet Standard registry, discovered the way the standard actually works.
 *
 * The first version of this read `navigator.wallets.get()` and found nothing
 * with Phantom installed and visible in the toolbar — because that was an early
 * draft of the proposal that never shipped. The protocol wallets implement is
 * **event-based**, and deliberately symmetric, because either side can be ready
 * first:
 *
 * - a wallet that loaded before this page fires `wallet-standard:register-wallet`
 *   carrying a callback; the page calls it with its own registration API;
 * - a page that loads before a wallet dispatches `wallet-standard:app-ready`
 *   carrying that same API; wallets call it when they appear.
 *
 * Listening for one and not dispatching the other is a detector that works on
 * exactly half the load orders, which is worse than one that never works —
 * it fails intermittently and reads as the user's problem.
 */
const discovered = new Set<StandardWallet>();
const subscribers = new Set<() => void>();
let listening = false;

type RegistrationApi = Readonly<{ register: (...wallets: StandardWallet[]) => () => void }>;

function announce(): void {
  for (const subscriber of subscribers) subscriber();
}

/**
 * Be told when the registry changes.
 *
 * Reading it once at mount is the half-working detector this file already
 * warns about, in its other form. A page can win the race with a wallet as
 * easily as lose it: `app-ready` is dispatched on mount and a wallet that
 * injects a moment later registers correctly, into a list nobody reads again.
 * The surface then says "no wallet detected" over a wallet sitting in the
 * toolbar, and reloading fixes it — which reads to the person as their
 * problem rather than as ours.
 *
 * Returns its own unsubscribe. Discovery itself is never torn down: the
 * listener is the registry's, not any one component's, and a second component
 * mounting must not re-dispatch `app-ready` at wallets that already answered.
 */
export function subscribeWallets(listener: () => void): () => void {
  startDiscovery();
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/** Observe account changes without reconnecting or asking for any signature. */
export function watchWalletAccounts(name: string, changed: (connection: WalletConnection | null) => void): () => void {
  const wallet = registeredWallet(name);
  if (!wallet) return () => undefined;
  let last = selectSolanaAccount(wallet.accounts)?.address ?? null;
  const publish = (accounts: readonly StandardAccount[]) => {
    const account = selectSolanaAccount(accounts);
    const address = account?.address ?? null;
    if (address === last) return;
    last = address;
    changed(account ? { wallet: name, address: account.address, chains: account.chains } : null);
  };
  const events = wallet.features["standard:events"] as { on?: (event: "change", listener: (props: { accounts?: readonly StandardAccount[] }) => void) => () => void } | undefined;
  const off = events?.on?.("change", (props) => { if (props.accounts) publish(props.accounts); });
  const read = () => publish(wallet.accounts);
  const timer = setInterval(read, 1000);
  window.addEventListener("focus", read);
  return () => { off?.(); clearInterval(timer); window.removeEventListener("focus", read); };
}

function startDiscovery(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;

  const api: RegistrationApi = {
    register: (...wallets) => {
      for (const wallet of wallets) discovered.add(wallet);
      announce();
      return () => {
        for (const wallet of wallets) discovered.delete(wallet);
        announce();
      };
    },
  };

  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const callback = (event as CustomEvent<(api: RegistrationApi) => void>).detail;
    if (typeof callback === "function") callback(api);
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
}

function registry(): readonly StandardWallet[] {
  startDiscovery();
  return [...discovered];
}

/**
 * Wallets that can sign a Solana transaction, best first.
 *
 * Ranked rather than dumped. A browser with five extensions registers five
 * entries, and listing them as five equal buttons is a registry printed on a
 * screen — it makes the person do the sorting that this code already knows how
 * to do. Wallets whose accounts actually carry a Solana chain come first,
 * because a multi-chain extension can advertise the sign feature while holding
 * no Solana account at all, and a Solana devnet account outranks the rest.
 */
const SOLANA_CHAIN_PREFIX = "solana:";

/** Pick an account that is actually a Solana signer; never fall back to an EVM account. */
export function selectSolanaAccount(accounts: readonly StandardAccount[]): StandardAccount | null {
  return (
    accounts.find(
      (account) =>
        account.features.includes(SIGN_FEATURE) &&
        account.chains.some((chain) => chain.startsWith(SOLANA_CHAIN_PREFIX)),
    ) ?? null
  );
}

export function detectWallets(): readonly DetectedWallet[] {
  const seen = new Set<string>();
  return registry()
    .filter((wallet) => {
      if (!(SIGN_FEATURE in wallet.features) || seen.has(wallet.name)) return false;
      seen.add(wallet.name);
      return true;
    })
    .map((wallet) => {
      const solanaAccounts = wallet.accounts.filter((account) =>
        account.chains.some((chain) => chain.startsWith(SOLANA_CHAIN_PREFIX)),
      );
      return {
        name: wallet.name,
        icon: wallet.icon ?? null,
        supportsDevnet: wallet.chains.includes(DEVNET_CHAIN),
        hasSolanaAccount: solanaAccounts.length > 0,
      };
    })
    .sort((left, right) => {
      const score = (entry: DetectedWallet) => (entry.hasSolanaAccount ? 2 : 0) + (entry.supportsDevnet ? 1 : 0);
      const difference = score(right) - score(left);
      return difference !== 0 ? difference : left.name.localeCompare(right.name);
    });
}

/**
 * The wallet a name means, and only ever one this workspace could use.
 *
 * A name is not unique in the Wallet Standard registry. Phantom registers twice
 * in a browser that has its Sui support enabled — one entry with
 * `solana:signTransaction`, one with `sui:*` and no Solana feature at all — and
 * MetaMask does the same for Bitcoin. `detectWallets` already filters on
 * {@link SIGN_FEATURE}, so the *list* is correct; this lookup did not, so the
 * name the list showed resolved to whichever entry happened to register first.
 *
 * Observed on 2026-09-04: pressing `Phantom` connected Phantom's Sui interface,
 * which returned Sui accounts, `selectSolanaAccount` found none, and the card
 * reported that a wallet the person had just approved had "offered no account".
 * The wallet was fine. The lookup was asking the wrong half of it.
 *
 * The filter is the same one the list uses, so a name can only ever resolve to
 * a wallet the person was actually offered.
 */
function findWallet(name: string): StandardWallet | null {
  const all = registry().filter((wallet) => wallet.name === name);
  /* Prefer the entry this workspace can actually use, and fall back to any
     entry of that name rather than returning nothing.

     The fallback is not tidiness. `signTransaction` resolves through here too,
     and its most useful refusal — *this wallet can only sign and send in one
     step, and this transfer is checked between the signature and the network* —
     can only be reached by finding a wallet that lacks the feature. Filtering
     it out would have replaced that sentence with "no longer registered in this
     browser", which is both wrong and unactionable. Connecting still gets the
     right half, because the right half is preferred whenever it exists. */
  return all.find((wallet) => SIGN_FEATURE in wallet.features) ?? all[0] ?? null;
}

/**
 * The registered wallet of that name, for the one module that signs
 * something other than a transaction.
 *
 * `wallet-signin.client.ts` used to look wallets up through
 * `navigator.wallets.get()` — the early draft of the standard the comment at
 * the top of this file already records as never having shipped — and through
 * a global nobody wrote to. With Phantom connected and its address in the top
 * bar, proof of ownership answered "Phantom is no longer registered in this
 * browser". The event-based registry here is the one that actually sees the
 * wallet, so sign-in resolves through it.
 */
export function registeredWallet(name: string): Readonly<{
  name: string;
  accounts: readonly Readonly<{ address: string; chains: readonly string[]; features: readonly string[] }>[];
  features: Record<string, unknown>;
}> | null {
  return findWallet(name);
}

export type ConnectResult =
  | Readonly<{ ok: true; connection: WalletConnection }>
  | Readonly<{ ok: false; state: WalletState; reason: string }>;

/**
 * What a wallet's own throw actually meant.
 *
 * The three answers are not interchangeable and calling them all `REFUSED` is
 * how this surface told a person a lie: a MetaMask with an unanswered popup
 * throws `-32002`, the panel titled it "The wallet refused", and `Try again`
 * re-sent the request the extension was already refusing to queue. Nobody had
 * refused anything and the one action that would have helped — open the
 * extension and answer what is waiting there — was on no surface.
 *
 * The codes are EIP-1193's, not the Wallet Standard's, which mandates none.
 * That is exactly why they are read as a hint rather than trusted as a
 * contract: `4001` and `-32002` are what MetaMask, OKX and Phantom actually
 * emit, and **anything else is `FAILED`** — an unclassified failure said out
 * loud, never a refusal inferred from silence.
 */
function classifyFailure(failure: unknown): { state: WalletState; reason: string } | null {
  if (typeof failure !== "object" || failure === null) return null;
  const code = (failure as { code?: unknown }).code;
  const message = failure instanceof Error ? failure.message : String((failure as { message?: unknown }).message ?? "");
  if (code === 4001) return { state: "REFUSED", reason: message };
  if (code === -32002) return { state: "PENDING", reason: message };
  return message ? { state: "FAILED", reason: message } : null;
}

/**
 * Ask one wallet to connect and report which account it offered.
 *
 * A refusal is an ordinary answer — the person clicked cancel — and comes back
 * as a value, because throwing here would turn "no thanks" into an error
 * banner. What it is *not* is the only answer: see `classifyFailure`.
 */
export async function connectWallet(name: string): Promise<ConnectResult> {
  const wallet = findWallet(name);
  if (!wallet) {
    return { ok: false, state: "NO_WALLET", reason: `${name} is no longer registered in this browser.` };
  }
  const connect = wallet.features[CONNECT_FEATURE] as
    | { connect?: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardAccount[] }> }
    | undefined;
  if (typeof connect?.connect !== "function") {
    return { ok: false, state: "UNSUPPORTED", reason: `${name} does not implement the standard connect feature.` };
  }

  try {
    const { accounts } = await withWalletPromptTimeout(connect.connect());
    const account = selectSolanaAccount(accounts);
    if (!account) {
      /* Connected and handed back nothing is a failure of the handshake, not a
         refusal. The person answered; the wallet did not. */
      return {
        ok: false,
        state: "UNSUPPORTED",
        reason: `${name} connected but offered no account that advertises both a Solana chain and solana:signTransaction.`,
      };
    }
    return {
      ok: true,
      connection: { wallet: name, address: account.address, chains: account.chains },
    };
  } catch (failure) {
    const classified = classifyFailure(failure);
    if (classified) return { ok: false, ...classified };
    return { ok: false, state: "FAILED", reason: `${name} did not connect, and gave no reason.` };
  }
}

/**
 * Restore a connection the wallet already trusts, without asking anybody.
 *
 * The workspace has never auto-connected, and the reason it gives is right: a
 * wallet prompt that appears because a page loaded is a permission request
 * nobody made. That rule is kept here rather than traded away. Wallet Standard
 * defines `connect({ silent: true })` as the call that **must not prompt** — it
 * returns the accounts this origin has already been granted, or nothing at all.
 * So the person is asked exactly once, ever, and the answer survives.
 *
 * What this buys is not convenience. `SolanaConnectionProvider` holds the
 * connection in React state, and `/agents/workspace` is outside that provider,
 * so before this a single trip out of the Solana tree and back left holdings,
 * history, receipts, receive, send, swap and bridge all disconnected, and
 * emptied Activity — receipts are keyed by the connected address. "One wallet
 * context" was true in the product decision and false in the code.
 *
 * A wallet that does not implement the silent path, or that has not been
 * granted this origin, answers with no account. That is not an error and is not
 * reported as one: it simply means the person is not connected, which is the
 * state they were in a moment ago anyway.
 */
export async function reconnectWallet(name: string): Promise<ConnectResult> {
  const wallet = findWallet(name);
  if (!wallet) {
    return { ok: false, state: "NO_WALLET", reason: `${name} is no longer registered in this browser.` };
  }
  const connect = wallet.features[CONNECT_FEATURE] as
    | { connect?: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardAccount[] }> }
    | undefined;
  if (typeof connect?.connect !== "function") {
    return { ok: false, state: "UNSUPPORTED", reason: `${name} does not implement the standard connect feature.` };
  }

  try {
    const { accounts } = await withWalletPromptTimeout(connect.connect({ silent: true }));
    const account = selectSolanaAccount(accounts);
    if (!account) {
      /* Not trusted yet, or trusted for a chain we cannot sign on. Silence is
         the correct outcome: nothing is restored and nothing is said. */
      return { ok: false, state: "REFUSED", reason: `${name} has not granted this site an account.` };
    }
    return { ok: true, connection: { wallet: name, address: account.address, chains: account.chains } };
  } catch (failure) {
    const classified = classifyFailure(failure);
    if (classified) return { ok: false, ...classified };
    return { ok: false, state: "FAILED", reason: `${name} did not restore, and gave no reason.` };
  }
}

export type SignResult =
  | Readonly<{ ok: true; signedWireBase64: string }>
  | Readonly<{ ok: false; reason: string }>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Hand the exact bytes to the wallet and return exactly what it gives back.
 *
 * Nothing is interpreted here — no field is read, no signature is extracted,
 * nothing is called valid. That happens in `signature.ts`, over the returned
 * bytes, deliberately in a module that never touched the wallet.
 */
export async function signTransaction(args: {
  wallet: string;
  address: string;
  unsignedWireBase64: string;
  chain?: string;
}): Promise<SignResult> {
  const wallet = findWallet(args.wallet);
  if (!wallet) return { ok: false, reason: `${args.wallet} is no longer registered in this browser.` };

  const feature = wallet.features[SIGN_FEATURE] as
    | {
        signTransaction?: (
          input: Readonly<{ account: StandardAccount; transaction: Uint8Array; chain: string }>,
        ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
      }
    | undefined;
  if (typeof feature?.signTransaction !== "function") {
    /* The one refusal a person can act on, so it says what to do. Naming no
       wallet, per this module's own rule — the fact that matters is the
       capability, not the brand. */
    return {
      ok: false,
      reason:
        `${args.wallet} can only sign and send in one step. This transfer is checked between the ` +
        `signature and the network, so it needs a wallet that signs without sending.`,
    };
  }

    const account = selectSolanaAccount(
      wallet.accounts.filter((entry) => entry.address === args.address),
    );
  if (!account) {
    return {
      ok: false,
      reason: `${args.wallet} no longer offers ${args.address}. Reconnect and check which account is selected.`,
    };
  }

  try {
    const [output] = await feature.signTransaction({
      account,
      transaction: fromBase64(args.unsignedWireBase64),
      chain: args.chain ?? DEVNET_CHAIN,
    });
    if (!output?.signedTransaction) {
      return { ok: false, reason: `${args.wallet} returned no signed transaction.` };
    }
    return { ok: true, signedWireBase64: toBase64(output.signedTransaction) };
  } catch (failure) {
    return {
      ok: false,
      reason: failure instanceof Error ? failure.message : `${args.wallet} refused to sign.`,
    };
  }
}

export type SignManyResult =
  | Readonly<{ ok: true; signedWireBase64: readonly string[] }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Several server-built transactions signed in one prompt — Wallet Standard's
 * `solana:signTransaction` takes many inputs at once, and the wallet shows
 * them together. Nothing is sent: each signed one goes back to the server,
 * which checks it against what it built. A wallet that returns fewer than it
 * was given has signed nothing usable.
 */
export async function signTransactions(args: {
  wallet: string;
  address: string;
  unsignedWireBase64: readonly string[];
  chain?: string;
}): Promise<SignManyResult> {
  if (args.unsignedWireBase64.length === 1) {
    const one = await signTransaction({ wallet: args.wallet, address: args.address, unsignedWireBase64: args.unsignedWireBase64[0] ?? "", chain: args.chain });
    return one.ok ? { ok: true, signedWireBase64: [one.signedWireBase64] } : one;
  }
  const wallet = findWallet(args.wallet);
  if (!wallet) return { ok: false, reason: `${args.wallet} is no longer registered in this browser.` };
  const feature = wallet.features[SIGN_FEATURE] as
    | {
        signTransaction?: (
          ...inputs: Readonly<{ account: StandardAccount; transaction: Uint8Array; chain: string }>[]
        ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
      }
    | undefined;
  if (typeof feature?.signTransaction !== "function") {
    return { ok: false, reason: `${args.wallet} can only sign and send in one step; this needs a wallet that signs without sending.` };
  }
  const account = selectSolanaAccount(wallet.accounts.filter((entry) => entry.address === args.address));
  if (!account) return { ok: false, reason: `${args.wallet} no longer offers ${args.address}. Reconnect and check which account is selected.` };
  try {
    const outputs = await feature.signTransaction(
      ...args.unsignedWireBase64.map((wire) => ({ account, transaction: fromBase64(wire), chain: args.chain ?? DEVNET_CHAIN })),
    );
    if (outputs.length !== args.unsignedWireBase64.length || outputs.some((output) => !output?.signedTransaction)) {
      return { ok: false, reason: `${args.wallet} returned fewer signed transactions than it was given.` };
    }
    return { ok: true, signedWireBase64: outputs.map((output) => toBase64(output.signedTransaction)) };
  } catch (failure) {
    return { ok: false, reason: failure instanceof Error ? failure.message : `${args.wallet} refused to sign.` };
  }
}
