import type { ReactNode } from 'react';

/** The quarter's glyphs, in the HUD's hand: one stroke weight, drawn for 24 px. */

const Glyph = ({ children, width = 2 }: { children: ReactNode; width?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    {children}
  </svg>
);

/** A lot with a home on it. */
export const LotGlyph = () => (
  <Glyph>
    <path d="M2 16.5l10 5 10-5-10-5z" />
    <path d="M8 15.5V10l4-3.5 4 3.5v5.5" />
  </Glyph>
);

export const BackGlyph = () => (
  <Glyph width={2.4}>
    <path d="M15 5l-7 7 7 7" />
  </Glyph>
);

const HomeGlyph = () => (
  <Glyph>
    <path d="M3.5 11L12 4l8.5 7" />
    <path d="M6 9.5V20h12V9.5" />
    <path d="M10 20v-5h4v5" />
  </Glyph>
);

const LampGlyph = () => (
  <Glyph>
    <path d="M12 21V9M9 21h6" />
    <path d="M9 4h6l-1 5h-4z" />
  </Glyph>
);

const CoinTowerGlyph = () => (
  <Glyph>
    <path d="M9 21V7l3-4 3 4v14" />
    <path d="M6 21h12M9 11h6M9 15h6" />
  </Glyph>
);

const HarborGlyph = () => (
  <Glyph>
    <path d="M2 15c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M2 20c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M12 3v9M8 8h8" />
  </Glyph>
);

const WorkshopGlyph = () => (
  <Glyph>
    <path d="M3 20V10l5 3v-3l5 3v-3l5 3v7z" />
    <path d="M3 20h18" />
  </Glyph>
);

const CrewGlyph = () => (
  <Glyph>
    <path d="M3 20l9-11 9 11z" />
    <path d="M12 9V3l5 2-5 2" />
  </Glyph>
);

const GarageGlyph = () => (
  <Glyph>
    <path d="M3 10l9-6 9 6v10H3z" />
    <path d="M7 20v-6h10v6M7 17h10" />
  </Glyph>
);

const OracleGlyph = () => (
  <Glyph>
    <path d="M4 4h16v11H4zM12 15v5M8 20h8" />
    <path d="M8 9.5c2-2.5 6-2.5 8 0-2 2.5-6 2.5-8 0z" />
  </Glyph>
);

const ShowcaseGlyph = () => (
  <Glyph>
    <path d="M3 9l2-5h14l2 5M4 9v11h16V9" />
    <path d="M8 20v-6h8v6" />
  </Glyph>
);

/** One glyph for every module of the picker, by its id. */
export const MODULE_GLYPH: Record<string, () => ReactNode> = {
  home: HomeGlyph,
  lamp: LampGlyph,
  coin_tower: CoinTowerGlyph,
  harbor: HarborGlyph,
  workshop: WorkshopGlyph,
  crew_hq: CrewGlyph,
  garage: GarageGlyph,
  oracle: OracleGlyph,
  showcase: ShowcaseGlyph,
};

/** Three people on one street: a crew. */
export const CrewPeopleGlyph = () => (
  <Glyph>
    <circle cx="12" cy="7.5" r="2.6" />
    <circle cx="5.5" cy="9.5" r="2.1" />
    <circle cx="18.5" cy="9.5" r="2.1" />
    <path d="M7.6 19.5v-1.2a4.4 4.4 0 0 1 8.8 0v1.2" />
    <path d="M2 18.5v-.6a3.4 3.4 0 0 1 4.4-3.2" />
    <path d="M22 18.5v-.6a3.4 3.4 0 0 0-4.4-3.2" />
  </Glyph>
);

/** A module going up onto the headquarters. */
export const GiftGlyph = () => (
  <Glyph>
    <path d="M4 14.5l8 4 8-4-8-4z" />
    <path d="M4 14.5V18l8 4 8-4v-3.5" />
    <path d="M12 2v6.5" />
    <path d="M9 5l3-3 3 3" />
  </Glyph>
);

/** Points: a star of the day's work. */
export const PointsGlyph = () => (
  <Glyph>
    <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />
  </Glyph>
);
