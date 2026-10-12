/**
 * Talking to an Ethereum wallet, in the browser and nowhere else.
 *
 * The destination half of a CCTP transfer is an ordinary EVM transaction, and
 * something has to send it. Circle does not deliver a Standard transfer, so the
 * choice is between a relayer holding a key on the server and the owner's own
 * wallet. This module is the second choice: no key, no seed, no secret passes
 * through it, and the only method it will ever ask a wallet for is a single
 * `eth_sendTransaction` whose `to` and `data` the server built and the person
 * reviewed.
 *
 * ## The chain check is not a formality
 *
 * An EVM wallet is connected to whatever network it was last on, and every
 * chain accepts the same address. Sending `receiveMessage` to the transmitter
 * address while the wallet sits on another chain would either revert or —
 * worse — reach a different contract that happens to live at the same address
 * there. With Ethereum on the same lane as Base that is no longer a
 * hypothetical: Circle's V2 contracts *do* live at the same addresses on both,
 * so a Base calldata sent from a wallet parked on Ethereum would burn real USDC
 * on the wrong chain into a message no one asked for. So the chain is read
 * first, a switch is requested if it is wrong, and the chain is read **again**
 * afterwards rather than assuming the switch took.
 *
 * Unlike the Solana side there is no sign-then-inspect moment here: EVM wallets
 * sign and send in one step. The compensating control is that the calldata is
 * built by the server, shown in the Review, and re-checked on chain afterwards
 * by reading the mint independently.
 */

export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_ID_HEX = "0x2105";
export const ETHEREUM_CHAIN_ID = 1;
export const ETHEREUM_CHAIN_ID_HEX = "0x1";
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_ID_HEX = "0x1237";

/**
 * What a wallet needs to be told to add a chain it has never heard of.
 *
 * Base and Ethereum are in every wallet already; Robinhood Chain is in none,
 * so `wallet_switchEthereumChain` answers 4902 — "unrecognized chain" — and a
 * switch that stopped there would strand a person on a screen telling them to
 * do something their wallet has no way to do. The RPC below is Robinhood's
 * own public endpoint, which its documentation marks rate-limited and not for
 * production: correct here, because it is used by the person's wallet for
 * their own transactions and never by this product's server.
 */
export type EvmChainAddParams = Readonly<{
  chainId: string;
  chainName: string;
  nativeCurrency: Readonly<{ name: string; symbol: string; decimals: number }>;
  rpcUrls: readonly string[];
  blockExplorerUrls: readonly string[];
}>;

/** The chain a call must be sent on, as the wallet needs to hear it. */
export type EvmWalletChain = Readonly<{
  id: "base" | "ethereum" | "arbitrum" | "optimism" | "polygon" | "bnb" | "robinhood";
  chainIdHex: string;
  label: string;
  /** Present only for a chain a wallet may not know; absent means "never offer to add it". */
  addParams?: EvmChainAddParams;
}>;

/*
 * The four chains added on 2026-09-10. Each carries `addParams` rather than
 * relying on the wallet already knowing it — the same reason Robinhood Chain
 * does — because a `wallet_switchEthereumChain` to a chain the wallet has never
 * seen fails with nothing a person can act on, and every fact below is Relay's
 * own for that chain rather than one typed from memory.
 *
 * `nativeCurrency` is the part worth checking twice: it is POL on Polygon and
 * BNB on BNB Chain, not ETH. A wallet told the wrong native coin displays every
 * balance and every fee under the wrong name.
 */
const ARBITRUM_CHAIN_ID_HEX = "0xa4b1";
const OPTIMISM_CHAIN_ID_HEX = "0xa";
const POLYGON_CHAIN_ID_HEX = "0x89";
const BNB_CHAIN_ID_HEX = "0x38";

export const EVM_WALLET_CHAINS: Readonly<Record<"base" | "ethereum" | "arbitrum" | "optimism" | "polygon" | "bnb" | "robinhood", EvmWalletChain>> = {
  base: { id: "base", chainIdHex: BASE_CHAIN_ID_HEX, label: "Base" },
  ethereum: { id: "ethereum", chainIdHex: ETHEREUM_CHAIN_ID_HEX, label: "Ethereum" },
  arbitrum: {
    id: "arbitrum",
    chainIdHex: ARBITRUM_CHAIN_ID_HEX,
    label: "Arbitrum",
    addParams: {
      chainId: ARBITRUM_CHAIN_ID_HEX,
      chainName: "Arbitrum One",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://arbitrum-one.publicnode.com"],
      blockExplorerUrls: ["https://arbiscan.io"],
    },
  },
  optimism: {
    id: "optimism",
    chainIdHex: OPTIMISM_CHAIN_ID_HEX,
    label: "Optimism",
    addParams: {
      chainId: OPTIMISM_CHAIN_ID_HEX,
      chainName: "OP Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://optimism.publicnode.com"],
      blockExplorerUrls: ["https://optimistic.etherscan.io"],
    },
  },
  polygon: {
    id: "polygon",
    chainIdHex: POLYGON_CHAIN_ID_HEX,
    label: "Polygon",
    addParams: {
      chainId: POLYGON_CHAIN_ID_HEX,
      chainName: "Polygon Mainnet",
      nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
      rpcUrls: ["https://polygon-bor-rpc.publicnode.com"],
      blockExplorerUrls: ["https://polygonscan.com"],
    },
  },
  bnb: {
    id: "bnb",
    chainIdHex: BNB_CHAIN_ID_HEX,
    label: "BNB Chain",
    addParams: {
      chainId: BNB_CHAIN_ID_HEX,
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "Binance Coin", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-rpc.publicnode.com"],
      blockExplorerUrls: ["https://bscscan.com"],
    },
  },
  robinhood: {
    id: "robinhood",
    chainIdHex: ROBINHOOD_CHAIN_ID_HEX,
    label: "Robinhood Chain",
    addParams: {
      chainId: ROBINHOOD_CHAIN_ID_HEX,
      chainName: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
      blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
    },
  },
};

type Eip1193Provider = Readonly<{
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
}>;

function provider(): Eip1193Provider | null {
  const candidate = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

/** Whether this browser has any wallet that speaks EIP-1193 at all. */
export function hasEvmWallet(): boolean {
  return provider() !== null;
}

export type EvmConnectResult =
  | Readonly<{ ok: true; address: string; chainIdHex: string; onBase: boolean }>
  | Readonly<{ ok: false; code: "NO_WALLET" | "REFUSED" | "NO_ACCOUNT" | "FAILED"; reason: string }>;

export async function connectEvmWallet(): Promise<EvmConnectResult> {
  const wallet = provider();
  if (!wallet) {
    return { ok: false, code: "NO_WALLET", reason: "No Ethereum wallet is available in this browser." };
  }
  let accounts: unknown;
  try {
    accounts = await wallet.request({ method: "eth_requestAccounts" });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      code: /reject|denied|4001/i.test(message) ? "REFUSED" : "FAILED",
      reason: message,
    };
  }
  const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
  if (!address) return { ok: false, code: "NO_ACCOUNT", reason: "The wallet returned no account." };
  /* A wallet answered here, so a later page load may ask it silently. Written
     only on a real connection — never on a refusal, and never on a browser that
     has not been asked. */
  writeEvmWalletHint(true);

  let chainIdHex = "";
  try {
    const chain = await wallet.request({ method: "eth_chainId" });
    chainIdHex = typeof chain === "string" ? chain.toLowerCase() : "";
  } catch (cause) {
    return { ok: false, code: "FAILED", reason: cause instanceof Error ? cause.message : String(cause) };
  }
  return {
    ok: true,
    address: address.toLowerCase(),
    chainIdHex,
    onBase: chainIdHex === BASE_CHAIN_ID_HEX,
  };
}

/**
 * The one thing remembered between page loads: that an EVM wallet was connected
 * *here* at all. Not an address, not a key — a flag, so nothing asks a browser
 * about Ethereum that has never been told about Ethereum.
 *
 * The Solana side has carried the same idea since it shipped, for the same
 * reason (`WALLET_HINT_KEY` in `connection.tsx`): a silent restore has to know
 * whether there is anything to restore.
 */
const EVM_WALLET_HINT_KEY = "ryntra.evm.wallet-hint.v1";

export function readEvmWalletHint(): boolean {
  try {
    return window.localStorage.getItem(EVM_WALLET_HINT_KEY) === "1";
  } catch {
    /* A browser with site data blocked simply has no hint, and is never asked. */
    return false;
  }
}

export function writeEvmWalletHint(connected: boolean): void {
  try {
    if (connected) window.localStorage.setItem(EVM_WALLET_HINT_KEY, "1");
    else window.localStorage.removeItem(EVM_WALLET_HINT_KEY);
  } catch {
    /* Not remembering is a worse session, never a broken one. */
  }
}

/**
 * The address this browser has **already** authorized, without asking for it.
 *
 * `eth_accounts` is the silent half of `eth_requestAccounts` — in a wallet that
 * speaks only Ethereum. **Phantom is not that wallet.** It injects
 * `window.ethereum` beside its Solana provider, and when the active Phantom
 * account is a Solana one it answers this call with a modal of its own:
 * *"Unsupported account — This website is trying to use Ethereum, which this
 * Solana account doesn't support."*
 *
 * So "silent" is a property of the wallets that were tested, not of the method,
 * and no caller may treat this as free. Call it only when the surface actually
 * has an Ethereum-style side **and** `readEvmWalletHint()` says one was
 * connected here before. A manual test met that modal on a Solana-to-Solana
 * swap, on a card with no Ethereum anything on it.
 *
 * Never a signature. An empty answer means "not connected here", which is a
 * fact and not a failure.
 */
export async function readEvmWalletAddress(): Promise<string | null> {
  const wallet = provider();
  if (!wallet) return null;
  try {
    const accounts = await wallet.request({ method: "eth_accounts" });
    const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
    return address ? address.toLowerCase() : null;
  } catch {
    /* A wallet that will not answer a silent read is simply not connected here. */
    return null;
  }
}

/**
 * Follow the account the wallet is on, for as long as the caller cares.
 *
 * A person switching accounts in their wallet expects the page to be about the
 * account they switched to. Without this the surface keeps showing the previous
 * address, its balance and its MAX — and the plan would then be built for a
 * wallet that is no longer there. Returns its own unsubscribe; a provider with
 * no event support simply never calls back.
 */
export function watchEvmWalletAddress(onChange: (address: string | null) => void): () => void {
  const wallet = provider() as (Eip1193Provider & {
    on?: (event: string, handler: (...args: never[]) => void) => void;
    removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  }) | null;
  if (!wallet || typeof wallet.on !== "function") return () => {};
  const handler = (...args: never[]) => {
    const accounts = args[0] as unknown;
    const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? (accounts[0] as string) : null;
    onChange(address ? address.toLowerCase() : null);
  };
  wallet.on("accountsChanged", handler);
  return () => {
    wallet.removeListener?.("accountsChanged", handler);
  };
}

export type EvmChainResult =
  | Readonly<{ ok: true; chainIdHex: string }>
  | Readonly<{ ok: false; code: "NO_WALLET" | "REFUSED" | "NOT_SWITCHED" | "FAILED"; reason: string }>;

/**
 * Put the wallet on the named chain, then confirm that it is.
 *
 * The second read is the point. A wallet can resolve the switch request and
 * leave the user on another network — dismissed prompt, pending approval, an
 * extension that answers optimistically — and a caller that trusted the first
 * answer would then send this chain's calldata somewhere else.
 */
export async function requireEvmChain(target: EvmWalletChain): Promise<EvmChainResult> {
  const wallet = provider();
  if (!wallet) return { ok: false, code: "NO_WALLET", reason: "No Ethereum wallet is available in this browser." };
  const wanted = target.chainIdHex.toLowerCase();
  try {
    const current = await wallet.request({ method: "eth_chainId" });
    if (typeof current === "string" && current.toLowerCase() === wanted) {
      return { ok: true, chainIdHex: wanted };
    }
  } catch (cause) {
    return { ok: false, code: "FAILED", reason: cause instanceof Error ? cause.message : String(cause) };
  }

  try {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.chainIdHex }],
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = (cause as { code?: unknown } | null)?.code;
    /* 4902 is "the wallet does not know this chain", which is the expected
       answer for Robinhood Chain rather than a failure. Offer to add it —
       once, and only for a chain this product carries add parameters for, so
       a wallet is never asked to add a network on a provider's say-so. The
       person still approves both prompts, and the confirming read below is
       still what decides. */
    const unrecognized = code === 4902 || /4902|unrecognized chain|add.*chain/i.test(message);
    if (!unrecognized || !target.addParams) {
      return {
        ok: false,
        code: /reject|denied|4001/i.test(message) ? "REFUSED" : "FAILED",
        reason: message,
      };
    }
    try {
      await wallet.request({ method: "wallet_addEthereumChain", params: [target.addParams] });
    } catch (addCause) {
      const addMessage = addCause instanceof Error ? addCause.message : String(addCause);
      return {
        ok: false,
        code: /reject|denied|4001/i.test(addMessage) ? "REFUSED" : "FAILED",
        reason: addMessage,
      };
    }
  }

  try {
    const after = await wallet.request({ method: "eth_chainId" });
    const chainIdHex = typeof after === "string" ? after.toLowerCase() : "";
    if (chainIdHex !== wanted) {
      return {
        ok: false,
        code: "NOT_SWITCHED",
        reason: `The wallet is on ${chainIdHex || "an unknown network"} rather than ${target.label}. Nothing was sent.`,
      };
    }
    return { ok: true, chainIdHex };
  } catch (cause) {
    return { ok: false, code: "FAILED", reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** The Base-only form every existing caller used. Unchanged in behaviour. */
export function requireBaseChain(): Promise<EvmChainResult> {
  return requireEvmChain(EVM_WALLET_CHAINS.base);
}

export type EvmSendResult =
  | Readonly<{ ok: true; transactionHash: string }>
  | Readonly<{ ok: false; code: "NO_WALLET" | "WRONG_CHAIN" | "REFUSED" | "FAILED"; reason: string }>;

/**
 * Send one transaction on one named chain. Exactly one, and only after the
 * chain is confirmed.
 *
 * There is no retry here and no automatic resend. A destination mint that does
 * not come back is resolved by reading the chain — the message's replay guard
 * says whether it was received — never by sending again on a timer.
 */
export async function sendEvmTransaction(args: {
  chain: EvmWalletChain;
  from: string;
  to: string;
  data: string;
  /** Hex wei carried with the call. Absent for the CCTP burn and every approval; a native-ETH swap input names it. */
  value?: string;
}): Promise<EvmSendResult> {
  const wallet = provider();
  if (!wallet) return { ok: false, code: "NO_WALLET", reason: "No Ethereum wallet is available in this browser." };

  const chain = await requireEvmChain(args.chain);
  if (!chain.ok) {
    return {
      ok: false,
      code: chain.code === "REFUSED" ? "REFUSED" : "WRONG_CHAIN",
      reason: chain.reason,
    };
  }

  try {
    const hash = await wallet.request({
      method: "eth_sendTransaction",
      params: [{ from: args.from, to: args.to, data: args.data, value: args.value ?? "0x0" }],
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return { ok: false, code: "FAILED", reason: "The wallet did not return a transaction hash." };
    }
    return { ok: true, transactionHash: hash.toLowerCase() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      code: /reject|denied|4001/i.test(message) ? "REFUSED" : "FAILED",
      reason: message,
    };
  }
}

export type EvmReceiptResult =
  | Readonly<{ ok: true; status: "SUCCESS" | "REVERTED"; blockNumber: number }>
  | Readonly<{ ok: false; code: "NO_WALLET" | "TIMEOUT" | "FAILED"; reason: string }>;

/**
 * Wait for one already-broadcast transaction to be mined, through the same
 * wallet the person signed with.
 *
 * `sendEvmTransaction` returns when the wallet hands back a hash, which is a
 * broadcast and not a result. For an ERC-20 approval that difference is the
 * whole experience: the allowance does not exist until the transaction lands,
 * so a caller that continues immediately either asks the person to guess when
 * to press again, or reads a zero allowance and asks them to approve a second
 * time — a second prompt and a second fee for an approval they already gave.
 * The first Base to Solana canary on 2026-09-07 went exactly that way, with
 * three minutes and forty-eight seconds of guessing between the two.
 *
 * This only reads. It never signs and never resends, and a timeout is reported
 * as a timeout rather than a failure: the transaction may still land, and a
 * caller must not read "not yet" as "not at all".
 */
export async function waitForEvmReceipt(
  transactionHash: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<EvmReceiptResult> {
  const wallet = provider();
  if (!wallet) return { ok: false, code: "NO_WALLET", reason: "No Ethereum wallet is available in this browser." };
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const receipt = (await wallet.request({ method: "eth_getTransactionReceipt", params: [transactionHash] })) as
        | { status?: string; blockNumber?: string }
        | null;
      if (receipt && typeof receipt.status === "string") {
        return {
          ok: true,
          status: receipt.status === "0x1" ? "SUCCESS" : "REVERTED",
          blockNumber: Number.parseInt(receipt.blockNumber ?? "0x0", 16),
        };
      }
    } catch (cause) {
      return { ok: false, code: "FAILED", reason: cause instanceof Error ? cause.message : String(cause) };
    }
    if (Date.now() >= deadline) return { ok: false, code: "TIMEOUT", reason: "The receipt did not arrive in time." };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** The Base-only form every existing caller used. Unchanged in behaviour. */
export function sendBaseTransaction(args: { from: string; to: string; data: string }): Promise<EvmSendResult> {
  return sendEvmTransaction({ ...args, chain: EVM_WALLET_CHAINS.base });
}
