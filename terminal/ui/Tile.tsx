import type { ReactNode } from 'react';
import { Figure, Kick } from './Type';
import s from './ui.module.css';

/** A tile: one fact with its label — a count, a price, a result. `tone` only when the figure is a move. */
export function Tile({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'up' | 'down' }) {
  return (
    <div className={s.tile}>
      <Kick>{label}</Kick>
      <Figure value={value} unit={unit} size="m" tone={tone} />
    </div>
  );
}
