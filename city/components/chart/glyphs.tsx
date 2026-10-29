/** The chart window's glyphs, drawn like the HUD's: one stroke weight, square joins, for 24 px. */

export const CandlesGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3v4M6 17v4M18 2v5M18 15v7M12 6v3M12 19v3" />
    <path d="M4 7h4v10H4zM16 7h4v8h-4zM10 9h4v10h-4z" />
  </svg>
);

