import { useEffect, useRef, type RefObject } from 'react';

/**
 * A panel of the frame closes on a tap outside its own box and on Escape. Escape is taken on its way down, so the
 * screen under the panel does not also hear it; the focus goes back to the control that opened the panel.
 */
export function useDismiss(open: boolean, box: RefObject<HTMLElement | null>, close: () => void): void {
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) closing.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      const back = box.current?.querySelector<HTMLElement>('[aria-expanded]');
      closing.current();
      back?.focus({ preventScroll: true });
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, box]);
}
