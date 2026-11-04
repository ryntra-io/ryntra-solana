/* The settings window's glyphs (CITY-87): 24 px, drawn in the current colour, the city's square line ends. */

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'square', strokeLinejoin: 'miter' } as const;

export const GearGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} strokeLinejoin="round" d="M10.3 2.8h3.4l.5 2.6a7.4 7.4 0 0 1 1.8 1l2.5-.9 1.7 2.9-2 1.8a7.4 7.4 0 0 1 0 2l2 1.8-1.7 2.9-2.5-.9a7.4 7.4 0 0 1-1.8 1l-.5 2.6h-3.4l-.5-2.6a7.4 7.4 0 0 1-1.8-1l-2.5.9-1.7-2.9 2-1.8a7.4 7.4 0 0 1 0-2l-2-1.8 1.7-2.9 2.5.9a7.4 7.4 0 0 1 1.8-1z" />
    <circle cx="12" cy="12" r="3" {...line} />
  </svg>
);

export const WalletGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M4 7.5h15.5v11.5H4z M4 7.5 15.5 4.5v3" />
    <circle cx="16" cy="13.2" r="1.3" fill="currentColor" />
  </svg>
);

export const BoltGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M13.5 2 5 13.5h6L9.5 22 19 9.8h-6.2z" />
  </svg>
);

export const BellGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} strokeLinejoin="round" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2H4.2zM10 21.2h4" />
  </svg>
);

export const LayoutGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M3.5 4.5h7.5v8H3.5zM13 4.5h7.5v5H13zM13 11.5h7.5v8H13zM3.5 14.5h7.5v5H3.5z" />
  </svg>
);

export const GlobeGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" {...line} />
    <path {...line} d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z" />
  </svg>
);

export const SpeakerGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path {...line} d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" />
  </svg>
);

export const ScreenGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M3.5 5h17v11h-17zM9 20h6M12 16v4" />
  </svg>
);

export const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} strokeLinejoin="round" d="M12 3 19.5 6v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z" />
    <path {...line} d="m8.8 12 2.3 2.3 4.2-4.6" />
  </svg>
);

/* The places a note goes. */

export const CityGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M3.5 20.5h17M5.5 20.5V10h4v10.5M9.5 20.5V5h5v15.5M14.5 20.5V8.5h4v12" />
  </svg>
);

export const DeskGlyph = ScreenGlyph;

export const TelegramGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} strokeLinejoin="round" d="M20.5 4 3.5 11l5.5 2 2 6 3-3.6 4.5 3.4z M9 13l8-6" />
  </svg>
);

export const OffGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="7.5" {...line} />
    <path {...line} d="M6.8 17.2 17.2 6.8" />
  </svg>
);

export const LockGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M5.5 11h13v9.5h-13zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

export const InfoGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 11v5.5M12 7.6v.1" />
  </svg>
);

export const ChevronGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const CopyGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M8.5 8.5h11v11h-11zM5 15.5V4.5h11" />
  </svg>
);

export const PhoneGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...line} d="M7 2.5h10v19H7zM11 18.5h2" />
  </svg>
);
