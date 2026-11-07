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
import { dockedIn, dropAt, frontOfStack, liftIn, moveIn, placed, resizeIn, tabsOf, top, type Drop } from '@/city/lib/window/layout';
import { canGoOut, goOut } from '@/city/lib/window/out';
import { useWindows } from '@/city/lib/window/store';
import { useRyntraApp } from '@/city/lib/app-mode';
import { AskInWindow } from '../command/AskInWindow';
import { Mark } from '../hud/Mark';
import { useWords } from '@/city/lib/i18n/dict';
import { CloseGlyph, FoldGlyph, FullGlyph, OutGlyph, PopOutGlyph } from './glyphs';
import { canOpen, foldWindow } from './openers';
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
 * One window over the city on a computer (CITY-65, macets M2 and M3): the head with its title and its buttons, dragged
 * by the head and stretched by every edge and corner; on the whole screen, the head of M3 with «Exit full screen».
 * What is inside comes from the window's own `render` and is not drawn again while the frame moves.
 *
 * Since CITY-84: in a bay the frame stretches by its inner edge only; dragged by the head out of the bay it floats,
 * near the screen's side it docks, over another frame's head it becomes its tab — the place it would land lights up.
 * Windows sharing a frame show their tabs in the head; «Minimise» folds the window into the tray (a window the city can
 * open again by itself: `openers.ts`). A tab not in front keeps its frame, out of sight, so what was typed in it is
 * still there.
 */
export function WindowFrame({ id, z }: { id: string; z: number }) {
  const w = useWords(WINDOW);
  const spec = useWindows((st) => st.specs[id]);
  const win = useWindows((st) => placed(st.layout, id));
  const full = useWindows((st) => st.layout.full === id);
  const front = useWindows((st) => top(st.layout)?.id === id);
  const docked = useWindows((st) => dockedIn(st.layout, id));
  const shown = useWindows((st) => frontOfStack(st.layout, id));
  const tabs = useWindows((st) => tabsOf(st.layout, id).map((t) => t.id).join(' '));
  const glide = useWindows((st) => st.glide);
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
  // A window that fits its contents stands as tall as they are, up to its place's height (CITY-201).
  const fit = Boolean(spec.fit) && !full;
  const actions = useWindows.getState();
  const tabIds = tabs.split(' ');
  const hidden = !shown;
  // A bay stretches by its inner edge alone; a floating frame by every edge and corner.
  const handles = win.bay ? HANDLES.filter((h) => h === (win.bay === 'left' ? 'e' : 'w')) : HANDLES;
  // Only a window the city can open again by itself folds: its chip brings it back.
  const fold = canOpen(id) ? (
    <button type="button" className={s.tool} aria-label={w.fold} title={w.fold} disabled={spec.held} onClick={() => foldWindow(id)}>
      <FoldGlyph />
    </button>
  ) : null;
  // Onto another screen (CITY-75): a window that says how to open on its own, in a browser that can.
  const out = spec.detach && !app && canGoOut() ? (
    <button type="button" className={s.tool} aria-label={w.goOut} title={w.goOut} onClick={() => void goOut(id)}>
      <OutGlyph />
    </button>
  ) : null;

  return (
    <div
      ref={frame}
      className={[s.window, full && s.full, fit && s.fit, front && s.front, docked && !full && s.docked, !shown && s.tabHidden, glide && s.glide]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`, width: rect.width, ...(fit ? { maxHeight: rect.height } : { height: rect.height }), zIndex: full ? 1000 : z + 1 }}
      role="dialog"
      aria-modal={full || undefined}
      aria-labelledby={titleId}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      tabIndex={-1}
      data-window={id}
      data-window-full={full ? '' : undefined}
      data-window-fit={fit ? '' : undefined}
      data-window-bay={win.bay ?? undefined}
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
              <AskInWindow id={id} className={s.tool!} />
              {out}
              <button type="button" className={s.tool} aria-label={w.popOut} title={w.popOut} onClick={() => actions.popOut(id)}>
                <PopOutGlyph />
              </button>
              {fold}
              <button type="button" className={s.exit} onClick={() => actions.exitFull()}>
                <CloseGlyph />
                {w.exitFull}
              </button>
            </div>
          </div>
        ) : (
          <div className={s.head} onPointerDown={(event) => !isControl(event) && begin(event, 'move')} onDoubleClick={(event) => !isControl(event) && actions.full(id)}>
            {tabIds.length > 1 ? (
              <>
                <h2 id={titleId} className={s.unseen}>
                  {spec.title}
                </h2>
                <Tabs ids={tabIds} shown={id} />
              </>
            ) : (
              <>
                {spec.icon && <span className={s.icon}>{spec.icon}</span>}
                <h2 id={titleId} className={s.title}>
                  {spec.title}
                </h2>
              </>
            )}
            <div className={s.tools}>
              <AskInWindow id={id} className={s.tool!} />
              {out}
              <button type="button" className={s.tool} aria-label={w.full} title={w.full} onClick={() => actions.full(id)}>
                <FullGlyph />
              </button>
              <button type="button" className={s.tool} aria-label={w.popOut} title={w.popOut} disabled={!docked} onClick={() => actions.popOut(id)}>
                <PopOutGlyph />
              </button>
              {fold}
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
          {handles.map((handle) => (
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

/** The tabs of a frame several windows share: each its glyph and title; a tap shows it. The frame's head stays draggable. */
function Tabs({ ids, shown }: { ids: readonly string[]; shown: string }) {
  const w = useWords(WINDOW);
  const specs = useWindows((st) => st.specs);
  return (
    <div className={s.headTabs} role="tablist" aria-label={w.tabs}>
      {ids.map((tab) => {
        const spec = specs[tab];
        if (!spec) return null;
        return (
          <button key={tab} type="button" role="tab" aria-selected={tab === shown} className={s.headTab} title={spec.title} onClick={() => useWindows.getState().raise(tab)}>
            {spec.icon && <span className={s.icon}>{spec.icon}</span>}
            <span className={s.headTabTitle}>{spec.title}</span>
          </button>
        );
      })}
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

/** A drag by the head moves a frame out of its bay only past this many pixels: a press on the head is not a lift. */
const LIFT_PX = 6;

/**
 * A drag by the head (`move`) or by an edge or corner: every step is worked out from where the windows stood when the
 * pointer went down, at most once a frame; the layout is remembered when the pointer lets go. A frame in a bay lifts
 * out of it once the pointer has really moved; over a place to land (a bay, another frame's head) the place lights up,
 * and letting go there docks the frame or makes it a tab.
 */
function useDrag(id: string) {
  return (event: ReactPointerEvent<HTMLElement>, kind: 'move' | Handle) => {
    if (event.button !== 0) return;
    const store = useWindows.getState();
    let start = store.layout;
    let own = placed(start, id);
    if (!store.desk || start.full === id || !own) return;
    event.preventDefault();
    event.stopPropagation();
    let x0 = event.clientX;
    let y0 = event.clientY;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let last: PointerEvent | null = null;
    let frame = 0;
    let landing: Drop | null = null;
    const apply = () => {
      frame = 0;
      if (!last || !own) return;
      if (kind === 'move' && own.bay) {
        if (Math.hypot(last.clientX - x0, last.clientY - y0) < LIFT_PX) return;
        start = liftIn(start, id, { x: last.clientX, y: last.clientY });
        own = placed(start, id)!;
        x0 = last.clientX;
        y0 = last.clientY;
      }
      const dx = last.clientX - x0;
      const dy = last.clientY - y0;
      const next = kind === 'move' ? moveIn(start, id, own.rect, dx, dy) : resizeIn(start, id, kind, dx, dy);
      landing = kind === 'move' ? dropAt(next.layout, id, { x: last.clientX, y: last.clientY }) : null;
      useWindows.getState().drag(next.layout, landing ? [] : next.guides, landing);
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
      if (landing) useWindows.getState().drop(id, landing);
      else useWindows.getState().settle();
    };
    // While a window moves the city under the pointer does not take the drag.
    document.documentElement.setAttribute('data-window-drag', kind);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };
}
