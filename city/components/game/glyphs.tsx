/** The Play layer's glyphs, drawn like the HUD's: one stroke weight, square joins, 24 px. */

/** The Ring: two agents face to face inside the ropes. */
export const RingGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18v14H3z" />
    <path d="M3 11h18M3 15.5h18" opacity="0.55" />
    <path d="M8.5 8.5l2 2-2 2-2-2zM15.5 8.5l2 2-2 2-2-2z" />
  </svg>
);

/** The Map: the island from above, a mark on it. */
export const MapGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" opacity="0.55" />
  </svg>
);

/** Play: a game pad, the one sign everyone reads as «a game». */
export const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 7h10a5 5 0 0 1 4.6 6.9l-1.2 3A2.6 2.6 0 0 1 16 17.5L14.5 15h-5L8 17.5a2.6 2.6 0 0 1-4.4-.6l-1.2-3A5 5 0 0 1 7 7z" />
    <path d="M8 10v3M6.5 11.5h3M15.5 11h.01M17.5 12.5h.01" strokeLinecap="round" />
  </svg>
);
