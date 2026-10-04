/**
 * Which networks Relay can actually carry right now, in Relay's own words.
 *
 * The network and asset selectors are live but never a huge catalogue, and a
 * network or asset is never shown as available only because it appears in the
 * currencies index — **Relay knowing about a network is not Relay having an
 * executable route.**
 *
 * `GET /chains` carries every per-network fact this product used to keep by hand:
 * the chain id, the display name, an RPC, an explorer, the native currency, the
 * virtual machine, and — the part a hand-maintained table can never have — the
 * live state. A chain Relay disables, or one whose block production is lagging,
 * stops being offered the moment it changes, without a release.
 *
 * ## Two gates, and they are different questions
 *
 * 1. **Can Relay carry it?** `depositEnabled`, not `disabled`, not lagging. This
 *    module answers that, from the provider.
 * 2. **Can Ryntra sign for it?** A network is only offerable if this product has
 *    a signer for its virtual machine and the facts to explain it afterwards. 51
 *    of Relay's 60 chains are EVM and two are SVM; the rest are `hypevm`,
 *    `xrpvm`, `bvm`, `tonvm` and `tvm`, and offering one of those would be
 *    offering a route nobody here could build a transaction for.
 *
 * Neither gate is a promise of a route. Only a live quote is, and that is
 * deliberately somewhere else: a pair can pass both gates and still have no
 * liquidity at this size, this minute.
 */

import { RELAY_API_ORIGIN } from "./chains.ts";
import { relayHeaders, type RelayAuth } from "./http.ts";

export const RELAY_CHAINS_PATH = "/chains";

/** The virtual machines this product has a signer for. Everything else is out. */
export const SIGNABLE_VM_TYPES = ["evm", "svm"] as const;
export type SignableVmType = (typeof SIGNABLE_VM_TYPES)[number];

export type RelayChainRow = Readonly<{
  id: number;
  /** Relay's slug, e.g. `base`. Stable enough to key on; the label is not. */
  name: string;
  displayName: string;
  vmType: SignableVmType;
  httpRpcUrl: string | null;
  explorerUrl: string | null;
  explorerName: string | null;
  nativeSymbol: string | null;
  nativeName: string | null;
  nativeDecimals: number | null;
  /** Relay's own live state, folded into one answer. */
  carrying: boolean;
  /** Why not, when `carrying` is false — for an operator, never for a customer. */
  notCarryingReason: "DEPOSITS_OFF" | "DISABLED" | "BLOCKS_LAGGING" | null;
  /** The tokens Relay itself features on this chain: the honest "popular" list. */
  featuredTokens: readonly string[];
}>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSignable(value: unknown): value is SignableVmType {
  return typeof value === "string" && (SIGNABLE_VM_TYPES as readonly string[]).includes(value);
}

/**
 * Fold one of Relay's rows into the shape this product reads, or `null` when the
 * row is for a machine nothing here can sign on.
 *
 * Exported and pure so the filtering can be tested against real recorded rows
 * rather than against a live endpoint — the part that can be quietly wrong is
 * which chains survive, not the fetch.
 */
export function normalizeRelayChain(raw: unknown): RelayChainRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = num(row.id);
  const name = str(row.name);
  if (id === null || name === null || !isSignable(row.vmType)) return null;

  const currency = typeof row.currency === "object" && row.currency !== null ? (row.currency as Record<string, unknown>) : {};
  /* Ordered so the reason a person cannot use a chain is the most specific one
     true of it, rather than whichever field happened to be read first. */
  const notCarryingReason: RelayChainRow["notCarryingReason"] =
    row.disabled === true ? "DISABLED" : row.depositEnabled === false ? "DEPOSITS_OFF" : row.blockProductionLagging === true ? "BLOCKS_LAGGING" : null;

  return {
    id,
    name,
    displayName: str(row.displayName) ?? name,
    vmType: row.vmType,
    httpRpcUrl: str(row.httpRpcUrl),
    explorerUrl: str(row.explorerUrl),
    explorerName: str(row.explorerName),
    nativeSymbol: str(currency.symbol),
    nativeName: str(currency.name),
    nativeDecimals: num(currency.decimals),
    carrying: notCarryingReason === null,
    notCarryingReason,
    featuredTokens: Array.isArray(row.featuredTokens) ? row.featuredTokens.filter((token): token is string => typeof token === "string") : [],
  };
}

export type RelayChainIndex = Readonly<{ ok: true; chains: readonly RelayChainRow[]; observedAt: string }>;
export type RelayChainFailure = Readonly<{ ok: false; reason: "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE"; message: string }>;

export type RelayChainDependencies = RelayAuth &
  Readonly<{
    fetchImpl?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    now?: () => Date;
  }>;

/**
 * The index, cached in the module for a few minutes.
 *
 * Chain metadata changes on the scale of weeks and a chain going down is the one
 * thing worth catching quickly, so the window is short enough to notice an
 * outage and long enough that opening the selector does not cost a request. It
 * is deliberately **not** stored per request: every surface asking the same
 * question in the same minute should ask Relay once.
 */
const CACHE_MS = 5 * 60_000;
let cache: Readonly<{ at: number; value: RelayChainIndex }> | null = null;

/** For tests, and for an operator who has just changed something at Relay. */
export function resetRelayChainCache(): void {
  cache = null;
}

export async function fetchRelayChains(deps: RelayChainDependencies = {}): Promise<RelayChainIndex | RelayChainFailure> {
  const now = deps.now ?? (() => new Date());
  if (cache !== null && now().getTime() - cache.at < CACHE_MS) return cache.value;

  const url = new URL(RELAY_CHAINS_PATH, deps.origin ?? RELAY_API_ORIGIN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
  try {
    const response = await (deps.fetchImpl ?? fetch)(url.toString(), {
      method: "GET",
      headers: relayHeaders({ apiKey: deps.apiKey }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "HTTP_ERROR", message: `Relay answered HTTP ${response.status}.` };
    const payload = (await response.json()) as { chains?: unknown };
    const rows = Array.isArray(payload.chains) ? payload.chains : Array.isArray(payload) ? payload : null;
    if (rows === null) return { ok: false, reason: "UNREADABLE", message: "Relay's chain index had no chains array." };
    const chains = rows.map(normalizeRelayChain).filter((row): row is RelayChainRow => row !== null);
    const value: RelayChainIndex = { ok: true, chains, observedAt: now().toISOString() };
    cache = { at: now().getTime(), value };
    return value;
  } catch (error) {
    return { ok: false, reason: "TRANSPORT", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
