import type { ReactNode } from 'react';
import type { PageId } from '@/city/lib/pages/pages';

/* The pages' glyphs, 24 px, drawn in the frame's colour (`stroke="currentColor"`), square ends like the HUD's. */

const Glyph = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    {children}
  </svg>
);

/** An open book. */
export const DocsGlyph = () => (
  <Glyph>
    <path d="M3 5h6.5L12 7l2.5-2H21v14h-6.5L12 21l-2.5-2H3z" />
    <path d="M12 7v14" />
  </Glyph>
);

/** Two brackets and a slash. */
export const DevelopersGlyph = () => (
  <Glyph>
    <path d="M8 6L3 12l5 6M16 6l5 6-5 6M14 4l-4 16" />
  </Glyph>
);

/** Three towers in a speech bubble: the city, inside a chat. */
export const ConnectorGlyph = () => (
  <Glyph>
    <path d="M3 4h18v13h-9l-5 4v-4H3z" />
    <path d="M8 13v-3M12 13V7M16 13v-4" />
  </Glyph>
);

/** A ring buoy. */
export const HelpGlyph = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M6 6l3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5" />
  </Glyph>
);

/** An «i» in a cut square. */
export const AboutGlyph = () => (
  <Glyph>
    <path d="M7 3h14v14l-4 4H3V7z" />
    <path d="M12 10.5V17M12 7v.5" />
  </Glyph>
);

/** A page with a folded corner and lines. */
export const DocumentGlyph = () => (
  <Glyph>
    <path d="M5 3h10l4 4v14H5z" />
    <path d="M9 11h6M9 15h6" />
  </Glyph>
);

export const ChevronGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M8 16L16 8M9 8h7v7" />
  </svg>
);

export const BackGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const XGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.7 3h3.1l-6.8 7.7L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.2-8.3L1.7 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.2 4.7H5.4z" />
  </svg>
);

export const PAGE_GLYPHS: Readonly<Record<PageId, () => ReactNode>> = {
  docs: DocsGlyph,
  developers: DevelopersGlyph,
  connector: ConnectorGlyph,
  help: HelpGlyph,
  about: AboutGlyph,
  terms: DocumentGlyph,
  privacy: DocumentGlyph,
};
