'use client';

import {
  memo,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { fullRect, type Handle } from '@/city/lib/window/geometry';
import { dockedIn, moveIn, placed, resizeIn } from '@/city/lib/window/layout';
import { canGoOut, goOut } from '@/city/lib/window/out';
import { useWindows } from '@/city/lib/window/store';
import { useRyntraApp } from '@/city/lib/app-mode';
import { Mark } from '../hud/Mark';
import { useWords } from '@/city/lib/i18n/dict';
import { CloseGlyph, FullGlyph, OutGlyph, PopOutGlyph } from './glyphs';
import { WINDOW } from './words';
import s from './window.module.css';

const HANDLES: readonly Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
const HANDLE_CLASS: Record<Handle, string> = {
  n: s.handleN!,
  s: s.handleS!,
  e: s.handleE!,
  w: s.handleW!,
  nw: s.handleNw!,
  ne: s.handleNe!,
  sw: s.handleSw!,
  se: s.handleSe!,
};

/**
 * One window over the city on a computer (CITY-65, macets M2 and M3): the head with its title and the three buttons,
 * dragged by the head and stretched by every edge and corner; on the whole screen, the head of M3 with «Exit full
 * screen». What is inside comes from the window's own `render` and is not drawn again while the frame moves.
 */
export function WindowFrame({ id, z }: { id: string; z: number }) {
  const w = useWords(WINDOW);
  const spec = useWindows((st) => st.specs[id]);
  const win = useWindows((st) => placed(st.layout, id));
  const full = useWindows((st) => st.layout.full === id);
  const front = useWindows((st) => st.layout.windows.at(-1)?.id === id);
  const docked = useWindows((st) => dockedIn(st.layout, id));
  const viewport = useWindows((st) => st.viewport);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const begin = useDrag(id);
  const app = useRyntraApp();

  // The window takes the keyboard when it opens and when it takes or gives back the whole screen.
  useEffect(() => {
    const node = frame.current;
    if (node && (front || full) && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening and on the whole screen, not on every raise
  }, [full]);

  if (!spec || !win) return null;
  const rect = full ? fullRect(viewport) : win.rect;
  const actions = useWindows.getState();
  // Onto another screen (CITY-75): a window that says how to open on its own, in a browser that can.
  const out = spec.detach && !app && canGoOut() ? (
    <button type="button" className={s.tool} aria-label={w.goOut} title={w.goOut} onClick={() => void goOut(id)}>
      <OutGlyph />
    </button>
  ) : null;

  return (
    <div
      ref={frame}
      className={`${s.window} ${full ? s.full : ''} ${front ? s.front : ''} ${docked && !full ? s.docked : ''}`}
      style={{ transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`, width: rect.width, height: rect.height, zIndex: full ? 1000 : z + 1 }}
      role="dialog"
      aria-modal={full || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-window={id}
      data-window-full={full ? '' : undefined}
      onPointerDownCapture={() => actions.raise(id)}
      onFocusCapture={() => !full && actions.raise(id)}
      onKeyDown={full ? trapFocus : undefined}
    >
      <div className={s.panel}>
        {full ? (
          <div className={`${s.head} ${s.headFull}`}>
            <span className={s.brand}>
              <Mark size={26} glow={false} />
              <span className={s.word}>RYNTRA</span>
            </span>
            <h2 id={titleId} className={`${s.title} ${s.titleFull}`}>
              {spec.title}
            </h2>
            <div className={s.tools}>
              {out}
              <button type="button" className={s.tool} aria-label={w.popOut} title={w.popOut} onClick={() => actions.popOut(id)}>
                <PopOutGlyph />
              </button>
              <button type="button" className={s.exit} onClick={() => actions.exitFull()}>
                <CloseGlyph />
                {w.exitFull}
              </button>
            </div>
          </div>
        ) : (
          <div className={s.head} onPointerDown={(event) => !isControl(event) && begin(event, 'move')} onDoubleClick={(event) => !isControl(event) && actions.full(id)}>
            {spec.icon && <span className={s.icon}>{spec.icon}</span>}
            <h2 id={titleId} className={s.title}>
              {spec.title}
            </h2>
            <div className={s.tools}>
              {out}
              <button type="button" className={s.tool} aria-label={w.full} title={w.full} onClick={() => actions.full(id)}>
                <FullGlyph />
              </button>
              <button type="button" className={s.tool} aria-label={w.popOut} title={w.popOut} disabled={!docked} onClick={() => actions.popOut(id)}>
                <PopOutGlyph />
              </button>
              <button type="button" className={s.tool} aria-label={w.close} title={w.close} disabled={spec.held} onClick={() => actions.dismiss(id)}>
                <CloseGlyph />
              </button>
            </div>
          </div>
        )}
        <div className={s.body}>
          <Body render={spec.render} />
        </div>
      </div>
      {!full && (
        <>
          {HANDLES.map((handle) => (
            <span key={handle} className={`${s.handle} ${HANDLE_CLASS[handle]}`} aria-hidden="true" data-handle={handle} onPointerDown={(event) => begin(event, handle)} />
          ))}
          <span className={`${s.bracket} ${s.bracketNw}`} aria-hidden="true" />
          <span className={`${s.bracket} ${s.bracketNe}`} aria-hidden="true" />
          <span className={`${s.bracket} ${s.bracketSw}`} aria-hidden="true" />
          <span className={`${s.bracket} ${s.bracketSe}`} aria-hidden="true" />
        </>
      )}
    </div>
  );
}

/** The window's contents: drawn when the window opens or its `render` changes, never because the frame moved. */
export const Body = memo(function Body({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
});

const isControl = (event: ReactPointerEvent | ReactMouseEvent) => Boolean((event.target as HTMLElement).closest('button, a, input, select, textarea'));

/** On the whole screen the keyboard stays in the window: Tab past the last control comes back to the first. */
function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const box = event.currentTarget;
  const stops = [...box.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (node) => node.offsetParent !== null,
  );
  if (!stops.length) return event.preventDefault();
  const first = stops[0]!;
  const last = stops.at(-1)!;
  const at = document.activeElement;
  if (event.shiftKey && (at === first || at === box)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (at === last || at === box)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A drag by the head (`move`) or by an edge or corner: every step is worked out from where the windows stood when the
 * pointer went down, at most once a frame; the layout is remembered when the pointer lets go.
 */
function useDrag(id: string) {
  return (event: ReactPointerEvent<HTMLElement>, kind: 'move' | Handle) => {
    if (event.button !== 0) return;
    const store = useWindows.getState();
    const start = store.layout;
    const own = placed(start, id);
    if (!store.desk || start.full === id || !own) return;
    event.preventDefault();
    event.stopPropagation();
    const x0 = event.clientX;
    const y0 = event.clientY;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let last: PointerEvent | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const dx = last.clientX - x0;
      const dy = last.clientY - y0;
      const next = kind === 'move' ? moveIn(start, id, own.rect, dx, dy) : resizeIn(start, id, kind, dx, dy);
      useWindows.getState().drag(next.layout, next.guides);
    };
    const onMove = (move: PointerEvent) => {
      last = move;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onUp = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.documentElement.removeAttribute('data-window-drag');
      useWindows.getState().settle();
    };
    // While a window moves the city under the pointer does not take the drag.
    document.documentElement.setAttribute('data-window-drag', kind);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };
}
