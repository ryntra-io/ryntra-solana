import { NextRequest, NextResponse } from "next/server";
import { getApiKeys, getCandles, getFills, getMarkets, getOracleFeeds, getOrders, getPositions, getSpotCandles, getSpotOverview, getSpotQuote, getSpotTokens, getSpotTrades, getTakerFeeFraction, relayCreateApiKey, relayRevokeApiKey, relaySpotSubmit } from "@/lib/arcus/public";
import { ARCUS_GET_KINDS, arcusCacheSeconds, arcusRateLimit } from "@/lib/arcus/policy";
import { ARCUS_POST_MAX_BODY_BYTES, FixedWindowLimiter, clientIp, privateNoStoreHeaders, publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { getSession } from "@/lib/session";
import { mutationOriginAllowed } from "@/lib/security";
import { reportError } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

const LIMITERS: Readonly<Record<number, FixedWindowLimiter>> = {
  40: new FixedWindowLimiter({ limit: 40, windowMs: 60_000, maxKeys: 5_000 }),
  90: new FixedWindowLimiter({ limit: 90, windowMs: 60_000, maxKeys: 5_000 }),
  120: new FixedWindowLimiter({ limit: 120, windowMs: 60_000, maxKeys: 5_000 }),
  240: new FixedWindowLimiter({ limit: 240, windowMs: 60_000, maxKeys: 5_000 }),
};
const postLimiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });

function responseCacheHeaders(kind: string, timeframe?: string): Record<string, string> {
  const seconds = arcusCacheSeconds(kind, timeframe);
  return seconds === null ? privateNoStoreHeaders() : publicCacheHeaders(seconds, seconds * 2);
}

function rateLimitResponse(req: NextRequest, kind: string): NextResponse | null {
  const limit = arcusRateLimit(kind);
  const decision = LIMITERS[limit].consume(`${kind}:${clientIp(req.headers)}`);
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: "slow down" },
    {
      status: 429,
      headers: { ...privateNoStoreHeaders(), ...rateLimitHeaders(decision) },
    },
  );
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: privateNoStoreHeaders() });
}

/** Public Arcus data proxy for the demo terminal and trading workspaces. */
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const kind = p.get("kind") ?? "";
  if (!ARCUS_GET_KINDS.has(kind)) return jsonError("unknown kind", 400);
  const limited = rateLimitResponse(req, kind);
  if (limited) return limited;

  try {
    if (kind === "markets") {
      const markets = await getMarkets();
      return NextResponse.json(
        { markets: markets.filter((market) => market.status === "ONLINE") },
        { headers: responseCacheHeaders(kind) },
      );
    }
    if (kind === "fees") {
      return NextResponse.json(
        { takerFeeFraction: await getTakerFeeFraction() },
        { headers: responseCacheHeaders(kind) },
      );
    }
    if (kind === "candles") {
      const market = p.get("market") ?? "";
      const tf = p.get("tf") ?? "1m";
      if (!/^[A-Z0-9-]{1,20}$/.test(market) || !TIMEFRAMES.has(tf)) return jsonError("bad params", 400);
      const hours = tf === "1m" ? 8 : tf === "5m" ? 40 : tf === "15m" ? 120 : tf === "1h" ? 480 : tf === "4h" ? 1440 : 4320;
      return NextResponse.json(
        { candles: await getCandles(market, tf, hours) },
        { headers: responseCacheHeaders(kind, tf) },
      );
    }
    if (kind === "account") {
      const address = p.get("address") ?? "";
      if (!ADDR_RE.test(address)) return jsonError("bad address", 400);
      const [fills, positions, orders] = await Promise.all([
        getFills(address, 100),
        getPositions(address),
        getOrders(address),
      ]);
      return NextResponse.json({ fills, positions, orders }, { headers: responseCacheHeaders(kind) });
    }
    if (kind === "apikeys") {
      const address = p.get("address") ?? "";
      if (!ADDR_RE.test(address)) return jsonError("bad address", 400);
      return NextResponse.json({ keys: await getApiKeys(address) }, { headers: responseCacheHeaders(kind) });
    }
    if (kind === "spot-tokens") {
      return NextResponse.json({ tokens: await getSpotTokens() }, { headers: responseCacheHeaders(kind) });
    }
    if (kind === "oracle-feeds") {
      return NextResponse.json({ feeds: await getOracleFeeds() }, { headers: responseCacheHeaders(kind) });
    }
    if (kind === "spot-overview") {
      return NextResponse.json({ overview: await getSpotOverview() }, { headers: responseCacheHeaders(kind) });
    }
    if (kind === "spot-candles") {
      const market = p.get("market") ?? "";
      const tf = p.get("tf") ?? "1h";
      if (!/^[A-Z0-9.]{1,12}$/.test(market) || !TIMEFRAMES.has(tf)) return jsonError("bad params", 400);
      const hours = tf === "1m" ? 12 : tf === "5m" ? 48 : tf === "15m" ? 120 : tf === "1h" ? 720 : tf === "4h" ? 1440 : 4320;
      return NextResponse.json(
        { candles: await getSpotCandles(market, tf, hours) },
        { headers: responseCacheHeaders(kind, tf) },
      );
    }
    if (kind === "spot-trades") {
      const address = p.get("address") ?? "";
      if (!ADDR_RE.test(address)) return jsonError("bad address", 400);
      return NextResponse.json(await getSpotTrades(address), { headers: responseCacheHeaders(kind) });
    }
    if (kind === "spot-quote") {
      const sellToken = p.get("sellToken") ?? "";
      const buyToken = p.get("buyToken") ?? "";
      const sellAmount = p.get("sellAmount") ?? "";
      const taker = p.get("taker") ?? "";
      const slippageBps = Math.max(0, Math.min(10_000, Number(p.get("slippageBps") ?? "50")));
      if (!ADDR_RE.test(sellToken) || !ADDR_RE.test(buyToken) || !ADDR_RE.test(taker) || !/^\d{1,32}$/.test(sellAmount)) {
        return jsonError("bad params", 400);
      }
      const result = await getSpotQuote({ sellToken, buyToken, sellAmount, taker, slippageBps });
      return new NextResponse(result.text, {
        status: result.status,
        headers: { "Content-Type": "application/json", ...responseCacheHeaders(kind) },
      });
    }
    return jsonError("unknown kind", 400);
  } catch (error) {
    void reportError("arcus.proxy", error, { kind });
    return jsonError("upstream unavailable", 502);
  }
}
/**
 * createApiKey relay (track B slice 1). No custody: the browser generated the Ed25519 pair;
 * only the PUBLIC key + the wallet's EIP-191 signature pass through here. Session-gated so
 * random internet traffic cannot burn our upstream quota.
 */
export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return jsonError("cross-site request blocked", 403);
  }

  const session = await getSession();
  if (!session?.verified) return jsonError("unauthorized", 401);

  const decision = postLimiter.consume(String(session.telegramId));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "slow down" },
      {
        status: 429,
        headers: { ...privateNoStoreHeaders(), ...rateLimitHeaders(decision) },
      },
    );
  }

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return jsonError("json required", 415);
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > ARCUS_POST_MAX_BODY_BYTES) {
    return jsonError("payload too large", 413);
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return jsonError("bad body", 400);
  }
  if (new TextEncoder().encode(text).byteLength > ARCUS_POST_MAX_BODY_BYTES) {
    return jsonError("payload too large", 413);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return jsonError("bad json", 400);
  }

  if (body.kind === "spot-submit") {
    const { kind: _kind, ...payload } = body;
    void _kind;
    try {
      const result = await relaySpotSubmit(payload);
      if (result.status !== 200) {
        console.log("spot-submit:", result.status, "sentKeys:", Object.keys(payload).join(","));
      }
      return new NextResponse(result.text, {
        status: result.status,
        headers: { "Content-Type": "application/json", ...privateNoStoreHeaders() },
      });
    } catch (error) {
      void reportError("arcus.spot-submit", error);
      return jsonError("upstream unavailable", 502);
    }
  }

  if (body.kind === "revokeApiKey") {
    const address = typeof body.address === "string" ? body.address : "";
    const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
    const apiWalletName = typeof body.apiWalletName === "string" ? body.apiWalletName : "";
    const sig = (body.signature ?? {}) as { r?: unknown; s?: unknown; v?: unknown };
    const ok =
      ADDR_RE.test(address) &&
      /^[0-9a-f]{64}$/.test(publicKey) &&
      /^[\w-]{1,32}$/.test(apiWalletName) &&
      typeof sig.r === "string" && /^0x[0-9a-f]{64}$/i.test(sig.r) &&
      typeof sig.s === "string" && /^0x[0-9a-f]{64}$/i.test(sig.s) &&
      (sig.v === "0x1b" || sig.v === "0x1c");
    if (!ok) return jsonError("bad params", 400);

    try {
      const result = await relayRevokeApiKey({
        address,
        publicKey,
        apiWalletName,
        signature: { r: sig.r, s: sig.s, v: sig.v },
      });
      if (result.status !== 200) console.log("revokeApiKey:", result.status);
      return new NextResponse(result.text, {
        status: result.status,
        headers: { "Content-Type": "application/json", ...privateNoStoreHeaders() },
      });
    } catch (error) {
      void reportError("arcus.revoke-api-key", error);
      return jsonError("upstream unavailable", 502);
    }
  }

  if (body.kind !== "createApiKey") return jsonError("unknown kind", 400);

  const address = typeof body.address === "string" ? body.address : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
  const apiWalletName = typeof body.apiWalletName === "string" ? body.apiWalletName : "";
  const validUntil = typeof body.validUntil === "number" ? body.validUntil : 0;
  const sig = (body.signature ?? {}) as { r?: unknown; s?: unknown; v?: unknown };

  const now = Date.now();
  const ok =
    ADDR_RE.test(address) &&
    /^[0-9a-f]{64}$/.test(publicKey) &&
    /^[\w-]{1,32}$/.test(apiWalletName) &&
    validUntil > now + 3_600_000 &&
    validUntil <= now + 181 * 24 * 3_600_000 &&
    typeof sig.r === "string" && /^0x[0-9a-f]{64}$/i.test(sig.r) &&
    typeof sig.s === "string" && /^0x[0-9a-f]{64}$/i.test(sig.s) &&
    (sig.v === "0x1b" || sig.v === "0x1c");
  if (!ok) return jsonError("bad params", 400);

  try {
    const result = await relayCreateApiKey({
      address,
      publicKey,
      apiWalletName,
      validUntil,
      signature: { r: sig.r, s: sig.s, v: sig.v },
    });
    return new NextResponse(result.text, {
      status: result.status,
      headers: { "Content-Type": "application/json", ...privateNoStoreHeaders() },
    });
  } catch (error) {
    void reportError("arcus.create-api-key", error);
    return jsonError("upstream unavailable", 502);
  }
}
