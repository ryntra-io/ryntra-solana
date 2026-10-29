import type { ReactNode } from 'react';
import type { PieceKind } from '@/lib/world/layout';

/** The free pieces' glyphs, in the quarter's hand: one stroke weight, drawn for 24 px. */

const Glyph = ({ children, width = 2 }: { children: ReactNode; width?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    {children}
  </svg>
);

const Block = () => (
  <Glyph>
    <path d="M4 10l8-5 8 5" />
    <path d="M6 9v11h12V9" />
    <path d="M10 20v-4h4v4M9 12h1M14 12h1" />
  </Glyph>
);

const Glass = () => (
  <Glyph>
    <rect x="5" y="4" width="14" height="16" />
    <path d="M5 9.5h14M5 15h14M12 4v16" />
  </Glyph>
);

const Arch = () => (
  <Glyph>
    <path d="M3 20V7h18v13" />
    <path d="M8 20v-5a4 4 0 0 1 8 0v5" />
  </Glyph>
);

const Turret = () => (
  <Glyph>
    <path d="M12 2.5l4.5 6.5h-9z" />
    <path d="M8.5 9v11.5h7V9" />
    <path d="M11 14h2" />
  </Glyph>
);

const Path = () => (
  <Glyph>
    <path d="M3 15l9-5 9 5-9 5z" />
    <path d="M7.5 12.5l9 5M12 10v10" />
  </Glyph>
);

const Hedge = () => (
  <Glyph>
    <path d="M3 18.5h18" />
    <path d="M4 18.5v-5a3 3 0 0 1 5-2.2 3 3 0 0 1 6 0 3 3 0 0 1 5 2.2v5" />
  </Glyph>
);

const Tree = () => (
  <Glyph>
    <path d="M12 21v-6" />
    <path d="M12 3a6 6 0 0 1 4.5 10H7.5A6 6 0 0 1 12 3z" />
  </Glyph>
);

const Lamp = () => (
  <Glyph>
    <path d="M12 21V9M9 21h6" />
    <circle cx="12" cy="6" r="3" />
  </Glyph>
);

const Fountain = () => (
  <Glyph>
    <path d="M4 16h16l-2 4H6z" />
    <path d="M12 16V6M12 6c-2 0-3.5 2-4 5M12 6c2 0 3.5 2 4 5" />
  </Glyph>
);

const Sign = () => (
  <Glyph>
    <rect x="3.5" y="5" width="17" height="9" />
    <path d="M7 14v7M17 14v7M7.5 9.5h9" />
  </Glyph>
);

const Arcade = () => (
  <Glyph>
    <rect x="4" y="3.5" width="16" height="17" />
    <rect x="7" y="7" width="10" height="6" />
    <path d="M9 17h.01M12 17h3" />
  </Glyph>
);

const Vault = () => (
  <Glyph>
    <rect x="3.5" y="4" width="17" height="16" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 9.5v5M9.5 12h5" />
  </Glyph>
);

const Ring = () => (
  <Glyph>
    <path d="M4 7v12M20 7v12M4 19h16" />
    <path d="M4 10h16M4 14h16" />
  </Glyph>
);

export const PIECE_GLYPH: Record<PieceKind, () => ReactNode> = {
  block: Block,
  glass: Glass,
  arch: Arch,
  turret: Turret,
  path: Path,
  hedge: Hedge,
  tree: Tree,
  lamp: Lamp,
  fountain: Fountain,
  sign: Sign,
  arcade: Arcade,
  vault_house: Vault,
  mini_ring: Ring,
};

/** Take a piece off. */
export const EraseGlyph = () => (
  <Glyph>
    <path d="M8.5 20h11" />
    <path d="M14.5 4.5l5 5L10 19H6.5l-3-3z" />
    <path d="M9.5 9.5l5 5" />
  </Glyph>
);

/** Turn the piece a quarter. */
export const TurnGlyph = () => (
  <Glyph width={2.2}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4v4.5H15" />
  </Glyph>
);

/** One step back. */
export const UndoGlyph = () => (
  <Glyph width={2.2}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Glyph>
);

/** Free building: a small stack of blocks. */
export const FreeGlyph = () => (
  <Glyph>
    <path d="M3 16l5-2.5 5 2.5-5 2.5z" />
    <path d="M3 16v3l5 2.5 5-2.5v-3" />
    <path d="M11 9.5l5-2.5 5 2.5-5 2.5z" />
    <path d="M11 9.5v3l5 2.5 5-2.5v-3" />
  </Glyph>
);
