/* Arcus — the REFERENCE implementation of the VenueAdapter contract (NORTH-STAR §3).
   Server-safe read ports only: it wraps the existing zero-auth Arcus reads (lib/arcus/public.ts)
   and normalizes them into the venue-agnostic shapes the core consumes. Nothing here holds keys
   or funds. Wallet-signed execution lives in lib/arcus/spot-exec.ts (client-only) and is wired to
   the optional `exec` port separately, so this module stays importable on the server.

   Adding a 2nd venue = implementing these same ports against its API. */

import {
  getMarkets,
  getCandles,
  getPositions,
  getFills,
  getOrders,
  type ArcusMarket,
} from "../../arcus/public";
import type { RwaAssetType } from "../../rwa/risk";
import type {
  VenueAdapter,
  VenueMarket,
  VenueCandle,
  VenuePosition,
  VenueFill,
  VenueOrder,
  AssetClass,
} from "../types";
import { arcusCapabilities } from "./capabilities";

/** Parse a possibly-absent numeric string to a finite number, else null (never fake a value). */
const num = (s?: string | null): number | null => {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const isCrypto = (category?: string) => (category ?? "").toUpperCase() === "CRYPTO";

/** /v1/markets are perp markets; CRYPTO → crypto-perp, EQUITIES/COMMODITIES/INDICES → rwa-perp. */
const assetClassOf = (category?: string): AssetClass => (isCrypto(category) ? "crypto-perp" : "rwa-perp");

const riskAssetTypeOf = (category?: string): RwaAssetType => (isCrypto(category) ? "crypto" : "equity-perp");

function toVenueMarket(m: ArcusMarket): VenueMarket {
  return {
    symbol: m.baseAsset || m.marketDisplayName,
    label: m.marketDisplayName,
    assetClass: assetClassOf(m.category),
    quoteModel: "clob",
    collateralAsset: "USDG",
    tickSize: m.tickSize ?? null,
    stepSize: m.stepSize ?? null,
    minNotional: m.minOrderNotional ?? null,
    maxLeverage: null, // not published in /v1/markets metadata; leave null rather than guess
    online: (m.status ?? "").toUpperCase().includes("ONLINE"),
    isOutsideRth: m.isOutsideRth,
  };
}

const findMarket = (ms: ArcusMarket[], symbol: string) =>
  ms.find((m) => m.baseAsset === symbol || m.marketDisplayName === symbol) ?? null;

export const arcusVenue: VenueAdapter = {
  meta: {
    id: "arcus",
    label: "Arcus",
    chainId: 4663,
    chainName: "Robinhood Chain",
    signingFamily: "evm", // spot EIP-712 + perps Ed25519, both via the EVM wallet
    status: "live", // spot live; perps beta/cohort-gated (a capability/status detail, not a venue status)
    venueStatedRestrictions: ["US", "UK", "CA", "CH", "UAE"],
  },

  capabilities: arcusCapabilities,

  economics: {
    model: "referral",
    note: "Referral 10%/3%/2% of referee PERP fees. Ryntra's executable Rialto spot route discloses its provider fee from each fresh quote; spot referral-code control and payout are unverified. No supported builder-code control on this route.",
    earnsToday: false, // Ryntra has not verified executable spot attribution or payout control
  },

  catalog: {
    async listMarkets(): Promise<VenueMarket[]> {
      return (await getMarkets()).map(toVenueMarket);
    },
    async getMarket(symbol: string): Promise<VenueMarket | null> {
      const m = findMarket(await getMarkets(), symbol);
      return m ? toVenueMarket(m) : null;
    },
  },

  data: {
    async candles(symbol: string, timeframe: string, hours: number): Promise<VenueCandle[]> {
      const raw = await getCandles(symbol, timeframe, hours);
      // Arcus perp candle openTime is in microseconds; normalize to unix seconds.
      return raw.map((c) => ({
        time: Math.floor(c.openTime / 1_000_000),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }));
    },
  },

  account: {
    async positions(address: string): Promise<VenuePosition[]> {
      return (await getPositions(address)).map((p) => ({
        symbol: p.marketDisplayName,
        side: p.side === "LONG" ? "long" : "short",
        size: Number(p.size),
        entryPrice: Number(p.averageEntryPrice),
        markPrice: num(p.markPrice),
        unrealizedPnl: num(p.unrealizedPnl),
        liquidationPrice: null, // not exposed on the public positions read
      }));
    },
    async fills(address: string, limit = 100): Promise<VenueFill[]> {
      return (await getFills(address, limit)).map((f) => ({
        id: f.tradeId,
        symbol: f.marketDisplayName,
        side: f.side === "BUY" ? "buy" : "sell",
        size: Number(f.size),
        price: Number(f.price),
        fee: Number(f.fee),
        realizedPnl: num(f.closedPnl),
        createdAt: f.createdAt,
      }));
    },
    async orders(address: string): Promise<VenueOrder[]> {
      return (await getOrders(address)).map((o) => ({
        id: o.orderId,
        symbol: o.marketDisplayName,
        side: o.side === "BUY" ? "buy" : "sell",
        type: o.type,
        status: o.status,
        price: num(o.price),
        size: Number(o.originalSize),
        filled: Number(o.filledSize),
        remaining: Number(o.remainingSize),
      }));
    },
  },

  risk: {
    // Build a (partial) RwaRiskSnapshot from live market metadata. On-chain signals (Chainlink
    // freshness, oraclePaused, sequencer) are `null` until that adapter ships — never faked; the
    // engine surfaces a partial snapshot as "unknown", never "all clear" (see lib/rwa/risk.ts).
    async snapshot(symbol: string) {
      const m = findMarket(await getMarkets(), symbol);
      if (!m) return null;
      const crypto = isCrypto(m.category);
      const outside = m.isOutsideRth;
      const venueKnowsHours = !crypto && typeof outside === "boolean";
      return {
        symbol,
        assetType: riskAssetTypeOf(m.category),
        marketOpen: crypto ? null : venueKnowsHours ? !outside : null,
        marketOpenSource: venueKnowsHours ? ("venue" as const) : undefined,
        offHours: !crypto && outside === true,
        oracleFresh: null,
        oraclePaused: null,
        sequencerUp: null,
        spreadBps: null,
        premiumPct: null,
        bookOneSided: null,
        fundingRateHourly: num(m.fundingRate),
        initialMarginFraction: num(m.initialMarginFraction),
        offHoursInitialMarginFraction: num(m.offHoursInitialMarginFraction),
        corporateAction: crypto ? "none" : "unknown",
      };
    },
  },

  // exec: wired on the client from lib/arcus/spot-exec.ts (executeSpotSwap); omitted here so this
  // module stays server-importable and non-custodial by construction.
};
