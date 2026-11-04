/** The Guard window's glyphs (CITY-152), drawn in `currentColor` like every glyph of the city. */

/** The window's head: a shield with its mark — the Deck's own Guard glyph. */
export const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </svg>
);

/** The verdict's mark: a tick, an exclamation, a bar across. */
export const VerdictGlyph = ({ verdict }: { verdict: 'allow' | 'warn' | 'block' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" strokeWidth="1.8" />
    {verdict === 'allow' ? <path d="M8.5 12l2.5 2.5 4.5-5" /> : verdict === 'warn' ? <path d="M12 7.5v5M12 15.8v.2" /> : <path d="M8.5 12h7" />}
  </svg>
);

export const PasteGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="4" width="12" height="17" rx="2" />
    <path d="M9 4V2.8h6V4M9.5 10h5M9.5 14h5" strokeLinecap="round" />
  </svg>
);

export const ChevronGlyph = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease-out' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * The window's emblem before anything is pasted: the shield over two rings of light — the city's orange on its glass,
 * drawn rather than pictured, so it is sharp at every size.
 */
export const Emblem = () => (
  <svg viewBox="0 0 160 160" aria-hidden="true">
    <defs>
      <radialGradient id="guard-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ff681c" stopOpacity="0.42" />
        <stop offset="60%" stopColor="#ff681c" stopOpacity="0.08" />
        <stop offset="100%" stopColor="#ff681c" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="guard-edge" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ffe7c2" />
        <stop offset="55%" stopColor="#ff681c" />
        <stop offset="100%" stopColor="#9945ff" />
      </linearGradient>
      <linearGradient id="guard-face" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#23222d" />
        <stop offset="100%" stopColor="#0b0a14" />
      </linearGradient>
    </defs>
    <circle cx="80" cy="80" r="78" fill="url(#guard-glow)" />
    <circle cx="80" cy="80" r="62" fill="none" stroke="#ff681c" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="2 6" />
    <circle cx="80" cy="80" r="50" fill="none" stroke="#eef1ff" strokeOpacity="0.12" strokeWidth="1" />
    <path d="M80 34l34 12.5v25c0 21-14.3 36-34 42-19.7-6-34-21-34-42v-25z" fill="url(#guard-face)" stroke="url(#guard-edge)" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M66 79l10 10 19-21" fill="none" stroke="#ff681c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
