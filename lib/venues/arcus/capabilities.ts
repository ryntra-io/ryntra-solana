import type { VenueCapabilities } from "../types";

/* Arcus capability matrix — client-safe, pure (imports only the type). The order ticket reads
   this to render ONLY the controls Arcus truthfully executes, and to keep client-side
   simulations honestly labeled (DECISIONS 2026-07-08: never mask a client-side conditional as a
   resting venue order). Kept in its own module so client bundles import zero server-read code. */
export const arcusCapabilities: VenueCapabilities = {
  spot: true,
  spotModel: "rfq",
  perps: true,
  clob: true,
  orderbookData: true, // perps l2Orderbook; spot RFQ has none
  supportsResting: true, // perps GTT/ALO
  supportsStopTrigger: true, // perps TPSL triggers
  supportsOCO: "fixed-bundle", // partial/position/entry TPSL groupings, not free OCO
  supportsTrailing: false, // Arcus has no trailing stop
  supportsSpotConditional: false, // spot = RFQ, no server orders → Ryntra simulates client-side, labeled
  nativeTpSl: true, // perps
  reduceOnly: true,
  funding: true,
  liquidation: true,
  publicAccountData: true,
  walletSignedExec: true,
  withdrawals: false,
};
