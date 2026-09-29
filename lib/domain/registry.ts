/* Route-specific provider state feeds the canonical product capability registry.
   UI surfaces read lib/product/capabilities.ts; they never redeclare maturity.
   The consistency test cross-checks route state, product maturity, and feature flags.
   Update verifiedAt only after re-verifying the exact route claim. */

import type { CapabilityState } from "./capability.ts";
import type { RouteId } from "./ids.ts";
import type { RouteCapabilityClaim } from "./readiness.ts";

export const APP_CAPABILITY_VERIFIED_AT = "2026-08-08";

export const ROUTE_CAPABILITIES: Record<RouteId, CapabilityState> = {
  "arcus-spot-rfq": {
    protocol: "live",
    ryntra: "live",
    user: "unknown", // per-user geo/compliance — resolved by the live compliance gate at trade time
    verifiedAt: APP_CAPABILITY_VERIFIED_AT,
    source: "live-probe", // npm run arcus:check + shipped wallet-signed swap
    reason: "Wallet-signed RFQ swaps shipped; per-user access depends on geo/compliance.",
  },
  "arcus-perps-clob": {
    protocol: "beta",
    ryntra: "read-only",
    user: "unknown",
    verifiedAt: APP_CAPABILITY_VERIFIED_AT,
    source: "live-probe",
    reason: "Arcus perps are cohort/API-gated. Ryntra ships public account reads (positions/fills/orders) and paper SmartTrade on live data; live perp orders wait on Arcus enablement.",
  },
  "uniswap-rhchain-amm": {
    protocol: "live",
    ryntra: "read-only",
    user: "unknown",
    verifiedAt: APP_CAPABILITY_VERIFIED_AT,
    source: "live-probe", // QuoterV2/factory probed live 2026-07-12 (lib/venues/uniswap/quote.ts)
    reason: "Live on-chain quote comparison only — no execution through Ryntra. At verification the stock-token v3 pools held zero liquidity (quotes report 'no liquidity' honestly); UniswapX / Trading API route is API-key-gated and stays planned.",
  },
  "hyperliquid-perps-clob": {
    protocol: "live",
    ryntra: "planned",
    user: "unknown",
    verifiedAt: APP_CAPABILITY_VERIFIED_AT,
    source: "live-probe", // read adapter probed against the live API 2026-07-12 (232 markets, candles, funding)
    reason: "Read-only adapter implemented behind the venue seam (lib/venues/hyperliquid) and live-probed; stays 'planned' until a user surface ships. Live execution deliberately out of scope until the execution-safety seams gate it.",
  },
};

export function routeCapability(id: RouteId): CapabilityState {
  return ROUTE_CAPABILITIES[id];
}

/**
 * The ONLY sanctioned way to build a capability claim for the readiness engine: the claim is
 * looked up from THIS registry and structurally bound to its route — callers never hand-pair
 * a capability with a foreign route.
 */
export function claimFor(route: RouteId): RouteCapabilityClaim {
  return { route, state: ROUTE_CAPABILITIES[route] };
}
