/* ERC-8056 "Scaled UI Amount" (uiMultiplier) helpers — pure, no I/O.
   Robinhood Chain Stock Tokens encode corporate actions (splits/dividends) in an on-chain
   uiMultiplier (18 dp, 1e18 = 1.0). Tokens are NOT rebasing: raw balanceOf stays fixed; the
   multiplier scales the share-equivalent view.

     underlying shares      = rawTokenAmount × uiMultiplier ÷ 1e18
     per-share-equiv price  = tokenFeedPrice × 1e18 ÷ uiMultiplier
     share-equiv balance    = rawBalance × uiMultiplier ÷ 1e18

   The Chainlink feed price ALREADY bakes in the multiplier, so a token's price legitimately
   drifts ABOVE the headline share price over time (total-return) — expected, not a bug. Any
   surface that shows share counts or a per-share-equivalent price MUST apply this, or balances
   and PnL silently mismatch after a split/dividend. */

/** 1.0 in 18 dp. At token launch uiMultiplier() == this. */
export const UI_MULTIPLIER_ONE = 10n ** 18n;

/** Coerce a raw multiplier (hex/decimal string or bigint) to bigint; falls back to 1.0 on invalid/≤0. */
export function normalizeUiMultiplier(value: string | bigint | null | undefined): bigint {
  if (value == null) return UI_MULTIPLIER_ONE;
  try {
    const b = typeof value === "bigint" ? value : BigInt(value);
    return b > 0n ? b : UI_MULTIPLIER_ONE;
  } catch {
    return UI_MULTIPLIER_ONE;
  }
}

/** Share-equivalent amount = raw × uiMultiplier ÷ 1e18 (exact, integer domain). */
export function sharesFromTokenAmount(rawAmount: bigint, uiMultiplier: string | bigint): bigint {
  return (rawAmount * normalizeUiMultiplier(uiMultiplier)) / UI_MULTIPLIER_ONE;
}

/** Multiplier as a float (1e18 → 1.0). For DISPLAY math only — never for on-chain amounts. */
export function uiMultiplierToNumber(uiMultiplier: string | bigint): number {
  const m = normalizeUiMultiplier(uiMultiplier);
  // Scale down in the integer domain first so the value stays within Number's safe range.
  return Number(m / 10n ** 6n) / 1e12;
}

/** Per-share-equivalent price from the token feed price (which already includes the multiplier). */
export function perShareEquivalentPrice(tokenFeedPrice: number, uiMultiplier: string | bigint): number {
  const m = uiMultiplierToNumber(uiMultiplier);
  return m > 0 ? tokenFeedPrice / m : tokenFeedPrice;
}

/* ---- Stock Token Intelligence: pure presentation math over an ERC-8056 snapshot ----
   Kept here (a leaf module, no relative imports) so it stays unit-testable under `node --test`.
   The on-chain read that produces the snapshot lives in lib/rwa/stock-token.ts, which re-exports
   this for ergonomic imports. */

/** A scheduled corporate action (split/dividend) that will change the multiplier. */
export type StockTokenPending = { newMultiplierX: number; effectiveAt: number };

export type StockTokenIntel = {
  /** 1 token = X shares (1.0 at launch; rises as dividends reinvest). */
  multiplierX: number;
  /** token feed price restated per underlying share, or null if no price given. */
  perSharePrice: number | null;
  /** share-equivalent balance for a raw token amount, or null if no balance given. */
  shareEquivBalance: bigint | null;
  /** multiplier > 1 → the token price is legitimately above the headline share price (expected). */
  hasDrift: boolean;
  pending: StockTokenPending | null;
  oraclePaused: boolean;
};

export type StockTokenIntelInput = {
  uiMultiplier: string | bigint;
  newUiMultiplier?: string | bigint | null;
  effectiveAt?: number | null;
  /** true = paused, false = active, null/undefined = not read yet (treated as not-paused for display). */
  oraclePaused?: boolean | null;
  tokenFeedPrice?: number | null;
  rawBalance?: bigint | null;
};

/** Pending corporate action: a scheduled multiplier that differs from the current one, with a
    non-zero effectiveAt. `newUIMultiplier()` equals the current one when nothing is scheduled. */
export function pendingCorporateAction(
  input: Pick<StockTokenIntelInput, "uiMultiplier" | "newUiMultiplier" | "effectiveAt">
): StockTokenPending | null {
  if (input.newUiMultiplier == null || !input.effectiveAt || input.effectiveAt <= 0) return null;
  const cur = normalizeUiMultiplier(input.uiMultiplier);
  const next = normalizeUiMultiplier(input.newUiMultiplier);
  return next !== cur ? { newMultiplierX: uiMultiplierToNumber(next), effectiveAt: input.effectiveAt } : null;
}

/** Risk-engine corporate-action status (rwa-risk-signals #13) from an ERC-8056 snapshot:
    - a failed sub-read (newUiMultiplier or effectiveAt == null) → "unknown" — we could not
      determine the schedule, so we must NEVER assert "none scheduled" (fake all-clear).
    - no scheduled change (schedule == current, or effectiveAt 0) → "none"
    - scheduled change with a future effective time → "pending" (caution: pricing may adjust)
    - effective time reached but the change not applied yet → "paused" (processing window —
      trading typically halts; once the venue applies it, newUIMultiplier() == uiMultiplier()
      again and the status self-heals to "none").
    A fully-absent snapshot (null) is mapped to "unknown" by the caller before this is reached. */
export function corporateActionStatus(
  input: Pick<StockTokenIntelInput, "uiMultiplier" | "newUiMultiplier" | "effectiveAt">,
  nowSec: number
): "none" | "pending" | "paused" | "unknown" {
  if (input.newUiMultiplier == null || input.effectiveAt == null) return "unknown";
  const pending = pendingCorporateAction(input);
  if (!pending) return "none";
  return pending.effectiveAt > nowSec ? "pending" : "paused";
}

export function stockTokenIntel(input: StockTokenIntelInput): StockTokenIntel {
  const multiplierX = uiMultiplierToNumber(input.uiMultiplier);
  const perSharePrice =
    input.tokenFeedPrice != null ? perShareEquivalentPrice(input.tokenFeedPrice, input.uiMultiplier) : null;
  const shareEquivBalance =
    input.rawBalance != null ? sharesFromTokenAmount(input.rawBalance, input.uiMultiplier) : null;

  return {
    multiplierX,
    perSharePrice,
    shareEquivBalance,
    hasDrift: multiplierX > 1,
    pending: pendingCorporateAction(input),
    oraclePaused: input.oraclePaused ?? false,
  };
}
