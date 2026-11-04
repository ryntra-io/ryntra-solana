import { backtest, type BotSetting } from "@/lib/bots/backtest/backtest";
import { isBacktestPeriod, poolInstrument } from "@/lib/bots/backtest/candles";
import { readCandles } from "@/lib/bots/backtest/candles.server";
import { readPaperTwin, startPaperTwin, stepPaperTwin } from "@/lib/bots/backtest/paper";
import { DEFAULT_COSTS, type ExecutionCosts, type GridSetting, type LadderLeg } from "@/lib/bots/backtest/sim";
import { isGridLevels, GRID_SIDES, type GridSide } from "@/lib/bots/grid";
import { readPoolRecord } from "@/lib/liquidity/catalog/service.server";
import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * An honest backtest of a bot on a DLMM pool over 7, 30 or 180 days of the
 * market-data gateway's candles: the setting as asked, holding beside it,
 * walk-forward, the worst drawdown and a dollar stress test, with the pool's
 * own fee, slippage and priority fees counted. A grid's figures carry
 * «приблизно». A grid may name a paper twin — another range or number of
 * levels — run on the same candles.
 *
 * `GET ?pool=&period=&bot=grid&lower=&upper=&levels=&side=&amount=[&twinLower=&twinUpper=&twinLevels=]`
 * `GET ?pool=&period=&bot=dca&every=<bars>&amount=`
 * `GET ?pool=&period=&bot=ladder&venue=trigger|dlmm&legs=buy:190:100,sell:220:0.5`
 *
 * Read-only: a simulation on public data; nothing is placed.
 */

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "no-store" } });
}

const positive = (value: string | null): number | null => {
  if (value === null || !/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function readLegs(text: string): LadderLeg[] | null {
  const legs = text.split(",").filter(Boolean).map((part) => {
    const [side, price, amount] = part.split(":");
    const p = positive(price ?? null);
    const a = positive(amount ?? null);
    return (side === "buy" || side === "sell") && p !== null && a !== null ? { side, price: p, amount: a } : null;
  });
  return legs.length > 0 && legs.length <= 20 && legs.every((leg) => leg !== null) ? (legs as LadderLeg[]) : null;
}

function readSetting(params: URLSearchParams): BotSetting | null {
  const bot = params.get("bot");
  const amount = positive(params.get("amount"));
  if (bot === "grid") {
    const lower = positive(params.get("lower"));
    const upper = positive(params.get("upper"));
    const levels = Number(params.get("levels") ?? "21");
    const side = params.get("side") ?? "both";
    if (lower === null || upper === null || upper <= lower || !isGridLevels(levels) || !(GRID_SIDES as readonly string[]).includes(side) || amount === null) return null;
    return { bot: "grid", grid: { lower, upper, levels, side: side as GridSide, amountQuote: amount } };
  }
  if (bot === "dca") {
    const every = Number(params.get("every") ?? "");
    return Number.isInteger(every) && every >= 1 && every <= 1_000 && amount !== null ? { bot: "dca", dca: { everyBars: every, amountQuote: amount } } : null;
  }
  if (bot === "ladder") {
    const venue = params.get("venue");
    const legs = readLegs(params.get("legs") ?? "");
    return (venue === "trigger" || venue === "dlmm") && legs ? { bot: "ladder", ladder: { venue, legs } } : null;
  }
  return null;
}

export async function GET(request: Request) {
  const rate = LIMITER.consume(`bots-backtest:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const pool = params.get("pool") ?? "";
  const instrument = poolInstrument(pool);
  const period = params.get("period") ?? "30d";
  const setting = readSetting(params);
  if (!instrument || !isBacktestPeriod(period) || !setting) return failure(400, "VALIDATION_ERROR", "A pool, a period of 7d, 30d or 180d, and a bot's setting.", rate);

  const [candles, record] = await Promise.all([readCandles(instrument, period), readPoolRecord("dlmm", pool, { meteora: { timeoutMs: 3_000 } })]);
  if (!candles.ok) return failure(candles.reason === "UNKNOWN_INSTRUMENT" ? 404 : 503, candles.reason, "The pool's candles could not be read.", rate);
  const facts = record.pool;
  /* The pool's own fee, less the protocol's share: what its liquidity earns and what a taker pays. */
  const baseFeeBps = facts?.baseFeePct != null ? facts.baseFeePct * 100 : null;
  const lpShare = facts?.protocolSharePct != null ? 1 - facts.protocolSharePct / 100 : 1;
  const solUsd = facts?.x.symbol === "SOL" && facts.x.priceUsd ? facts.x.priceUsd : facts?.y.symbol === "SOL" && facts.y.priceUsd ? facts.y.priceUsd : null;
  const costs: ExecutionCosts = {
    ...DEFAULT_COSTS,
    poolFeeBps: baseFeeBps !== null ? baseFeeBps * lpShare : DEFAULT_COSTS.poolFeeBps,
    solUsd: solUsd ?? DEFAULT_COSTS.solUsd,
    quoteUsd: facts?.y.priceUsd ?? DEFAULT_COSTS.quoteUsd,
  };
  const symbol = facts?.x.symbol ?? "base";
  const run = backtest(candles.candles, setting, { period, symbol, costs });
  if (!run) return failure(422, "TOO_FEW_BARS", "Too few candles for this setting.", rate);

  let twin = null;
  if (setting.bot === "grid" && params.has("twinLower")) {
    const lower = positive(params.get("twinLower"));
    const upper = positive(params.get("twinUpper"));
    const levels = Number(params.get("twinLevels") ?? setting.grid.levels);
    if (lower === null || upper === null || upper <= lower || !isGridLevels(levels)) return failure(400, "VALIDATION_ERROR", "The twin's range and levels.", rate);
    const twinSetting: GridSetting = { ...setting.grid, lower, upper, levels };
    twin = { setting: twinSetting, reading: readPaperTwin(stepPaperTwin(startPaperTwin(twinSetting, candles.candles[0]!, costs), candles.candles)) };
  }
  return Response.json(
    { pool, instrument, period, costs: { ...costs, read: { poolFee: baseFeeBps !== null, solUsd: solUsd !== null, quoteUsd: facts?.y.priceUsd != null } }, backtest: run, twin, candlesAt: candles.at },
    { headers: { ...rateLimitHeaders(rate), "cache-control": "public, max-age=60, stale-while-revalidate=120" } },
  );
}
