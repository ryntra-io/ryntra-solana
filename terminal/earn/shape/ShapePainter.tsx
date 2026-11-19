'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Icon, Info, Kick, Quiet } from '@/terminal/ui';
import { COLUMNS, LEVELS, MAX_NAME, PRESETS, SIDE, cellAt, nextName, paintColumn, paintStroke, presetColumns, pressCells, redo, undo, type Columns } from './model';
import { useShape } from './store';
import { SHAPE } from './words';
import s from './shape.module.css';

/** A shape in small: its 32 columns as bars, the price's line between the halves. Decorative — the control carries the name. */
function Glyph({ columns }: { columns: Columns }) {
  return (
    <svg className={s.glyph} viewBox={`0 0 ${COLUMNS} ${LEVELS}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {columns.map((cells, column) => (cells > 0 ? <rect key={column} className={s.glyphBar} data-side={column < SIDE ? 'under' : 'over'} x={column + 0.15} y={LEVELS - cells} width={0.7} height={cells} /> : null))}
    </svg>
  );
}

type Stroke = { pointer: number; last: Readonly<{ column: number; cells: number }>; columns: Columns };

/**
 * The grid: 32 columns of 8 cells, the price's line between the halves, the range's prices under it. A finger or the
 * mouse paints by dragging; a press on a column's top cell takes it off. The keys paint too: ← → pick a column, ↑ ↓
 * set its height. What a stroke painted is kept when the stroke ends — one step back for «Undo». While the wallet holds
 * the form (`locked`), nothing paints: what is on the grid is what is being signed.
 */
function Grid({ columns, onPaint, locked, low, now, high }: { columns: Columns; onPaint: (columns: Columns) => void; locked: boolean; low: string; now: string; high: string }) {
  const w = useWords(SHAPE);
  const lang = useLang();
  const box = useRef<HTMLDivElement>(null);
  /* The stroke under way: read by every pointer event as it comes, drawn from the state beside it. */
  const stroke = useRef<Stroke | null>(null);
  const [live, setLive] = useState<Columns | null>(null);
  const [focus, setFocus] = useState(SIDE);
  /* The wallet took the form: a stroke under way ends unkept, and the grid shows only what is being signed. */
  useEffect(() => {
    if (!locked) return;
    stroke.current = null;
    setLive(null);
  }, [locked]);
  const shown = locked ? columns : (live ?? columns);

  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return cellAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (locked || stroke.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const cell = at(event);
    if (!cell) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const cells = pressCells(columns, cell);
    setFocus(cell.column);
    stroke.current = { pointer: event.pointerId, last: { column: cell.column, cells }, columns: paintColumn(columns, cell.column, cells) };
    setLive(stroke.current.columns);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const now = stroke.current;
    if (locked || !now || now.pointer !== event.pointerId) return;
    const cell = at(event);
    if (!cell || (cell.column === now.last.column && cell.cells === now.last.cells)) return;
    now.columns = paintStroke(now.columns, now.last, cell);
    now.last = cell;
    setLive(now.columns);
  };
  /* The stroke ends where the pointer lifts, is cancelled, or is let go of: what it painted is kept. */
  const lift = (event: PointerEvent<HTMLDivElement>) => {
    const now = stroke.current;
    if (!now || now.pointer !== event.pointerId) return;
    if (event.type === 'pointerup') move(event);
    stroke.current = null;
    setLive(null);
    if (!locked) onPaint(now.columns);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setFocus((was) => (event.key === 'Home' ? 0 : event.key === 'End' ? COLUMNS - 1 : Math.max(0, Math.min(COLUMNS - 1, was + step))));
      return;
    }
    const height = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (!height || locked) return;
    event.preventDefault();
    const next = paintColumn(columns, focus, (columns[focus] ?? 0) + height);
    if (next !== columns) onPaint(next);
  };
  const side = focus < SIDE ? w.under : w.over;
  const place = focus < SIDE ? SIDE - focus : focus - SIDE + 1;

  return (
    <div className={s.gridWrap}>
      <div
        ref={box}
        className={s.grid}
        data-earn-shape="grid"
        data-painting={live ? '' : undefined}
        data-locked={locked ? '' : undefined}
        tabIndex={0}
        role="application"
        aria-label={w.grid}
        aria-disabled={locked || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={lift}
        onPointerCancel={lift}
        onLostPointerCapture={lift}
        onKeyDown={keys}
      >
        <span className={s.said} aria-live="polite">
          {digits(w.column(side, String(place), String(shown[focus] ?? 0)), lang)}
        </span>
        <svg className={s.cells} viewBox={`0 0 ${COLUMNS} ${LEVELS}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {shown.flatMap((cells, column) =>
            Array.from({ length: LEVELS }, (_, row) => (
              <rect key={`${column}-${row}`} className={s.cell} data-side={column < SIDE ? 'under' : 'over'} data-on={row < cells ? '' : undefined} x={column + 0.09} y={LEVELS - row - 1 + 0.09} width={0.82} height={0.82} />
            )),
          )}
          <rect className={s.focusRing} x={focus + 0.02} y={0.02} width={0.96} height={LEVELS - 0.04} />
        </svg>
        <span className={s.line} aria-hidden="true" />
      </div>
      <div className={s.prices} data-earn-shape="prices">
        <span>{low}</span>
        <span data-at="mid">
          <b>{now}</b>
        </span>
        <span data-at="end">{high}</span>
      </div>
    </div>
  );
}

/** «Save as mine»: the name, prefilled, and the two buttons; the kept shapes as a row to take one from. */
function Mine({ onUse }: { onUse: (columns: Columns) => void }) {
  const w = useWords(SHAPE);
  const saved = useShape((st) => st.saved);
  const [naming, setNaming] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const open = naming !== null;
  useEffect(() => {
    useShape.getState().load();
  }, []);
  useEffect(() => {
    if (open) field.current?.select();
  }, [open]);

  const keep = (event: FormEvent) => {
    event.preventDefault();
    if (naming === null || !naming.trim()) return;
    setMissed(!useShape.getState().save(naming));
    setNaming(null);
  };

  return (
    <div className={s.mine} data-earn-shape="mine">
      {saved && saved.length ? (
        <div className={s.mineRow} role="group" aria-label={w.mine}>
          {saved.map((shape) => (
            <span key={shape.id} className={s.saved}>
              <button type="button" className={s.savedUse} aria-label={w.use(shape.name)} onClick={() => onUse(shape.columns)}>
                <Glyph columns={shape.columns} />
                <span>{shape.name}</span>
              </button>
              <button type="button" className={s.savedOff} aria-label={w.remove(shape.name)} onClick={() => useShape.getState().remove(shape.id)}>
                <Icon name="close" size="s" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {naming !== null ? (
        <form className={s.naming} onSubmit={keep}>
          <input ref={field} className={s.name} value={naming} maxLength={MAX_NAME} aria-label={w.nameLabel} onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setNaming(null)} />
          <Quiet size="s" type="submit" disabled={!naming.trim()}>
            {w.keep}
          </Quiet>
          <Quiet size="s" onClick={() => setNaming(null)}>
            {w.cancel}
          </Quiet>
        </form>
      ) : (
        <Quiet size="s" full onClick={() => setNaming(nextName(useShape.getState().saved ?? [], w.nameOf))} data-earn-shape="save">
          {w.save}
        </Quiet>
      )}
      {missed ? <p className={s.note}>{w.notKept}</p> : null}
    </div>
  );
}

/**
 * A shape of one's own on the ticket: «Start from» one of four shapes, the grid to paint over it, a stroke
 * back and forth, and the person's own shapes kept under a name. `onShape` is asked to take every grid first — the
 * form builds its figures for it after a pause, as for any choice — and the grid shows only what the form took: what is
 * painted is always what a Review is built for. `locked` — the wallet holds the form, and nothing paints.
 */
export function ShapePainter({ onShape, locked = false, low, now, high }: { onShape: (columns: Columns) => boolean; locked?: boolean; low: string; now: string; high: string }) {
  const w = useWords(SHAPE);
  const history = useShape((st) => st.history);
  const columns = history.present;
  const keep = (next: Columns) => {
    if (!locked && onShape(next)) useShape.getState().set(next);
  };
  const step = (move: 'undo' | 'redo') => {
    const target = (move === 'undo' ? undo : redo)(useShape.getState().history).present;
    if (!locked && onShape(target)) useShape.getState()[move]();
  };

  return (
    <div className={s.painter} data-earn-shape="painter">
      <div className={s.head}>
        <Kick>{w.shape}</Kick>
        <span className={s.tools}>
          <button type="button" className={s.tool} aria-label={w.undo} title={w.undo} disabled={!history.past.length} onClick={() => step('undo')}>
            <Icon name="undo" size="s" />
          </button>
          <button type="button" className={s.tool} aria-label={w.redo} title={w.redo} disabled={!history.future.length} onClick={() => step('redo')}>
            <Icon name="redo" size="s" />
          </button>
          <Info label={w.about}>{w.aboutText}</Info>
        </span>
      </div>
      <div className={s.starts} role="group" aria-label={w.startFrom}>
        <span className={s.startWord}>{w.startFrom}</span>
        {PRESETS.map((preset) => (
          <button key={preset} type="button" className={s.start} aria-label={w[preset]} title={w[preset]} onClick={() => keep(presetColumns(preset))} data-earn-shape={`start-${preset}`}>
            <Glyph columns={presetColumns(preset)} />
          </button>
        ))}
      </div>
      <Grid columns={columns} onPaint={keep} locked={locked} low={low} now={now} high={high} />
      <Mine onUse={keep} />
    </div>
  );
}
