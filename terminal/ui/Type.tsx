import type { ElementType, ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/** A screen's or a panel's name: the display face, wide and upper case. */
export function Title({ as: Tag = 'h1', className, children }: { as?: ElementType; className?: string; children: ReactNode }) {
  return <Tag className={cx(s.title, className)}>{children}</Tag>;
}

/** A small upper-case label over a figure or a field. */
export function Kick({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx(s.kick, className)}>{children}</span>;
}

/**
 * A big number in the display face, with its unit in amber. `tone` colours it only when it is a move: mint for growth,
 * flare for a fall — never decoration.
 */
export function Figure({ value, unit, size = 'l', tone, className }: { value: ReactNode; unit?: string; size?: 'xl' | 'l' | 'm' | 's'; tone?: 'up' | 'down'; className?: string }) {
  return (
    <span className={cx(s.fig, size === 'xl' && s.figXl, size === 'm' && s.figM, size === 's' && s.figS, tone === 'up' && s.up, tone === 'down' && s.down, className)}>
      {value}
      {unit ? <span className={s.unit}>{unit}</span> : null}
    </span>
  );
}
