/**
 * Jupiter Tokens + Price, as labelled venue facts for the Send picker.
 *
 * Chain balances stay the source of truth. This overlay names a mint the
 * way Phantom does — ticker, verification, USD — and says the name is
 * Jupiter's. A mint Jupiter omits has no USD; that absence is the fact,
 * not a zero. Never retried: a price is a quote in all but name.
 *
 * Swap execution lives elsewhere. This module does not build a swap.
 */

import { noteJupiterResponse } from "./jupiter-budget.ts";
import { resolveJupiterCatalogEndpoint, type JupiterTier } from "./quotes.ts";
import { WRAPPED_SOL_MINT } from "./send-kinds.ts";
import type { EvidenceSource } from "./evidence.ts";
import { parseSolanaAddress } from "./address.ts";

const LITE_TOKENS = "https://lite-api.jup.ag/tokens/v2/search";
const PRO_TOKENS = "https://api.jup.ag/tokens/v2/search";
const LITE_PRICE = "https://lite-api.jup.ag/price/v3";
const PRO_PRICE = "https://api.jup.ag/price/v3";
const MAX_JUPITER_RESPONSE_BYTES = 256 * 1024;
const MAX_JUPITER_ROWS = 200;

export type TokenCatalogEntry = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  isVerified: boolean | null;
  isSuspicious: boolean;
  usdPrice: string | null;
  source: EvidenceSource;
  /** The catalogue's own icon address, where the read that answered carries one. */
  icon?: string | null;
  /** `crypto` · `meme` · `stock`, from the catalogue's tags, where known. */
  category?: string | null;
  /** The day's price change in percent, where the read that answered carries one. */
  dayChangePct?: number | null;
  /** The mint's scale, where the catalogue row carries it — a statistics row needs it to print an amount. */
  decimals?: number | null;
}>;

export type TokenCatalog = Readonly<{
  ok: true;
  byMint: Readonly<Record<string, TokenCatalogEntry>>;
  missing: readonly string[];
  observedAt: string;
}>;

export type TokenCatalogFailure = Readonly<{
  ok: false;
  code: "RATE_LIMITED" | "REFUSED" | "UNREACHABLE" | "MALFORMED";
  reason: string;
}>;

export type TokenCatalogResult = TokenCatalog | TokenCatalogFailure;

function asString(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function tokensUrl(tier: JupiterTier): string {
  return tier === "pro" ? PRO_TOKENS : LITE_TOKENS;
}

function priceUrl(tier: JupiterTier): string {
  return tier === "pro" ? PRO_PRICE : LITE_PRICE;
}

export function nativeSolPriceMint(): string {
  return WRAPPED_SOL_MINT;
}

/**
 * Normalize one Tokens API v2 row. Pure, so fixtures exercise it offline.
 */
export function normalizeTokenRow(raw: unknown, source: EvidenceSource): TokenCatalogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const mint = asString(row.id, 44);
  if (!mint || !parseSolanaAddress(mint, "catalog mint").ok) return null;
  const usd =
    typeof row.usdPrice === "number" && Number.isFinite(row.usdPrice) ? String(row.usdPrice) : asString(row.usdPrice);
  const audit = row.audit && typeof row.audit === "object" ? (row.audit as Record<string, unknown>) : null;
  return {
    mint,
    symbol: asString(row.symbol, 32),
    name: asString(row.name, 128),
    isVerified: typeof row.isVerified === "boolean" ? row.isVerified : null,
    isSuspicious: audit?.isSus === true,
    usdPrice: usd,
    source,
    decimals:
      typeof row.decimals === "number" && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18 ? row.decimals : null,
  };
}

export function normalizePriceMap(body: unknown): Readonly<Record<string, string>> {
  if (typeof body !== "object" || body === null) return {};
  const out: Record<string, string> = {};
  for (const [mint, value] of Object.entries(body as Record<string, unknown>).slice(0, MAX_JUPITER_ROWS)) {
    if (typeof value !== "object" || value === null) continue;
    const usd = (value as Record<string, unknown>).usdPrice;
    if (typeof usd === "number" && Number.isFinite(usd)) out[mint] = String(usd);
    else if (typeof usd === "string" && usd.length > 0) out[mint] = usd;
  }
  return out;
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_JUPITER_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error(`Jupiter response exceeds the ${MAX_JUPITER_RESPONSE_BYTES}-byte ceiling.`);
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JUPITER_RESPONSE_BYTES) {
      throw new Error(`Jupiter response exceeds the ${MAX_JUPITER_RESPONSE_BYTES}-byte ceiling.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_JUPITER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Jupiter response exceeds the ${MAX_JUPITER_RESPONSE_BYTES}-byte ceiling.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function getJson(
  url: string,
  apiKey: string | null,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; status: number | null; reason: string; code: TokenCatalogFailure["code"] }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (failure) {
    return {
      ok: false,
      status: null,
      code: "UNREACHABLE",
      reason: `Jupiter did not answer: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  noteJupiterResponse(response.headers);
  if (response.status === 429) {
    await response.body?.cancel();
    return { ok: false, status: 429, code: "RATE_LIMITED", reason: "Jupiter rate-limited the token catalog." };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, status: response.status, code: "REFUSED", reason: `Jupiter refused the catalog: HTTP ${response.status}` };
  }
  let body: unknown = null;
  try {
    const text = await readBoundedText(response);
    body = JSON.parse(text) as unknown;
  } catch (failure) {
    return {
      ok: false,
      status: response.status,
      code: "MALFORMED",
      reason: failure instanceof Error ? failure.message : "Jupiter returned unreadable JSON.",
    };
  }
  return { ok: true, status: response.status, body };
}

/**
 * Look up names, verification and USD for a set of mints. Fail-closed: a
 * refusal returns no overlay, never invented tickers.
 */
export async function fetchTokenCatalog(
  mints: readonly string[],
  timeoutMs = 8_000,
  signal?: AbortSignal,
  /** `lite` asks the keyless host even where a key is configured — its own budget, for when the keyed one is spent. */
  tier?: JupiterTier,
): Promise<TokenCatalogResult> {
  const unique = [...new Set(mints.filter((mint) => mint.length >= 32))].slice(0, 50);
  if (unique.length === 0) {
    return { ok: true, byMint: {}, missing: [], observedAt: new Date().toISOString() };
  }
  const configured = resolveJupiterCatalogEndpoint();
  const endpoint = tier === "lite" ? { tier: "lite" as const, apiKey: null } : configured;
  const query = unique.join(",");
  const tokens = await getJson(`${tokensUrl(endpoint.tier)}?query=${encodeURIComponent(query)}`, endpoint.apiKey, timeoutMs, signal);
  if (!tokens.ok) return tokens;

  if (!Array.isArray(tokens.body)) {
    return { ok: false, code: "MALFORMED", reason: "Jupiter Tokens did not return an array." };
  }
  if (tokens.body.length > MAX_JUPITER_ROWS) {
    return {
      ok: false,
      code: "MALFORMED",
      reason: `Jupiter Tokens exceeded the ${MAX_JUPITER_ROWS}-row ceiling.`,
    };
  }

  const price = await getJson(`${priceUrl(endpoint.tier)}?ids=${encodeURIComponent(query)}`, endpoint.apiKey, timeoutMs, signal);
  const prices = price.ok ? normalizePriceMap(price.body) : {};

  const source: EvidenceSource = {
    ref: `jupiter:mainnet:tokens:${unique.length}`,
    label: `Jupiter Tokens API, ${endpoint.tier} tier`,
  };

  const byMint: Record<string, TokenCatalogEntry> = {};
  for (const row of tokens.body) {
    const entry = normalizeTokenRow(row, source);
    if (!entry) continue;
    const usd = prices[entry.mint] ?? entry.usdPrice;
    byMint[entry.mint] = { ...entry, usdPrice: usd };
  }
  for (const [mint, usd] of Object.entries(prices)) {
    if (byMint[mint]) continue;
    byMint[mint] = {
      mint,
      symbol: mint === WRAPPED_SOL_MINT ? "SOL" : null,
      name: mint === WRAPPED_SOL_MINT ? "Solana" : null,
      isVerified: mint === WRAPPED_SOL_MINT ? true : null,
      isSuspicious: false,
      usdPrice: usd,
      source,
    };
  }

  const missing = unique.filter((mint) => !(mint in byMint));
  return { ok: true, byMint, missing, observedAt: new Date().toISOString() };
}

/**
 * One searchable asset, as Jupiter's own catalogue describes it.
 *
 * `decimals` and `tokenProgram` are the two structural facts a swap surface
 * cannot proceed without: the first turns a typed amount into raw units, and
 * the second says which program owns the mint. Both are re-read from the
 * chain before any quote is built — this row exists so a person can find an
 * asset by its ticker instead of memorising a base58 address.
 */
export type TokenSearchRow = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  isVerified: boolean | null;
  isSuspicious: boolean;
  usdPrice: string | null;
  icon: string | null;
}>;

export type TokenSearchResult =
  | Readonly<{ ok: true; rows: readonly TokenSearchRow[]; observedAt: string; source: EvidenceSource }>
  | TokenCatalogFailure;

function normalizeSearchRow(raw: unknown): TokenSearchRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const mint = asString(row.id, 44);
  if (!mint || !parseSolanaAddress(mint, "catalog mint").ok) return null;
  const decimals =
    typeof row.decimals === "number" && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18
      ? row.decimals
      : null;
  const usd =
    typeof row.usdPrice === "number" && Number.isFinite(row.usdPrice) ? String(row.usdPrice) : asString(row.usdPrice);
  const audit = row.audit && typeof row.audit === "object" ? (row.audit as Record<string, unknown>) : null;
  return {
    mint,
    symbol: asString(row.symbol, 32),
    name: asString(row.name, 128),
    decimals,
    icon: asString(row.icon, 2048),
    tokenProgram: asString(row.tokenProgram, 44),
    isVerified: typeof row.isVerified === "boolean" ? row.isVerified : null,
    isSuspicious: audit?.isSus === true,
    usdPrice: usd,
  };
}

/**
 * Free-text or mint-address search over Jupiter's token catalogue.
 *
 * Fail-closed in the same way the overlay is: a refusal returns no rows
 * rather than an invented ticker, and nothing here decides that an asset is
 * good. Verification and the suspicious flag travel with each row so the
 * surface can say whose claim they are.
 */
export async function searchTokenCatalog(
  query: string,
  limit = 24,
  timeoutMs = 8_000,
): Promise<TokenSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return { ok: false, code: "MALFORMED", reason: "A token search needs one to sixty-four characters." };
  }
  const endpoint = resolveJupiterCatalogEndpoint();
  const response = await getJson(
    `${tokensUrl(endpoint.tier)}?query=${encodeURIComponent(trimmed)}`,
    endpoint.apiKey,
    timeoutMs,
  );
  if (!response.ok) return response;
  if (!Array.isArray(response.body)) {
    return { ok: false, code: "MALFORMED", reason: "Jupiter Tokens did not return an array." };
  }
  if (response.body.length > MAX_JUPITER_ROWS) {
    return { ok: false, code: "MALFORMED", reason: `Jupiter Tokens exceeded the ${MAX_JUPITER_ROWS}-row ceiling.` };
  }
  const rows: TokenSearchRow[] = [];
  for (const raw of response.body) {
    const row = normalizeSearchRow(raw);
    if (row && !rows.some((existing) => existing.mint === row.mint)) rows.push(row);
    if (rows.length >= limit) break;
  }
  return {
    ok: true,
    rows,
    observedAt: new Date().toISOString(),
    source: {
      ref: `jupiter:mainnet:tokens:search`,
      label: `Jupiter Tokens API, ${endpoint.tier} tier`,
    },
  };
}
