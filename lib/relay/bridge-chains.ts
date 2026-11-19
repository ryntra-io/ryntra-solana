/**
 * Every network the Bridge can carry, in Relay's own words.
 *
 * The Bridge page used to offer six networks written into `catalog.ts` by hand,
 * USDC only, Solana on one end. «через релей. Всі,
 * повністю всі, які там є мережі». So the list is Relay's `GET /chains`, whole:
 * every chain whose deposits Relay has open, whose blocks are not lagging and
 * which it has not disabled — 58 on 18.11, of eight machines (49 EVM, Solana and
 * Eclipse, Bitcoin, Tron, TON, XRP, Hyperliquid, Lighter). A chain Relay adds
 * tomorrow appears tomorrow; one it closes disappears the same minute.
 *
 * What this module adds to Relay's row is only what a person needs to *use* a
 * chain from this page:
 *
 * - **which wallet signs on it.** An EVM chain is the browser's EVM wallet; Solana
 *   is the Solana wallet the terminal already connects. Any other chain has no
 *   wallet here — money leaves it through a deposit address Relay opens for the
 *   exact amount, and only where Relay says it can (`depositAddressEnabled`).
 *   Hyperliquid is one of those: its SDK step posts the signature to
 *   Hyperliquid's own API, which this site's policy keeps the page from reaching.
 * - **whose address receives there.** An EVM wallet's address is also its address
 *   on Hyperliquid, so money lands there in the person's own EVM wallet.
 * - **how Relay's order names it** (`protocol.v2.chainId`), because the refund
 *   check reads the order's chain by that word, not by the number.
 *   The words read by hand off live orders (`RELAY_ORDER_CHAIN_NAMES`) win where
 *   they exist; the rest come from the same index the order is built against.
 * - **which contracts may be the target of a signature on it** — Relay's own,
 *   as its index lists them. A step that targets anything else is refused before
 *   a wallet is asked (`bridge-quote.ts`).
 *
 * Pure apart from the one fetch, which takes an injected `fetchImpl`; the
 * normalising is exported and tested against a recorded index.
 */

import { RELAY_API_ORIGIN, RELAY_CHAIN_IDS, RELAY_ORDER_CHAIN_NAMES, RELAY_SOLANA_CHAIN_ID } from "./chains.ts";
import { relayHeaders, type RelayAuth } from "./http.ts";

export const BRIDGE_VMS = ["evm", "svm", "bvm", "tvm", "tonvm", "xrpvm", "hypevm", "lvm"] as const;
export type BridgeVm = (typeof BRIDGE_VMS)[number];

/** The wallet this page signs with on a chain — or, as `owner`, whose address receives there — or none. */
export type BridgeWallet = "evm" | "solana" | null;

export type BridgeToken = Readonly<{
  chainId: number;
  /** Contract on an EVM chain, mint on Solana, Relay's own sentinel for a chain's coin. */
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  /** Whether Relay's index vouches for it. Shown, never used to hide a coin. */
  verified: boolean;
  /** Relay's logo address for it — fetched only by the server (`/api/swap/bridge/icon`), never by a browser. */
  logo: string | null;
}>;

export type BridgeChain = Readonly<{
  id: number;
  /** Relay's slug: `base`, `bsc`, `bitcoin`. */
  name: string;
  label: string;
  vm: BridgeVm;
  wallet: BridgeWallet;
  /** The wallet whose address is the person's own on this chain: where money lands by default. */
  owner: BridgeWallet;
  /** Relay can open a deposit address on it — the way money leaves a chain no wallet here signs on. */
  depositAddress: boolean;
  /** How Relay's order names the chain (`protocol.v2.chainId`). */
  order: string | null;
  /** Relay's depository on the chain (`protocol.v2.depository`). */
  depository: string | null;
  /**
   * Relay's own entry contracts on an EVM chain, lowercased — its routers, approval proxies and receiver, every version
   * the index names: with the depository, the only addresses a step may call. Never the multicall contracts the same
   * index lists: anyone can make those move value.
   */
  contracts: readonly string[];
  /** Where an approval may point: the depository and the approval proxies, lowercased. */
  spenders: readonly string[];
  explorer: string | null;
  /** Relay's public RPC for the chain: read by the server for a balance, never handed to a browser. */
  rpc: string | null;
  icon: string | null;
  native: BridgeToken;
  featured: readonly BridgeToken[];
}>;

/** What a browser is told about a chain: no RPC, no contract list, no logo host. */
export type BridgeChainView = Readonly<{
  id: number;
  name: string;
  label: string;
  vm: BridgeVm;
  wallet: BridgeWallet;
  owner: BridgeWallet;
  /** Money can leave this chain from this page: a wallet signs on it, or Relay opens a deposit address. */
  send: boolean;
  deposit: boolean;
  explorer: string | null;
  native: BridgeTokenView;
  featured: readonly BridgeTokenView[];
}>;

export type BridgeTokenView = Omit<BridgeToken, "logo"> & Readonly<{ logo: boolean }>;

const str = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function isVm(value: unknown): value is BridgeVm {
  return typeof value === "string" && (BRIDGE_VMS as readonly string[]).includes(value);
}

function walletOf(vm: BridgeVm, id: number): BridgeWallet {
  if (vm === "evm") return "evm";
  if (vm === "svm" && id === RELAY_SOLANA_CHAIN_ID) return "solana";
  return null;
}

function ownerOf(vm: BridgeVm, id: number): BridgeWallet {
  return vm === "hypevm" ? "evm" : walletOf(vm, id);
}

/** One of Relay's currency rows, as a coin of the given chain; null when it cannot size an amount. */
export function normalizeBridgeToken(raw: unknown, chainId: number): BridgeToken | null {
  const row = record(raw);
  if (!row) return null;
  const address = str(row.address);
  const symbol = str(row.symbol);
  const decimals = num(row.decimals);
  if (!address || !symbol || decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const metadata = record(row.metadata);
  const rowChain = num(row.chainId);
  return {
    chainId: rowChain ?? chainId,
    address,
    symbol,
    name: str(row.name),
    decimals,
    verified: metadata?.verified === true,
    logo: str(metadata?.logoURI) ?? str(row.logoURI),
  };
}

/** The entry contracts a Relay order is signed into, by name only. `multicall3` and the multicallers are not among them. */
const ENTRY_KEYS = ["erc20Router", "approvalProxy", "relayReceiver"] as const;
const SPENDER_KEYS = ["approvalProxy"] as const;

/** Relay's contracts of the given names in a chain row, at the top and in each version (`v3`, `v3.2`), lowercased. */
function contractsOf(raw: unknown, keys: readonly string[]): string[] {
  const found = new Set<string>();
  const take = (row: Record<string, unknown> | null) => {
    if (!row) return;
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) found.add(value.toLowerCase());
    }
  };
  const top = record(raw);
  take(top);
  for (const [key, value] of Object.entries(top ?? {})) if (/^v\d/.test(key)) take(record(value));
  return [...found];
}

/** The machines Relay names as deposit-address chains in its index but refuses an address on when asked (18.11). */
const NO_DEPOSIT_ADDRESS: readonly BridgeVm[] = ["xrpvm", "tonvm"];

/**
 * One row of Relay's `/chains`, or null when the chain cannot carry money right now (disabled, deposits off, blocks
 * lagging) or is not a machine Relay names in this module.
 */
export function normalizeBridgeChain(raw: unknown): BridgeChain | null {
  const row = record(raw);
  if (!row) return null;
  const id = num(row.id);
  const name = str(row.name);
  if (id === null || !name || !isVm(row.vmType)) return null;
  if (row.disabled === true || row.depositEnabled === false || row.blockProductionLagging === true) return null;
  const native = normalizeBridgeToken(row.currency, id);
  if (!native) return null;
  // A chain's own coin carries no logo in the index; Relay keeps one by the coin's id on its own asset host.
  const currencyId = str(record(row.currency)?.id);
  const nativeLogo = native.logo ?? (currencyId && /^[a-z0-9-]{1,32}$/.test(currencyId) ? `https://assets.relay.link/icons/currencies/${currencyId}.png` : null);
  const protocol = record(record(row.protocol)?.v2);
  const featured = (Array.isArray(row.featuredTokens) ? row.featuredTokens : []).map((token) => normalizeBridgeToken(token, id)).filter((token): token is BridgeToken => token !== null);
  return {
    id,
    name,
    label: str(row.displayName) ?? name,
    vm: row.vmType,
    wallet: walletOf(row.vmType, id),
    owner: ownerOf(row.vmType, id),
    depositAddress: row.depositAddressEnabled === true && !NO_DEPOSIT_ADDRESS.includes(row.vmType),
    order: str(protocol?.chainId),
    depository: str(protocol?.depository),
    contracts: row.vmType === "evm" ? contractsOf(row.contracts, ENTRY_KEYS) : [],
    spenders: row.vmType === "evm" ? [...new Set([...(str(protocol?.depository) ? [str(protocol?.depository)!.toLowerCase()] : []), ...contractsOf(row.contracts, SPENDER_KEYS)])] : [],
    explorer: str(row.explorerUrl),
    rpc: str(row.httpRpcUrl),
    icon: str(row.iconUrl),
    native: { ...native, verified: true, logo: nativeLogo },
    featured,
  };
}

/**
 * The order a person meets the chains in: Solana first — this is a Solana terminal — then the ones most reached for,
 * then the rest by name. Curated, not computed, so the list does not reshuffle between visits.
 */
export const BRIDGE_POPULAR = ["base", "ethereum", "arbitrum", "bsc", "bitcoin", "tron", "polygon", "optimism", "avalanche", "hyperliquid", "linea", "ton"] as const;

export function orderBridgeChains(chains: readonly BridgeChain[]): BridgeChain[] {
  const rank = (chain: BridgeChain) => {
    if (chain.id === RELAY_SOLANA_CHAIN_ID) return -1;
    const popular = (BRIDGE_POPULAR as readonly string[]).indexOf(chain.name);
    return popular === -1 ? BRIDGE_POPULAR.length : popular;
  };
  return [...chains].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "en"));
}

/** What a browser is told about a chain. */
export function bridgeChainView(chain: BridgeChain): BridgeChainView {
  const token = (entry: BridgeToken): BridgeTokenView => ({ ...entry, logo: entry.logo !== null });
  return {
    id: chain.id,
    name: chain.name,
    label: chain.label,
    vm: chain.vm,
    wallet: chain.wallet,
    owner: chain.owner,
    send: chain.wallet !== null || chain.depositAddress,
    deposit: chain.depositAddress,
    explorer: chain.explorer,
    native: token(chain.native),
    featured: chain.featured.map(token),
  };
}

/**
 * The word Relay's order uses for a chain. The words read by hand off live orders win; a chain they do not
 * name takes the index's own `protocol.v2.chainId` — the same index the order is built against. Null when neither
 * names it: a refund on such a chain is refused rather than guessed.
 */
export function orderNameOf(chain: Pick<BridgeChain, "id" | "order">): string | null {
  for (const [network, id] of Object.entries(RELAY_CHAIN_IDS)) {
    if (id === chain.id) {
      const hand = RELAY_ORDER_CHAIN_NAMES[network as keyof typeof RELAY_ORDER_CHAIN_NAMES];
      if (hand) return hand;
    }
  }
  return chain.order;
}

/* ── addresses ─────────────────────────────────────────────────────────── */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Whether an address has the shape of an address on a chain of this machine. A shape, not a proof: Relay refuses an
 * address it cannot pay, and the quote's recipient is read back against this one before anything is signed.
 */
export function bridgeAddressOk(vm: BridgeVm, address: string): boolean {
  const value = address.trim();
  switch (vm) {
    case "evm":
    case "hypevm":
      return /^0x[0-9a-fA-F]{40}$/.test(value);
    case "svm":
      return value.length >= 32 && value.length <= 44 && BASE58.test(value);
    case "bvm":
      return /^(bc1)[02-9ac-hj-np-z]{25,87}$/.test(value) || (/^[13]/.test(value) && value.length >= 26 && value.length <= 35 && BASE58.test(value));
    case "tvm":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
    case "tonvm":
      return /^[EUk0][Qf][A-Za-z0-9_-]{46}$/.test(value) || /^-?\d:[0-9a-fA-F]{64}$/.test(value);
    case "xrpvm":
      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);
    case "lvm":
      return /^\d{1,12}$/.test(value);
  }
}

/** Two addresses of one chain are the same: hex compares without case, everything else exactly. */
export function sameBridgeAddress(vm: BridgeVm, a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  return vm === "evm" || vm === "hypevm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The sender Relay is told for a deposit address, where no wallet sends: the burn address of the origin's machine, as
 * Relay's own SDK names them (`constants/address.ts`). Relay then has no sender to refund on the origin chain, so a
 * failed fill refunds on the destination — to the recipient, the person's own wallet (read back in `bridge-quote.ts`).
 */
export function depositSenderOf(chain: Pick<BridgeChain, "id" | "vm">): string {
  switch (chain.vm) {
    case "svm":
      return chain.id === 9_286_185 ? "CrfbABN2sSvmoZLu9eDDfXpaC2nHg42R7AXbHs9eg4S9" : "CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr";
    case "bvm":
      return "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo";
    case "tvm":
      return "THa7BwoPfacfiELa63pbmm3g5PGKYmtJyt";
    case "tonvm":
      return "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADerZ0z";
    case "xrpvm":
      return "rrrrrrrrrrrrrrrrrrrrBZbvji";
    case "lvm":
      return chain.id === 548_123_634 ? "33627" : "462196";
    default:
      /* In its checksummed spelling: as the recipient of a price asked before a wallet is connected, Relay swaps the
         all-lowercase burn address for an address of its own (seen 18.11 on every Solana → EVM preview), and the
         read-back then refuses the whole quote (`QUOTE_MISMATCH`, field `recipient`); the checksummed one it keeps. */
      return "0x000000000000000000000000000000000000dEaD";
  }
}

/* ── the index ─────────────────────────────────────────────────────────── */

export type BridgeChainIndex = Readonly<{ ok: true; chains: readonly BridgeChain[]; observedAt: string }>;
export type BridgeChainFailure = Readonly<{ ok: false; reason: "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE"; message: string }>;

export type BridgeChainDependencies = RelayAuth &
  Readonly<{
    fetchImpl?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    now?: () => Date;
  }>;

/** Read every few minutes, not per request: a chain going down is noticed within the window, and one read serves all. */
const CACHE_MS = 5 * 60_000;
/** A last good index is still served this long while Relay's index cannot be read. */
const STALE_MS = 60 * 60_000;
let cache: Readonly<{ at: number; value: BridgeChainIndex }> | null = null;
let asking: Promise<BridgeChainIndex | BridgeChainFailure> | null = null;

export function resetBridgeChainCache(): void {
  cache = null;
  asking = null;
}

/** Parse Relay's `/chains` answer into the ordered chains this page offers. */
export function readBridgeChains(payload: unknown): BridgeChain[] | null {
  const rows = Array.isArray(payload) ? payload : Array.isArray(record(payload)?.chains) ? (record(payload)!.chains as unknown[]) : null;
  if (rows === null) return null;
  return orderBridgeChains(rows.map(normalizeBridgeChain).filter((chain): chain is BridgeChain => chain !== null));
}

/** One read for every caller of the same moment; a failed read falls back to the last good index for an hour. */
export function fetchBridgeChains(deps: BridgeChainDependencies = {}): Promise<BridgeChainIndex | BridgeChainFailure> {
  const now = deps.now ?? (() => new Date());
  if (cache !== null && now().getTime() - cache.at < CACHE_MS) return Promise.resolve(cache.value);
  if (asking) return asking;
  asking = readChains(deps, now).then((value) => {
    asking = null;
    if (!value.ok && cache !== null && now().getTime() - cache.at < STALE_MS) return cache.value;
    return value;
  });
  return asking;
}

async function readChains(deps: BridgeChainDependencies, now: () => Date): Promise<BridgeChainIndex | BridgeChainFailure> {
  const url = new URL("/chains", deps.origin ?? RELAY_API_ORIGIN);
  try {
    const response = await (deps.fetchImpl ?? fetch)(url.toString(), {
      method: "GET",
      headers: relayHeaders({ apiKey: deps.apiKey }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000),
    });
    if (!response.ok) return { ok: false, reason: "HTTP_ERROR", message: `Relay answered HTTP ${response.status}.` };
    const chains = readBridgeChains(await response.json());
    if (chains === null) return { ok: false, reason: "UNREADABLE", message: "Relay's chain index had no chains array." };
    const value: BridgeChainIndex = { ok: true, chains, observedAt: now().toISOString() };
    cache = { at: now().getTime(), value };
    return value;
  } catch (error) {
    return { ok: false, reason: "TRANSPORT", message: error instanceof Error ? error.message : String(error) };
  }
}

export function chainById(chains: readonly BridgeChain[], id: number): BridgeChain | null {
  return chains.find((chain) => chain.id === id) ?? null;
}
