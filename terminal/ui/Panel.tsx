import type { CSSProperties, ElementType, ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

export type PanelTone = 'base' | 'hi' | 'soft';

/**
 * The panel: straight dark glass with a violet edge. `hi` is the one panel a screen acts in — its ticket or its form:
 * a warm edge and the brand's cut corner, one on a screen; `soft` quiets the edge. With `gap` its children stand in a
 * column that far apart. `edge` — the panel stands straight on the page, the width of its screen: on a phone it runs
 * from edge to edge.
 */
export function Panel({
  as: Tag = 'section',
  tone = 'base',
  pad = 'm',
  gap,
  edge = false,
  label,
  className,
  style,
  children,
}: {
  as?: ElementType;
  tone?: PanelTone;
  pad?: 'none' | 'm' | 'l';
  gap?: number;
  /** On a phone the panel runs from edge to edge: for a panel that is the width of its screen, never a card in a row. */
  edge?: boolean;
  /** The panel's name for a screen reader, where no heading names it. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cx(s.glass, tone === 'hi' && s.hi, tone === 'soft' && s.soft, pad === 'm' && s.pad, pad === 'l' && s.padL, gap !== undefined && s.stack, edge && s.edge, className)}
      aria-label={label}
      style={gap !== undefined ? { gap, ...style } : style}
    >
      {children}
    </Tag>
  );
}
