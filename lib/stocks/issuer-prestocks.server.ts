/**
 * The PreStocks public API — an issuer source for pre-IPO exposure tokens,
 * read on the server, validated, cached, and never treated as a market
 * reference (`RYN-STOCKS-PROVIDERS-001`, stage 2).
 *
 * Read on 2026-09-16 from `https://prestocks.com/api/prestocks` (no key,
 * `cache-control: public, max-age=0, must-revalidate`, served by Vercel):
 * one array of products, each with `name`, `symbol`, `description`,
 * `image`, `external_url`, `contract_address` (the Solana mint, every one
 * beginning `Pre`), and five figures — `tokenPrice` (the token's onchain
 * price), `markPrice` (the issuer's mark of one token), `impliedValuation`
 * (the valuation the token price implies), `markValuation` (the issuer's
 * mark of the company) and `supply` (tokens in circulation, in the scaled
 * units the wallet shows). The response carries **no observation time**:
 * Ryntra records when it fetched, and nothing more. The FAQ of the same
 * date: the price "represents the gross price per share of the referenced
 * company" — the issuer's statement, kept as such; the unit Ryntra can
 * check is the token.
 *
 * The catalogue is the identity source for the `prestocks` issuer: a venue
 * row tagged `prestocks` whose mint is not here is not a representation. A
 * failed read keeps the last complete copy for a grace period, marked stale,
 * so a slow issuer does not delist nine tokens; when no copy exists the
 * issuer's rows are absent and the universe says why.
 *
 * Since canon v5.2 (В25, 2026-09-24) PreStocks is the one source of private
 * companies, so the universe reads it through the deployment's shared data
 * cache as well (`readPreStocksCatalogueShared`): an instance's own grace
 * copy does not outlive the instance, and a cold build against a failing
 * API would otherwise take every private company off every instance at once
 * (the failure seen on 2026-09-23 with the other pre-IPO issuer). The shared
 * copy does: a failing API leaves the last complete copy served everywhere,
 * marked stale by its own age.
 */

import { unstable_cache } from "next/cache.js";

export const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";
export const PRESTOCKS_SOURCE = { id: "issuer-prestocks" as const, label: "PreStocks" };
const PRESTOCKS_ORIGINS = ["https://prestocks.com/", "https://www.prestocks.com/"];

const CATALOGUE_TTL_MS = 10 * 60 * 1000;
/** A copy this old is still served, marked stale, while the issuer's API is not answering. */
export const CATALOGUE_GRACE_MS = 12 * 60 * 60 * 1000;
const MAX_ROWS = 200;

export type PreStocksAsset = Readonly<{
  symbol: string;
  /** The token's name as the issuer gives it, e.g. `OpenAI PreStocks`. */
  name: string;
  /** The company, from the issuer's naming pattern (`<Company> PreStocks`); null when the name does not follow it. */
  company: string | null;
  /** The Solana mint the issuer names for this product. */
  solanaMint: string;
  /** The issuer's description, plain text, capped. */
  description: string | null;
  /** The issuer's own product page, on the issuer's domain only. */
  productUrl: string | null;
  logo: string | null;
  mark: Readonly<{
    tokenPriceUsd: number | null;
    markPriceUsd: number | null;
    impliedValuationUsd: number | null;
    markValuationUsd: number | null;
    supply: number | null;
  }>;
}>;

export type PreStocksCatalogue = Readonly<{ ok: true; assets: readonly PreStocksAsset[]; fetchedAt: string; stale: boolean }>;
export type PreStocksFailure = Readonly<{ ok: false; code: "HTTP" | "SHAPE" | "NETWORK" | "RATE_LIMITED"; reason: string }>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const str = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null);
const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** An https URL on the issuer's own domain, or null — a description's link is never followed anywhere else. */
export function issuerUrl(value: unknown, origins: readonly string[] = PRESTOCKS_ORIGINS): string | null {
  const text = str(value, 300);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    return origins.some((origin) => url.href.startsWith(origin)) ? url.href : null;
  } catch {
    return null;
  }
}

/** `OpenAI PreStocks` → `OpenAI`; a name without the issuer's suffix names no company. */
export function companyFromPreStocksName(name: string): string | null {
  const stripped = name.replace(/\s+PreStocks$/i, "").trim();
  return stripped.length > 0 && stripped !== name.trim() ? stripped : null;
}

/** One product node into the shape Ryntra keeps, or null when it names no valid Solana mint. */
export function normalizePreStocksAsset(raw: unknown): PreStocksAsset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const node = raw as Record<string, unknown>;
  const symbol = str(node.symbol, 24);
  const name = str(node.name, 120);
  const mint = str(node.contract_address, 44);
  if (!symbol || !name || !mint || !BASE58.test(mint)) return null;
  return {
    symbol,
    name,
    company: companyFromPreStocksName(name),
    solanaMint: mint,
    description: str(node.description, 2_000),
    productUrl: issuerUrl(node.external_url),
    logo: issuerUrl(node.image),
    mark: {
      tokenPriceUsd: positive(node.tokenPrice),
      markPriceUsd: positive(node.markPrice),
      impliedValuationUsd: positive(node.impliedValuation),
      markValuationUsd: positive(node.markValuation),
      supply: positive(node.supply),
    },
  };
}

let cache: { value: PreStocksCatalogue; at: number } | null = null;
let inflight: Promise<PreStocksCatalogue | PreStocksFailure> | null = null;

/** For tests: forget everything. */
export function resetPreStocksCache(): void {
  cache = null;
  inflight = null;
}

type Deps = Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date; sleep?: (ms: number) => Promise<void> }>;

/**
 * The catalogue, cached ten minutes; on a failed read the last complete copy
 * is served for twelve hours, marked stale, and the failure is returned only
 * when there is nothing true to serve.
 */
export function readPreStocksCatalogue(deps: Deps = {}): Promise<PreStocksCatalogue | PreStocksFailure> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  if (cache && nowMs - cache.at < CATALOGUE_TTL_MS) return Promise.resolve(cache.value);
  if (inflight) return inflight;
  const fetchImpl = deps.fetchImpl ?? fetch;
  inflight = (async (): Promise<PreStocksCatalogue | PreStocksFailure> => {
    let failure: PreStocksFailure;
    /* One read, and one more after a short pause when the issuer's API failed
       on its side (a 5xx, a dropped connection) — a safe read, never on a
       429. A pre-IPO issuer's API answered 500 once on 2026-09-16 and its
       rows were absent for a minute for want of this. */
    const attempt = async (): Promise<Response> => {
      const first = await fetchImpl(PRESTOCKS_API_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000) }).catch((error: unknown) => error);
      if (first instanceof Response && (first.ok || first.status < 500)) return first;
      await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(800);
      const second = await fetchImpl(PRESTOCKS_API_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000) }).catch((error: unknown) => error);
      if (second instanceof Response) return second;
      throw second instanceof Error ? second : first instanceof Error ? first : new Error(String(second));
    };
    try {
      const response = await attempt();
      if (response.status === 429) failure = { ok: false, code: "RATE_LIMITED", reason: "The issuer's API rate limit was reached." };
      else if (!response.ok) failure = { ok: false, code: "HTTP", reason: `The issuer's API answered ${response.status}.` };
      else {
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) failure = { ok: false, code: "SHAPE", reason: "The catalogue is not a list." };
        else {
          const assets: PreStocksAsset[] = [];
          for (const node of body.slice(0, MAX_ROWS)) {
            const asset = normalizePreStocksAsset(node);
            if (asset) assets.push(asset);
          }
          const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
          const value: PreStocksCatalogue = { ok: true, assets, fetchedAt, stale: false };
          cache = { value, at: nowMs };
          return value;
        }
      }
    } catch (error) {
      failure = { ok: false, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
    }
    if (cache && nowMs - cache.at < CATALOGUE_GRACE_MS) return { ...cache.value, stale: true };
    return failure;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/* The deployment's shared layer. The callback throws on a failed read, so nothing false is ever kept and a stale entry stays served while the issuer's API is failing; the key names the shape's version. */
const readSharedPreStocks = unstable_cache(
  async (): Promise<PreStocksCatalogue> => {
    const read = await readPreStocksCatalogue();
    if (!read.ok) throw new Error(`${read.code}: ${read.reason}`);
    return read;
  },
  ["prestocks-catalogue", "v1"],
  { revalidate: CATALOGUE_TTL_MS / 1000, tags: ["prestocks-catalogue"] },
);

const FAILURE_CODES = new Set<PreStocksFailure["code"]>(["HTTP", "SHAPE", "NETWORK", "RATE_LIMITED"]);

/**
 * The catalogue as the universe reads it: through the shared data cache, so
 * the last complete copy outlives a failing API on every instance — marked
 * stale once it is older than the catalogue's own freshness window. Outside
 * Next (tests, scripts) the platform layer is absent and the direct read
 * answers; a read that failed with no copy anywhere is the failure itself.
 */
export async function readPreStocksCatalogueShared(nowMs: number = Date.now()): Promise<PreStocksCatalogue | PreStocksFailure> {
  try {
    const copy = await readSharedPreStocks();
    const fetchedMs = Date.parse(copy.fetchedAt);
    return { ...copy, stale: copy.stale || !Number.isFinite(fetchedMs) || nowMs - fetchedMs > CATALOGUE_TTL_MS };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/incrementalCache missing/.test(message)) return readPreStocksCatalogue();
    const [code, ...rest] = message.split(": ");
    return { ok: false, code: FAILURE_CODES.has(code as PreStocksFailure["code"]) ? (code as PreStocksFailure["code"]) : "NETWORK", reason: rest.length > 0 ? rest.join(": ") : message };
  }
}

/** Index a catalogue by Solana mint, the only key a representation is looked up by. */
export function indexPreStocksAssets(assets: readonly PreStocksAsset[]): ReadonlyMap<string, PreStocksAsset> {
  return new Map(assets.map((asset) => [asset.solanaMint, asset]));
}
