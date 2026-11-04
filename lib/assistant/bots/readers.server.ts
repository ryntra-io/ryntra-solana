/**
 * The bot tools' readers bound to the engine (CITY-133, B3), server side:
 *
 * - candles — the chart's own read of a coin (`readSpotCandles`, the deepest pool's OHLCV), the same bars the bots
 *   window tries a draft on; in dollars, so the backtest's quote is one dollar;
 * - the symbol — the spot market's row (Jupiter's list);
 * - safety — the bots' token filter on the gateway's chain facts (`mintSafety`);
 * - the Hangar — the chain's public read of a wallet's own bots (`readHangar`, CITY-131), without reminder rules:
 *   nothing that needs the wallet's proof.
 *
 * Reads only: these are the engine's read seams, each answering `null` when its source did not. The tools that take
 * them (`tools.ts`) import none of this — they cannot reach what these reach.
 */

import "server-only";

import { mintSafety } from "../../bots/backtest/mint-safety.ts";
import { readHangar } from "../../bots/hangar/read.server.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import { readSpotCandles } from "../../spot/candles.server.ts";
import { readSpotMarket } from "../../spot/markets.server.ts";
import { readTokenRiskFacts } from "../../solana/risk-facts.ts";
import type { Candle } from "../../bots/backtest/candles.ts";
import type { BotsReaders, BotsTimeframe } from "./tools.ts";

const candleOf = (bar: Readonly<{ time: number; open: number; high: number; low: number; close: number }>): Candle | null => {
  const t = bar.time * 1000;
  if (!Number.isFinite(t) || ![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { t, o: bar.open, h: Math.max(bar.high, bar.open, bar.close), l: Math.min(bar.low, bar.open, bar.close), c: bar.close };
};

async function candles(mint: string, timeframe: BotsTimeframe) {
  const read = await readSpotCandles(mint, timeframe, "page");
  if (!read.ok) return null;
  const bars = read.candles.map(candleOf).filter((bar): bar is Candle => bar !== null).sort((a, b) => a.t - b.t);
  return { candles: bars, observedAt: read.observedAt, stale: read.stale };
}

async function symbol(mint: string) {
  const read = await readSpotMarket(mint);
  return read.ok && read.market ? read.market.symbol : null;
}

async function safety(mint: string) {
  const reading = await readTokenRiskFacts({ mint, timeoutMs: 3_000 });
  if (reading.state !== "READ") return { read: false, ok: false, reasons: ["not_read"] };
  const verdict = mintSafety(reading.facts.mint_account);
  return { read: true, ok: verdict.ok, reasons: verdict.reasons };
}

async function hangar(wallet: string) {
  return readHangar(getGuardRuntime().store, { wallet, proven: false, grids: [], entries: {}, bundles: [] });
}

export function engineBotsReaders(): BotsReaders {
  return { candles, symbol, safety, hangar, now: Date.now };
}
