/**
 * «Реальність послідовника» (SOL-R3) — which pool's bars price the seconds after a leader's trade, how fine they are,
 * and which of them the page needs. Pure: the read is `paths.server.ts`.
 *
 * The pool is the token's busiest against SOL, USDC or USDT — where the token trades, as the Spot chart's rule says
 * (`chooseSpotPool`), but without its floors: a meme a wallet copied is often thinner than a chart is allowed to be,
 * and a thin pool's bars are exactly what a follower would have met. One read of up to a thousand bars per token: the
 * finest width whose thousand bars cover all its trades.
 */

import { normalizeCandles } from "../spot/candles.ts";
import { REACH_S, type PathBar } from "./reality.ts";

const MAJOR_QUOTES: ReadonlySet<string> = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

export type PathPool = Readonly<{ address: string; side: "base" | "quote"; dex: string | null; name: string }>;

type GeckoPoolRow = Readonly<{
  attributes?: { address?: unknown; name?: unknown; reserve_in_usd?: unknown; volume_usd?: { h24?: unknown } };
  relationships?: { base_token?: { data?: { id?: unknown } }; quote_token?: { data?: { id?: unknown } }; dex?: { data?: { id?: unknown } } };
}>;

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The token's pool against a major quote that traded most over the day, ties by depth; null when there is none. */
export function pathPool(body: unknown, mint: string): PathPool | null {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: GeckoPoolRow[] }).data) : [];
  let best: { pool: PathPool; volume: number; reserve: number } | null = null;
  for (const row of data) {
    const address = typeof row.attributes?.address === "string" ? row.attributes.address : null;
    const id = (value: unknown) => (typeof value === "string" && value.startsWith("solana_") ? value.slice(7) : null);
    const base = id(row.relationships?.base_token?.data?.id);
    const quote = id(row.relationships?.quote_token?.data?.id);
    const side = base === mint ? "base" : quote === mint ? "quote" : null;
    if (!address || !side) continue;
    const other = side === "base" ? quote : base;
    if (!other || !MAJOR_QUOTES.has(other)) continue;
    const volume = num(row.attributes?.volume_usd?.h24);
    const reserve = num(row.attributes?.reserve_in_usd);
    /* A drained pool (a rug) is kept: its bars are the worst outcome, and the one a follower would have met. */
    if (!best || volume > best.volume || (volume === best.volume && reserve > best.reserve)) {
      const dex = row.relationships?.dex?.data?.id;
      best = { pool: { address, side, dex: typeof dex === "string" ? dex : null, name: typeof row.attributes?.name === "string" ? row.attributes.name : address }, volume, reserve };
    }
  }
  return best?.pool ?? null;
}

/** GeckoTerminal's widths, finest first: the `{path}?aggregate=` pair and the bar's seconds. */
export const PATH_WIDTHS = [
  { path: "minute", aggregate: 1, seconds: 60 },
  { path: "minute", aggregate: 5, seconds: 300 },
  { path: "minute", aggregate: 15, seconds: 900 },
  { path: "hour", aggregate: 1, seconds: 3_600 },
  { path: "hour", aggregate: 4, seconds: 14_400 },
] as const;
export type PathWidth = (typeof PATH_WIDTHS)[number];

/** Bars one read returns at most. */
export const PATH_BARS = 1_000;
/** How far after a leg the follower's latest attempt can reach, seconds. */
export const PATH_REACH_S = REACH_S;

/** The finest width whose thousand bars cover every leg, from a bar before the first to the reach after the last. */
export function pathWidth(times: readonly number[]): PathWidth {
  const first = Math.min(...times);
  const last = Math.max(...times);
  for (const width of PATH_WIDTHS) if (last + PATH_REACH_S - first + 2 * width.seconds <= PATH_BARS * width.seconds) return width;
  return PATH_WIDTHS[PATH_WIDTHS.length - 1];
}

/** The bars around the legs only — a bar before each and through the reach after it — the rest is not sent to the page. */
export function barsNear(body: unknown, times: readonly number[], seconds: number): PathBar[] {
  const bars = normalizeCandles(body).map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close] as const);
  const windows = times.map((t) => [t - 2 * seconds, t + PATH_REACH_S + seconds] as const);
  /* A quiet gap before a leg is priced by the last bar before it: that one is kept too. */
  const keep = new Set<number>();
  for (const [from, to] of windows) {
    let before = -1;
    let after = -1;
    bars.forEach((bar, index) => {
      if (bar[0] < from) before = index;
      else if (bar[0] <= to) keep.add(index);
      else if (after < 0) after = index;
    });
    /* And the first bar after it: a quiet stretch at the window's end is the market resting, not the read ending. */
    if (before >= 0) keep.add(before);
    if (after >= 0) keep.add(after);
  }
  return bars.filter((_, index) => keep.has(index));
}
