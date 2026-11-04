import type { BotKind, Goal, NextKind } from '@/city/lib/bots/kinds';
import type { BotTab } from '@/city/lib/bots/open';
import type { Sky } from '@/city/lib/bots/weather';

/** The bots window's glyphs: 24 px, one stroke in `currentColor`, the city's line. */

type P = Readonly<{ size?: number }>;

function Svg({ size = 24, children }: Readonly<{ size?: number; children: React.ReactNode }>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const KIND_PATHS: Readonly<Record<BotKind | NextKind, React.ReactNode>> = {
  grid: (
    <>
      <path d="M3 6h18M3 10h18M3 14h18M3 18h18" opacity={0.45} />
      <path d="M3 15l4-5 4 6 4-7 6 5" />
    </>
  ),
  lpRange: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="1.5" opacity={0.5} />
      <path d="M3 13c3-4 5 3 9-1s5-3 9 0" />
    </>
  ),
  buyLadder: (
    <>
      <path d="M5 5v14M5 7h4M5 11h7M5 15h10M5 19h13" />
      <path d="M18 9v6m-2.5-2.5L18 15l2.5-2.5" />
    </>
  ),
  exitLadder: (
    <>
      <path d="M5 5v14M5 19h4M5 15h7M5 11h10M5 7h13" />
      <path d="M18 15V9m-2.5 2.5L18 9l2.5 2.5" />
    </>
  ),
  recurring: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
      <path d="M19.5 4.5v3h-3" />
    </>
  ),
  smartDca: (
    <>
      <path d="M4 18h16" opacity={0.5} />
      <path d="M6 16v-3M10 16v-6M14 16v-2M18 16V8" />
      <path d="M4 7l5 3 4-2 7 4" opacity={0.6} />
    </>
  ),
  rebalancer: (
    <>
      <path d="M12 4v16M6 20h12" />
      <path d="M4 9h6M14 9h6M4 9l-1 5h8l-1-5M14 9l-1 5h8l-1-5" />
    </>
  ),
  priceAlert: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  signal: (
    <>
      <path d="M3 17l5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  flipGrid: (
    <>
      <path d="M3 8h18M3 16h18" opacity={0.45} />
      <path d="M4 12c3-6 5-6 8 0s5 6 8 0" />
    </>
  ),
  stocksFunding: (
    <>
      <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" />
      <path d="M17 6h4v4" opacity={0.6} />
    </>
  ),
};

export function KindGlyph({ kind, size }: P & Readonly<{ kind: BotKind | NextKind }>) {
  return <Svg size={size}>{KIND_PATHS[kind]}</Svg>;
}

const GOAL_KIND: Readonly<Record<Goal, BotKind>> = { swings: 'grid', accumulate: 'recurring', profit: 'exitLadder', balance: 'rebalancer' };
export const GoalGlyph = ({ goal, size }: P & Readonly<{ goal: Goal }>) => <KindGlyph kind={GOAL_KIND[goal]} size={size} />;

export function SkyGlyph({ sky, size }: P & Readonly<{ sky: Sky }>) {
  return (
    <Svg size={size}>
      {sky === 'range' ? (
        <>
          <path d="M3 7h18M3 17h18" opacity={0.45} />
          <path d="M3 12c2.5-4 4.5-4 6 0s3.5 4 6 0 4.5-4 6 0" />
        </>
      ) : sky === 'trendUp' ? (
        <>
          <path d="M3 18l6-6 4 3 8-8" />
          <path d="M16 7h5v5" />
        </>
      ) : sky === 'trendDown' ? (
        <>
          <path d="M3 6l6 6 4-3 8 8" />
          <path d="M16 17h5v-5" />
        </>
      ) : (
        <path d="M3 13l3-6 3 10 3-12 3 12 3-8 3 4" />
      )}
    </Svg>
  );
}

export function TabGlyph({ tab, size }: P & Readonly<{ tab: BotTab }>) {
  return (
    <Svg size={size}>
      {tab === 'launch' ? (
        <path d="M12 3c3 2 5 5.5 5 9.5L15 17H9l-2-4.5C7 8.5 9 5 12 3zM10 20.5h4M12 9.5v.01" />
      ) : tab === 'hangar' ? (
        <>
          <rect x="5" y="8" width="14" height="11" rx="3" />
          <path d="M12 8V5M10 4h4M9 13v.01M15 13v.01M9.5 16h5" />
        </>
      ) : tab === 'strategies' ? (
        <>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M6 8v2a4 4 0 0 0 4 4h0.5M18 8v2a4 4 0 0 1-4 4h-.5M12 14v2" />
        </>
      ) : (
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
      )}
    </Svg>
  );
}

export const BackGlyph = () => (
  <Svg size={20}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronGlyph = () => (
  <Svg size={16}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const CheckGlyph = () => (
  <Svg size={16}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const ChainGlyph = () => (
  <Svg size={14}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const DownloadGlyph = () => (
  <Svg size={18}>
    <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14" />
  </Svg>
);

/** The scout: the city's small drone, four rotors over a body with one eye. */
export const ScoutGlyph = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 11h8l-1.5 5h-5z" />
    <path d="M12 16v2.5M10.5 13.5h3" />
    <path d="M4 8h5M15 8h5M6.5 8v3M17.5 8v3" />
  </Svg>
);

/** Ryntra's spark — the assistant's own mark in the city's top bar, drawn the same here. */
export const SparkGlyph = ({ size = 18 }: P) => (
  <Svg size={size}>
    <path d="M10 4.5l1.6 4.4 4.4 1.6-4.4 1.6L10 16.5l-1.6-4.4L4 10.5l4.4-1.6z" />
    <path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </Svg>
);
