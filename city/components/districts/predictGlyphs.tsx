import type { Art } from '@/city/lib/districts/predict/markets';

/** Predictions' glyphs, drawn like the HUD's: one stroke weight, round joins, 24 px. */

export const PredictGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 17l5.5-5.5 4 4L21 7" />
    <path d="M15 7h6v6" />
  </svg>
);

export const BackGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ChevronGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const InfoGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const VolumeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 20V13M9 20V8M14 20v-9M19 20V5M3 20h18" />
  </svg>
);

export const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" strokeWidth="1.6" />
    <path d="M8 12.4l2.7 2.6L16 9.6" />
  </svg>
);

export const CopyGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);

/** The USDC coin: a blue disc with the dollar ring, as the coin is drawn everywhere. */
export const UsdcCoin = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#2775CA" />
    <path d="M12.2 7.6a9.2 9.2 0 0 0 0 16.8M19.8 7.6a9.2 9.2 0 0 1 0 16.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    <text x="16" y="21.4" textAnchor="middle" fontSize="14.5" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
      $
    </text>
  </svg>
);

/** Practice money: an amber ring with a P, never the USDC coin. */
export const PracticeCoin = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="15" fill="#2A1640" stroke="#FFB23F" strokeWidth="2" />
    <path d="M12.5 22.5v-13h4.6a3.9 3.9 0 0 1 0 7.8h-4.6" fill="none" stroke="#FFB23F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A card's picture when the event has none the page may show: its category's emblem on the night glass. */
export function ArtGlyph({ art }: { art: Art }) {
  switch (art) {
    case 'crypto':
      return (
        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="2.4" />
          <path d="M20 15v18M24 15v3M24 30v3M19 18h7.5a3.5 3.5 0 0 1 0 7H19m0 0h8.5a3.5 3.5 0 0 1 0 7H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'politics':
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 36h28M12 32h24M14 31V20M20 31V20M28 31V20M34 31V20M11 20h26L24 11z" />
          <path d="M24 11V7" strokeLinecap="round" />
        </svg>
      );
    case 'sports':
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden="true">
          <circle cx="24" cy="24" r="15" />
          <path d="M24 17l6.6 4.8-2.5 7.8h-8.2l-2.5-7.8zM24 17V9.5M30.6 21.8l7-2.3M28.1 29.6l4.3 6M19.9 29.6l-4.3 6M17.4 21.8l-7-2.3" />
        </svg>
      );
    case 'world':
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <circle cx="24" cy="24" r="15" />
          <path d="M9 24h30M24 9c4.5 4.2 6.5 9.2 6.5 15S28.5 34.8 24 39c-4.5-4.2-6.5-9.2-6.5-15S19.5 13.2 24 9z" />
        </svg>
      );
    case 'finance':
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 38h30M13 38V26M21 38V18M29 38V22M37 38V12" />
          <path d="M11 20l8-7 7 4 11-8" />
        </svg>
      );
    case 'culture':
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden="true">
          <path d="M24 9l4.3 9.2 10 1.2-7.4 6.9 2 9.9L24 31.3l-8.9 4.9 2-9.9-7.4-6.9 10-1.2z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 32l9-9 6 6 15-15" />
          <path d="M30 14h9v9" />
        </svg>
      );
  }
}

export const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);

/** Trending: a flame. */
export const FlameGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.4 2.3-5.2 3.6-7.9.4 1.9 1.3 3 2.4 3.6C11.7 7 13 4.6 14.6 3c.3 3 4 5.6 4 10.6 0 4.4-2.8 7.4-6.6 7.4z" />
    <path d="M12 21c-1.6 0-2.8-1.2-2.8-2.9 0-1.8 1.6-2.7 2.3-4.4 1.3 1.1 3.3 2.4 3.3 4.4 0 1.7-1.2 2.9-2.8 2.9z" />
  </svg>
);

/** Ending soon: a clock. */
export const ClockGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** Your positions: a stack of cards. */
export const StackGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="9" width="16" height="11" rx="2.5" />
    <path d="M6.5 6h11M9 3h6" />
  </svg>
);
