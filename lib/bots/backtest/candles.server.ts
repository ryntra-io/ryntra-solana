/**
 * One period of candles from the market-data gateway (CH-10), server side:
 * the same gateway address (`MD_GATEWAY_URL`) and the same page check the
 * prediction pages read it with. Without the address, or with a gateway that
 * does not answer, the candles are **not read** — a backtest is never run on
 * bars from somewhere else.
 *
 * Server only. Public data: nothing here is a secret.
 */

import { isHistoryPage } from "../../predictions/chart-feed.ts";
import { GATEWAY_TIMEOUT_MS, readGatewayEnv } from "../../predictions/gateway.ts";
import { candlesOf, PERIOD_PAGE, type BacktestPeriod, type Candle } from "./candles.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CandleRead = Readonly<{ ok: true; candles: readonly Candle[]; at: number }> | Readonly<{ ok: false; reason: "NO_GATEWAY" | "UNKNOWN_INSTRUMENT" | "UNREACHABLE" | "MALFORMED" }>;

export async function readCandles(
  instrument: string,
  period: BacktestPeriod,
  deps: Readonly<{ env?: NodeJS.ProcessEnv; fetchImpl?: Fetch }> = {},
): Promise<CandleRead> {
  const env = readGatewayEnv(deps.env);
  if (!env) return { ok: false, reason: "NO_GATEWAY" };
  const page = PERIOD_PAGE[period];
  const query = new URLSearchParams({ instrument, resolution: page.resolution, load: "init", limit: String(page.bars) });
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(`${env.baseUrl}/v1/history?${query}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
  } catch {
    return { ok: false, reason: "UNREACHABLE" };
  }
  if (response.status === 404) return { ok: false, reason: "UNKNOWN_INSTRUMENT" };
  const body: unknown = await response.json().catch(() => null);
  if (response.status !== 200 || !isHistoryPage(body)) return { ok: false, reason: response.status === 200 ? "MALFORMED" : "UNREACHABLE" };
  return { ok: true, candles: candlesOf(body.bars), at: body.status.at };
}
