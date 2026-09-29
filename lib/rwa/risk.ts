/* RWA risk classification — pure logic, no React, no I/O.
   Consumed by the Spot RWA Risk Panel (swap) and the SmartTrade Risk tab.

   Level precedence (first match wins): avoid > caution > unknown > ok.
   - avoid   — hard signals: oracle paused, oracle stale, sequencer down,
               corporate action paused the market.
   - caution — soft signals: underlying US market closed (off-hours regime),
               elevated spread, one-sided order book, notable premium/discount
               vs the oracle price, elevated funding, corporate-action status
               pending or not connected yet.
   - unknown — no avoid/caution trigger fired, but a CONNECTABLE core signal
               (oracle freshness/pause, or — for stock tokens / equity perps —
               market-hours estimate) is missing. Callers show this as "partial
               data", never as "all clear".
   - ok      — every connectable core signal present and healthy.

   Sequencer note: the L2 Sequencer Uptime Feed is NOT published for Robinhood
   Chain, so `sequencerUp` is structurally unmeasurable here. An explicit down
   signal (`false`) is still a hard `avoid`, but a null sequencer does NOT drag
   the verdict to "unknown" (that would pin every verdict to "partial data"
   forever over a signal we cannot get). Callers surface "sequencer not
   monitored" as an honest footnote instead of degrading the verdict. For spot
   this is safe: a sequencer outage makes a swap fail to settle, not fill badly.

   Conventions for callers:
   - Pass `null` for anything not measured yet (e.g. Chainlink freshness
     before the on-chain adapter ships). Never fake a healthy value.
   - For crypto assets, market hours / corporate actions do not apply:
     pass marketOpen: null, offHours: false, corporateAction: "none";
     a null marketOpen is only treated as missing data for RWA asset types. */

export type RwaRiskLevel = "ok" | "caution" | "avoid" | "unknown";

export type RwaAssetType = "stock-token" | "equity-perp" | "crypto" | "unknown";

export type RwaRiskSnapshot = {
  symbol: string;
  assetType: RwaAssetType;
  /** Underlying US market open? From the venue's `isOutsideRth` fact when available,
      else a local NYSE estimate. See `marketOpenSource`. */
  marketOpen: boolean | null;
  /** Where `marketOpen` came from: "venue" = Arcus `isOutsideRth` fact (word it plainly),
      "est" (or undefined) = local NYSE calc (word it "likely … (est.)"). */
  marketOpenSource?: "venue" | "est";
  /** RWA instrument trading while the underlying market is (likely) closed. */
  offHours: boolean;
  oracleFresh: boolean | null;
  oraclePaused: boolean | null;
  /** L2 sequencer health. `false` = down (hard avoid); `true` = up; `null` = not monitored —
      the Robinhood-Chain sequencer uptime feed is not published, so null is EXPECTED and does
      not degrade the verdict (only an explicit `false` does). Surface null as a footnote. */
  sequencerUp: boolean | null;
  spreadBps: number | null;
  /** Signed % the token's traded price sits above (+) / below (−) its Chainlink feed price
      (rwa-risk-signals #14). The feed prices the TOKEN (uiMultiplier already baked in — see
      robinhood-chain-truth §5), so no multiplier adjustment here. This is Ryntra's own
      moment-in-time ESTIMATE, never RHJ's official deviation methodology. null = not measured.
      An enhancement signal: null never degrades the verdict to "unknown". */
  premiumPct: number | null;
  /** Perps CLOB only (#15): true = exactly one of bid/ask is missing (one-sided book),
      false = both sides quoted, null = no book / not measured (spot RFQ has no book).
      Like premiumPct, null never degrades the verdict. */
  bookOneSided: boolean | null;
  /** Arcus funding is an hourly fraction (see ARCUS-API.md). */
  fundingRateHourly: number | null;
  initialMarginFraction: number | null;
  offHoursInitialMarginFraction: number | null;
  corporateAction: "none" | "pending" | "paused" | "unknown";
};

/** Spread at or above this is flagged as elevated (0.25%). */
export const HIGH_SPREAD_BPS = 25;
/** |hourly funding| at or above this is flagged as elevated (0.01%/h ≈ 87%/yr). */
export const HIGH_FUNDING_HOURLY = 0.0001;
/** |premium/discount| at or above this is flagged (2%). Deliberately tighter than RHJ's official
    disclosure regime (≥5% sustained over 7 trading days) — ours is a momentary early warning. */
export const HIGH_PREMIUM_PCT = 2;

/** Premium/discount % of a traded price vs the Chainlink feed price (#14). Pure; returns null
    unless both prices are finite and positive — a 0/NaN price must never fake a 0% premium. */
export function computePremiumPct(tradedPrice: number | null | undefined, feedPrice: number | null | undefined): number | null {
  if (tradedPrice == null || feedPrice == null) return null;
  if (!Number.isFinite(tradedPrice) || !Number.isFinite(feedPrice) || tradedPrice <= 0 || feedPrice <= 0) return null;
  return (tradedPrice / feedPrice - 1) * 100;
}

const isRwaAsset = (t: RwaAssetType) => t === "stock-token" || t === "equity-perp";

export function classifyRwaRisk(s: RwaRiskSnapshot): { level: RwaRiskLevel; reasons: string[] } {
  const avoid: string[] = [];
  const caution: string[] = [];
  const missing: string[] = [];

  // --- avoid: hard stop signals ---
  if (s.oraclePaused === true) avoid.push("Oracle is paused — price feed is not updating.");
  // A stale feed is a hard stop ONLY while the underlying market is open — Stock Token feeds
  // update 24/5, so an off-hours/weekend flat feed is EXPECTED, not an incident (rwa-risk-signals
  // #9). Off-hours staleness is surfaced by the off-hours caution below, not as a false red.
  if (s.oracleFresh === false && !s.offHours) avoid.push("Oracle price is stale — last update is too old.");
  if (s.sequencerUp === false) avoid.push("L2 sequencer appears down — transactions may not settle.");
  // RHJ frames the halt as typical, not guaranteed (robinhood-chain-truth §7) — hedge, don't state.
  if (s.corporateAction === "paused")
    avoid.push("A corporate action is processing — trading typically pauses and open orders may be canceled.");
  if (avoid.length) return { level: "avoid", reasons: avoid };

  // --- caution: elevated-risk signals ---
  if (s.offHours) {
    caution.push(
      s.marketOpenSource === "venue"
        ? "Underlying US market is closed — thinner liquidity, wider spreads."
        : "Underlying US market is likely closed (est.) — thinner liquidity, wider spreads."
    );
    if (
      s.initialMarginFraction != null &&
      s.offHoursInitialMarginFraction != null &&
      s.offHoursInitialMarginFraction > s.initialMarginFraction
    ) {
      caution.push("Off-hours initial margin is higher than regular hours.");
    }
  }
  if (s.spreadBps != null && s.spreadBps >= HIGH_SPREAD_BPS)
    caution.push(`Spread is elevated (${s.spreadBps.toFixed(1)} bps).`);
  if (s.bookOneSided === true)
    caution.push("Order book is one-sided — one side has no quotes right now.");
  if (s.premiumPct != null && Math.abs(s.premiumPct) >= HIGH_PREMIUM_PCT) {
    const dir = s.premiumPct > 0 ? "above" : "below";
    // The feed prices the TOKEN (multiplier baked in) — never say "the underlying's price": with
    // uiMultiplier > 1 the token legitimately trades above the underlying share and the sentence
    // would be factually wrong. Against a flat off-hours feed the basis is the last print — say so.
    const ref = s.oracleFresh === true ? "its live oracle price" : "its oracle's last price";
    caution.push(`Token trades ${Math.abs(s.premiumPct).toFixed(1)}% ${dir} ${ref} (est.).`);
  }
  if (s.fundingRateHourly != null && Math.abs(s.fundingRateHourly) >= HIGH_FUNDING_HOURLY)
    caution.push("Funding rate is elevated.");
  if (s.corporateAction === "pending")
    caution.push("A corporate action is pending — pricing may adjust.");
  // "unknown" covers both a surface with no adapter yet AND a failed on-chain read — the honest
  // common denominator is "unavailable right now", never a claim about what is or isn't scheduled.
  if (s.corporateAction === "unknown" && isRwaAsset(s.assetType))
    caution.push("Corporate-action status unavailable — check dividends/splits yourself.");
  if (caution.length) return { level: "caution", reasons: caution };

  // --- unknown: core health signals missing ---
  // Each oracle signal counts independently: freshness and pause status arrive from
  // different adapters, and a partially-connected oracle must never read as all-clear.
  if (s.oracleFresh == null || s.oraclePaused == null) missing.push("Oracle status not fully connected yet.");
  // sequencerUp == null is NOT treated as missing — the feed is unavailable on this chain, so it
  // would pin every verdict to "partial data" forever. An explicit `false` is still a hard avoid
  // above; callers name "sequencer not monitored" as a footnote (see doc comment).
  if (s.marketOpen == null && isRwaAsset(s.assetType)) missing.push("Market-hours estimate unavailable.");
  if (missing.length) return { level: "unknown", reasons: missing };

  return { level: "ok", reasons: [] };
}
