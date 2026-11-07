import { useEffect } from 'react';
import { chartOwns, wayOf, type Touch, type Way } from './gesture.ts';

/**
 * The tower chart gives an up-or-down finger to the window it stands in (CITY-215; who takes what — `gesture.ts`).
 *
 * The core chart's engine keeps every touch on its canvas to itself: `touch-action: none` and a drag claimed as soon as
 * a finger moves. The city's stylesheet lets the browser pan up and down over the canvas (`chart.module.css`), and this
 * hook, listening on the chart's pane before the engine hears anything, decides each gesture once:
 * - up or down: the engine never hears the rest of it — the browser scrolls the window, with its own fling — and the
 *   engine is told the touch was cancelled, so no crosshair is left behind and no hold turns into one mid-scroll;
 * - across, two fingers, a held finger, a handle that drags on its own, or the drawing tools open: the engine has it
 *   all, as before.
 * Nothing here calls `preventDefault`: the hook only chooses who hears the finger.
 */
export function useScrollThrough(pane: Readonly<{ current: HTMLElement | null }>): void {
  useEffect(() => {
    const root = pane.current;
    if (!root) return;
    let gesture: { id: number; start: Touch; way: Way } | null = null;

    const point = (touch: globalThis.Touch, t: number): Touch => ({ x: touch.clientX, y: touch.clientY, t });
    const find = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i += 1) if (list[i].identifier === id) return list[i];
      return null;
    };

    const onStart = (event: TouchEvent) => {
      if (gesture?.way === 'scroll') {
        // A second finger while the window scrolls is still the window's.
        event.stopPropagation();
        return;
      }
      if (gesture) {
        if (gesture.way === 'undecided') gesture.way = 'chart';
        return;
      }
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      const owned = chartOwns({ handle: handleUnder(event.target, root), drawing: root.querySelector('.ryntra-draw[data-open]') !== null });
      gesture = { id: touch.identifier, start: point(touch, event.timeStamp), way: owned ? 'chart' : 'undecided' };
    };

    const onMove = (event: TouchEvent) => {
      if (!gesture || gesture.way === 'chart') return;
      if (gesture.way === 'scroll') {
        event.stopPropagation();
        return;
      }
      const touch = find(event.touches, gesture.id);
      if (!touch) return;
      gesture.way = wayOf(gesture.start, point(touch, event.timeStamp), event.touches.length);
      if (gesture.way !== 'scroll') return;
      event.stopPropagation();
      cancelInEngine(touch);
    };

    const onEnd = (event: TouchEvent) => {
      if (!gesture) return;
      if (gesture.way === 'scroll') event.stopPropagation();
      if (event.touches.length === 0) gesture = null;
    };

    const options = { capture: true, passive: true } as const;
    root.addEventListener('touchstart', onStart, options);
    root.addEventListener('touchmove', onMove, options);
    root.addEventListener('touchend', onEnd, options);
    root.addEventListener('touchcancel', onEnd, options);
    return () => {
      root.removeEventListener('touchstart', onStart, options);
      root.removeEventListener('touchmove', onMove, options);
      root.removeEventListener('touchend', onEnd, options);
      root.removeEventListener('touchcancel', onEnd, options);
    };
  }, [pane]);
}

/**
 * Whether the finger came down on a part of the chart that drags on its own — a price line the person moves, a tag, a
 * slider: anything between it and the pane that keeps every touch (`touch-action: none`). The engine's own canvas is let
 * pan up and down by the city's stylesheet, so it is never one of them.
 */
function handleUnder(target: EventTarget | null, root: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    if (getComputedStyle(node).touchAction === 'none') return true;
  }
  return false;
}

/**
 * The engine heard the finger come down and waits for it; the window has taken the gesture, so the engine is told it
 * was cancelled — the same word a browser sends when it takes a touch for itself. Its listeners stand on the document.
 */
function cancelInEngine(touch: globalThis.Touch): void {
  try {
    const cancel = new TouchEvent('touchcancel', { bubbles: true, cancelable: false, touches: [], targetTouches: [], changedTouches: [touch] });
    document.documentElement.dispatchEvent(cancel);
  } catch {
    // A browser without the TouchEvent constructor: the engine ends the touch when the finger lifts.
  }
}
