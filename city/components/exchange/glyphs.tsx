/** The Exchange's glyphs, drawn as the dock's: a square stroke on a 24 grid, the colour from the text. */

/** Two candles, one rising and one falling: a market both ways. */
export const ExchangeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M7 3v4M7 15v6M17 3v6M17 17v4" />
    <rect x="4.5" y="7" width="5" height="8" />
    <rect x="14.5" y="9" width="5" height="8" fill="currentColor" fillOpacity="0.35" />
  </svg>
);

export const ChevronGlyph = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M8 16L16 8M9 8h7v7" />
  </svg>
);
