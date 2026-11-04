/** The window frame's glyphs: the HUD's stroke and joins (city/components/hud/glyphs.tsx), drawn for 24 px. */

/** On the whole screen: two corners pulled outward. */
export const FullGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
  </svg>
);

/** Back from the whole screen: the two corners pulled in. */
export const ExitFullGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7" />
  </svg>
);

/** Pop out: a window with an arrow leaving it. */
export const PopOutGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5H4v15h15v-7" />
    <path d="M14 4h6v6M20 4l-9 9" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Stick together: four panes in one grid. */
export const GridGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h11v9H3zM17 4h4v4h-4zM17 11h4v2h-4zM3 16h18v4H3z" />
  </svg>
);

/** Onto another screen: a screen with an arrow leaving it for the next one. */
export const OutGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 15H3V5h12v3M6 19h5" />
    <path d="M11 12h10M18 9l3 3-3 3" />
  </svg>
);

/** Back into the city: an arrow coming home into the screen. */
export const BackGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 9V5h10v10h-4M14 19h5" />
    <path d="M14 12H3M6 9l-3 3 3 3" />
  </svg>
);

/** Minimise: the window drops to a bar at the bottom — the tray over the Deck. */
export const FoldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M6 18h12" />
  </svg>
);

/** The layouts: the two bays with the city between them. */
export const BaysGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h5v16H3zM16 4h5v16h-5z" />
    <path d="M11 15v5M13.5 11v9" strokeLinecap="square" />
  </svg>
);
