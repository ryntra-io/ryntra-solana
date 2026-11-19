'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { DESK_GUTTER, DESK_LIMITS, deskAtPointer, deskByKey, deskGrid, deskMax, type DeskPart } from './desk-rules';
import { hydrateDesk, setDeskFolded, setDeskMeasure, useDesk } from './desk-store';
import { DESK } from './desk-words';
import k from './desk.module.css';

/**
 * The coin's trading desk on the whole screen: the chart is the main area; beside it the narrow column of the market's trades and
 * liquidity; on the right the ticket the whole height; under the chart and the column the bottom panel. The person
 * drags every border (or its arrows, Home and End; a double click gives the default back), folds the column and the
 * bottom panel to a strip, and the browser keeps it all. A desk too narrow for the column keeps the chart and the
 * ticket: the column's tabs then stand in the bottom panel (`wide` tells the screen).
 */
export function Desk({ chart, tape, ticket, bottom, tapeLabel, bottomLabel, onWide }: { chart: ReactNode; tape: ReactNode; ticket: ReactNode; bottom: ReactNode; tapeLabel: string; bottomLabel: string; onWide?: (wide: boolean) => void }) {
  const d = useWords(DESK);
  const memory = useDesk((st) => st.memory);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<Readonly<{ part: DeskPart; value: number }> | null>(null);
  const liveRef = useRef<Readonly<{ part: DeskPart; value: number }> | null>(null);

  useLayoutEffect(() => hydrateDesk(), []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const look = () => setRoom((was) => (was.w === el.clientWidth && was.h === el.clientHeight ? was : { w: el.clientWidth, h: el.clientHeight }));
    look();
    const watch = new ResizeObserver(look);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const held = live ? { ...memory, [live.part]: live.value } : memory;
  const grid = deskGrid(held, room.w, room.h);
  const wide = room.w === 0 ? true : grid.wide;
  useEffect(() => onWide?.(wide), [wide, onWide]);

  const limits = (part: DeskPart) => ({ min: DESK_LIMITS[part].min, max: deskMax(part, room.w, room.h, part === 'tape' ? grid.ticket : part === 'ticket' ? grid.tape : 0) });
  const value = (part: DeskPart) => (part === 'tape' ? grid.tape : part === 'ticket' ? grid.ticket : grid.bottom);
  const clampLive = (part: DeskPart, next: number) => {
    const { min, max } = limits(part);
    return Math.round(Math.min(max, Math.max(min, next)));
  };

  const handle = (part: DeskPart) => {
    const vertical = part !== 'bottom';
    const grab = (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      liveRef.current = { part, value: value(part) };
      setLive(liveRef.current);
    };
    const move = (event: PointerEvent<HTMLDivElement>) => {
      if (!liveRef.current || liveRef.current.part !== part || !box.current) return;
      const rect = box.current.getBoundingClientRect();
      // The ticket's far edge is the desk's right; the column's is where the ticket begins; the bottom's, the desk's foot.
      const far = part === 'ticket' ? rect.right : part === 'tape' ? rect.right - grid.ticket - DESK_GUTTER : rect.bottom;
      const next = clampLive(part, deskAtPointer(part, vertical ? event.clientX : event.clientY, far));
      liveRef.current = { part, value: next };
      setLive(liveRef.current);
    };
    const drop = () => {
      const was = liveRef.current;
      if (!was || was.part !== part) return;
      liveRef.current = null;
      setLive(null);
      setDeskMeasure(part, was.value);
    };
    const key = (event: KeyboardEvent<HTMLDivElement>) => {
      const { min, max } = limits(part);
      const next = deskByKey(event.key, value(part), min, max);
      if (next === null) return;
      event.preventDefault();
      setDeskMeasure(part, next);
    };
    const { min, max } = limits(part);
    return (
      <div
        role="separator"
        tabIndex={0}
        className={k.handle}
        data-part={part}
        aria-label={part === 'tape' ? d.resizeTape : part === 'ticket' ? d.resizeTicket : d.resizeBottom}
        title={part === 'tape' ? d.resizeTape : part === 'ticket' ? d.resizeTicket : d.resizeBottom}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value(part)}
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={drop}
        onPointerCancel={drop}
        onLostPointerCapture={drop}
        onDoubleClick={() => setDeskMeasure(part, null)}
        onKeyDown={key}
      >
        <span className={k.grip} aria-hidden="true" />
      </div>
    );
  };

  // Before the desk is measured (the server, the first paint) the sheet's own defaults stand: nothing jumps.
  const style = room.w > 0 ? ({ ['--tape' as string]: `${grid.tape}px`, ['--ticket' as string]: `${grid.ticket}px`, ['--bottom' as string]: `${grid.bottom}px` } as CSSProperties) : undefined;
  const tapeFolded = memory.folded.tape;
  const bottomFolded = memory.folded.bottom;

  return (
    <div ref={box} className={k.desk} style={style} data-wide={wide ? '' : undefined} data-dragging={live ? live.part : undefined}>
      <section className={k.chart}>{chart}</section>
      {wide ? (
        <>
          {tapeFolded ? null : handle('tape')}
          <section className={k.tape} aria-label={tapeLabel} data-folded={tapeFolded ? '' : undefined}>
            {tapeFolded ? (
              <button type="button" className={k.strip} aria-label={`${d.unfold}: ${tapeLabel}`} title={d.unfold} onClick={() => setDeskFolded('tape', false)}>
                <Icon name="unfold" size="s" />
                <span className={k.stripWord}>{tapeLabel}</span>
              </button>
            ) : (
              <>
                {tape}
                <button type="button" className={k.fold} data-part="tape" aria-label={`${d.fold}: ${tapeLabel}`} title={d.fold} onClick={() => setDeskFolded('tape', true)}>
                  <Icon name="fold" size="s" />
                </button>
              </>
            )}
          </section>
        </>
      ) : null}
      {handle('ticket')}
      <aside className={k.ticket}>{ticket}</aside>
      {bottomFolded ? <div className={k.gap} aria-hidden="true" /> : handle('bottom')}
      <section className={k.bottom} aria-label={bottomLabel} data-folded={bottomFolded ? '' : undefined}>
        {bottom}
        <button type="button" className={k.fold} data-part="bottom" aria-label={`${bottomFolded ? d.unfold : d.fold}: ${bottomLabel}`} title={bottomFolded ? d.unfold : d.fold} aria-expanded={!bottomFolded} onClick={() => setDeskFolded('bottom', !bottomFolded)}>
          <Icon name={bottomFolded ? 'unfold' : 'fold'} size="s" />
        </button>
      </section>
    </div>
  );
}
