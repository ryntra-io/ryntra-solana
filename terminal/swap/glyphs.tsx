import { cx } from '@/terminal/ui';
import s from './swap.module.css';

/**
 * The Swap screen's marks that the kit has none of — the bridge and a paper plane — drawn here on
 * the kit's 24 grid with its one stroke, as the approved design draws them.
 */

export function BridgeGlyph({ className }: { className?: string }) {
  return (
    <svg className={cx(s.glyph, s.glyphL, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 17c2.5-6 5.5-9 9-9s6.5 3 9 9M3 17h18M8 17v-4.5M12 17V8M16 17v-4.5" />
    </svg>
  );
}

export function SendGlyph({ className }: { className?: string }) {
  return (
    <svg className={cx(s.glyph, s.glyphL, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 4L3 11l7 3 3 7zM10 14l4-4" />
    </svg>
  );
}
