/** The «Scouts» glyphs: 24 px, `currentColor`, the city's square stroke. */

/** A scout's pennant on its pole: the window's mark, and the sign on a tower your friends trade. */
export const FlagGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <path d="M6 21V3" />
    <path d="M6 4h12l-3.5 4.5L18 13H6" fill="currentColor" fillOpacity="0.28" />
  </svg>
);

export const XGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.33l4.38 5.79L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z" />
  </svg>
);

/** One of your own trades, half its fee back. */
const Back = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />
  </svg>
);

/** A friend you brought. */
const Friend = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

/** A friend a friend brought. */
const Friends = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.9 2.9-6 6.5-6s6.5 2.1 6.5 6" />
    <path d="M15 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.3c2.4.6 4 2.6 4 5.7" />
  </svg>
);

/** Paid out. */
const Out = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />
  </svg>
);

export function KindGlyph({ kind }: { kind: 'CASHBACK' | 'REFERRAL_L1' | 'REFERRAL_L2' | 'CLAIM' }) {
  if (kind === 'CASHBACK') return <Back />;
  if (kind === 'REFERRAL_L1') return <Friend />;
  if (kind === 'REFERRAL_L2') return <Friends />;
  return <Out />;
}
