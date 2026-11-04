import { ENGINE_ROUTES, engineMethod, type EngineAnswer, type EngineRead, type EngineRouteKey } from "@/lib/connector/tools";
import { walletReadKey } from "@/lib/connector/ledger";
import { readWindowHeaders } from "@/lib/http-control";

/**
 * The connector's reader of the engine (CITY-154): each tool's route handler, called in this process.
 *
 * The connector reads exactly what ryntra.io serves — the same route handlers, with their own validation, caches,
 * errors and read windows — without a second network hop and without a deployment's protection standing between a
 * function and itself. The handlers are loaded on first use, so `/mcp` pays for the routes it is asked for.
 *
 * Each call carries the wallet's own read key (`walletReadKey`) as its address, so the engine's per-address floor
 * counts one wallet's calls, not every chat behind one egress.
 */

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = { GET?: Handler; POST?: Handler };

const LOADERS: Readonly<Record<EngineRouteKey, () => Promise<RouteModule>>> = {
  city: () => import("@/app/api/city/route") as unknown as Promise<{ GET: Handler }>,
  "spot.markets": () => import("@/app/api/spot/markets/route"),
  "spot.token": () => import("@/app/api/spot/token/route"),
  "stocks.universe": () => import("@/app/api/stocks/universe/route"),
  "stocks.asset": () => import("@/app/api/stocks/asset/route"),
  "launch.markets": () => import("@/app/api/v1/launch/markets/route"),
  "launch.market": () => import("@/app/api/v1/launch/markets/[mint]/route") as unknown as Promise<{ GET: Handler }>,
  "launch.health": () => import("@/app/api/v1/launch/[mint]/health/route") as unknown as Promise<{ GET: Handler }>,
  "launch.survival": () => import("@/app/api/v1/launch/survival/route"),
  events: () => import("@/app/api/v1/events/route"),
  "money.recipient": () => import("@/app/api/v1/money/recipient/route"),
  "research.evidence": () => import("@/app/api/v1/research/evidence/route"),
  "research.addressEvidence": () => import("@/app/api/v1/research/address-evidence/route"),
  /* The pre-sign check (CITY-152): POST, because a transaction does not fit a query; it reads and keeps nothing. */
  "ward.check": () => import("@/app/api/v1/ward/check/route"),
};

export function engineReaderFor(origin: string, wallet: string): EngineRead {
  const readKey = walletReadKey(wallet);
  return async (route, input): Promise<EngineAnswer> => {
    let path: string = ENGINE_ROUTES[route];
    const params = input.params ?? {};
    for (const [name, value] of Object.entries(params)) path = path.replace(`{${name}}`, encodeURIComponent(value));
    const url = new URL(path, origin);
    for (const [name, value] of Object.entries(input.query ?? {})) url.searchParams.set(name, value);
    const method = engineMethod(route);
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "ryntra-connector/1.0", ...readWindowHeaders(readKey) };
    if (method === "POST") headers["content-type"] = "application/json";
    const request = new Request(url, { method, headers, ...(method === "POST" ? { body: JSON.stringify(input.body ?? {}) } : {}) });
    const handler = (await LOADERS[route]())[method];
    if (!handler) return { status: 503, body: { error: { code: "ENGINE_UNAVAILABLE", message: "The engine route does not answer this method." } } };
    const response = await handler(request, { params: Promise.resolve(params) });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: { code: "ENGINE_NOT_JSON", message: "The engine route answered something other than JSON." } };
    }
    return { status: response.status, body };
  };
}
