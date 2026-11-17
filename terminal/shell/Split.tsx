'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { hydrateSide, setSheetOpen, setSideShut, setSideWidth, useSide } from './side';
import { SIDE_MIN, sideAtPointer, sideByKey, sideClamp, sideMax } from './split-rules';
import { SHELL } from './words';
import s from './split.module.css';

/**
 * A screen with a side column — the ticket, the pool, the agent.
 *
 * - Desk: the screen's own column, a strip with a grip, and the side column. 400 px on a 1440 window, wider on a wider
 *   one; the person drags the strip either way (or its arrows, Home and End); a double click gives the default back.
 *   The fold button hides the side column to a narrow strip; the browser remembers the width and the fold per `id`.
 * - A narrow desk, where both columns do not fit: the side column stands under the screen's own, whole width.
 * - Phone (`phone="sheet"`, the default): the side column is a sheet over the tab bar. Its grip folds it to its bar —
 *   `peek`, when the screen gives one (the coin and its price) — and opens it again; a screen opens it with
 *   `openSide(id)` when the person picks a row. It stands open at first; `sheetStart="folded"` starts it on its bar,
 *   for a screen whose first look is its own column (the home market: the person picks the coin before the ticket
 *   opens). Once the person opens or folds it, that holds. `phone="stack"` keeps it in the page, under the screen's
 *   column.
 *
 * The side column stays mounted when folded, so a ticket keeps what the person typed.
 */
export function Split({
  id = 'ticket',
  side,
  peek,
  label,
  phone = 'sheet',
  sheetStart = 'open',
  className,
  children,
}: {
  /** Which side column this is: each keeps its own width and fold. Short, lower case. */
  id?: string;
  side: ReactNode;
  /** On a phone, what the folded sheet shows on its bar. */
  peek?: ReactNode;
  /** The side column's name for a screen reader. */
  label: string;
  phone?: 'sheet' | 'stack';
  /** On a phone, how the sheet stands until the person opens or folds it: open (the default), or folded to its bar. */
  sheetStart?: 'open' | 'folded';
  className?: string;
  children: ReactNode;
}) {
  const w = useWords(SHELL);
  const memory = useSide((st) => st.memory[id]);
  const sheetOpen = useSide((st) => st.sheet[id] ?? sheetStart === 'open');
  const wrap = useRef<HTMLDivElement>(null);
  const sideBox = useRef<HTMLElement>(null);
  const [live, setLive] = useState<number | null>(null);
  // The last width under the pointer, as the pointer moved: a fast release can come before the render of the last move.
  const liveRef = useRef<number | null>(null);
  const [room, setRoom] = useState({ split: 0, win: 0 });
  const dragging = useRef(false);
  const foldBtn = useRef<HTMLButtonElement>(null);
  const unfoldBtn = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef<'fold' | 'unfold' | null>(null);

  useLayoutEffect(() => hydrateSide(), []);

  // The split's own width, for the handle's limits — set only when it changes.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const look = () => setRoom((was) => (was.split === el.clientWidth && was.win === window.innerWidth ? was : { split: el.clientWidth, win: window.innerWidth }));
    look();
    const watch = new ResizeObserver(look);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // On a phone the sheet stands over the page's foot: the frame's body keeps that much room after its last block
  // (`--sheet-h`, read by shell.module.css), so nothing of the screen stays under the sheet. Written on the body, which
  // the watch does not observe.
  useEffect(() => {
    const box = sideBox.current;
    const body = wrap.current?.closest('main');
    if (!box || !body || phone !== 'sheet') return;
    const look = () => body.style.setProperty('--sheet-h', `${Math.ceil(box.getBoundingClientRect().height)}px`);
    look();
    const watch = new ResizeObserver(look);
    watch.observe(box);
    return () => {
      watch.disconnect();
      body.style.removeProperty('--sheet-h');
    };
  }, [phone]);

  // After a fold the focus goes to the button that brings the column back, and back to the strip after the unfold.
  useEffect(() => {
    const to = moveFocus.current;
    moveFocus.current = null;
    if (to === 'fold') unfoldBtn.current?.focus();
    else if (to === 'unfold') handleRef.current?.focus();
  });

  const shut = memory?.shut ?? false;
  const kept = live ?? memory?.width ?? null;
  const width = sideClamp(kept ?? Number.NaN, room.split, room.win);

  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !wrap.current) return;
    const rect = wrap.current.getBoundingClientRect();
    const next = sideAtPointer(event.clientX, rect.right, rect.width, window.innerWidth);
    liveRef.current = next;
    setLive(next);
  };
  const drop = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (liveRef.current !== null) setSideWidth(id, liveRef.current);
    liveRef.current = null;
    setLive(null);
  };
  const fold = (shut: boolean) => {
    moveFocus.current = shut ? 'fold' : 'unfold';
    setSideShut(id, shut);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = sideByKey(event.key, width, room.split, room.win);
    if (next === null) return;
    event.preventDefault();
    setSideWidth(id, next);
  };

  // No width of the person's: the sheet's default follows the window (split.module.css), so nothing jumps on a wide one.
  const style = kept !== null ? ({ ['--side-w' as string]: `${width}px` } as CSSProperties) : undefined;

  return (
    <div ref={wrap} className={`${s.split}${className ? ` ${className}` : ''}`} data-phone={phone} data-shut={shut ? '' : undefined} data-folded={sheetOpen ? undefined : ''} data-dragging={live !== null ? '' : undefined}>
      <div className={s.grid} style={style}>
        <div className={s.main}>{children}</div>
        <div className={s.gutter}>
          {shut ? null : (
            <>
              <button ref={foldBtn} type="button" className={s.fold} aria-label={w.fold} title={w.fold} onClick={() => fold(true)}>
                <Icon name="fold" size="s" />
              </button>
              <div
                ref={handleRef}
                role="separator"
                tabIndex={0}
                className={s.handle}
                aria-label={w.resize}
                aria-orientation="vertical"
                aria-valuemin={SIDE_MIN}
                aria-valuemax={sideMax(room.split)}
                aria-valuenow={width}
                onPointerDown={grab}
                onPointerMove={move}
                onPointerUp={drop}
                onPointerCancel={drop}
                onLostPointerCapture={drop}
                onDoubleClick={() => setSideWidth(id, null)}
                onKeyDown={key}
              >
                <span className={s.grip} aria-hidden="true" />
              </div>
            </>
          )}
        </div>
        <aside ref={sideBox} className={s.side} aria-label={label}>
          <button ref={unfoldBtn} type="button" className={s.unfold} aria-label={w.unfold} title={w.unfold} onClick={() => fold(false)}>
            <Icon name="unfold" size="s" />
          </button>
          <button type="button" className={s.sheetGrip} aria-label={sheetOpen ? w.fold : w.unfold} aria-expanded={sheetOpen} onClick={() => setSheetOpen(id, !sheetOpen)}>
            <span className={s.sheetBar} aria-hidden="true" />
          </button>
          {peek ? (
            <button type="button" className={s.peek} aria-expanded={false} onClick={() => setSheetOpen(id, true)}>
              {peek}
            </button>
          ) : null}
          <div className={s.sideBody}>{side}</div>
        </aside>
      </div>
    </div>
  );
}
