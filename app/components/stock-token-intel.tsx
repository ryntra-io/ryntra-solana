"use client";

// Stock Token Intelligence card — explains, in plain words, why a Stock Token's price legitimately
// differs from the headline share price (ERC-8056 uiMultiplier / total-return drift), and surfaces
// scheduled corporate actions + an oracle-paused state. Fed by lib/rwa/stock-token.ts (on-chain).
// Design per ryntra-design-bar: locked palette via CSS vars, mono numbers, semantic flags, no emoji.

import type { StockTokenIntel } from "@/lib/rwa/stock-token";

const fmtMult = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtUsd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function StockTokenIntelCard({
  symbol,
  intel,
  tokenPrice,
  loading,
  processing,
}: {
  symbol: string;
  intel: StockTokenIntel | null;
  tokenPrice: number | null;
  loading?: boolean;
  /** Corporate action is in its on-chain processing window — computed by the parent from the
      SAME clock as the risk verdict, so this card and the risk tile never disagree by up to a
      minute around the effective time. */
  processing?: boolean;
}) {
  return (
    <section className="sti-card" translate="no" aria-label="Stock Token Intelligence">
      <div className="sti-eyebrow">
        <span>Stock Token Intelligence</span>
        <span className="sti-tag">on-chain</span>
      </div>

      {loading || !intel ? (
        <p className="cb-hint">
          {loading
            ? "Reading the on-chain multiplier…"
            : "On-chain multiplier unavailable — could not read this token's uiMultiplier right now."}
        </p>
      ) : (
        <>
          <div className="sti-headline">
            <span className="sti-eq">1 {symbol} =</span>
            <span className="sti-mult">{fmtMult(intel.multiplierX)}</span>
            <span className="sti-unit">{intel.multiplierX === 1 ? "share" : "shares"}</span>
          </div>

          <div className="sti-rows">
            {tokenPrice != null ? (
              <div className="sti-row">
                <span>Token price</span>
                <b>${fmtUsd(tokenPrice)}</b>
              </div>
            ) : null}
            {intel.perSharePrice != null ? (
              <div className="sti-row">
                <span>Per share (equiv.)</span>
                <b>${fmtUsd(intel.perSharePrice)}</b>
              </div>
            ) : null}
          </div>

          {intel.hasDrift ? (
            <p className="sti-note">
              The token price sits <b>above</b> the headline share price because dividends auto-reinvest into the
              multiplier. That drift is expected — not a premium and not a bug.
            </p>
          ) : (
            <p className="sti-note">
              At launch, 1 token equals 1 share. As dividends reinvest, the multiplier rises and one token comes to
              track progressively more than one share.
            </p>
          )}

          {intel.pending ? (
            // `processing` (past effective time, change not yet applied on-chain) comes from the
            // parent's single clock so this card and the risk tile agree at the boundary.
            processing ? (
              <p className="sti-flag sti-flag-warn">
                Multiplier change to {fmtMult(intel.pending.newMultiplierX)}× is processing — trading typically pauses
                and open orders may be canceled until it completes.
              </p>
            ) : (
              <p className="sti-flag sti-flag-warn">
                Multiplier changes to {fmtMult(intel.pending.newMultiplierX)}× on {fmtDate(intel.pending.effectiveAt)} — a
                corporate action. Trading may pause around the effective time.
              </p>
            )
          ) : null}

          {intel.oraclePaused ? (
            <p className="sti-flag sti-flag-danger">
              Oracle paused — the price feed is not updating. Avoid new trades until it resumes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
