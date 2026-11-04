/** The agent's glyphs in the window's head (CITY-176): a spark with a path — the agent at work — and a list of what it set. */

export const AgentGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3.5l1.5 3.8L14.3 9l-3.8 1.5L9 14.3 7.5 10.5 3.7 9l3.8-1.7z" />
    <path d="M14.5 16.5c1.6-.4 3-1.6 3.6-3.2M12.5 20.5c3.9-.3 7.2-3.5 7.8-7.4" />
  </svg>
);

export const ListGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6.5h11M9 12h11M9 17.5h7" />
    <path d="M4 6.5l1 1 2-2M4 12l1 1 2-2" />
    <circle cx="5" cy="17.5" r="1.3" />
  </svg>
);

export const CheckGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.2 4.2L19 7" />
  </svg>
);

export const ChevronGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
