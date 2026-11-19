import { planFrom } from "@/lib/mandate/plans";
import { budgetRefusal, DAYS_MAX, type AgentBudget } from "@/lib/mandate/budget";
import { testPlan } from "@/lib/mandate/history.server";
import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The agent's strategy tested before money moves.
 *
 * `GET ?coin=<mint>&plan=<plan>&perDay=<lamports>&perTrade=<lamports>&days=<n>` — the strategy run, on the person's own
 * budget, on the coin's history (about twelve days of hours) against plain holding. `&since=<ms>` — the
 * practice without money: the same rules on the candles since that moment, as if the agent had traded them.
 * `&born=<ms>` — an early plan's launch.
 *
 * Read-only: a run of the agent's own rules on public candles; nothing is signed or placed, and no figure is a promise.
 */

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MS = /^\d{12,14}$/;
const RAW = /^\d{1,20}$/;
const DAYS = /^\d{1,4}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "no-store" } });
}

/** The budget the query names, when it is one the agent takes; null otherwise. */
function budgetOf(params: URLSearchParams): AgentBudget | null {
  const perDay = params.get("perDay") ?? "";
  const perTrade = params.get("perTrade") ?? "";
  const days = params.get("days") ?? "";
  if (!RAW.test(perDay) || !RAW.test(perTrade) || !DAYS.test(days) || Number(days) > DAYS_MAX) return null;
  const budget = { perDay: BigInt(perDay), perTrade: BigInt(perTrade), days: Number(days) };
  return budgetRefusal(budget) === null ? budget : null;
}

export async function GET(request: Request) {
  const rate = LIMITER.consume(`mandate-test:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const coin = params.get("coin") ?? "";
  const plan = planFrom(params.get("plan") ?? "steady");
  const budget = budgetOf(params);
  const since = params.get("since");
  const born = params.get("born");
  if (!MINT.test(coin) || !plan || !budget || (since !== null && !MS.test(since)) || (born !== null && !MS.test(born))) return failure(400, "VALIDATION_ERROR", "coin, plan, budget, since or born is not one the agent reads.", rate);
  const now = Date.now();
  if (since !== null && Number(since) > now) return failure(400, "VALIDATION_ERROR", "since is in the future.", rate);
  const answer = await testPlan({ coin, plan, budget, since: since === null ? null : Number(since), bornAt: born === null ? null : Number(born) });
  if (!answer.ok) return failure(422, answer.code, answer.code === "NO_HISTORY" ? "The coin has no candles the city reads." : "The coin's history is too short to test on.", rate);
  return Response.json(
    { coin, plan: params.get("plan") ?? "steady", perDay: budget.perDay.toString(), perTrade: budget.perTrade.toString(), days: budget.days, ...answer },
    { headers: { ...rateLimitHeaders(rate), "cache-control": since === null ? "public, max-age=120, stale-while-revalidate=600" : "private, max-age=30" } },
  );
}
