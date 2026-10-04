"use client";

/**
 * Token orbit for the hero.
 *
 * The design asked for tokens circling the brand. The honesty constraint is
 * that an orbit is a claim about coverage, so:
 *
 *  - Symbols are real and fixed, never invented and never fetched. A decorative
 *    ring must not become a second, unverified market feed.
 *  - Each symbol carries its actual role. The three swap routes are visually
 *    distinct from read-only markets, because conflating them is exactly the
 *    overstatement this page exists to avoid.
 *  - No prices appear here. A number beside a symbol reads as live data, and
 *    this ring has no freshness contract to back that up.
 *
 * Motion is transform-only and stops entirely under reduced motion, where the
 * ring becomes a static, fully legible arrangement rather than disappearing.
 */

export type OrbitToken = { symbol: string; role: "swap" | "read" };

/** The three supported swap routes plus a sample of read-only Arcus markets. */
export const HERO_ORBIT: readonly OrbitToken[] = [
  { symbol: "TSLA", role: "swap" },
  { symbol: "BTC", role: "read" },
  { symbol: "AAPL", role: "swap" },
  { symbol: "ETH", role: "read" },
  { symbol: "AMD", role: "swap" },
  { symbol: "GLD", role: "read" },
];

export function TokenOrbit({
  tokens = HERO_ORBIT,
  swapLabel,
  readLabel,
  pauseLabel,
  resumeLabel,
  reduced,
  paused,
  onTogglePaused,
}: {
  tokens?: readonly OrbitToken[];
  swapLabel: string;
  readLabel: string;
  pauseLabel: string;
  resumeLabel: string;
  reduced: boolean;
  paused: boolean;
  onTogglePaused: () => void;
}) {
  const step = 360 / tokens.length;

  return (
    <div className="lp4-orbit" data-paused={paused ? "true" : undefined}>
      {/* A continuously moving element needs a stop control. The ring itself is
          decorative and aria-hidden; only this control is exposed, and it
          disappears under reduced motion where nothing is moving. */}
      {reduced ? null : (
        <button
          type="button"
          className="lp4-orbit-toggle"
          onClick={onTogglePaused}
          aria-pressed={paused}
        >
          {paused ? resumeLabel : pauseLabel}
        </button>
      )}
      <div className="lp4-orbit-ring" aria-hidden>
        {tokens.map((token, index) => (
          <span
            className="lp4-orbit-token mono"
            key={token.symbol}
            data-role={token.role}
            style={{ "--i": index, "--step": `${step}deg` } as React.CSSProperties}
          >
            <span className="lp4-orbit-face">{token.symbol}</span>
          </span>
        ))}
      </div>
      {/* The legend is the honest part of the ornament: it names what each
          treatment means, so the ring cannot imply everything is tradable. */}
      <p className="lp4-orbit-legend" aria-hidden>
        <span data-role="swap">{swapLabel}</span>
        <span data-role="read">{readLabel}</span>
      </p>
    </div>
  );
}
