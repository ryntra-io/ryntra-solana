/** The Deck's own glyphs, drawn as the HUD's: one stroke weight, square joins, 24 px. */

export const MoneyGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h15v13H3zM3 7l12-4v4" />
    <path d="M21 11h-5v5h5z" />
  </svg>
);

export const TradeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M3 17l6-6 4 4 7-8" />
    <path d="M15 7h5v5" />
  </svg>
);

export const BotGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 8h14v11H5zM12 8V4M9 4h6" />
    <path d="M9 12.5v1.5M15 12.5v1.5M9 16.5h6M2 12v3M22 12v3" />
  </svg>
);

export const EarnGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 18c0 1.7 3.6 3 8 3s8-1.3 8-3M4 14c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    <path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zM4 10v8M20 10v8M12 2v3" />
  </svg>
);

export const SwapGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
  </svg>
);

export const SpotGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9h18" strokeDasharray="3 3" />
    <path d="M4 20l5-6 4 3 7-9" />
    <path d="M20 4v5" />
  </svg>
);

export const FuturesGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3v3M6 15v6M18 3v5M18 17v4M12 7v2M12 19v2" />
    <path d="M4 6h4v9H4zM16 8h4v9h-4zM10 9h4v10h-4z" />
  </svg>
);

/** Agents: a helmet with its visor — the city's agents wear one. */
export const AgentsGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M4 21v-8a8 8 0 0116 0v8z" />
    <path d="M7.5 12h9v4h-9z" />
  </svg>
);

/** Arena: two blades crossed. */
export const ArenaGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 3l10 10M20 3L10 13" />
    <path d="M11 16l-3 3M13 16l3 3M6 15l3 3M18 15l-3 3M3 21l3-3M21 21l-3-3" />
  </svg>
);

/** Guard: a shield with its mark. */
export const GuardGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </svg>
);

/** The hangar: a roof over an open door. */
export const HangarGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 10l10-6 10 6M4 9v12h16V9" />
    <path d="M8 21v-7h8v7M8 17.5h8" />
  </svg>
);

/** Garage: the agent's garage with its roll-up door, an antenna on the roof — it reports in (CITY-29). */
export const GarageGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21V10l9-4 9 4v11" />
    <path d="M7 21v-8h10v8M7 16h10M7 18.5h10" />
    <path d="M12 6V2.5M10 3.5a3 3 0 014 0" />
  </svg>
);

/** Hack: a lock opened from inside. */
export const HackGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 11h14v10H5zM8 11V7a4 4 0 017.6-1.8" />
    <path d="M10 14l-2 2 2 2M14 14l2 2-2 2" />
  </svg>
);

/** Out to another place: an arrow leaving its box. */
export const OutGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M9 5H4v15h15v-5M13 4h7v7M20 4l-9 9" />
  </svg>
);

export const ChevronGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
