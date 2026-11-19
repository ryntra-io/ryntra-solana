import { cx } from '@/terminal/ui';
import p from './portfolio.module.css';

/**
 * The Portfolio screen's marks that the kit has none of — a plus, a paper plane, an arrow down into a tray, a lock, a broom, an arrow into a bowl, a door —
 * drawn here on the kit's 24 grid with its one stroke, as the approved design draws them.
 */

export type GlyphName = 'plus' | 'send' | 'receive' | 'lock' | 'sweep' | 'collect' | 'exit' | 'wallet';

const PATHS: Readonly<Record<GlyphName, string>> = {
  plus: 'M12 5v14M5 12h14',
  send: 'M20 4L3 11l7 3 3 7zM10 14l4-4',
  receive: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  sweep: 'M14.5 3.5l-4 8M7 12h8l2 8.5H5zM9 16v4.5M13 16v4.5',
  collect: 'M12 4v9M8.5 9.5L12 13l3.5-3.5M5 14.5c0 3 3.1 5 7 5s7-2 7-5',
  exit: 'M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4M9.5 8l-4 4 4 4M5.5 12H15',
  wallet: 'M4.5 7.5A1.5 1.5 0 0 1 6 6h11.5v3M4.5 7.5v10A1.5 1.5 0 0 0 6 19h13a.5.5 0 0 0 .5-.5V9.5A.5.5 0 0 0 19 9H6a1.5 1.5 0 0 1-1.5-1.5zM15.5 14h1.5',
  lock: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M7 10.5h10a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 18v-6A1.5 1.5 0 0 1 7 10.5z',
};

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={cx(p.glyph, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
