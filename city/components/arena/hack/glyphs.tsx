import type { ReactNode } from 'react';
import type { StepKind } from '@/city/lib/arena/hack/view/model';

/** Hack's own glyphs, drawn as the Deck's: one stroke weight, square joins, 24 px. */

const Svg = ({ children, width = 2 }: { children: ReactNode; width?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    {children}
  </svg>
);

export const BackGlyph = () => (
  <Svg width={2.4}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const InfoGlyph = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.5" />
  </Svg>
);

export const ChevronGlyph = () => (
  <Svg width={2.4}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

/** One glyph per step of a run. */
const STEP: Readonly<Record<StepKind, () => ReactNode>> = {
  took: () => <path d="M4 20V4h11l-2 4 2 4H4" />,
  read: () => (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  build: () => <path d="M14 6l4 4M4 20l9-9M13 3l8 8-3 3-8-8z" />,
  broke: () => <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  held: () => <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  unclear: () => <path d="M9 9a3 3 0 115 2c-1 .8-2 1.4-2 3M12 18v.5" />,
  filed: () => <path d="M5 21V4h12l-2 4 2 4H5M9 8l2 2 4-4" />,
  review: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  refused: () => <path d="M6 6l12 12M18 6L6 18" />,
  finding: () => <path d="M5 21V4h12l-2 4 2 4H5" />,
};

export function StepGlyph({ kind }: { kind: StepKind }) {
  const Draw = STEP[kind];
  return <Svg>{Draw()}</Svg>;
}
