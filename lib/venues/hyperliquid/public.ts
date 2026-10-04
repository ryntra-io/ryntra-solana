/* Hyperliquid public /info client — READ-ONLY, zero-auth (venue #2).
   Every request/response shape below is taken verbatim from the official docs
   (hyperliquid.gitbook.io → for-developers/api/info-endpoint, verified 2026-07-12):
     - POST https://api.hyperliquid.xyz/info, Content-Type: application/json
     - numeric values arrive as STRINGS; times are epoch MILLISECONDS
     - l2Book returns at most 20 levels per side; candleSnapshot at most 5000 candles;
       userFills at most 2000 most recent fills
     - rate limits: aggregated REST weight 1200/min/IP; l2Book/clearinghouseState weigh 2,
       most other info types weigh 20 — this client stays far below with on-demand reads
   NO exchange endpoint here: live execution is deliberately out of scope for this client.
   The transport is injectable so tests run on doc-shaped fixtures without a network. */

export const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

export type HlTransport = (body: unknown) => Promise<unknown>;

export function makeHlTransport(url: string = HL_INFO_URL): HlTransport {
  return async (body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`hyperliquid info ${res.status}`);
    return res.json();
  };
}

/* ---- doc-verified response shapes (subset we consume) ---- */

export type HlAssetMeta = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
};

export type HlMeta = { universe: HlAssetMeta[] };

/** metaAndAssetCtxs: [meta, ctxs[]] — ctxs index-aligned with universe. All numerics are strings. */
export type HlAssetCtx = {
  funding: string; // hourly funding rate
  markPx: string;
  midPx: string | null;
  oraclePx: string;
  openInterest: string;
  premium: string | null;
  dayNtlVlm: string;
  prevDayPx: string;
  impactPxs: [string, string] | null;
};

export type HlL2Level = { px: string; sz: string; n: number };
/** levels[0] = bids, levels[1] = asks (top-of-book first). */
export type HlL2Book = { coin: string; time: number; levels: [HlL2Level[], HlL2Level[]] };

export type HlCandle = {
  t: number; // open time, ms
  T: number; // close time, ms
  s: string; // coin
  i: string; // interval
  o: string;
  c: string;
  h: string;
  l: string;
  v: string; // base-unit volume
  n: number; // trade count
};

export type HlPosition = {
  position: {
    coin: string;
    szi: string; // signed size: >0 long, <0 short
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    liquidationPx: string | null;
    marginUsed: string;
    maxLeverage: number;
    leverage: { type: "isolated" | "cross"; value: number };
  };
  type: "oneWay";
};

export type HlClearinghouseState = {
  assetPositions: HlPosition[];
  marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string; totalRawUsd: string };
  withdrawable: string;
  time: number;
};

export type HlFill = {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A"; // B = buy/bid, A = ask/sell
  time: number; // ms
  closedPnl: string;
  dir: string; // "Open Long", "Close Short", …
  hash: string;
  oid: number;
  tid: number;
  fee: string; // inclusive of builderFee; negative = rebate
  feeToken: string;
  builderFee?: string; // absent when 0
};

export type HlOpenOrder = {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string; // remaining size
  origSz: string;
  oid: number;
  timestamp: number;
  orderType: string; // "Limit", "Stop Market", …
  reduceOnly: boolean;
  isTrigger: boolean;
  triggerPx: string;
  triggerCondition: string;
};

export type HlFundingEntry = { coin: string; fundingRate: string; premium: string; time: number };

/** Supported candle intervals per docs (exact list). */
export const HL_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
export type HlInterval = (typeof HL_INTERVALS)[number];

/* ---- typed calls ---- */

export const hlMeta = (t: HlTransport) => t({ type: "meta" }) as Promise<HlMeta>;

export const hlMetaAndAssetCtxs = (t: HlTransport) =>
  t({ type: "metaAndAssetCtxs" }) as Promise<[HlMeta, HlAssetCtx[]]>;

export const hlL2Book = (t: HlTransport, coin: string) => t({ type: "l2Book", coin }) as Promise<HlL2Book>;

export const hlCandles = (t: HlTransport, coin: string, interval: HlInterval, startTimeMs: number, endTimeMs: number) =>
  t({ type: "candleSnapshot", req: { coin, interval, startTime: startTimeMs, endTime: endTimeMs } }) as Promise<HlCandle[]>;

export const hlClearinghouseState = (t: HlTransport, user: string) =>
  t({ type: "clearinghouseState", user }) as Promise<HlClearinghouseState>;

export const hlUserFills = (t: HlTransport, user: string) => t({ type: "userFills", user }) as Promise<HlFill[]>;

export const hlFrontendOpenOrders = (t: HlTransport, user: string) =>
  t({ type: "frontendOpenOrders", user }) as Promise<HlOpenOrder[]>;

export const hlFundingHistory = (t: HlTransport, coin: string, startTimeMs: number) =>
  t({ type: "fundingHistory", coin, startTime: startTimeMs }) as Promise<HlFundingEntry[]>;
