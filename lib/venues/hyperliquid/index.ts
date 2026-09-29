/* Hyperliquid — venue #2, READ-ONLY implementation of the VenueAdapter contract (STEP 6).
   Wave 1 boundary (deliberate): market catalog, candles, public account reads and risk signals
   only. NO `exec` port — live execution is not built; it would come only behind the
   execution-safety seams (lib/domain/execution-safety.ts: wallet-signed builder-fee approval,
   revocation, kill switch, idempotency, audit log). The capability truth for the product surface
   lives in lib/domain/registry.ts ("planned" until a user surface actually consumes this).

   All shapes doc-verified 2026-07-12 (see lib/venues/hyperliquid/public.ts header). */

import type {
  VenueAdapter,
  VenueMarket,
  VenueCandle,
  VenuePosition,
  VenueFill,
  VenueOrder,
} from "../types.ts";
import {
  makeHlTransport,
  hlMeta,
  hlMetaAndAssetCtxs,
  hlCandles,
  hlClearinghouseState,
  hlUserFills,
  hlFrontendOpenOrders,
  HL_INTERVALS,
  type HlTransport,
  type HlInterval,
  type HlAssetMeta,
} from "./public.ts";

/** Parse a docs-style numeric string; null when absent/not finite (never fake a value). */
const num = (s?: string | null): number | null => {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const toMarket = (a: HlAssetMeta): VenueMarket => ({
  symbol: a.name,
  label: `${a.name}-PERP`,
  assetClass: "crypto-perp", // first-dex universe is crypto perps; HIP-3 equity dexes are out of scope this wave
  quoteModel: "clob",
  collateralAsset: "USDC",
  tickSize: null, // HL prices use significant-figure rules, not a fixed tick — null, never guessed
  stepSize: a.szDecimals >= 0 ? (10 ** -a.szDecimals).toFixed(Math.max(0, a.szDecimals)) : null,
  minNotional: null, // not published in meta — left null rather than hardcoding folklore
  maxLeverage: a.maxLeverage,
  online: a.isDelisted !== true,
});

/**
 * Build the adapter around an injectable transport (tests pass doc-shaped fixtures).
 * Read ports only — structurally incapable of placing an order.
 */
export function makeHyperliquidVenue(transport: HlTransport = makeHlTransport()): VenueAdapter {
  return {
    meta: {
      id: "hyperliquid",
      label: "Hyperliquid",
      // Perps/orderbook settle on HyperCore — NOT an EVM chain, so no numeric id (never borrow
      // 999: that belongs to HyperEVM, a separate environment we don't touch until real EVM
      // interaction ships). Wallets still sign EVM-style typed data → signingFamily "evm".
      chainId: null,
      chainName: "HyperCore",
      signingFamily: "evm",
      status: "live",
      // Per Hyperliquid's own terms the app restricts US persons. RE-VERIFY before any Ryntra
      // user surface ships on this venue — this array is a disclosure hint, not legal advice.
      venueStatedRestrictions: ["US"],
    },

    capabilities: {
      // Capabilities describe what THIS ADAPTER truthfully serves, not the venue's brochure:
      // Hyperliquid does run spot markets, but this adapter reads only the perp universe
      // (meta/metaAndAssetCtxs) — claiming spot here would let a future consumer render a spot
      // surface this code cannot back. Flip when spotMeta/spotClearinghouseState reads ship.
      spot: false,
      spotModel: null,
      perps: true,
      clob: true,
      orderbookData: true, // real L2 book (l2Book, ≤20 levels/side) — DOM here is honest
      supportsResting: true,
      supportsStopTrigger: true,
      supportsOCO: "fixed-bundle", // TP/SL grouping (normalTpsl/positionTpsl), not free-form OCO
      supportsTrailing: false,
      supportsSpotConditional: false, // not verified in docs this pass — claim OFF until verified
      nativeTpSl: true,
      reduceOnly: true,
      funding: true,
      liquidation: true,
      publicAccountData: true, // clearinghouseState/userFills by address, zero-auth
      walletSignedExec: true,
      withdrawals: false,
    },

    economics: {
      model: "builder-code",
      note:
        "Builder codes: the USER wallet-signs an approveBuilderFee cap, revocable anytime; the per-fill builderFee is itemized in fills. Ryntra ships NO approval flow yet — no builder revenue accrues.",
      maxFeeBps: 10, // perps builder-fee ceiling per docs (0.1%)
      earnsToday: false,
    },

    catalog: {
      async listMarkets(): Promise<VenueMarket[]> {
        return (await hlMeta(transport)).universe.map(toMarket);
      },
      async getMarket(symbol: string): Promise<VenueMarket | null> {
        const a = (await hlMeta(transport)).universe.find((u) => u.name === symbol);
        return a ? toMarket(a) : null;
      },
    },

    data: {
      async candles(symbol: string, timeframe: string, hours: number): Promise<VenueCandle[]> {
        const interval = (HL_INTERVALS as readonly string[]).includes(timeframe) ? (timeframe as HlInterval) : "1h";
        const end = Date.now();
        const start = end - Math.max(1, hours) * 3_600_000;
        const raw = await hlCandles(transport, symbol, interval, start, end);
        // HL times are epoch ms; normalize open time to unix seconds like every other venue.
        return raw.map((c) => ({
          time: Math.floor(c.t / 1000),
          open: Number(c.o),
          high: Number(c.h),
          low: Number(c.l),
          close: Number(c.c),
          volume: Number(c.v),
        }));
      },
    },

    account: {
      async positions(address: string): Promise<VenuePosition[]> {
        const s = await hlClearinghouseState(transport, address);
        return s.assetPositions.map(({ position: p }) => {
          const szi = Number(p.szi);
          return {
            symbol: p.coin,
            side: szi >= 0 ? "long" : "short",
            size: Math.abs(szi),
            entryPrice: Number(p.entryPx),
            markPrice: null, // not in the position payload; joined ctx read is a separate call — never guessed
            unrealizedPnl: num(p.unrealizedPnl),
            liquidationPrice: num(p.liquidationPx),
          };
        });
      },
      async fills(address: string, limit = 100): Promise<VenueFill[]> {
        const fills = await hlUserFills(transport, address);
        return fills.slice(0, limit).map((f) => ({
          id: String(f.tid),
          symbol: f.coin,
          side: f.side === "B" ? "buy" : "sell",
          size: Number(f.sz),
          price: Number(f.px),
          fee: Number(f.fee), // inclusive of any builderFee; negative = rebate (doc semantics)
          realizedPnl: num(f.closedPnl),
          createdAt: f.time,
        }));
      },
      async orders(address: string): Promise<VenueOrder[]> {
        const orders = await hlFrontendOpenOrders(transport, address);
        return orders.map((o) => {
          const orig = Number(o.origSz);
          const remaining = Number(o.sz);
          return {
            id: String(o.oid),
            symbol: o.coin,
            side: o.side === "B" ? "buy" : "sell",
            type: o.orderType,
            status: "open",
            price: num(o.limitPx),
            size: orig,
            filled: Math.max(0, orig - remaining),
            remaining,
          };
        });
      },
    },

    risk: {
      // Crypto-perp snapshot from one metaAndAssetCtxs read. Signals HL does not expose
      // (oracle freshness/pause, sequencer) stay null — the engine renders them "unknown".
      async snapshot(symbol: string) {
        const [meta, ctxs] = await hlMetaAndAssetCtxs(transport);
        const i = meta.universe.findIndex((u) => u.name === symbol);
        if (i < 0 || !ctxs[i]) return null;
        const ctx = ctxs[i];
        const mark = num(ctx.markPx);
        const oracle = num(ctx.oraclePx);
        const maxLev = meta.universe[i].maxLeverage;
        return {
          symbol,
          assetType: "crypto" as const,
          marketOpen: null, // 24/7 venue — hours are not a signal here
          offHours: false,
          oracleFresh: null, // HL's oracle cadence is internal; freshness not exposed → unknown, never faked
          oraclePaused: null,
          sequencerUp: null,
          spreadBps: null, // needs an l2Book read; single-call snapshot keeps it unmeasured
          // (mark / oracle − 1)·100 from two doc-verified fields — no reliance on the
          // loosely-specified `premium` field's semantics.
          premiumPct: mark != null && oracle != null && oracle > 0 ? (mark / oracle - 1) * 100 : null,
          bookOneSided: null,
          fundingRateHourly: num(ctx.funding), // HL funding accrues hourly (doc semantics)
          initialMarginFraction: maxLev > 0 ? 1 / maxLev : null, // definitionally 1/maxLeverage
          offHoursInitialMarginFraction: null,
          corporateAction: "none" as const,
        };
      },
    },

    // exec: DELIBERATELY ABSENT this wave. When it ships it must be wallet-signed and wrapped in
    // the execution-safety seams (builder-fee approval, kill switch, idempotency, audit log).
  };
}

/** Default instance on the public mainnet API. */
export const hyperliquidVenue: VenueAdapter = makeHyperliquidVenue();
