import type { LaunchMarketResponse, LaunchTokenResponse } from "../api/v1/contract.ts";
import { BASE58 } from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";
import type { LaunchRecord } from "./flow.server.ts";
import { LAUNCH_SHORT_CHARS, LAUNCH_SHORT_SLUG } from "./share-link.ts";

/** What a short address names: the token, and the name and ticker its launch was recorded with. */
export type LaunchShort = Readonly<{ token: string; name: string; symbol: string }>;

/**
 * The launch a short address names (SOL-L1e): the whole mint, or its first eight letters matched against the launches
 * Ryntra made on this network. Null when none matches — or more than one: a short address never lands on the wrong token.
 */
export async function resolveLaunchShort(store: GuardStore, cluster: string, slug: string): Promise<LaunchShort | null> {
  if (!LAUNCH_SHORT_SLUG.test(slug)) return null;
  const launches = store.collection<LaunchRecord>("launches");
  const short = (record: LaunchRecord): LaunchShort => ({ token: record.token, name: record.name, symbol: record.symbol });
  if (slug.length >= 32 && BASE58.test(slug)) {
    const record = await launches.get(`solana:${cluster}:${slug}`);
    return record ? short(record) : null;
  }
  if (slug.length !== LAUNCH_SHORT_CHARS) return null;
  const found = await launches.valuesWithPrefix(`solana:${cluster}:${slug}`);
  const tokens = new Map(found.map((record) => [record.token, record] as const));
  return tokens.size === 1 ? short([...tokens.values()][0]) : null;
}

/** What a token's card says — each part only when the chain was read for it: never a figure the chain did not give. */
export type LaunchShareFacts = Readonly<{
  name: string;
  symbol: string;
  image: string | null;
  network: LaunchTokenResponse["network"];
  /** The price of one token, in dollars when the pair is a dollar, else in the pair; and when it was read. */
  price: Readonly<{ value: number; dollar: boolean; pair: string; at: string }> | null;
  /** The curve's way to the DEX, basis points; `migrated` once the token trades in its pool. */
  dex: Readonly<{ bps: number; migrated: boolean }> | null;
  /** «Чесний лаунч»: the marks the chain proved now, one line each, the creator's lock first. */
  marks: readonly string[];
}>;

/** The mark codes a card names, in its order; the exit's two locked positions are one line. */
const CARD_MARKS = ["CREATOR_BUY_LOCKED", "MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "LP_LOCKED_FOREVER", "CURVE_HOLDS_FUNDS", "NO_TRANSFER_HOOK"] as const;
export const CARD_MARKS_SHOWN = 5;

/** The chain not read in time: the name and the ticker the launch was recorded with, and nothing the chain must say. */
export function launchShareFactsOfRecord(short: LaunchShort, network: LaunchTokenResponse["network"]): LaunchShareFacts {
  return { name: short.name, symbol: short.symbol, image: null, network, price: null, dex: null, marks: [] };
}

export function launchShareFacts(token: LaunchTokenResponse, market: LaunchMarketResponse | null): LaunchShareFacts {
  const codes = new Set((token.receipt?.marks ?? []).map((mark) => mark.code));
  const marks = CARD_MARKS.filter((code) => codes.has(code)).slice(0, CARD_MARKS_SHOWN);
  const migrated = market?.progress.migrated ?? token.migrated;
  const bps = market?.progress.bps ?? token.progressBps;
  const dollar = market ? market.pair.dollar && market.price.usd !== null : false;
  return {
    name: token.name,
    symbol: token.symbol,
    image: token.image,
    network: token.network,
    price: market && market.price.pair > 0 ? { value: dollar ? (market.price.usd ?? 0) : market.price.pair, dollar, pair: market.pair.symbol, at: market.observedAt } : null,
    dex: migrated === true ? { bps: 10_000, migrated: true } : bps !== null && bps !== undefined ? { bps, migrated: false } : null,
    marks,
  };
}
