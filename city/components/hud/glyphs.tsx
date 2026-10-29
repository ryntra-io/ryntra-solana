/** The HUD's glyphs: one stroke weight, square joins, drawn for 24 px. */

export const MarketGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V11h4v9M10 20V5h4v15M16 20v-7h4v7M2 20h20" />
  </svg>
);

export const LaunchGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l3 7v11H9V9z" />
    <path d="M9 14l-3 3v3h3M15 14l3 3v3h-3" />
  </svg>
);

export const RunGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13l18-8-6 16-3-7z" />
  </svg>
);

export const HomeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11l9-7 9 7" />
    <path d="M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />
  </svg>
);

export const HarborGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M2 15c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M2 20c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M12 3v9M8 8h8" />
  </svg>
);

export const AgentGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4l7 5-7 11-7-11z" />
    <path d="M2 9h5M17 9h5" />
  </svg>
);

export const LockGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3" />
  </svg>
);

export const SpeakerOn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
  </svg>
);

export const SpeakerOff = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const InfoGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6M12 7.2v.3" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
