import { NOT_MEASURED } from '../../../lib/world/text-safety/measured.ts';

/** Where a tower stands. Each district is a sector of the island with its own skyline rules. */
export type District = 'core' | 'heights' | 'strip' | 'avenue' | 'docks';

export type Tower = {
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  district: District;
  price: number;
  mcap: number;
  liquidity: number;
  holders: number;
  change5m: number;
  change1h: number;
  change24h: number;
  volume24h: number;
  traders1h: number;
  /** Jupiter's organic score, 0–100: how much of the activity looks human. */
  organic: number;
  verified: boolean;
  /** First pool creation time; new launches sprout in the docks. */
  launchedAt: string | null;
  /**
   * The figures the source did not measure (CITY-73). They stay zero above so the scene can still draw the tower, and
   * a screen writes «Not measured» for them, never the zero (`towerFigure`). Absent when every figure was read.
   */
  unread?: readonly TowerFigure[];
};

/** The figures of a tower a source may leave out. */
export const TOWER_FIGURES = ['price', 'mcap', 'liquidity', 'holders', 'change5m', 'change1h', 'change24h', 'volume24h', 'traders1h', 'organic'] as const;
export type TowerFigure = (typeof TOWER_FIGURES)[number];

/** A tower's figure for a screen: formatted when the source measured it, «Not measured» when it did not. */
export const towerFigure = (tower: Pick<Tower, TowerFigure | 'unread'>, figure: TowerFigure, format: (value: number) => string): string =>
  tower.unread?.includes(figure) ? NOT_MEASURED.en : format(tower[figure]);

/**
 * Only Jupiter-verified tokens are shown by name and logo. Unverified pools stand in the city as anonymous
 * scaffolds: the city never promotes a coin nobody has vetted.
 */
export const isNamed = (tower: Pick<Tower, 'verified'>): boolean => tower.verified;

export type CitySnapshot = {
  towers: Tower[];
  fetchedAt: string;
  /** 'live' when this answer came from Jupiter now; 'snapshot' is the bundled fallback and is labelled on screen. */
  source: 'live' | 'snapshot';
};
