/**
 * Backpack's public list of assets — the issuer source that confirms a Backpack Securities token by its own contract
 * address. Read on the server, validated, cached, never a market reference.
 *
 * `GET https://api.backpack.exchange/api/v1/assets` (no key) answers one array of assets, each with its `symbol`
 * (`ANT.US` for a share: the exchange ticker and the listing country), its `displayName` («Anthropic») and its `tokens`
 * — one per chain, each with `blockchain`, `contractAddress` (on Solana the mint), whether deposits and withdrawals are
 * open, and the withdrawal fee. Read on 2026-11-19 (`docs/research/terminal-bench-2026-11-19/ANT-LIVE.md`): `ANT.US` ·
 * «Anthropic» · Solana · `ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe`, deposits and withdrawals open. The answer
 * carries no observation time: Ryntra records when it fetched, nothing more.
 *
 * What the list decides: a venue row tagged `backpack` whose mint the list names on Solana is confirmed by the issuer
 * (`issuer-catalogue`). A row the list does not name stays what it was before the list was read — confirmed by the
 * venue's tag alone (`tag-only`) — and is never dropped for it: the list confirms, it does not delist. A failed read
 * keeps the last complete copy for twelve hours, marked stale; with no copy at all every Backpack row is `tag-only`, and the universe says the list did not answer.
 *
 * The universe reads it through the deployment's shared data cache (`readBackpackCatalogueShared`), as it reads
 * PreStocks: an instance's own copy does not outlive the instance, the shared copy does.
 */

import { unstable_cache } from "next/cache.js";

export const BACKPACK_ASSETS_URL = "https://api.backpack.exchange/api/v1/assets";
export const BACKPACK_SOURCE = { id: "issuer-backpack" as const, label: "Backpack" };

const CATALOGUE_TTL_MS = 10 * 60 * 1000;
/** A copy this old is still served, marked stale, while the issuer's API is not answering. */
export const BACKPACK_GRACE_MS = 12 * 60 * 60 * 1000;
/** The list has a few hundred assets; past this many an answer is not the list. */
const MAX_ASSETS = 2_000;

export type BackpackAsset = Readonly<{
  /** The issuer's own symbol, e.g. `ANT.US`. */
  symbol: string;
  /** The exchange ticker the symbol names — the symbol without its listing country (`ANT`). */
  ticker: string;
  /** The issuer's display name, e.g. `Anthropic`; null when it states none. */
  name: string | null;
  /** The Solana mint the issuer names for this asset. */
  solanaMint: string;
  depositEnabled: boolean | null;
  withdrawEnabled: boolean | null;
}>;

export type BackpackCatalogue = Readonly<{ ok: true; assets: readonly BackpackAsset[]; fetchedAt: string; stale: boolean }>;
export type BackpackFailure = Readonly<{ ok: false; code: "HTTP" | "SHAPE" | "NETWORK" | "RATE_LIMITED"; reason: string }>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A listing country after the ticker: `ANT.US`, `SAP.DE`. */
const COUNTRY_SUFFIX = /\.[A-Z]{2}$/;

const str = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null);
const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** `ANT.US` → `ANT`; a symbol without a listing country is its own ticker. */
export function backpackTicker(symbol: string): string {
  return symbol.replace(COUNTRY_SUFFIX, "");
}

/**
 * One asset of the list into what Ryntra keeps — one entry per Solana token it names, none when it names no valid
 * Solana mint (a coin of another chain, a fiat balance).
 */
export function normalizeBackpackAsset(raw: unknown): BackpackAsset[] {
  if (typeof raw !== "object" || raw === null) return [];
  const node = raw as Record<string, unknown>;
  const symbol = str(node.symbol, 32);
  if (!symbol || !Array.isArray(node.tokens)) return [];
  const name = str(node.displayName, 120);
  const out: BackpackAsset[] = [];
  for (const token of node.tokens.slice(0, 16)) {
    if (typeof token !== "object" || token === null) continue;
    const entry = token as Record<string, unknown>;
    const chain = str(entry.blockchain, 32);
    const mint = str(entry.contractAddress, 44);
    if (!chain || chain.toLowerCase() !== "solana" || !mint || !BASE58.test(mint)) continue;
    out.push({ symbol, ticker: backpackTicker(symbol), name, solanaMint: mint, depositEnabled: flag(entry.depositEnabled), withdrawEnabled: flag(entry.withdrawEnabled) });
  }
  return out;
}

/** The whole answer into assets; null when it is not the list. */
export function normalizeBackpackAssets(body: unknown): BackpackAsset[] | null {
  if (!Array.isArray(body) || body.length > MAX_ASSETS) return null;
  const assets: BackpackAsset[] = [];
  const seen = new Set<string>();
  for (const raw of body) {
    for (const asset of normalizeBackpackAsset(raw)) {
      if (seen.has(asset.solanaMint)) continue;
      seen.add(asset.solanaMint);
      assets.push(asset);
    }
  }
  return assets;
}

let cache: { value: BackpackCatalogue; at: number } | null = null;
let inflight: Promise<BackpackCatalogue | BackpackFailure> | null = null;

/** For tests: forget everything. */
export function resetBackpackCache(): void {
  cache = null;
  inflight = null;
}

type Deps = Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date; sleep?: (ms: number) => Promise<void> }>;

/**
 * The list, cached ten minutes; on a failed read the last complete copy is served for twelve hours, marked stale, and
 * the failure is returned only when there is nothing true to serve. One more read after a short pause when the API
 * failed on its side (a 5xx, a dropped connection) — never after a 429.
 */
export function readBackpackCatalogue(deps: Deps = {}): Promise<BackpackCatalogue | BackpackFailure> {
  const clock = deps.now ?? (() => new Date());
  const nowMs = clock().getTime();
  if (cache && nowMs - cache.at < CATALOGUE_TTL_MS) return Promise.resolve(cache.value);
  if (inflight) return inflight;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ask = () => fetchImpl(BACKPACK_ASSETS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000) }).catch((error: unknown) => error);
  inflight = (async (): Promise<BackpackCatalogue | BackpackFailure> => {
    let failure: BackpackFailure;
    try {
      let response = await ask();
      if (!(response instanceof Response) || response.status >= 500) {
        await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(800);
        const second = await ask();
        if (second instanceof Response || !(response instanceof Response)) response = second;
      }
      if (!(response instanceof Response)) throw response instanceof Error ? response : new Error(String(response));
      if (response.status === 429) failure = { ok: false, code: "RATE_LIMITED", reason: "The issuer's API rate limit was reached." };
      else if (!response.ok) failure = { ok: false, code: "HTTP", reason: `The issuer's API answered ${response.status}.` };
      else {
        const assets = normalizeBackpackAssets((await response.json()) as unknown);
        if (assets === null) failure = { ok: false, code: "SHAPE", reason: "The list of assets is not a list." };
        else {
          const value: BackpackCatalogue = { ok: true, assets, fetchedAt: clock().toISOString(), stale: false };
          cache = { value, at: nowMs };
          return value;
        }
      }
    } catch (error) {
      failure = { ok: false, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
    }
    if (cache && nowMs - cache.at < BACKPACK_GRACE_MS) return { ...cache.value, stale: true };
    return failure;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/* The deployment's shared layer: the callback throws on a failed read, so nothing false is kept and the last complete copy stays served. */
const readSharedBackpack = unstable_cache(
  async (): Promise<BackpackCatalogue> => {
    const read = await readBackpackCatalogue();
    if (!read.ok) throw new Error(`${read.code}: ${read.reason}`);
    return read;
  },
  ["backpack-assets", "v1"],
  { revalidate: CATALOGUE_TTL_MS / 1000, tags: ["backpack-assets"] },
);

const FAILURE_CODES = new Set<BackpackFailure["code"]>(["HTTP", "SHAPE", "NETWORK", "RATE_LIMITED"]);

/**
 * The list as the universe reads it: through the shared data cache, marked stale once older than its freshness window.
 * Outside Next (tests, scripts) the direct read answers; a read that failed with no copy anywhere is the failure itself.
 */
export async function readBackpackCatalogueShared(nowMs: number = Date.now()): Promise<BackpackCatalogue | BackpackFailure> {
  try {
    const copy = await readSharedBackpack();
    const fetchedMs = Date.parse(copy.fetchedAt);
    return { ...copy, stale: copy.stale || !Number.isFinite(fetchedMs) || nowMs - fetchedMs > CATALOGUE_TTL_MS };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/incrementalCache missing/.test(message)) return readBackpackCatalogue();
    const [code, ...rest] = message.split(": ");
    return { ok: false, code: FAILURE_CODES.has(code as BackpackFailure["code"]) ? (code as BackpackFailure["code"]) : "NETWORK", reason: rest.length > 0 ? rest.join(": ") : message };
  }
}

/** Index the list by Solana mint, the only key a representation is looked up by. */
export function indexBackpackAssets(assets: readonly BackpackAsset[]): ReadonlyMap<string, BackpackAsset> {
  return new Map(assets.map((asset) => [asset.solanaMint, asset]));
}
