import { create } from 'zustand';

/**
 * What the mouse is over in the city, for the name label beside the cursor (desktop, fine pointer only). The target
 * changes a few times a second at most; the cursor's place goes straight to the label's style, never through React.
 */
export type HoverTarget = { kind: 'tower'; id: string } | { kind: 'building'; slot: number } | null;

export const useHover = create<{ target: HoverTarget }>(() => ({ target: null }));

const same = (a: HoverTarget, b: HoverTarget) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === 'tower' ? a.id === (b as { id: string }).id : a.slot === (b as { slot: number }).slot));

export function setHover(target: HoverTarget) {
  if (!same(useHover.getState().target, target)) useHover.setState({ target });
}

/** Gap between the cursor and the label, and from the label to the screen's edge. */
const OFFSET = 18;
const EDGE = 8;

let label: HTMLElement | null = null;
let size = { w: 0, h: 0 };
const at = { x: -9999, y: -9999 };

function place() {
  if (!label) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Right of and below the cursor; flipped to the other side where the screen ends.
  let x = at.x + OFFSET;
  let y = at.y + OFFSET;
  if (x + size.w > vw - EDGE) x = at.x - OFFSET - size.w;
  if (y + size.h > vh - EDGE) y = at.y - OFFSET - size.h;
  label.style.transform = `translate3d(${Math.max(EDGE, Math.round(x))}px, ${Math.max(EDGE, Math.round(y))}px, 0)`;
}

/** The scene reports the cursor here on every move: one style write, nothing else. */
export function moveHover(x: number, y: number) {
  at.x = x;
  at.y = y;
  place();
}

/** The label registers itself and tells its size whenever its words change. */
export function bindHoverLabel(el: HTMLElement | null) {
  label = el;
  size = el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
  place();
}
