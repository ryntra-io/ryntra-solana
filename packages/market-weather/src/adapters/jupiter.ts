/**
 * Jupiter, read-only and keyless: Price V3 for the dollar price and its 24-hour move, Tokens V2 for depth, the verified
 * flag, the organic score, the issuer's authorities and the launch's graduation.
 *
 * The same public endpoints Ryntra's engine already reads (`lite-api.jup.ag`). Keyless calls are rate-limited by
 * Jupiter; a 429 comes back as a value and is not retried.
 *
 * The parsers are pure and take the moment of reading: Price V3 states no time of its own, so its readings carry
 * `timeFrom: "read"`; a Tokens V2 row states `updatedAt`, so its readings carry the source's time.
 */

import { measure, type Measured, type Reading } from "../contract.ts";
import type { AuthorityRead } from "../badges.ts";
import { readJson, type JsonRead, type ReadDeps } from "./http.ts";

export const JUPITER_BASE = "https://lite-api.jup.ag";
/** Price V3 takes up to 50 ids a call; Tokens V2 search up to 100. */
export const PRICE_V3_MAX_IDS = 50;
export const TOKENS_V2_MAX_IDS = 100;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isMint = (value: unknown): value is string => typeof value === "string" && BASE58.test(value);

export const priceV3Url = (mints: readonly string[], base = JUPITER_BASE): string => `${base}/price/v3?ids=${mints.join(",")}`;
export const tokensV2Url = (mints: readonly string[], base = JUPITER_BASE): string => `${base}/tokens/v2/search?query=${mints.join(",")}`;

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

const isoOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

export type JupiterPrice = Readonly<{ price: Reading; change24h: Reading }>;

/** A Price V3 answer, `{ <mint>: { usdPrice, priceChange24h, … } }`, as readings. A mint Jupiter left out is absent. */
export function parsePriceV3(body: unknown, readAt: string, base = JUPITER_BASE): Map<string, JupiterPrice> {
  const out = new Map<string, JupiterPrice>();
  const map = record(body);
  if (!map) return out;
  for (const [mint, raw] of Object.entries(map)) {
    const row = record(raw);
    if (!isMint(mint) || !row) continue;
    const head = { source: "jupiter-price-v3" as const, url: priceV3Url([mint], base), observedAt: readAt, timeFrom: "read" as const };
    out.set(mint, {
      price: { ...head, value: positive(row.usdPrice) },
      change24h: { ...head, value: measure(row.priceChange24h) },
    });
  }
  return out;
}

/** A price is a positive number; zero or below is not a price anybody traded at. */
function positive(raw: unknown): Measured {
  const figure = measure(raw);
  return figure.state === "measured" && figure.value <= 0 ? { state: "not_measured", why: "not a positive price" } : figure;
}

export type JupiterAsset = Readonly<{
  asset: string;
  symbol: string | null;
  verified: boolean;
  organicScore: Measured;
  liquidity: Reading;
  price: Reading;
  change24h: Reading;
  authorities: readonly AuthorityRead[];
  launchpad: string | null;
  graduatedPool: string | null;
  graduatedAt: string | null;
}>;

/** Jupiter's audit states an authority as disabled, or names the authority's address. Silence is not «revoked». */
function authorityState(disabled: unknown, address: unknown): AuthorityRead["state"] {
  if (disabled === true) return "revoked";
  if (disabled === false || (typeof address === "string" && address.length > 0)) return "active";
  return "not_measured";
}

/** One Tokens V2 row, or null when it names no mint. */
export function parseTokenV2(raw: unknown, readAt: string, base = JUPITER_BASE): JupiterAsset | null {
  const row = record(raw);
  if (!row || !isMint(row.id)) return null;
  const asset = row.id;
  const url = tokensV2Url([asset], base);
  const stated = isoOf(row.updatedAt);
  const head = { source: "jupiter-tokens-v2" as const, url, observedAt: stated ?? readAt, timeFrom: stated ? ("source" as const) : ("read" as const) };
  const audit = record(row.audit);
  const stats = record(row.stats24h);
  const launchpad = typeof row.launchpad === "string" && row.launchpad.length > 0 && row.launchpad.length <= 48 ? row.launchpad : null;
  const pool = isMint(row.graduatedPool) ? row.graduatedPool : null;
  const authority = (kind: "mint" | "freeze", state: AuthorityRead["state"]): AuthorityRead => ({ authority: kind, source: "jupiter-tokens-v2", url, observedAt: head.observedAt, state });
  return {
    asset,
    symbol: typeof row.symbol === "string" ? row.symbol : null,
    verified: row.isVerified === true,
    organicScore: measure(row.organicScore),
    liquidity: { ...head, value: measure(row.liquidity) },
    price: { ...head, value: positive(row.usdPrice) },
    change24h: { ...head, value: measure(stats?.priceChange) },
    authorities: [
      authority("mint", authorityState(audit?.mintAuthorityDisabled, row.mintAuthority)),
      authority("freeze", authorityState(audit?.freezeAuthorityDisabled, row.freezeAuthority)),
    ],
    launchpad,
    graduatedPool: pool,
    graduatedAt: isoOf(row.graduatedAt),
  };
}

/** A Tokens V2 search answer (a list of rows) as assets, keyed by mint; the first row for a mint wins. */
export function parseTokensV2(body: unknown, readAt: string, base = JUPITER_BASE): Map<string, JupiterAsset> {
  const out = new Map<string, JupiterAsset>();
  if (!Array.isArray(body)) return out;
  for (const raw of body) {
    const asset = parseTokenV2(raw, readAt, base);
    if (asset && !out.has(asset.asset)) out.set(asset.asset, asset);
  }
  return out;
}

export type JupiterRead = Readonly<{
  prices: Map<string, JupiterPrice>;
  tokens: Map<string, JupiterAsset>;
  failures: readonly Extract<JsonRead, { ok: false }>[];
}>;

const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Read prices and token records for a list of mints. Failures are listed; whatever was read is returned. */
export async function readJupiter(mints: readonly string[], deps: ReadDeps & Readonly<{ base?: string }> = {}): Promise<JupiterRead> {
  const valid = [...new Set(mints.filter(isMint))];
  const base = deps.base ?? JUPITER_BASE;
  const prices = new Map<string, JupiterPrice>();
  const tokens = new Map<string, JupiterAsset>();
  const failures: Extract<JsonRead, { ok: false }>[] = [];
  for (const part of chunks(valid, PRICE_V3_MAX_IDS)) {
    const read = await readJson(priceV3Url(part, base), deps);
    if (!read.ok) failures.push(read);
    else for (const [mint, price] of parsePriceV3(read.body, read.readAt, base)) prices.set(mint, price);
  }
  for (const part of chunks(valid, TOKENS_V2_MAX_IDS)) {
    const read = await readJson(tokensV2Url(part, base), deps);
    if (!read.ok) failures.push(read);
    else for (const [mint, token] of parseTokensV2(read.body, read.readAt, base)) if (part.includes(mint)) tokens.set(mint, token);
  }
  return { prices, tokens, failures };
}
